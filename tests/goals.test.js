import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

let app;
beforeEach(() => { app = createApp(); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Two closed trades in the current month: +300 and -100 → net 200, 50% win rate.
function csvThisMonth() {
  const d = new Date();
  const day = (n) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  return [
    'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
    `${day(2)} 09:31:00,BUY,100,TO OPEN,AAPL,100.00,0`,
    `${day(2)} 14:00:00,SELL,100,TO CLOSE,AAPL,103.00,0`,
    `${day(3)} 09:31:00,BUY,100,TO OPEN,MSFT,100.00,0`,
    `${day(3)} 14:00:00,SELL,100,TO CLOSE,MSFT,99.00,0`,
  ].join('\n');
}

describe('goals', () => {
  it('defaults to null and persists what you set', async () => {
    const { body: u } = await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'secret123' });
    let g = (await request(app).get('/api/me/goals').set(auth(u.token))).body;
    expect(g.goalMonthlyPnl).toBeNull();
    expect(g.goalWinRate).toBeNull();

    await request(app).put('/api/me/goals').set(auth(u.token)).send({ goalMonthlyPnl: 5000, goalWinRate: 0.55 }).expect(200);
    g = (await request(app).get('/api/me/goals').set(auth(u.token))).body;
    expect(g.goalMonthlyPnl).toBe(5000);
    expect(g.goalWinRate).toBe(0.55);
  });

  it('computes month-to-date progress across accounts', async () => {
    const { body: u } = await request(app).post('/api/auth/register').send({ email: 'b@x.com', password: 'secret123' });
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'M', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: csvThisMonth(), mode: 'replace' });

    const g = (await request(app).get('/api/me/goals').set(auth(u.token))).body;
    expect(g.mtd.trades).toBe(2);
    expect(g.mtd.netPnl).toBeCloseTo(200, 1);
    expect(g.mtd.winRate).toBeCloseTo(0.5, 5);
    expect(g.lastMonth).toBeDefined();
    expect(typeof g.lastMonth.netPnl).toBe('number');
  });
});
