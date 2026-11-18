#!/usr/bin/env node
/**
 * Generates n8n/workflows/*.json from the Code-node sources in n8n/code/.
 * Keeping node code in real .js files makes it reviewable and diff-able;
 * the JSON files are what you import into n8n (and are committed too).
 *
 *   node n8n/scripts/build-workflows.mjs
 *
 * No secrets are ever written into the JSON: Code nodes read them from
 * environment variables, and the SMTP node references an n8n credential
 * by id/name only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = (file) => readFileSync(join(root, "code", file), "utf8").trimEnd();

export const IDS = {
  notifications: "LendLoopNotify01",
  overdue: "LendLoopOverdue1",
  errors: "LendLoopErrors01",
  smtpCredential: "LendLoopSmtp0001",
};

const SMTP = { smtp: { id: IDS.smtpCredential, name: "LendLoop SMTP" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 };

const codeNode = (name, file, position, extra = {}) => ({
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  parameters: { jsCode: code(file), ...extra },
});

const ifNode = (name, leftValue, position) => ({
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: `${name.toLowerCase().replace(/\W+/g, "-")}-cond`,
          leftValue,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
});

const respond = (name, code, body, position) => ({
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.4,
  position,
  parameters: { respondWith: "json", responseBody: body, options: { responseCode: code } },
});

/** POST a pre-signed body ({ body, timestamp, signature } on the item) to Convex. */
const signedPost = (name, path, position, extra = {}) => ({
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position,
  ...RETRY,
  ...extra,
  parameters: {
    method: "POST",
    url: `={{ $env.LENDLOOP_API_URL }}${path}`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "X-LendLoop-Timestamp", value: "={{ $json.timestamp }}" },
        { name: "X-LendLoop-Signature", value: "={{ $json.signature }}" },
      ],
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: "={{ $json.body }}",
    options: { timeout: 10000 },
  },
});

const email = (name, position, extra = {}) => ({
  name,
  type: "n8n-nodes-base.emailSend",
  typeVersion: 2.1,
  position,
  credentials: SMTP,
  ...RETRY,
  ...extra,
  parameters: {
    fromEmail: "={{ $env.LENDLOOP_MAIL_FROM || 'LendLoop <no-reply@lendloop.local>' }}",
    toEmail: "={{ $json.to }}",
    subject: "={{ $json.subject }}",
    emailFormat: "text",
    text: "={{ $json.text }}",
    options: { appendAttribution: false },
  },
});

const link = (from, to, output = 0) => ({ from, to, output });

function workflow({ id, name, nodes, links, settings = {} }) {
  const connections = {};
  for (const { from, to, output } of links) {
    connections[from] ??= { main: [] };
    const outs = connections[from].main;
    while (outs.length <= output) outs.push([]);
    outs[output].push({ node: to, type: "main", index: 0 });
  }
  return {
    id,
    name,
    nodes: nodes.map((n, i) => ({ id: `${id}-node-${i + 1}`, ...n })),
    connections,
    settings: { executionOrder: "v1", ...settings },
    pinData: {},
    active: false,
    tags: [],
  };
}

const notifications = workflow({
  id: IDS.notifications,
  name: "LendLoop · Loan notifications",
  settings: { errorWorkflow: IDS.errors },
  nodes: [
    {
      name: "Loan event webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 300],
      webhookId: "6f1c2a8e-4b7d-4e59-9d3a-1e2d3c4b5a60",
      parameters: {
        httpMethod: "POST",
        path: "lendloop/loan-events",
        responseMode: "responseNode",
        options: { rawBody: true },
      },
    },
    codeNode("Verify signature", "verify-signature.js", [220, 300]),
    ifNode("Signature valid?", "={{ $json.valid }}", [440, 300]),
    respond("Reject (401)", 401, '={{ { "error": "invalid_signature" } }}', [660, 480]),
    ifNode("Already handled?", "={{ $json.duplicate }}", [660, 200]),
    respond("Acknowledge duplicate", 200, '={{ { "ok": true, "duplicate": true } }}', [880, 80]),
    codeNode("Compose email", "compose-notification.js", [880, 280]),
    email("Send email", [1100, 280]),
    codeNode("Remember event", "remember-event.js", [1320, 280]),
    respond("Acknowledge", 200, '={{ { "ok": true } }}', [1540, 280]),
  ],
  links: [
    link("Loan event webhook", "Verify signature"),
    link("Verify signature", "Signature valid?"),
    link("Signature valid?", "Already handled?", 0),
    link("Signature valid?", "Reject (401)", 1),
    link("Already handled?", "Acknowledge duplicate", 0),
    link("Already handled?", "Compose email", 1),
    link("Compose email", "Send email"),
    link("Send email", "Remember event"),
    link("Remember event", "Acknowledge"),
  ],
});

