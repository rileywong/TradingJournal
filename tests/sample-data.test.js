import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

let app;
beforeEach(() => { app = createApp(); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('sample data', () => {
  it('seeds the user’s own account with demo trades', async () => {
    const { body: u } = await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'secret123' });
    const res = await request(app).post('/api/me/sample-data').set(auth(u.token)).expect(201);
    expect(res.body.account.name).toMatch(/Sample/);
    expect(res.body.trades).toBeGreaterThan(10);

    const accounts = (await request(app).get('/api/accounts').set(auth(u.token))).body.accounts;
    expect(accounts).toHaveLength(1);
    const trades = (await request(app).get(`/api/trades?accountId=${accounts[0].id}`).set(auth(u.token))).body.trades;
    expect(trades.length).toBeGreaterThan(10);
  });

  it('is blocked for the read-only demo session', async () => {
    const { body: demo } = await request(app).post('/api/demo');
    await request(app).post('/api/me/sample-data').set(auth(demo.token)).expect(403);
  });
});
