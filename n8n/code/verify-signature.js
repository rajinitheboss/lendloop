// Verify the HMAC signature Convex put on this webhook, using the exact raw
// bytes that were signed (not a re-serialised copy of the parsed JSON).
// Secret: env LENDLOOP_SECRET_CONVEX_TO_N8N. Never hard-code it here.
const crypto = require('crypto');

const MAX_SKEW_SECONDS = 300;
const secret = $env.LENDLOOP_SECRET_CONVEX_TO_N8N;
if (!secret) {
  throw new Error('LENDLOOP_SECRET_CONVEX_TO_N8N is not set in the n8n environment');
}

const headers = $input.first().json.headers || {};
const timestamp = String(headers['x-lendloop-timestamp'] || '');
const signature = String(headers['x-lendloop-signature'] || '');
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');

let reason = null;
if (!/^\d{1,12}$/.test(timestamp) || !signature) {
  reason = 'missing';
} else if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) {
  reason = 'stale';
} else {
  const expected = Buffer.from(
    'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex'),
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    reason = 'mismatch';
  }
}
if (reason) {
  return [{ json: { valid: false, reason } }];
}

const event = JSON.parse(raw);
// Idempotency: Convex may retry a delivery whose response was lost.
// Event ids we already handled are kept in workflow static data.
const seen = $getWorkflowStaticData('global').seen || {};
return [{ json: { valid: true, duplicate: Boolean(seen[event.id]), event } }];
