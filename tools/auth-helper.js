
  // Chitransh sign-in helper (window.chitranshFirebase).
  // Google and email + password use Firebase Auth directly. Email OTP codes are sent and
  // checked by the Netlify functions at /api/otp/*, which return a Firebase custom token.
  // Member profiles live in Firestore at members/{uid}; rules let each member read and write only their own.
  import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
  import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    signInWithCustomToken,
    linkWithCredential,
    sendPasswordResetEmail,
    updatePassword,
    updateProfile,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    signOut
  } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
  import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

  const firebaseConfig = __FIREBASE_CONFIG__;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  window.firebaseAuth = auth;

  const MEMBER_KEY = "lekha.member.v1";
  const NOTES_KEY = "lekha.notes.v1";
  const PROFILE_FIELDS = ["fullName", "email", "phone", "gender", "seeking", "kulId", "gotra", "city", "age", "maritalStatus", "profession", "profileFor", "photoURL", "authMethod"];
  const REQUIRED_FIELDS = ["fullName", "gender", "kulId", "gotra", "city"];

  // The email-code server runs on Netlify; the GitHub Pages copy calls the main Netlify site.
  const host = location.hostname;
  const API_BASE = (host.endsWith(".netlify.app") || host === "localhost") ? "" : "https://chitranshh.netlify.app";

  const AUTH_MESSAGES = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-disabled": "This account has been disabled. Please contact us.",
    "auth/invalid-credential": "Email or password is incorrect. Try again, use Login with OTP, or reset your password.",
    "auth/invalid-login-credentials": "Email or password is incorrect. Try again, use Login with OTP, or reset your password.",
    "auth/wrong-password": "Email or password is incorrect. Try again, use Login with OTP, or reset your password.",
    "auth/user-not-found": "Email or password is incorrect. Try again, use Login with OTP, or reset your password.",
    "auth/missing-password": "Please enter your password.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/email-already-in-use": "An account with this email already exists. Please log in instead.",
    "auth/weak-password": "Please choose a stronger password (at least 6 characters).",
    "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/cancelled-popup-request": "Google sign-in was cancelled.",
    "auth/unauthorized-domain": "Google sign-in isn't allowed on this web address yet. Please use the main site or log in with email.",
    "auth/operation-not-allowed": "This sign-in method is switched off. Please use another way to log in.",
    "auth/network-request-failed": "Network problem. Check your internet connection and try again.",
    "auth/account-exists-with-different-credential": "This email already has an account. Log in with OTP (or your password) once, and Google will be linked to it.",
    "auth/requires-recent-login": "Please log in again to continue.",
    "auth/invalid-custom-token": "That code could not be used. Please request a new one.",
    "permission-denied": "We couldn't save your profile. Please log in again."
  };

  const OTP_MESSAGES = {
    invalid_email: "Please enter a valid Email ID.",
    invalid_code: "Please enter the 6-digit code from your email.",
    too_soon: "Please wait a few seconds before asking for another code.",
    too_many: "Too many codes requested for this email. Please try again in an hour.",
    rate_limited: "Too many code requests from your network. Please try again later.",
    email_failed: "We couldn't send the email just now. Please try again in a minute.",
    no_code: "Please request a new code first.",
    expired: "This code has expired. Please request a new one.",
    wrong_code: "That code is incorrect.",
    locked: "Too many wrong tries. Please request a new code.",
    locked_day: "Too many wrong codes for this email today. Please try again tomorrow or use another sign-in method.",
    daily_cap: "Email codes are busy right now. Please try again later, or use Google or your password.",
    account_disabled: "This account has been disabled. Please contact us.",
    server_not_configured: "Email sign-in isn't set up yet. Please use Google or your password for now.",
    origin_not_allowed: "Email sign-in isn't available on this web address.",
    server_error: "Something went wrong on our side. Please try again."
  };

  function friendly(err, fallback) {
    const code = err && err.code;
    const e = new Error((code && AUTH_MESSAGES[code]) || (err && err.friendly) || fallback || "Something went wrong. Please try again.");
    e.code = code;
    if (err && err.retryAfter) e.retryAfter = err.retryAfter;
    return e;
  }

  async function callOtp(path, payload) {
    let res;
    try {
      res = await fetch(API_BASE + "/api/otp/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw friendly({ code: "auth/network-request-failed" });
    }
    let body = {};
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(OTP_MESSAGES[body.error] || OTP_MESSAGES.server_error);
      err.friendly = err.message;
      if (body.error === "wrong_code" && body.attemptsLeft) {
        err.friendly = "That code is incorrect. " + body.attemptsLeft + (body.attemptsLeft === 1 ? " try" : " tries") + " left.";
      }
      if (body.error === "too_soon" && body.retryAfter) {
        err.friendly = "Please wait " + body.retryAfter + " seconds before asking for another code.";
        err.retryAfter = body.retryAfter;
      }
      err.code = "otp/" + (body.error || "server_error");
      throw err;
    }
    return body;
  }

  function cleanProfile(p) {
    const out = {};
    for (const k of PROFILE_FIELDS) {
      if (p && p[k] !== undefined && p[k] !== null) out[k] = typeof p[k] === "string" ? p[k].trim().slice(0, 200) : String(p[k]).slice(0, 200);
    }
    return out;
  }

  function isComplete(p) {
    return !!p && REQUIRED_FIELDS.every((k) => typeof p[k] === "string" && p[k].trim().length > 0);
  }

  function methodOf(user) {
    const ids = (user.providerData || []).map((x) => x.providerId);
    if (ids.includes("google.com")) return "Google";
    if (ids.includes("password")) return "Email & Password";
    return "Email OTP";
  }

  function readNotes() {
    try { const raw = localStorage.getItem(NOTES_KEY); const n = raw ? JSON.parse(raw) : []; return Array.isArray(n) ? n.filter((x) => typeof x === "string").slice(0, 200) : []; } catch (e) { return []; }
  }

  async function loadProfile(uid) {
    const snap = await getDoc(doc(db, "members", uid));
    return snap.exists() ? snap.data() : null;
  }

  function toMember(user, profile) {
    return { ...profile, uid: user.uid, email: (profile && profile.email) || user.email || "" };
  }

  // After any successful Firebase sign-in: return the saved member, or ask the app to collect the profile.
  // A Google sign-in that hit "account exists" is linked after the person proves the email another way.
  let pendingGoogle = null;
  async function linkPendingGoogle(user) {
    if (!pendingGoogle || !user.email || pendingGoogle.email !== user.email.toLowerCase()) return;
    const cred = pendingGoogle.credential;
    pendingGoogle = null;
    try { await linkWithCredential(user, cred); } catch (e) {}
  }

  async function finishSignIn(user, authMethod, review) {
    sessionStorage.removeItem("lekha.logged_out");
    await linkPendingGoogle(user);
    let profile = null;
    try { profile = await loadProfile(user.uid); } catch (e) { throw friendly(e, "We couldn't load your profile. Please try again."); }
    // review: the account was reset because nobody had proved this email before, so the
    // person checks the saved details before entering.
    if (!review && isComplete(profile)) return toMember(user, profile);
    return {
      needsProfile: true,
      uid: user.uid,
      email: user.email || "",
      fullName: (profile && profile.fullName) || user.displayName || "",
      photoURL: user.photoURL || "",
      profile: profile ? cleanProfile(profile) : null,
      authMethod: authMethod || methodOf(user)
    };
  }

  async function writeProfile(user, profile) {
    const data = cleanProfile({ ...profile, email: user.email || profile.email || "", photoURL: profile.photoURL || user.photoURL || "" });
    const existing = await loadProfile(user.uid).catch(() => null);
    const payload = { ...data, requestedIntroductions: readNotes(), updatedAt: new Date().toISOString() };
    if (!existing) payload.createdAt = payload.updatedAt;
    try {
      await setDoc(doc(db, "members", user.uid), payload, { merge: true });
    } catch (e) {
      throw friendly(e, "We couldn't save your profile. Please try again.");
    }
    if (data.fullName && data.fullName !== user.displayName) updateProfile(user, { displayName: data.fullName }).catch(() => {});
    return toMember(user, { ...(existing || {}), ...data });
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  // Restore a real session on page load, and clear any sign-in left over from the old demo login.
  let firstAuthEvent = true;
  onAuthStateChanged(auth, async (user) => {
    const first = firstAuthEvent;
    firstAuthEvent = false;
    const appApi = window.__chitranshApp;
    if (!user) {
      if (first) {
        try { localStorage.removeItem(MEMBER_KEY); } catch (e) {}
        if (appApi && appApi.setUser) appApi.setUser(null);
      }
      return;
    }
    if (sessionStorage.getItem("lekha.logged_out") === "1") return;
    try {
      const profile = await loadProfile(user.uid);
      if (!isComplete(profile)) return;
      const member = toMember(user, profile);
      localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
      if (appApi && appApi.setUser) appApi.setUser(member);
    } catch (e) {}
  });

  window.chitranshFirebase = {
    ready: true,

    async setRemember(remember) {
      try { await setPersistence(auth, remember === false ? browserSessionPersistence : browserLocalPersistence); } catch (e) {}
    },

    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      let result;
      try {
        result = await signInWithPopup(auth, provider);
      } catch (e) {
        if (e && e.code === "auth/account-exists-with-different-credential") {
          const credential = GoogleAuthProvider.credentialFromError(e);
          const email = e.customData && e.customData.email;
          if (credential && email) pendingGoogle = { credential, email: String(email).toLowerCase() };
        }
        throw friendly(e, "Google sign-in could not complete. Please try again.");
      }
      return finishSignIn(result.user, "Google");
    },

    // target: an email address. Mobile OTP is not available yet.
    async sendOtp(target) {
      const email = String(target || "").trim().toLowerCase();
      if (!isEmail(email)) throw new Error("Mobile OTP is coming soon. Please use your Email ID for now.");
      try {
        const res = await callOtp("send", { email });
        return {
          notice: "We've sent a 6-digit code to " + email + ". It expires in 10 minutes. Check your spam folder if you don't see it.",
          resendInSec: res.resendInSec || 30
        };
      } catch (e) {
        throw friendly(e);
      }
    },

    async verifyOtp({ target, enteredCode }) {
      const email = String(target || "").trim().toLowerCase();
      let res;
      try {
        res = await callOtp("verify", { email, code: String(enteredCode || "").trim() });
      } catch (e) {
        throw friendly(e);
      }
      try {
        const cred = await signInWithCustomToken(auth, res.token);
        return finishSignIn(cred.user, "Email OTP", !!res.passwordReset);
      } catch (e) {
        throw friendly(e);
      }
    },

    async signInWithEmail({ email, password }) {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, String(email || "").trim().toLowerCase(), password);
      } catch (e) {
        throw friendly(e);
      }
      return finishSignIn(cred.user, "Email & Password");
    },

    // Sign-up: prove the email with a code, set the chosen password, save the profile.
    async registerWithEmailOtp({ email, code, password, profile }) {
      const cleanEmail = String(email || "").trim().toLowerCase();
      if (!password || password.length < 6) throw new Error("Create a password of at least 6 characters.");
      let res;
      try {
        res = await callOtp("verify", { email: cleanEmail, code: String(code || "").trim() });
      } catch (e) {
        throw friendly(e);
      }
      let user;
      try {
        user = (await signInWithCustomToken(auth, res.token)).user;
      } catch (e) {
        throw friendly(e);
      }
      await linkPendingGoogle(user);
      const hasPassword = (user.providerData || []).some((x) => x.providerId === "password");
      if (res.isNew || res.passwordReset || !hasPassword) {
        try { await updatePassword(user, password); } catch (e) { throw friendly(e); }
      }
      const existing = await loadProfile(user.uid).catch(() => null);
      if (isComplete(existing) && !res.passwordReset) return toMember(user, existing); // already a member: just log in
      return writeProfile(user, { ...profile, email: cleanEmail, authMethod: "Email Verified" });
    },

    // For people already signed in (Google / OTP) who still need to fill in their profile.
    async saveProfile(profile) {
      const user = auth.currentUser;
      if (!user) throw new Error("Your sign-in expired. Please log in again.");
      return writeProfile(user, profile);
    },

    async resetPassword(email) {
      const clean = String(email || "").trim().toLowerCase();
      if (!isEmail(clean)) throw new Error("Enter your Email ID above, then tap Forgot password.");
      try {
        await sendPasswordResetEmail(auth, clean);
      } catch (e) {
        if (e && e.code === "auth/user-not-found") return; // don't reveal which emails are registered
        throw friendly(e);
      }
    },

    syncMemberProfile(member) {
      const user = auth.currentUser;
      if (!user || !member || member.uid !== user.uid) return;
      writeProfile(user, member).catch(() => {});
    },

    async logout() {
      sessionStorage.setItem("lekha.logged_out", "1");
      try { await signOut(auth); } catch (e) {}
    }
  };
