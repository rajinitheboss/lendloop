# Design decisions and trade-offs

Each entry gives the decision, why it was made, and what it costs.

## Authorization

**Roles live in Convex, not in Clerk metadata.**
Every function already loads the caller's `users` row, so the role is one field away, and the tests can set it directly. The cost is one database read per call, which is cheap. Keeping roles in Clerk would mean two sources of truth, and the JWT would carry stale roles until it refreshed.

**Admins are made from the CLI only (`internalMutation users:setRole`).**
There is no UI path to become an admin, so there is nothing to exploit. In a real product this would be an admin-only screen with an audit entry, which the `setRole` audit row already prepares for.

**Identity comes only from `ctx.auth`.**
Functions never take a `userId` argument for "who am I". A client can't act as someone else by changing a parameter.

**The proxy only redirects; Convex decides.**
`src/proxy.ts` sends signed-out visitors to sign-in for a smoother UX. Authorization lives entirely in Convex, which is also what the brief asks for.

**Name and email come from custom session-token claims.**
Clerk's Convex integration token has no profile claims by default. The alternatives were trusting values sent by the client (unsafe, since anyone could claim an admin's email) or calling the Clerk Backend API from Convex (another secret to manage). Adding three claims in the Clerk dashboard is one setup step and keeps the data signed.

## Data model

**Soft delete for listings** (`status: "removed"`, with who, when and why).
Loan history and the audit log keep pointing at real rows. Public queries only read `status = "active"` through an index.

**Loans are both the request and the loan.**
A single state machine (`requested → approved → returned`, `requested → declined | cancelled`) is easier to reason about than two tables. *Overdue* is derived (approved and `endDate < today`) rather than stored, so it can't drift out of date.

**Calendar dates are `YYYY-MM-DD` strings in UTC.**
They sort correctly as strings, have no timezone surprises, and work directly with the `by_status_and_endDate` index range (`lt("endDate", today)`). The cost is that a neighbour in UTC−8 sees "today" roll over at 16:00. For a production app I'd store the community's timezone.

**Overlaps are blocked only against approved loans.**
Several people can request the same dates and the lender picks one. Approving re-checks for overlaps, and because Convex mutations are serializable, two concurrent approvals can't both win.

**Lists are capped at 200 rows.**
That's simple and bounded. Pagination is the first scale item in the production notes.

## Notifications (Convex → n8n)

**Transactional outbox instead of calling n8n directly from the mutation.**
Mutations in Convex can't make network calls anyway. Even where they can, "write to the database, then call the webhook" loses events when the call fails after the commit. The outbox row commits atomically with the status change, and a scheduled action delivers it with retries. It's the same idea as publishing to Kafka from an outbox table.

**The payload is built at send time, not stored.**
The outbox row holds ids only, so emails aren't copied into another table. The cost is that if a tool is renamed between enqueue and send, the email uses the new name, which is acceptable.

**Deterministic outbox key (`notification:<loanId>:<type>`).**
Each transition happens at most once per loan, so the key is naturally unique and enqueueing twice is a no-op.

**Backoff of 10 s, 1 min, 5 min, 30 min, then `failed`.**
This covers a restart or a short outage without hammering n8n. After that, a person should look: the event appears in Admin → Automation. 4xx responses are retried too, because the usual cause is a misconfigured secret that someone will fix.

**n8n de-duplicates on event id after sending.**
Convex retries when it doesn't get a 2xx back, including when the email *was* sent but the response was lost. Marking the id as seen only after the email goes out means a retry after a failure still delivers, while a retry after success doesn't double-send. The trade-off is that workflow static data is fine for a demo; production should use a real table (see PRODUCTION.md).

## Reminders (n8n → Convex)

**Convex decides what "overdue today" means.**
n8n only asks for the list. A compromised or misconfigured caller can't shift the date to trigger early reminders.

**Convex issues the idempotency key (`reminder:<loanId>:<date>`).**
The key covers "one reminder per loan per day". A duplicate `sent` is ignored, and `failed` followed by `sent` upgrades the same row, so `reminderCount` stays correct.

**The email node uses its error output instead of failing the run.**
One bad address shouldn't stop reminders to everyone else. Each failure is written back as `failed` with the error, and the next run retries it because `lastReminderOn` isn't set.

## Signing

**HMAC-SHA256 over `timestamp.rawBody`, Stripe-style.**
It's well understood, needs no extra infrastructure, and the timestamp in the signed string blocks replays beyond 5 minutes. mTLS or OAuth client credentials would be heavier to run locally.

**Two secrets, one per direction.**
A leaked n8n-side secret can't be used to forge calls from n8n into Convex, and the reverse holds too. It costs one more environment variable.

**Raw body verification in n8n.**
Verifying `JSON.stringify(parsedBody)` usually works, but it's subtly wrong: it relies on key order and number formatting surviving a parse/serialise round trip. The webhook node's *Raw Body* option gives the exact bytes.

**Secrets in n8n live in env vars** (Code nodes read `$env`).
n8n credentials can't be read from a Code node, and HMAC needs the key at runtime. SMTP uses a proper n8n credential. `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is set deliberately, so in production restrict who can edit workflows.

## Frontend

**Client-rendered signed-in pages with realtime Convex queries.**
Approvals, reminders and delivery status appear live without refreshing. Pages are tiny server components that render a client view with `export const instant = false`. There's no useful static shell for personal data, and this tells Next.js 16's instant-navigation check exactly that.

**No component library.**
A small token-based UI kit (`src/components/ui.tsx`, CSS variables for light and dark) keeps the bundle small and the look consistent. Native `<dialog>` gives focus trapping and Esc handling for free.

**Code-node logic in real `.js` files, with JSON generated from them.**
The logic is reviewable and diff-able. The generated JSON is still committed, because that's what gets imported.
