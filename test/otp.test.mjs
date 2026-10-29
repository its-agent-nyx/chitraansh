import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCode, verifyCode, OTP_COLLECTION, sha256, MAX_ATTEMPTS, IP_MAX_PER_HOUR, MAX_FAILS_PER_DAY } from '../netlify/lib/otp.mjs';
import { allowedOrigin, brevoSender, missingEnv } from '../netlify/lib/http.mjs';

// Minimal in-memory stand-in for the Firestore Admin API used by otp.mjs.
function fakeDb() {
  const store = new Map();
  const ref = (col, id) => {
    const key = `${col}/${id}`;
    return {
      key,
      async update(data) { store.set(key, { ...(store.get(key) || {}), ...data }); },
    };
  };
  return {
    store,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    async runTransaction(fn) {
      const tx = {
        async get(r) { const d = store.get(r.key); return { exists: !!d, data: () => ({ ...d }) }; },
        set(r, d) { store.set(r.key, { ...d }); },
        update(r, d) { store.set(r.key, { ...(store.get(r.key) || {}), ...d }); },
      };
      return fn(tx);
    },
  };
}

function fakeAuth(existing = {}) {
  const users = new Map(Object.entries(existing));
  let n = 0;
  return {
    users,
    async getUserByEmail(email) {
      const u = [...users.values()].find((x) => x.email === email);
      if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; }
      return { ...u };
    },
    async createUser({ email, emailVerified }) { const u = { uid: `u${++n}`, email, emailVerified }; users.set(u.uid, u); return u; },
    revoked: [],
    async updateUser(uid, data) { users.set(uid, { ...users.get(uid), ...data }); },
    async revokeRefreshTokens(uid) { this.revoked.push(uid); },
    async createCustomToken(uid) { return `token-for-${uid}`; },
  };
}

const SECRET = 'test-secret';

async function sendAndCapture(db, email, now = 1_000_000, ip = '1.2.3.4') {
  let code = null;
  const out = await sendCode({ db, secret: SECRET, email, ip, now, sendEmail: async ({ code: c }) => { code = c; } });
  return { out, code };
}

test('sends a 6-digit code and stores only its hash', async () => {
  const db = fakeDb();
  const { out, code } = await sendAndCapture(db, 'Asha@Example.com ');
  assert.equal(out.status, 200);
  assert.match(code, /^\d{6}$/);
  const doc = db.store.get(`${OTP_COLLECTION}/${sha256('asha@example.com')}`);
  assert.ok(doc.codeHash);
  assert.ok(!JSON.stringify(doc).includes(code), 'plain code must not be stored');
});

test('rejects bad emails', async () => {
  const db = fakeDb();
  for (const bad of ['', 'abc', 'a@b', '9876543210']) {
    const { out } = await sendAndCapture(db, bad);
    assert.equal(out.status, 400, bad);
  }
});

test('resend cooldown and hourly limit', async () => {
  const db = fakeDb();
  const t0 = 5_000_000;
  assert.equal((await sendAndCapture(db, 'a@x.in', t0)).out.status, 200);
  const soon = await sendAndCapture(db, 'a@x.in', t0 + 5_000);
  assert.equal(soon.out.status, 429);
  assert.equal(soon.out.body.error, 'too_soon');
  for (let i = 1; i < 5; i++) assert.equal((await sendAndCapture(db, 'a@x.in', t0 + i * 31_000)).out.status, 200);
  const sixth = await sendAndCapture(db, 'a@x.in', t0 + 6 * 31_000);
  assert.equal(sixth.out.body.error, 'too_many');
  assert.equal((await sendAndCapture(db, 'a@x.in', t0 + 61 * 60_000)).out.status, 200, 'resets after an hour');
});

test('per-IP limit', async () => {
  const db = fakeDb();
  for (let i = 0; i < IP_MAX_PER_HOUR; i++) assert.equal((await sendAndCapture(db, `p${i}@x.in`, 1_000, '9.9.9.9')).out.status, 200);
  assert.equal((await sendAndCapture(db, 'last@x.in', 1_000, '9.9.9.9')).out.body.error, 'rate_limited');
});

