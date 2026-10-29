// HTTP wrapper for the OTP functions: environment, Firebase Admin, Brevo, CORS.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { sendCode, verifyCode } from './otp.mjs';

const REQUIRED_ENV = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL'];

const ALLOWED_ORIGINS = new Set([
  'https://chitranshh.netlify.app',
  'https://chitraansh.netlify.app',
  'https://its-agent-nyx.github.io',
  'http://localhost:8888',
  'http://localhost:3000',
]);

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Netlify deploy previews: https://<id>--chitranshh.netlify.app
  if (/^https:\/\/[a-z0-9-]+--(chitranshh|chitraansh)\.netlify\.app$/.test(origin)) return origin;
  return null;
}

function json(status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function missingEnv(env = process.env) {
  return REQUIRED_ENV.filter((k) => !env[k]);
}

function privateKey(env) {
  // Netlify may store the key with literal "\n" sequences or with real line breaks.
  let key = env.FIREBASE_PRIVATE_KEY.trim();
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  return key.replace(/\\n/g, '\n');
}

let cached = null;
function services(env = process.env) {
  if (cached) return cached;
  const app = getApps()[0] || initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey(env),
    }),
  });
  cached = { auth: getAuth(app), db: getFirestore(app), secret: env.OTP_SECRET || privateKey(env) };
  return cached;
}

export function brevoSender(env = process.env, fetchImpl = fetch) {
  return async ({ to, code }) => {
    const name = env.BREVO_SENDER_NAME || 'Chitransh';
    const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name, email: env.BREVO_SENDER_EMAIL },
        to: [{ email: to }],
        subject: `${code} is your Chitransh sign-in code`,
        textContent: `Your Chitransh sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for this code, you can ignore this email.`,
        htmlContent: `<!doctype html><html><body style="margin:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1d1a24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:460px;background:#ffffff;border:1px solid #e5d7b4;border-radius:16px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#9a7a2c">Chitransh · Kayastha Matrimony</td></tr>
<tr><td style="padding:0 28px;font-size:16px;line-height:1.5">Your sign-in code is:</td></tr>
<tr><td style="padding:14px 28px"><div style="font-size:34px;font-weight:bold;letter-spacing:10px;color:#1d1a24">${code}</div></td></tr>
<tr><td style="padding:0 28px 28px;font-size:14px;line-height:1.5;color:#5b5566">It expires in 10 minutes. If you didn't ask for this code, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Brevo ${res.status}: ${text.slice(0, 200)}`);
    }
  };
}

function clientIp(req, context) {
  return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '';
}

function makeHandler(action) {
  return async (req, context) => {
    const origin = allowedOrigin(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return json(204, null, origin);
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);
    if (req.headers.get('origin') && !origin) return json(403, { error: 'origin_not_allowed' }, null);

    const missing = missingEnv();
    if (missing.length) {
      console.error('Missing environment variables:', missing.join(', '));
      return json(500, { error: 'server_not_configured' }, origin);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'bad_request' }, origin);
    }

    try {
      const { auth, db, secret } = services();
      const out = action === 'send'
        ? await sendCode({ db, secret, sendEmail: brevoSender(), email: body.email, ip: clientIp(req, context), dailyCap: Number(process.env.OTP_DAILY_CAP) || undefined })
        : await verifyCode({ db, auth, secret, email: body.email, code: body.code });
      return json(out.status, out.body, origin);
    } catch (err) {
      console.error(`otp ${action} failed:`, err && (err.code || err.message));
      return json(500, { error: 'server_error' }, origin);
    }
  };
}

export const handleSend = makeHandler('send');
export const handleVerify = makeHandler('verify');