const overdue = workflow({
  id: IDS.overdue,
  name: "LendLoop · Overdue reminders",
  settings: { errorWorkflow: IDS.errors },
  nodes: [
    {
      name: "Every day at 09:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 200],
      parameters: { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 9 }] } },
    },
    {
      name: "Run now (manual)",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 400],
      parameters: {},
    },
    codeNode("Sign request", "sign-overdue-request.js", [220, 300]),
    signedPost("Fetch overdue loans", "/n8n/overdue-loans", [440, 300]),
    codeNode("Prepare reminders", "prepare-reminders.js", [660, 300]),
    email("Send reminder", [880, 300], { onError: "continueErrorOutput" }),
    codeNode("Sign write-back", "sign-reminder-status.js", [1100, 300], { mode: "runOnceForEachItem" }),
    signedPost("Write status to Convex", "/n8n/reminder-status", [1320, 300]),
  ],
  links: [
    link("Every day at 09:00", "Sign request"),
    link("Run now (manual)", "Sign request"),
    link("Sign request", "Fetch overdue loans"),
    link("Fetch overdue loans", "Prepare reminders"),
    link("Prepare reminders", "Send reminder"),
    link("Send reminder", "Sign write-back", 0),
    link("Send reminder", "Sign write-back", 1),
    link("Sign write-back", "Write status to Convex"),
  ],
});

const errors = workflow({
  id: IDS.errors,
  name: "LendLoop · Error handler",
  nodes: [
    {
      name: "On workflow error",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {},
    },
    codeNode("Sign error report", "sign-error-report.js", [220, 200]),
    signedPost("Report to Convex", "/n8n/workflow-error", [440, 200], { onError: "continueRegularOutput" }),
    {
      name: "Compose alert",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 420],
      parameters: {
        jsCode: [
          "const { execution = {}, workflow = {} } = $input.first().json;",
          "return [{ json: {",
          "  to: $env.LENDLOOP_OPS_EMAIL || 'ops@lendloop.local',",
          "  subject: `[LendLoop] ${workflow.name ?? 'Workflow'} failed`,",
          "  text: [",
          "    `Workflow: ${workflow.name ?? 'unknown'}`,",
          "    `Failed node: ${execution.lastNodeExecuted ?? 'unknown'}`,",
          "    `Error: ${execution.error?.message ?? 'unknown'}`,",
          "    `Execution: ${execution.url ?? execution.id ?? 'unknown'}`,",
          "  ].join('\\n'),",
          "} }];",
        ].join("\n"),
      },
    },
    email("Email on-call", [440, 420], { onError: "continueRegularOutput" }),
  ],
  links: [
    link("On workflow error", "Sign error report"),
    link("Sign error report", "Report to Convex"),
    link("On workflow error", "Compose alert"),
    link("Compose alert", "Email on-call"),
  ],
});

const files = {
  "loan-notifications.json": notifications,
  "overdue-reminders.json": overdue,
  "error-handler.json": errors,
};
for (const [file, wf] of Object.entries(files)) {
  writeFileSync(join(root, "workflows", file), JSON.stringify(wf, null, 2) + "\n");
  console.log(`wrote n8n/workflows/${file}`);
}
