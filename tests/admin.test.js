import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

const ADMIN = 'admin@site.com';

const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
].join('\n');

let app;
beforeEach(() => {
  // Default in-memory repo; designate one admin by email.
  app = createApp(undefined, { adminEmails: [ADMIN] });
});

const register = (email) =>
  request(app).post('/api/auth/register').send({ email, password: 'secret123' }).then((r) => r.body);

const stats = (token) =>
  request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`);

describe('admin access', () => {
  it('flags admin users via isAdmin on register and login', async () => {
    const admin = await register(ADMIN);
    expect(admin.user.isAdmin).toBe(true);

    const normal = await register('jane@site.com');
    expect(normal.user.isAdmin).toBe(false);

    const login = await request(app).post('/api/auth/login').send({ email: ADMIN, password: 'secret123' });
    expect(login.body.user.isAdmin).toBe(true);
  });

  it('gates /api/admin/stats to admins', async () => {
    const admin = await register(ADMIN);
    const normal = await register('jane@site.com');

    await stats('').expect(401);
    await stats(normal.token).expect(403);
    await stats(admin.token).expect(200);
  });

  it('rejects a demo session from admin stats', async () => {
    await register(ADMIN);
    const demo = (await request(app).post('/api/demo')).body;
    await stats(demo.token).expect(403);
  });
});

describe('admin stats content', () => {
  it('aggregates users, funnel, revenue, and engagement', async () => {
    const admin = await register(ADMIN);
    const jane = await register('jane@site.com');
    await register('bob@site.com');

    // Seed the public demo user — it must be excluded from the stats.
    await request(app).post('/api/demo');

    // Give jane an account with imported trades.
    const acct = (await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${jane.token}`)
      .send({ name: 'Main', startingBalance: 10000 })).body.account;
    await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${jane.token}`)
      .send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' });

    const body = (await stats(admin.token).expect(200)).body;

    // 3 real registrations; demo user excluded.
    expect(body.totalUsers).toBe(3);
    expect(body.recentSignups.some((u) => u.email === 'demo@greenstreak.app')).toBe(false);

    // All three are on fresh trials → no revenue yet.
    expect(body.funnel.trialing).toBe(3);
    expect(body.revenue.payingUsers).toBe(0);
    expect(body.revenue.mrr).toBe(0);
    expect(body.revenue.pricePerMonth).toBe(10);

    // Engagement: only jane imported (1 closed trade from the round-trip).
    expect(body.engagement.usersWithData).toBe(1);
    expect(body.engagement.totalAccounts).toBe(1);
    expect(body.engagement.totalTrades).toBe(1);

    // Signups all happened "now".
    expect(body.signups.today).toBe(3);
    expect(body.signupSeries).toHaveLength(30);
    expect(body.signupSeries.at(-1).count).toBe(3);
  });
});

describe('admin users CSV export', () => {
  it('returns CSV for admins and 403 for everyone else', async () => {
    const admin = await register(ADMIN);
    const jane = await register('jane@site.com');

    await stats(jane.token); // warm
    const res = await request(app).get('/api/admin/users.csv').set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/greenstreak-users\.csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('email,joinedAt,status,accounts,trades,auth');
    expect(lines.length).toBe(3); // header + admin + jane (demo excluded)

    await request(app).get('/api/admin/users.csv').set('Authorization', `Bearer ${jane.token}`).expect(403);
    await request(app).get('/api/admin/users.csv').expect(401);
  });
});
