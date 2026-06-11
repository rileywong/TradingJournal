import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { buildWeeklyDigest } from '../core/digest.js';

const t = (netPnl, closedAt) => ({ netPnl, closedAt });
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

describe('buildWeeklyDigest', () => {
  it('returns null when nothing closed in the last 7 days', () => {
    expect(buildWeeklyDigest([t(100, iso(30))])).toBeNull();
    expect(buildWeeklyDigest([])).toBeNull();
  });

  it('summarises the last 7 days with best/worst day', () => {
    const d = buildWeeklyDigest([
      t(200, iso(1)), t(-50, iso(2)), t(80, iso(2)), t(500, iso(40)), // last one is outside the window
    ]);
    expect(d.trades).toBe(3);
    expect(d.netPnl).toBeCloseTo(230, 1);
    expect(d.bestDay.pnl).toBeCloseTo(200, 1);
    expect(d.worstDay.pnl).toBeCloseTo(30, 1); // the -50 and +80 net on the same day
  });
});

function fakeEmail() {
  const sent = [];
  return { name: 'fake', sent, async send(msg) { sent.push(msg); return { ok: true }; } };
}
const tick = () => new Promise((r) => setTimeout(r, 15));
const ADMIN = 'admin@site.com';

// A CSV with a closed trade dated yesterday so it falls in the digest window.
function recentCsv() {
  const d = new Date(Date.now() - 86_400_000);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [
    'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
    `${day} 09:31:00,BUY,100,TO OPEN,AAPL,100.00,0`,
    `${day} 14:00:00,SELL,100,TO CLOSE,AAPL,105.00,0`,
  ].join('\n');
}

describe('admin send-digests', () => {
  let app; let email;
  beforeEach(() => { email = fakeEmail(); app = createApp(undefined, { adminEmails: [ADMIN], email }); });
  const auth = (tk) => ({ Authorization: `Bearer ${tk}` });

  it('emails a digest to users who traded this week (admin only)', async () => {
    const admin = (await request(app).post('/api/auth/register').send({ email: ADMIN, password: 'secret123' })).body;
    const u = (await request(app).post('/api/auth/register').send({ email: 'tom@x.com', password: 'secret123' })).body;
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'M', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: recentCsv(), mode: 'replace' });

    const res = await request(app).post('/api/admin/send-digests').set(auth(admin.token)).expect(200);
    expect(res.body.sent).toBe(1);
    await tick();
    const digests = email.sent.filter((m) => /trading week/i.test(m.subject));
    expect(digests).toHaveLength(1);
    expect(digests[0].to).toBe('tom@x.com');

    await request(app).post('/api/admin/send-digests').set(auth(u.token)).expect(403);
  });
});

describe('cron-triggered digests (internal endpoint)', () => {
  let app; let email;
  const SECRET = 'cron-s3cret-value';
  beforeEach(() => { email = fakeEmail(); app = createApp(undefined, { email, cronSecret: SECRET }); });
  const auth = (tk) => ({ Authorization: `Bearer ${tk}` });

  it('requires the cron secret', async () => {
    await request(app).post('/api/internal/send-digests').expect(401);
    await request(app).post('/api/internal/send-digests').set('X-Cron-Secret', 'wrong').expect(401);
  });

  it('sends with the correct secret', async () => {
    const u = (await request(app).post('/api/auth/register').send({ email: 'tom@x.com', password: 'secret123' })).body;
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'M', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: recentCsv(), mode: 'replace' });

    const res = await request(app).post('/api/internal/send-digests').set('X-Cron-Secret', SECRET).expect(200);
    expect(res.body.sent).toBe(1);
  });
});
