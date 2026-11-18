import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addDays, todayUtc } from "./lib/dates";
import { signPayload, verifySignature, timingSafeEqual } from "./lib/signing";
import schema from "./schema";
import { modules } from "./test.setup";

const INBOUND_SECRET = "test-inbound-secret";

function setup() {
  const t = convexTest(schema, modules);
  const as = (subject: string, name: string, email: string) =>
    t.withIdentity({ subject, tokenIdentifier: `test|${subject}`, name, email });
  return { t, as };
}

async function newUser(
  t: ReturnType<typeof convexTest>,
  as: ReturnType<typeof setup>["as"],
  subject: string,
  name: string,
  email: string,
) {
  const client = as(subject, name, email);
  const id = (await client.mutation(api.users.store, {})) as Id<"users">;
  return { client, id };
}

const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V drill with two batteries and a bit set.",
};

const today = todayUtc();
const inDays = (n: number) => addDays(today, n);

beforeEach(() => {
  vi.stubEnv("LENDLOOP_SECRET_N8N_TO_CONVEX", INBOUND_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication and roles", () => {
  test("signed-out users can read the public list but nothing else", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    await lender.client.mutation(api.tools.create, drill);

    const pub = await t.query(api.tools.listPublic, {});
    expect(pub).toEqual([{ _id: expect.any(String), name: drill.name, category: drill.category }]);

    await expect(t.query(api.tools.browse, {})).rejects.toThrow(/sign in/i);
    await expect(t.mutation(api.tools.create, drill)).rejects.toThrow(/sign in/i);
  });

  test("new users are never admins, and users cannot call admin functions", async () => {
    const { t, as } = setup();
    const u = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    expect((await u.client.query(api.users.me, {}))?.role).toBe("user");
    await expect(u.client.query(api.loans.listForAdmin, {})).rejects.toThrow(/only admins/i);
    await expect(
      u.client.mutation(api.users.setTrustedLender, { userId: u.id, trusted: true }),
    ).rejects.toThrow(/only admins/i);
  });

  test("admin can trust a lender, see all loans and remove any listing", async () => {
    const { t, as } = setup();
    const admin = await newUser(t, as, "a1", "Admin Person", "admin@example.com");
    await t.mutation(internal.users.setRole, { email: "ADMIN@example.com", role: "admin" });
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(3),
    });

    await admin.client.mutation(api.users.setTrustedLender, { userId: lender.id, trusted: true });
    const browse = await borrower.client.query(api.tools.browse, {});
    expect(browse[0].owner).toEqual({ firstName: "Asha", trustedLender: true });

    expect(await admin.client.query(api.loans.listForAdmin, {})).toHaveLength(1);

    await expect(
      admin.client.mutation(api.tools.adminRemove, { toolId, reason: "" }),
    ).rejects.toThrow(/reason/i);
    await admin.client.mutation(api.tools.adminRemove, { toolId, reason: "Unsafe item" });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
    // The pending request was cancelled and the borrower notified.
    const [mine] = await borrower.client.query(api.loans.myRequests, {});
    expect(mine.status).toBe("cancelled");
  });
});

describe("ownership rules", () => {
  test("only the owner can edit or delete a listing", async () => {
    const { t, as } = setup();
    const owner = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const other = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await owner.client.mutation(api.tools.create, drill);

    await expect(
      other.client.mutation(api.tools.update, { toolId, ...drill, name: "Hacked" }),
    ).rejects.toThrow(/your own listings/i);
    await expect(other.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(/your own listings/i);

    await owner.client.mutation(api.tools.update, { toolId, ...drill, name: "  Hammer   drill " });
    expect((await owner.client.query(api.tools.mine, {}))[0].name).toBe("Hammer drill");
    await owner.client.mutation(api.tools.remove, { toolId });
    expect(await owner.client.query(api.tools.mine, {})).toHaveLength(0);
  });

  test("only the lender can approve, decline or mark returned; only the borrower can cancel", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const stranger = await newUser(t, as, "u3", "Cy Lee", "cy@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    const loanId = await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(2),
    });

    for (const c of [borrower.client, stranger.client]) {
      await expect(c.mutation(api.loans.approve, { loanId })).rejects.toThrow(/owner/i);
      await expect(c.mutation(api.loans.decline, { loanId })).rejects.toThrow(/owner/i);
    }
    await expect(lender.client.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/your own requests/i);
    await expect(stranger.client.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/your own requests/i);

    await lender.client.mutation(api.loans.approve, { loanId });
    await expect(borrower.client.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/owner/i);
    await lender.client.mutation(api.loans.markReturned, { loanId });
    const [loan] = await lender.client.query(api.loans.incoming, {});
    expect(loan.status).toBe("returned");
    expect(await stranger.client.query(api.loans.incoming, {})).toHaveLength(0);
  });
});