test('email failure returns 502 and leaves no usable code', async () => {
  const db = fakeDb();
  const out = await sendCode({ db, secret: SECRET, email: 'f@x.in', now: 1, sendEmail: async () => { throw new Error('down'); } });
  assert.equal(out.status, 502);
  const v = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'f@x.in', code: '123456', now: 2 });
  assert.equal(v.body.error, 'no_code');
});

test('correct code creates a verified user and returns a token; code is single-use', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  const { code } = await sendAndCapture(db, 'new@x.in', 100);
  const ok = await verifyCode({ db, auth, secret: SECRET, email: 'NEW@x.in', code, now: 200 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isNew, true);
  assert.match(ok.body.token, /^token-for-/);
  assert.equal([...auth.users.values()][0].emailVerified, true);
  const again = await verifyCode({ db, auth, secret: SECRET, email: 'new@x.in', code, now: 300 });
  assert.equal(again.body.error, 'no_code');
});

test('unverified account (maybe pre-registered by someone else) is reset and its sessions revoked', async () => {
  const db = fakeDb();
  const auth = fakeAuth({ u9: { uid: 'u9', email: 'old@x.in', emailVerified: false, password: 'attacker-pass' } });
  const { code } = await sendAndCapture(db, 'old@x.in', 100);
  const ok = await verifyCode({ db, auth, secret: SECRET, email: 'old@x.in', code, now: 200 });
  assert.equal(ok.body.isNew, false);
  assert.equal(ok.body.passwordReset, true);
  assert.equal(ok.body.token, 'token-for-u9');
  assert.equal(auth.users.size, 1);
  const u = auth.users.get('u9');
  assert.equal(u.emailVerified, true);
  assert.notEqual(u.password, 'attacker-pass');
  assert.deepEqual(auth.revoked, ['u9']);
});

test('verified existing account is not reset', async () => {
  const db = fakeDb();
  const auth = fakeAuth({ v1: { uid: 'v1', email: 'ok@x.in', emailVerified: true, password: 'mine' } });
  const { code } = await sendAndCapture(db, 'ok@x.in', 100);
  const ok = await verifyCode({ db, auth, secret: SECRET, email: 'ok@x.in', code, now: 200 });
  assert.equal(ok.body.passwordReset, false);
  assert.equal(auth.users.get('v1').password, 'mine');
  assert.deepEqual(auth.revoked, []);
});

test('wrong guesses add up across new codes and lock the email for the day', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  let t = 1_000_000;
  let fails = 0;
  let last;
  while (fails < MAX_FAILS_PER_DAY) {
    const { code } = await sendAndCapture(db, 'brute@x.in', (t += 31_000));
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3 && fails < MAX_FAILS_PER_DAY; i++, fails++) {
      last = await verifyCode({ db, auth, secret: SECRET, email: 'brute@x.in', code: wrong, now: t });
    }
    t += 13 * 60_000; // next hour window
  }
  assert.equal(last.body.error, 'locked_day');
  const send = await sendAndCapture(db, 'brute@x.in', (t += 31_000));
  assert.equal(send.out.body.error, 'locked_day');
  const tomorrow = await sendAndCapture(db, 'brute@x.in', t + 25 * 60 * 60_000);
  assert.equal(tomorrow.out.status, 200);
});

test('site-wide daily cap', async () => {
  const db = fakeDb();
  for (let i = 0; i < 3; i++) {
    const out = await sendCode({ db, secret: SECRET, email: `c${i}@x.in`, now: 5, dailyCap: 3, sendEmail: async () => {} });
    assert.equal(out.status, 200);
  }
  const over = await sendCode({ db, secret: SECRET, email: 'c9@x.in', now: 5, dailyCap: 3, sendEmail: async () => {} });
  assert.equal(over.body.error, 'daily_cap');
});

