// Browser test of the sign-in screens against stand-in Firebase modules and the real OTP logic.
// usage: node test/e2e.mjs <base-url>   (serve ./site at that URL first)
import { chromium } from 'playwright';
import { sendCode, verifyCode } from '../netlify/lib/otp.mjs';
import { firebaseApp, firebaseAuth, firebaseFirestore } from './fake-firebase.mjs';

const BASE = process.argv[2] || 'http://localhost:8803/';
const SHOTS = process.argv[3] || '.';

// Server-side stand-ins for Firestore and Firebase Admin Auth.
const store = new Map();
const db = {
  collection: (c) => ({ doc: (id) => ({ key: `${c}/${id}`, async update(d) { store.set(`${c}/${id}`, { ...(store.get(`${c}/${id}`) || {}), ...d }); } }) }),
  async runTransaction(fn) {
    return fn({
      async get(r) { const d = store.get(r.key); return { exists: !!d, data: () => ({ ...d }) }; },
      set(r, d) { store.set(r.key, { ...d }); },
      update(r, d) { store.set(r.key, { ...(store.get(r.key) || {}), ...d }); },
    });
  },
};
const adminUsers = new Map();
let un = 0;
const auth = {
  async getUserByEmail(email) { const u = [...adminUsers.values()].find((x) => x.email === email); if (!u) { const e = new Error(); e.code = 'auth/user-not-found'; throw e; } return u; },
  async createUser({ email, emailVerified }) { const u = { uid: `o${++un}`, email, emailVerified }; adminUsers.set(u.uid, u); return u; },
  async updateUser(uid, d) { Object.assign(adminUsers.get(uid), d); },
  async createCustomToken(uid) { return `tok:${uid}:${adminUsers.get(uid).email}`; },
};
const inbox = {};
let clock = Date.now();

const results = [];
function check(name, cond, extra = '') { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.route('https://www.gstatic.com/firebasejs/**', (route) => {
  const url = route.request().url();
  const body = url.endsWith('firebase-app.js') ? firebaseApp : url.endsWith('firebase-auth.js') ? firebaseAuth : firebaseFirestore;
  route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body });
});
await page.route('**/api/otp/*', async (route) => {
  const req = route.request();
  const body = JSON.parse(req.postData() || '{}');
  clock += 31_000; // step past the resend cooldown between requests
  const out = req.url().endsWith('/send')
    ? await sendCode({ db, secret: 's', email: body.email, ip: '1.1.1.1', now: clock, sendEmail: async ({ to, code }) => { inbox[to] = code; } })
    : await verifyCode({ db, auth, secret: 's', email: body.email, code: body.code, now: clock });
  route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
});

const dialog = () => page.getByRole('dialog');
async function openAuth(which) {
  await page.getByRole('button', { name: which, exact: true }).first().click();
  await dialog().waitFor();
}
async function typeCode(code) { await dialog().locator('input[maxlength="6"]').first().fill(code); }
async function member() { return page.evaluate(() => JSON.parse(localStorage.getItem('lekha.member.v1') || 'null')); }
async function alertText() { const a = dialog().getByRole('alert'); return (await a.count()) ? (await a.first().innerText()) : ''; }
async function logout() { await page.evaluate(async () => { await window.chitranshFirebase.logout(); localStorage.removeItem('lekha.member.v1'); window.__chitranshApp.setUser(null); }); }

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.chitranshFirebase && window.chitranshFirebase.ready);

// 1. Mobile number in the login box
await openAuth('Login');
await page.fill('#shaadi-login-id', '9876543210');
await dialog().getByRole('button', { name: 'Login with OTP' }).click();
check('mobile number shows "coming soon"', /coming soon/i.test(await alertText()), await alertText());
await page.screenshot({ path: `${SHOTS}/e2e-1-login.png` });

