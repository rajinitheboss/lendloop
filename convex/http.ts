import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "./lib/signing";

/**
 * Endpoints called BY n8n. Every request must carry a valid HMAC
 * signature made with LENDLOOP_SECRET_N8N_TO_CONVEX (a different secret from
 * the one Convex uses to sign outgoing webhooks, so one leaked secret does
 * not open both directions).
 */

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Verified =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/** Read the raw body, verify the signature over it, then parse it. */
async function verifiedJson(request: Request): Promise<Verified> {
  const secret = process.env.LENDLOOP_SECRET_N8N_TO_CONVEX;
  if (!secret) {
    console.error("LENDLOOP_SECRET_N8N_TO_CONVEX is not set");
    return { ok: false, response: json(503, { error: "not_configured" }) };
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { error: "body_too_large" }) };
  }
  const result = await verifySignature(
    secret,
    raw,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
  );
  if (!result.ok) {
    // Deliberately vague to the caller; detailed in the logs.
    console.warn(`Rejected n8n request: signature ${result.reason}`);
    return { ok: false, response: json(401, { error: "invalid_signature" }) };
  }
  try {
    const body: unknown = JSON.parse(raw || "{}");
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { ok: false, response: json(400, { error: "invalid_body" }) };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: json(400, { error: "invalid_json" }) };
  }
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json(200, { ok: true })),
});

/** Overdue workflow, step 1: which borrowers need a reminder today? */
http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const v = await verifiedJson(request);
    if (!v.ok) return v.response;
    const result = await ctx.runQuery(internal.automation.listOverdueForReminders, {});
    return json(200, result);
  }),
});

/** Overdue workflow, step 2: record whether each reminder was sent. */
http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const v = await verifiedJson(request);
    if (!v.ok) return v.response;
    const reminderKey = str(v.body.reminderKey, 200);
    const status = v.body.status;
    if (!reminderKey || (status !== "sent" && status !== "failed")) {
      return json(400, { error: "expected { reminderKey, status: 'sent' | 'failed' }" });
    }
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      reminderKey,
      status,
      error: str(v.body.error, 500),
    });
    if (!result.ok) return json(result.error === "loan_not_found" ? 404 : 400, result);
    return json(200, result);
  }),
});

/** n8n error workflow: make failed executions visible in the admin page. */
http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const v = await verifiedJson(request);
    if (!v.ok) return v.response;
    const executionId = str(v.body.executionId, 100);
    const workflowName = str(v.body.workflowName, 200);
    // Truncate rather than reject: an error report must never be lost
    // because the error text happened to be long.
    const message =
      typeof v.body.message === "string" && v.body.message.length > 0
        ? v.body.message.slice(0, 1000)
        : undefined;
    if (!executionId || !workflowName || !message) {
      return json(400, { error: "expected { executionId, workflowName, message }" });
    }
    const result = await ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId,
      workflowName,
      message,
      nodeName: str(v.body.nodeName, 200),
    });
    return json(200, result);
  }),
});

export default http;
