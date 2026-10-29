// POST /api/otp/send  { email }  ->  emails a 6-digit sign-in code
import { handleSend } from '../lib/http.mjs';

export default handleSend;
export const config = { path: '/api/otp/send' };
