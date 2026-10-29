// Vercel entry point for the email-code server.
// /api/otp/send and /api/otp/verify are rewritten here by vercel.json (?action=send|verify).
import { handleSend, handleVerify } from '../netlify/lib/http.mjs';

export default {
  fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || url.pathname.split('/').pop();
    if (action === 'send') return handleSend(request);
    if (action === 'verify') return handleVerify(request);
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
};
