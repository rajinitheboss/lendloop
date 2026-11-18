# Running LendLoop in production

The README has the short version. This is the checklist I'd work through.

## Hosting

| Piece | Local | Production |
| --- | --- | --- |
| Next.js | `next dev` | Vercel (or any Node host), with preview deployments per PR |
| Convex | local backend | Convex cloud: separate *dev*, *preview* and *prod* deployments |
| Auth | Clerk dev instance | Clerk production instance on our own domain |
| n8n | Docker, SQLite, one process | n8n Cloud, or self-hosted in **queue mode** (Postgres + Redis + workers) behind TLS, with webhook processors separated from the editor |
| Email | Mailpit | SES or Postmark through the same n8n SMTP credential, with SPF, DKIM and DMARC on the sending domain |

## Secrets

* Keep them in a secret manager (AWS Secrets Manager, Doppler or Vault). Convex and n8n read env vars that are injected at deploy time.
* **Rotation without downtime:** accept two secrets during a rotation window and sign with the newer one. The `v1=` prefix leaves room for a key id (for example `kid` in a header).
* Use different secrets per environment. n8n's `N8N_ENCRYPTION_KEY` must be backed up, or stored credentials are lost.
* Lock down the n8n editor (SSO, few editors). Anyone who can edit a workflow can read `$env`.

## Reliability

* **n8n de-duplication** belongs in a table (Postgres in n8n, or a Convex endpoint), not workflow static data, which isn't shared across queue-mode workers.
* **Outbox sweeper:** a Convex cron that re-schedules `pending` notifications older than a few minutes, in case a scheduled action never ran.
* **Dead letters:** after `failed`, allow an admin to retry from the UI (a one-line mutation that resets the status and schedules delivery).
* Treat 401 and 403 from n8n as configuration errors: alert straight away instead of waiting out the backoff.
* Add a "last successful overdue run" heartbeat so a schedule that silently stops gets noticed.

## Scale

* Replace the 200-row caps with `usePaginatedQuery` and cursor pagination.
* Keep admin stats as counters updated in the same mutations, instead of counting rows.
* Page the overdue query, and send in batches with a rate limit to respect the email provider's quota.
* Add search (a Convex search index on tool name and description) once listings grow.

## Security and privacy

* Rate-limit mutations per user (for example with the Convex rate-limiter component) and rate-limit the `/n8n/*` endpoints per IP.
* Add a Content-Security-Policy, HSTS, `X-Frame-Options` and a referrer policy in `next.config.ts`.
* **Clerk webhooks** (`user.updated`, `user.deleted`), verified with Svix, so email changes and account deletions reach Convex. Also add account deletion and data export flows (GDPR-style).
* Set retention for `automationEvents` and `auditLog` (for example 13 months), with a scheduled cleanup job.
* Add notification preferences and opt-out, plus an unsubscribe link in emails.
* Review least privilege: admins see emails today, but a moderator role could see listings without contact details.

## Observability

* Sentry in the Next.js app (errors, plus Web Vitals).
* Convex log streams to Datadog. Alert on `notification.failed`, error-workflow runs, and 401s on `/n8n/*` (possible forgery attempts or a rotated secret).
* Send n8n execution logs to the same place, with a dashboard showing deliveries per hour, failure rate and p95 delivery latency.

## Process

* CI: `npm run check` (typecheck, lint, tests) on every PR, `convex deploy` on merge, and `npm run n8n:build` plus a JSON diff to catch hand-edited workflows.
* Run end-to-end tests with Playwright and Clerk testing tokens against a preview deployment.
* Keep the workflows in git and promote them dev → prod through the n8n CLI (`import:workflow` / `publish:workflow`), as `n8n/scripts/bootstrap.sh` already does.