describe("borrowing rules", () => {
  test("validates dates, self-borrowing, duplicates and overlaps", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const b1 = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const b2 = await newUser(t, as, "u3", "Cy Lee", "cy@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);

    const req = (c: typeof b1.client, s: string, e: string) =>
      c.mutation(api.loans.request, { toolId, startDate: s, endDate: e });

    await expect(req(lender.client, inDays(1), inDays(2))).rejects.toThrow(/own tool/i);
    await expect(req(b1.client, inDays(-1), inDays(2))).rejects.toThrow(/past/i);
    await expect(req(b1.client, inDays(3), inDays(2))).rejects.toThrow(/on or after/i);
    await expect(req(b1.client, inDays(1), inDays(31))).rejects.toThrow(/at most 30 days/i);
    await expect(req(b1.client, "2026-02-30", "2026-03-01")).rejects.toThrow(/valid dates/i);

    const first = await req(b1.client, inDays(1), inDays(5));
    await expect(req(b1.client, inDays(10), inDays(11))).rejects.toThrow(/already have a pending/i);
    const second = await req(b2.client, inDays(4), inDays(6));

    await lender.client.mutation(api.loans.approve, { loanId: first });
    await expect(lender.client.mutation(api.loans.approve, { loanId: second })).rejects.toThrow(/overlaps/i);
    // b1 has no pending request any more (it was approved), so this hits the overlap rule.
    await expect(req(b1.client, inDays(5), inDays(7))).rejects.toThrow(/already booked/i);

    const browse = await b2.client.query(api.tools.browse, {});
    expect(browse[0].availability).toEqual({
      state: "available",
      nextBooking: { startDate: inDays(1), endDate: inDays(5) },
    });
  });

  test("cannot delete a listing while it is out on loan", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    const loanId = await borrower.client.mutation(api.loans.request, {
      toolId, startDate: today, endDate: inDays(2),
    });
    await lender.client.mutation(api.loans.approve, { loanId });
    await expect(lender.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(/out on loan/i);
    const [tool] = await lender.client.query(api.tools.mine, {});
    expect(tool.availability).toMatchObject({ state: "on_loan", until: inDays(2) });
  });
});