test('a failed send does not wipe a newer code', async () => {
  const db = fakeDb();
  let newer;
  const out = await sendCode({
    db, secret: SECRET, email: 'race@x.in', now: 100,
    sendEmail: async () => {
      // Meanwhile a newer code was stored for the same email.
      newer = await sendAndCapture(db, 'race@x.in', 40_000, null);
      throw new Error('down');
    },
  });
  assert.equal(out.status, 502);
  const v = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'race@x.in', code: newer.code, now: 41_000 });
  assert.equal(v.status, 200);
});

test('123456 and other wrong codes fail; locks after max attempts', async () => {
  const db = fakeDb();
  const { code } = await sendAndCapture(db, 'w@x.in', 100);
  const wrong = code === '123456' ? '654321' : '123456';
  const first = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'w@x.in', code: wrong, now: 200 });
  assert.equal(first.body.error, 'wrong_code');
  assert.equal(first.body.attemptsLeft, MAX_ATTEMPTS - 1);
  for (let i = 2; i < MAX_ATTEMPTS; i++) await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'w@x.in', code: wrong, now: 200 });
  const last = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'w@x.in', code: wrong, now: 200 });
  assert.equal(last.body.error, 'locked');
  const evenRight = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'w@x.in', code, now: 200 });
  assert.equal(evenRight.body.error, 'locked');
});

test('expired code is rejected', async () => {
  const db = fakeDb();
  const { code } = await sendAndCapture(db, 'e@x.in', 0);
  const out = await verifyCode({ db, auth: fakeAuth(), secret: SECRET, email: 'e@x.in', code, now: 11 * 60_000 });
  assert.equal(out.body.error, 'expired');
});

test('CORS allows only the two sites and Netlify previews', () => {
  assert.equal(allowedOrigin('https://chitranshh.netlify.app'), 'https://chitranshh.netlify.app');
  assert.equal(allowedOrigin('https://chitraansh.netlify.app'), 'https://chitraansh.netlify.app');
  assert.equal(allowedOrigin('https://x1--chitranshh.netlify.app'), 'https://x1--chitranshh.netlify.app');
  assert.equal(allowedOrigin('https://its-agent-nyx.github.io'), 'https://its-agent-nyx.github.io');
  assert.equal(allowedOrigin('https://abc123--chitraansh.netlify.app'), 'https://abc123--chitraansh.netlify.app');
  assert.equal(allowedOrigin('https://chitraansh.vercel.app'), 'https://chitraansh.vercel.app');
  assert.equal(allowedOrigin('https://chitraansh-git-main-nyx.vercel.app'), 'https://chitraansh-git-main-nyx.vercel.app');
  assert.equal(allowedOrigin('https://kayasthalekh.com', { EXTRA_ALLOWED_ORIGINS: 'https://kayasthalekh.com' }), 'https://kayasthalekh.com');
  assert.equal(allowedOrigin('https://evil.vercel.app'), null);
  assert.equal(allowedOrigin('https://evil.example'), null);
  assert.equal(allowedOrigin('https://chitraansh.netlify.app.evil.example'), null);
});

test('reports missing environment variables by name', () => {
  assert.deepEqual(missingEnv({ FIREBASE_PROJECT_ID: 'x' }), ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL']);
});

test('Brevo request has the right shape and surfaces errors', async () => {
  let seen;
  const okFetch = async (url, init) => { seen = { url, init }; return { ok: true }; };
  await brevoSender({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'otp@site.in' }, okFetch)({ to: 'a@x.in', code: '042911' });
  const body = JSON.parse(seen.init.body);
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(seen.init.headers['api-key'], 'k');
  assert.equal(body.sender.email, 'otp@site.in');
  assert.equal(body.to[0].email, 'a@x.in');
  assert.ok(body.htmlContent.includes('042911') && body.subject.includes('042911'));
  const badFetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(brevoSender({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 's@x.in' }, badFetch)({ to: 'a@x.in', code: '1' }), /Brevo 401/);
});
