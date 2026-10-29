// Email OTP logic shared by the Netlify functions.
// Codes are stored only as an HMAC hash in Firestore (collection "emailOtps"),
// expire after 10 minutes, allow 5 wrong tries, and are rate limited per email and per IP.
import crypto from 'node:crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;
export const IP_MAX_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

export const OTP_COLLECTION = 'emailOtps';
export const IP_COLLECTION = 'otpIpLimits';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashCode(secret, email, code) {
  return crypto.createHmac('sha256', String(secret)).update(`${email}:${code}`).digest('hex');
}

export function generateCode(randomInt = crypto.randomInt) {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const result = (status, body) => ({ status, body });

/**
 * Create a code for `email`, store its hash and email it.
 * deps: { db, sendEmail({ to, code }), secret, now? }
 */
export async function sendCode({ db, sendEmail, secret, email: rawEmail, ip, now = Date.now() }) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return result(400, { error: 'invalid_email' });

  // Per-IP limit, so one visitor cannot spam many inboxes.
  if (ip) {
    const ipRef = db.collection(IP_COLLECTION).doc(sha256(ip));
    const blocked = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ipRef);
      const d = snap.exists ? snap.data() : null;
      const fresh = !d || now - d.windowStart >= HOUR_MS;
      const count = fresh ? 0 : d.count;
      if (count >= IP_MAX_PER_HOUR) return true;
      tx.set(ipRef, { windowStart: fresh ? now : d.windowStart, count: count + 1 });
      return false;
    });
    if (blocked) return result(429, { error: 'rate_limited' });
  }

  const ref = db.collection(OTP_COLLECTION).doc(sha256(email));
  const code = generateCode();
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    if (d && d.sentAt && now - d.sentAt < RESEND_COOLDOWN_MS) {
      return { status: 429, body: { error: 'too_soon', retryAfter: Math.ceil((RESEND_COOLDOWN_MS - (now - d.sentAt)) / 1000) } };
    }
    const fresh = !d || !d.windowStart || now - d.windowStart >= HOUR_MS;
    const sends = fresh ? 0 : d.sends || 0;
    if (sends >= MAX_SENDS_PER_HOUR) return { status: 429, body: { error: 'too_many' } };
    tx.set(ref, {
      codeHash: hashCode(secret, email, code),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      sentAt: now,
      windowStart: fresh ? now : d.windowStart,
      sends: sends + 1,
    });
    return null;
  });
  if (outcome) return result(outcome.status, outcome.body);

  try {
    await sendEmail({ to: email, code });
  } catch (err) {
    console.error('otp email failed:', err && err.message);
    await ref.update({ codeHash: null, sentAt: 0 }).catch(() => {});
    return result(502, { error: 'email_failed' });
  }
  return result(200, { ok: true, expiresInSec: OTP_TTL_MS / 1000, resendInSec: RESEND_COOLDOWN_MS / 1000 });
}

/**
 * Check a code. On success, find or create the Firebase user for the email
 * and return a custom sign-in token.
 * deps: { db, auth (firebase-admin Auth), secret, now? }
 */
export async function verifyCode({ db, auth, secret, email: rawEmail, code: rawCode, now = Date.now() }) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode || '').trim();
  if (!isValidEmail(email)) return result(400, { error: 'invalid_email' });
  if (!/^\d{6}$/.test(code)) return result(400, { error: 'invalid_code' });

  const ref = db.collection(OTP_COLLECTION).doc(sha256(email));
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    if (!d || !d.codeHash) return { status: 400, body: { error: 'no_code' } };
    if (now > d.expiresAt) {
      tx.update(ref, { codeHash: null });
      return { status: 400, body: { error: 'expired' } };
    }
    if ((d.attempts || 0) >= MAX_ATTEMPTS) return { status: 429, body: { error: 'locked' } };
    if (!safeEqualHex(hashCode(secret, email, code), d.codeHash)) {
      const attempts = (d.attempts || 0) + 1;
      tx.update(ref, { attempts });
      return attempts >= MAX_ATTEMPTS
        ? { status: 429, body: { error: 'locked' } }
        : { status: 400, body: { error: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - attempts } };
    }
    // Correct: the code can be used once only. Keep the send counters.
    tx.update(ref, { codeHash: null, attempts: 0 });
    return null;
  });
  if (outcome) return result(outcome.status, outcome.body);

  let user;
  let isNew = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') {
      user = await auth.createUser({ email, emailVerified: true });
      isNew = true;
    } else {
      throw err;
    }
  }
  if (user.disabled) return result(403, { error: 'account_disabled' });
  if (!isNew && !user.emailVerified) {
    await auth.updateUser(user.uid, { emailVerified: true });
  }
  const token = await auth.createCustomToken(user.uid, { otp: 'email' });
  return result(200, { token, isNew });
}