describe("notifications outbox", () => {
  test("each status change writes exactly one outbox row in the same transaction", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    const loanId = await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(2),
    });
    await lender.client.mutation(api.loans.approve, { loanId });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => [e.notificationType, e.recipient, e.status])).toEqual([
      ["loan.requested", "lender", "pending"],
      ["loan.approved", "borrower", "pending"],
    ]);
  });

  test("payload is minimal: first name + email of the recipient only", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(2), message: "Private note for Asha",
    });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    const built = await t.query(internal.automation.getNotificationPayload, { eventId: event._id });
    expect(built?.status).toBe("pending");
    const json = JSON.stringify(built && "payload" in built ? built.payload : null);
    expect(json).toContain("asha@example.com");
    expect(json).toContain('"firstName":"Asha"');
    expect(json).not.toContain("Rao");
    expect(json).not.toContain("ben@example.com");
    expect(json).not.toContain("Ben");
    expect(json).not.toContain("Private note");
  });

  test("delivery is skipped (not lost silently) when n8n is not configured", async () => {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(2),
    });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    await t.action(internal.automation.deliverNotification, { eventId: event._id });
    const after = await t.run((ctx) => ctx.db.get(event._id));
    expect(after?.status).toBe("skipped");
    expect(after?.detail).toMatch(/not configured/);
  });

  test("failed deliveries retry and finally become 'failed'", async () => {
    const { t, as } = setup();
    vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", "https://n8n.invalid/webhook/x");
    vi.stubEnv("LENDLOOP_SECRET_CONVEX_TO_N8N", "out-secret");
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    await borrower.client.mutation(api.loans.request, {
      toolId, startDate: inDays(1), endDate: inDays(2),
    });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    for (let i = 0; i < 5; i++) {
      await t.action(internal.automation.deliverNotification, { eventId: event._id });
    }
    const after = await t.run((ctx) => ctx.db.get(event._id));
    expect(after?.status).toBe("failed");
    expect(after?.attempts).toBe(5);
    expect(after?.lastError).toMatch(/500/);

    // The request that was sent carried a valid signature over the exact body.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const verified = await verifySignature(
      "out-secret", init.body as string,
      headers["X-LendLoop-Timestamp"], headers["X-LendLoop-Signature"],
    );
    expect(verified.ok).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("n8n HTTP endpoints", () => {
  async function overdueFixture() {
    const { t, as } = setup();
    const lender = await newUser(t, as, "u1", "Asha Rao", "asha@example.com");
    const borrower = await newUser(t, as, "u2", "Ben Ito", "ben@example.com");
    const toolId = await lender.client.mutation(api.tools.create, drill);
    // Insert an approved loan that ended 3 days ago (can't be requested in the past).
    const loanId = await t.run(async (ctx) =>
      ctx.db.insert("loans", {
        toolId, lenderId: lender.id, borrowerId: borrower.id,
        startDate: inDays(-6), endDate: inDays(-3), status: "approved", reminderCount: 0,
      }),
    );
    return { t, loanId };
  }

  async function signedPost(t: ReturnType<typeof convexTest>, path: string, body: unknown, secret = INBOUND_SECRET) {
    const raw = JSON.stringify(body);
    const { timestamp, signature } = await signPayload(secret, raw);
    return t.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LendLoop-Timestamp": timestamp, "X-LendLoop-Signature": signature },
      body: raw,
    });
  }

  test("rejects unsigned, wrongly signed and stale requests", async () => {
    const { t } = await overdueFixture();
    expect((await t.fetch("/n8n/overdue-loans", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await signedPost(t, "/n8n/overdue-loans", {}, "wrong-secret")).status).toBe(401);

    const raw = "{}";
    const old = await signPayload(INBOUND_SECRET, raw, Math.floor(Date.now() / 1000) - 3600);
    const stale = await t.fetch("/n8n/overdue-loans", {
      method: "POST",
      headers: { "X-LendLoop-Timestamp": old.timestamp, "X-LendLoop-Signature": old.signature },
      body: raw,
    });
    expect(stale.status).toBe(401);

    // A valid signature for a different body is rejected (tamper check).
    const good = await signPayload(INBOUND_SECRET, "{}");
    const tampered = await t.fetch("/n8n/overdue-loans", {
      method: "POST",
      headers: { "X-LendLoop-Timestamp": good.timestamp, "X-LendLoop-Signature": good.signature },
      body: '{"x":1}',
    });
    expect(tampered.status).toBe(401);
  });

  test("overdue list -> write-back is idempotent and hides the loan for the rest of the day", async () => {
    const { t, loanId } = await overdueFixture();
    const res = await signedPost(t, "/n8n/overdue-loans", { runId: "r1" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.loans[0]).toEqual({
      loanId,
      reminderKey: `reminder:${loanId}:${today}`,
      toolName: drill.name,
      endDate: inDays(-3),
      daysOverdue: 3,
      borrower: { firstName: "Ben", email: "ben@example.com" },
      appPath: "/requests",
    });

    const key = data.loans[0].reminderKey;
    // First attempt fails, retry succeeds, a duplicate retry is ignored.
    expect(await (await signedPost(t, "/n8n/reminder-status", { reminderKey: key, status: "failed", error: "SMTP down" })).json())
      .toEqual({ ok: true, duplicate: false });
    expect((await (await signedPost(t, "/n8n/overdue-loans", {})).json()).count).toBe(1);
    expect(await (await signedPost(t, "/n8n/reminder-status", { reminderKey: key, status: "sent" })).json())
      .toEqual({ ok: true, duplicate: false });
    expect(await (await signedPost(t, "/n8n/reminder-status", { reminderKey: key, status: "sent" })).json())
      .toEqual({ ok: true, duplicate: true });

    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.reminderCount).toBe(1);
    expect(loan?.lastReminderOn).toBe(today);
    const reminders = await t.run((ctx) =>
      ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).collect(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect((await (await signedPost(t, "/n8n/overdue-loans", {})).json()).count).toBe(0);
  });

  test("write-back rejects bad keys and unknown loans", async () => {
    const { t } = await overdueFixture();
    expect((await signedPost(t, "/n8n/reminder-status", { reminderKey: "nope", status: "sent" })).status).toBe(400);
    expect((await signedPost(t, "/n8n/reminder-status", { reminderKey: "x", status: "maybe" })).status).toBe(400);
  });

  test("workflow errors are recorded once per execution", async () => {
    const { t } = await overdueFixture();
    const body = { executionId: "42", workflowName: "Overdue reminders", nodeName: "Send email", message: "x".repeat(5000) };
    expect(await (await signedPost(t, "/n8n/workflow-error", body)).json()).toEqual({ ok: true, duplicate: false });
    expect(await (await signedPost(t, "/n8n/workflow-error", body)).json()).toEqual({ ok: true, duplicate: true });
  });
});

test("timingSafeEqual", () => {
  expect(timingSafeEqual("abc", "abc")).toBe(true);
  expect(timingSafeEqual("abc", "abd")).toBe(false);
  expect(timingSafeEqual("abc", "abcd")).toBe(false);
});
