// Sign the request for the overdue list. Secret: env LENDLOOP_SECRET_N8N_TO_CONVEX.
const crypto = require('crypto');
const secret = $env.LENDLOOP_SECRET_N8N_TO_CONVEX;
if (!secret) throw new Error('LENDLOOP_SECRET_N8N_TO_CONVEX is not set in the n8n environment');

const body = JSON.stringify({ runId: String($execution.id) });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
return [{ json: { body, timestamp, signature } }];
