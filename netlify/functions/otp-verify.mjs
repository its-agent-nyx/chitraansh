// POST /api/otp/verify  { email, code }  ->  { token, isNew } (Firebase custom token)
import { handleVerify } from '../lib/http.mjs';

export default handleVerify;
export const config = { path: '/api/otp/verify' };
