#!/bin/sh
# One-shot n8n setup, run by the `n8n-bootstrap` service in docker-compose.yml
# before n8n starts. Safe to run again: imports overwrite by id.
set -eu
DIR="${LENDLOOP_N8N_DIR:-/lendloop}"

echo "Importing SMTP credential (Mailpit, no password)…"
n8n import:credentials --input="$DIR/credentials/smtp-mailpit.json"

echo "Importing workflows…"
n8n import:workflow --separate --input="$DIR/workflows"

for id in LendLoopNotify01 LendLoopOverdue1 LendLoopErrors01; do
  echo "Publishing $id…"
  n8n publish:workflow --id="$id"
done
echo "n8n bootstrap done."
