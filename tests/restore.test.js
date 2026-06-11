import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

let app;
beforeEach(() => { app = createApp(); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
  '2024-03-05 10:15:00,SELL,50,TO OPEN,TSLA,182.00,0.50',
  '2024-03-05 15:45:30,BUY,50,TO CLOSE,TSLA,179.00,0.50',
].join('\n');

async function user(email) {
  return (await request(app).post('/api/auth/register').send({ email, password: 'secret123' })).body;
}

describe('restore from export', () => {
  it('round-trips accounts and trades into another account', async () => {
    const a = await user('a@x.com');
    const acct = (await request(app).post('/api/accounts').set(auth(a.token)).send({ name: 'Main', startingBalance: 12345 })).body.account;
    await request(app).post('/api/import').set(auth(a.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' });
    const exported = (await request(app).get('/api/me/export').set(auth(a.token))).body;
    const srcTrades = exported.accounts[0].trades.length;
    expect(srcTrades).toBeGreaterThan(0);

    // Fresh user restores A's export.
    const b = await user('b@x.com');
    const res = await request(app).post('/api/me/import-data').set(auth(b.token)).send(exported).expect(201);
    expect(res.body.accounts).toBe(1);
    expect(res.body.trades).toBe(srcTrades);

    const bAccounts = (await request(app).get('/api/accounts').set(auth(b.token))).body.accounts;
    expect(bAccounts).toHaveLength(1);
    expect(bAccounts[0].name).toBe('Main');
    const bTrades = (await request(app).get(`/api/trades?accountId=${bAccounts[0].id}`).set(auth(b.token))).body.trades;
    expect(bTrades.length).toBe(srcTrades);
  });

  it('rejects a malformed body', async () => {
    const a = await user('c@x.com');
    await request(app).post('/api/me/import-data').set(auth(a.token)).send({ nope: true }).expect(400);
  });
});
