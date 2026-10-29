# Chitransh — Kayastha matrimony

- Live site: https://chitranshh.netlify.app/ (Netlify, built from the `main` branch)
- Mirror: https://its-agent-nyx.github.io/chitraansh/ (GitHub Pages, from the `gh-pages` branch)

## Sign-in

| Method | How it works |
|---|---|
| Google | Firebase Auth popup |
| Email + password | Firebase Auth; "Forgot password?" sends a Firebase reset email |
| Email OTP | `POST /api/otp/send` emails a 6-digit code through Brevo; `POST /api/otp/verify` checks it and returns a Firebase custom token |
| Mobile OTP | Not enabled yet (needs the paid Firebase Blaze plan for SMS) |

Email codes expire after 10 minutes and allow 5 wrong tries each, with 10 wrong tries per email per day across codes. Sends are limited to one every 30 seconds and 5 an hour per email, 20 an hour per IP address, and 250 a day for the whole site (`OTP_DAILY_CAP`). Only an HMAC hash of each code is stored, in the Firestore collection `emailOtps`.

If someone registered an email without proving it, the first code sign-in for that email replaces the password with a random one, signs out every other session, and asks the person to review the saved profile.

New members who sign in with Google or an email code complete their profile before entering. Profiles are stored in Firestore at `members/{uid}`, and `firestore.rules` lets each member read and write only their own.

## Layout

```
site/                 ready-made static site (Next.js export, patched)
netlify/functions/    otp-send.mjs, otp-verify.mjs
netlify/lib/          otp.mjs (code logic), http.mjs (Firebase Admin, Brevo, CORS)
firestore.rules       paste into Firebase console → Firestore → Rules
tools/                patch_site.py, auth-helper.js, login-logic.js, build_sites.py
test/                 otp.test.mjs (unit), e2e.mjs (browser, needs Playwright)
```

## Netlify environment variables

Set these in Project configuration → Environment variables. Never commit them.

| Key | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | `chitransh-513f7` |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the service account JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` from the service account JSON |
| `BREVO_API_KEY` | Brevo API key (Transactional email: All, everything else: None) |
| `BREVO_SENDER_EMAIL` | a sender address verified in Brevo |
| `BREVO_SENDER_NAME` | optional, defaults to `Chitransh` |
| `OTP_DAILY_CAP` | optional, emails per day for the whole site, defaults to `250` |

## Rebuilding the site from the original export

```
python3 tools/patch_site.py <original-export> /tmp/patched
python3 tools/build_sites.py /tmp/patched /tmp/out     # out/netlify -> site/, out/ghpages -> gh-pages branch
npm test
```
