// Mark the event as handled only AFTER the email was sent, so a retry from
// Convex after a failure still gets delivered, and a retry after success
// does not send a second email. Keeps the most recent 1000 ids.
const store = $getWorkflowStaticData('global');
const seen = store.seen || {};
seen[$('Compose email').first().json.eventId] = Date.now();
const ids = Object.keys(seen);
if (ids.length > 1000) {
  ids.sort((a, b) => seen[a] - seen[b]).slice(0, ids.length - 1000).forEach((id) => delete seen[id]);
}
store.seen = seen;
return [{ json: { ok: true } }];
