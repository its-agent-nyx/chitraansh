// In-browser stand-ins for the three Firebase CDN modules, used only by test/e2e.mjs.
export const firebaseApp = `export function initializeApp(c){ return { options: c }; }`;

export const firebaseAuth = `
const F = (window.__fake ||= { users: {}, current: null, listeners: [], n: 0, popupUser: null, resets: [], db: {} });
F.linked ||= [];
function err(code){ const e = new Error(code); e.code = code; return e; }
function setCurrent(u){ F.current = u; F.listeners.forEach((f) => f(u)); return { user: u }; }
function byEmail(email){ return Object.values(F.users).find((x) => x.email === email); }
function mkUser(uid, email, providers){ const u = { uid, email, displayName: null, photoURL: null, providerData: providers.map((p) => ({ providerId: p })), password: null }; F.users[uid] = u; return u; }
export function getAuth(){ return { get currentUser(){ return F.current; } }; }
export class GoogleAuthProvider { setCustomParameters(){} static credentialFromError(e){ return e && e.cred || null; } }
export async function linkWithCredential(u, cred){ F.linked.push({ uid: u.uid, cred }); if (!u.providerData.some((p) => p.providerId === 'google.com')) u.providerData.push({ providerId: 'google.com' }); }
export const browserLocalPersistence = 'local', browserSessionPersistence = 'session';
export async function setPersistence(){}
export async function signInWithPopup(){
  if (!F.popupUser) throw err('auth/popup-closed-by-user');
  if (F.popupUser.conflict) { const e = err('auth/account-exists-with-different-credential'); e.customData = { email: F.popupUser.email }; e.cred = { google: F.popupUser.email }; throw e; }
  const u = byEmail(F.popupUser.email) || mkUser('g' + (++F.n), F.popupUser.email, ['google.com']);
  u.displayName = F.popupUser.name; return setCurrent(u);
}
export async function signInWithEmailAndPassword(a, email, pw){
  const u = byEmail(email); if (!u || u.password !== pw) throw err('auth/invalid-credential'); return setCurrent(u);
}
export async function createUserWithEmailAndPassword(a, email, pw){
  if (byEmail(email)) throw err('auth/email-already-in-use');
  const u = mkUser('p' + (++F.n), email, ['password']); u.password = pw; return setCurrent(u);
}
export async function signInWithCustomToken(a, token){
  const [, uid, email] = token.split(':');
  const u = F.users[uid] || mkUser(uid, email, []); return setCurrent(u);
}
export async function updatePassword(u, pw){ u.password = pw; if (!u.providerData.some((p) => p.providerId === 'password')) u.providerData.push({ providerId: 'password' }); }
export async function updateProfile(u, d){ Object.assign(u, d); }
export async function sendPasswordResetEmail(a, email){ F.resets.push(email); }
export function onAuthStateChanged(a, cb){ F.listeners.push(cb); setTimeout(() => cb(F.current), 0); return () => {}; }
export async function signOut(){ setCurrent(null); }
`;

export const firebaseFirestore = `
const F = (window.__fake ||= { users: {}, current: null, listeners: [], n: 0, popupUser: null, resets: [], db: {} });
function err(code){ const e = new Error(code); e.code = code; return e; }
export function getFirestore(){ return {}; }
export function doc(db, col, id){ return { col, id, path: col + '/' + id }; }
function owner(ref){ if (!F.current || F.current.uid !== ref.id) throw err('permission-denied'); }
export async function getDoc(ref){ owner(ref); const d = F.db[ref.path]; return { exists: () => !!d, data: () => ({ ...d }) }; }
export async function setDoc(ref, data, opts){ owner(ref); F.db[ref.path] = opts && opts.merge ? { ...(F.db[ref.path] || {}), ...data } : { ...data }; }
`;
