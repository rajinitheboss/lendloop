#!/usr/bin/env node
/**
 * One-time local setup for the automation layer:
 *  1. generates two HMAC secrets and an n8n encryption key,
 *  2. writes them to n8n/.env (from n8n/.env.example) if it doesn't exist,
 *  3. sets the matching variables on your Convex dev deployment.
 *
 * Run it while `npx convex dev` is running:   npm run setup:local
 * Optional: CLERK_JWT_ISSUER_DOMAIN=https://xxx.clerk.accounts.dev npm run setup:local
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = "n8n/.env";
const secret = () => randomBytes(32).toString("hex");

let values;
if (existsSync(envPath)) {
  console.log(`${envPath} already exists. Reusing its secrets.`);
  values = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
} else {
  values = {
    N8N_ENCRYPTION_KEY: secret(),
    LENDLOOP_SECRET_CONVEX_TO_N8N: secret(),
    LENDLOOP_SECRET_N8N_TO_CONVEX: secret(),
  };
  const filled = readFileSync("n8n/.env.example", "utf8").replace(
    /^(N8N_ENCRYPTION_KEY|LENDLOOP_SECRET_CONVEX_TO_N8N|LENDLOOP_SECRET_N8N_TO_CONVEX)=$/gm,
    (_, key) => `${key}=${values[key]}`,
  );
  writeFileSync(envPath, filled, { mode: 0o600 });
  console.log(`Wrote ${envPath}`);
}

for (const key of ["LENDLOOP_SECRET_CONVEX_TO_N8N", "LENDLOOP_SECRET_N8N_TO_CONVEX"]) {
  if (!values[key]) throw new Error(`${key} is empty in ${envPath}`);
}

const convexEnv = {
  LENDLOOP_SECRET_CONVEX_TO_N8N: values.LENDLOOP_SECRET_CONVEX_TO_N8N,
  LENDLOOP_SECRET_N8N_TO_CONVEX: values.LENDLOOP_SECRET_N8N_TO_CONVEX,
  N8N_LOAN_EVENTS_WEBHOOK_URL:
    process.env.N8N_LOAN_EVENTS_WEBHOOK_URL ?? "http://localhost:5678/webhook/lendloop/loan-events",
};
if (process.env.CLERK_JWT_ISSUER_DOMAIN) {
  convexEnv.CLERK_JWT_ISSUER_DOMAIN = process.env.CLERK_JWT_ISSUER_DOMAIN;
}
for (const [key, value] of Object.entries(convexEnv)) {
  // execFileSync with an argument array: values never pass through a shell.
  execFileSync("npx", ["convex", "env", "set", key, value], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`Set ${key} on the Convex deployment`);
}
console.log("\nDone. Next: docker compose up -d");