// 2. Email OTP login for a brand-new email -> profile completion
await page.fill('#shaadi-login-id', 'Asha.Srivastava@Example.com');
await dialog().getByRole('button', { name: 'Login with OTP' }).click();
await dialog().getByText('We\'ve sent a 6-digit code').waitFor();
check('no auto-fill / demo code on screen', !(await dialog().innerText()).match(/auto-fill|123456/i));
check('code emailed', /^\d{6}$/.test(inbox['asha.srivastava@example.com'] || ''));
await typeCode(inbox['asha.srivastava@example.com'] === '123456' ? '654321' : '123456');
await dialog().getByRole('button', { name: 'Verify & Login' }).click();
await page.waitForTimeout(300);
check('123456 is rejected', /incorrect/i.test(await alertText()), await alertText());
await typeCode(inbox['asha.srivastava@example.com']);
await dialog().getByRole('button', { name: 'Verify & Login' }).click();
await dialog().getByText('Please complete your profile').waitFor();
check('new OTP user is asked to complete profile', true);
await page.fill('#lekha-name', 'Asha Srivastava');
await dialog().getByRole('button', { name: 'Continue to Lineage Details ►' }).click();
await page.fill('#lekha-gotra', 'Kashyap');
await page.fill('#lekha-city', 'Lucknow');
await dialog().getByRole('button', { name: 'Continue ►', exact: true }).click();
check('email locked and no password asked', (await page.locator('#lekha-email').isDisabled()) && (await page.locator('#lekha-password').count()) === 0);
await page.fill('#lekha-phone', '9811122233');
await page.screenshot({ path: `${SHOTS}/e2e-2-complete-profile.png` });
await dialog().getByRole('button', { name: 'Save & Enter ►' }).click();
await dialog().waitFor({ state: 'hidden' });
let mem = await member();
check('OTP member saved with real details', mem && mem.email === 'asha.srivastava@example.com' && mem.phone === '9811122233' && mem.city === 'Lucknow', JSON.stringify(mem));
check('profile stored in Firestore under the user', await page.evaluate(() => Object.keys(window.__fake.db).length === 1));
await logout();

// 3. Sign-up with email + password, verified by an emailed code
await openAuth('Sign Up Free');
await page.fill('#lekha-name', 'Rohan Mathur');
await dialog().getByRole('button', { name: 'Continue to Lineage Details ►' }).click();
await page.fill('#lekha-gotra', 'Bharadwaj');
await page.fill('#lekha-city', 'Jaipur');
await dialog().getByRole('button', { name: 'Continue ►', exact: true }).click();
await page.fill('#lekha-email', 'rohan@example.in');
await page.fill('#lekha-phone', '9876501234');
await page.fill('#lekha-password', 'secret77');
await dialog().getByRole('button', { name: 'Email me a code ►' }).click();
await dialog().getByText('Verify Your Email').waitFor();
check('normal email and phone pass sign-up checks', true);
await page.screenshot({ path: `${SHOTS}/e2e-3-signup-code.png` });
await typeCode(inbox['rohan@example.in']);
await dialog().getByRole('button', { name: 'Verify & Complete Sign Up' }).click();
await dialog().waitFor({ state: 'hidden' });
mem = await member();
check('sign-up member saved', mem && mem.fullName === 'Rohan Mathur' && mem.gotra === 'Bharadwaj', JSON.stringify(mem));
await logout();

// 4. Password login: wrong then right
await openAuth('Login');
await dialog().getByRole('button', { name: 'Login with Password' }).click();
await page.fill('#pw-login-id', 'rohan@example.in');
await page.fill('#pw-login-pass', 'wrongpass');
await dialog().locator('form button[type=submit]', { hasText: 'Login' }).click();
await page.waitForTimeout(300);
check('wrong password shows a clear error', /incorrect/i.test(await alertText()), await alertText());
check('wrong password did not log in', (await member()) === null);
await dialog().getByRole('button', { name: 'Forgot password?' }).click();
await dialog().getByText('emailed a link').waitFor();
check('forgot password sends a reset email', await page.evaluate(() => window.__fake.resets.includes('rohan@example.in')));
await page.fill('#pw-login-pass', 'secret77');
await dialog().locator('form button[type=submit]', { hasText: 'Login' }).click();
await dialog().waitFor({ state: 'hidden' });
check('right password logs in', (await member())?.email === 'rohan@example.in');
await logout();

// 5. Google: cancelled, then new Google user completes profile
await openAuth('Login');
await dialog().getByRole('button', { name: 'Sign in with Google' }).click();
await page.waitForTimeout(300);
check('cancelled Google shows message, no fake login', /cancelled/i.test(await alertText()) && (await member()) === null, await alertText());
await page.evaluate(() => { window.__fake.popupUser = { email: 'meera@gmail.com', name: 'Meera Saxena' }; });
await dialog().getByRole('button', { name: 'Sign in with Google' }).click();
await dialog().getByText('Please complete your profile').waitFor();
check('Google name prefilled', (await page.inputValue('#lekha-name')) === 'Meera Saxena');

check('no page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
