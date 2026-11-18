// Build and sign the write-back for one reminder. Runs once per item.
// `status` comes from which output of "Send reminder" the item arrived on.
const crypto = require('crypto');
const secret = $env.LENDLOOP_SECRET_N8N_TO_CONVEX;
if (!secret) throw new Error('LENDLOOP_SECRET_N8N_TO_CONVEX is not set in the n8n environment');

const reminder = $('Prepare reminders').item.json;
const failed = Boolean($json.error);
const payload = { reminderKey: reminder.reminderKey, status: failed ? 'failed' : 'sent' };
if (failed) {
  payload.error = String($json.error.message || $json.error).slice(0, 500);
}
const body = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
return { json: { body, timestamp, signature } };
