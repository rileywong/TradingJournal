// Render Cron Job entrypoint: POST the internal weekly-digest trigger on the
// live web service. Needs APP_URL (the service's public URL) and CRON_SECRET
// (same value as the web service). Exits non-zero on failure so Render flags it.
const base = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;

if (!base) { console.error('APP_URL (or RENDER_EXTERNAL_URL) is required'); process.exit(1); }
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1); }

const res = await fetch(`${base}/api/internal/send-digests`, {
  method: 'POST',
  headers: { 'X-Cron-Secret': secret },
});
const body = await res.text();
if (!res.ok) {
  console.error(`weekly-digest trigger failed: ${res.status} ${body}`);
  process.exit(1);
}
console.log(`weekly-digest sent: ${body}`);
