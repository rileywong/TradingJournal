import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { Repository } from '../core/repository.js';

const ADMIN = 'admin@site.com';
const DAY = 86_400_000;

const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
].join('\n');

const reg = (app, email) =>
  request(app).post('/api/auth/register').send({ email, password: 'secret123' }).then((r) => r.body);
const mkAccount = (app, token) =>
  request(app).post('/api/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Main', startingBalance: 10000 }).then((r) => r.body.account);
const importCsv = (app, token, accountId) =>
  request(app).post('/api/import').set('Authorization', `Bearer ${token}`).send({ accountId, csv: TOS_CSV, mode: 'replace' });

describe('admin acquisition funnel', () => {
  it('counts each milestone and the drop-off between stages', async () => {
    const repo = new Repository();
    const app = createApp(repo, { adminEmails: [ADMIN] });

    const admin = await reg(app, ADMIN); // the admin themselves: signed up only

    // u1: signed up only
    await reg(app, 'u1@x.com');
    // u2: created an account, no import
    const u2 = await reg(app, 'u2@x.com');
    await mkAccount(app, u2.token);
    // u3: created + imported (activated, still trialing)
    const u3 = await reg(app, 'u3@x.com');
    const a3 = await mkAccount(app, u3.token);
    await importCsv(app, u3.token, a3.id);
    // u4: created + imported + subscribed (converted)
    const u4 = await reg(app, 'u4@x.com');
    const a4 = await mkAccount(app, u4.token);
    await importCsv(app, u4.token, a4.id);
    repo.setSubscription(u4.user.id, { subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString() });

    const body = (await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${admin.token}`).expect(200)).body;

    const byKey = Object.fromEntries(body.funnelStages.map((s) => [s.key, s]));
    expect(byKey.signed_up.count).toBe(5);        // admin + u1..u4
    expect(byKey.created_account.count).toBe(3);  // u2, u3, u4
    expect(byKey.imported.count).toBe(2);         // u3, u4
    expect(byKey.subscribed.count).toBe(1);       // u4

    // Drop-off at each step.
    expect(byKey.created_account.droppedFromPrev).toBe(2); // admin + u1 never made an account
    expect(byKey.imported.droppedFromPrev).toBe(1);        // u2 made an account but never imported
    expect(byKey.subscribed.droppedFromPrev).toBe(1);      // u3 imported but didn't convert

    // Percentages: subscribed is 1/5 of the top, 1/2 of the previous stage.
    expect(byKey.subscribed.pctOfTop).toBeCloseTo(0.2, 5);
    expect(byKey.subscribed.pctOfPrev).toBeCloseTo(0.5, 5);
    expect(byKey.signed_up.pctOfTop).toBe(1);
  });
});
