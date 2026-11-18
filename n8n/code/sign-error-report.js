// Report a failed execution back to LendLoop so it shows on the admin page.
const crypto = require('crypto');
const secret = $env.LENDLOOP_SECRET_N8N_TO_CONVEX;
if (!secret) throw new Error('LENDLOOP_SECRET_N8N_TO_CONVEX is not set in the n8n environment');

const { execution = {}, workflow = {} } = $input.first().json;
const body = JSON.stringify({
  executionId: String(execution.id ?? `unknown-${Date.now()}`),
  workflowName: String(workflow.name ?? 'Unknown workflow'),
  nodeName: execution.lastNodeExecuted ? String(execution.lastNodeExecuted) : undefined,
  message: String(execution.error?.message ?? 'Unknown error').slice(0, 1000),
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
return [{ json: { body, timestamp, signature } }];
