import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

let app;

const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
  '2024-03-05 10:15:00,SELL,50,TO OPEN,TSLA,182.00,0.50',
  '2024-03-05 15:45:30,BUY,50,TO CLOSE,TSLA,179.00,0.50',
].join('\n');

async function registerUser(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123' });
  return res.body;
}

async function createAccount(token, body = {}) {
  const res = await request(app)
    .post('/api/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Main', startingBalance: 10000, ...body });
  return res.body.account;
}

beforeEach(() => {
  app = createApp();
});

describe('auth', () => {
  it('registers and logs in a user', async () => {
    const reg = await registerUser('trader@example.com');
    expect(reg.token).toBeTruthy();
    expect(reg.user.email).toBe('trader@example.com');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trader@example.com', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('rejects duplicate registration', async () => {
    await registerUser('dupe@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dupe@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('rejects bad credentials', async () => {
    await registerUser('a@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('blocks unauthenticated access to protected routes', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});

describe('row-level security (user isolation)', () => {
  it('prevents one user from reading another user\'s account data', async () => {
    const alice = await registerUser('alice@example.com');
    const bob = await registerUser('bob@example.com');
    const aliceAcct = await createAccount(alice.token);

    // Bob tries to read Alice's trades
    const res = await request(app)
      .get(`/api/trades?accountId=${aliceAcct.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404); // account not found for Bob

    // Bob cannot import into Alice's account
    const imp = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ accountId: aliceAcct.id, csv: TOS_CSV });
    expect(imp.status).toBe(404);
  });

  it('only lists the caller\'s own accounts', async () => {
    const alice = await registerUser('alice2@example.com');
    const bob = await registerUser('bob2@example.com');
    await createAccount(alice.token, { name: 'A1' });
    await createAccount(bob.token, { name: 'B1' });

    const res = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].name).toBe('A1');
  });
});

describe('cross-account aggregate (accountId=all)', () => {
  it('combines metrics, trades, and analytics across all the user\'s accounts', async () => {
    const user = await registerUser('agg@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const a1 = await createAccount(user.token, { name: 'A1', startingBalance: 10000 });
    const a2 = await createAccount(user.token, { name: 'A2', startingBalance: 5000 });
    await request(app).post('/api/import').set(h).send({ accountId: a1.id, csv: TOS_CSV }); // +447, 2 trades
    const nvda = 'Symbol,Action,Quantity,Price,Timestamp\nNVDA,BUY,10,500,2024-03-06 11:00:00\nNVDA,SELL,10,510,2024-03-06 12:00:00';
    await request(app).post('/api/import').set(h).send({ accountId: a2.id, csv: nvda }); // +100, 1 trade

    const all = await request(app).get('/api/metrics?accountId=all').set(h);
    expect(all.body.metrics.totalTrades).toBe(3);
    expect(all.body.metrics.netPnl).toBe(547); // 447 + 100
    expect(all.body.metrics.startingBalance).toBe(15000); // summed

    const trades = await request(app).get('/api/trades?accountId=all').set(h);
    expect(trades.body.trades).toHaveLength(3);

    const an = await request(app).get('/api/analytics?accountId=all').set(h);
    expect(an.body.analytics.bySymbol.map((s) => s.key).sort()).toEqual(['AAPL', 'NVDA', 'TSLA']);

    const yr = await request(app).get('/api/year?accountId=all&year=2024').set(h);
    expect(yr.body.heatmap.yearlyPnl).toBe(547);
  });

  it('aggregate only spans the caller\'s own accounts (RLS)', async () => {
    const alice = await registerUser('aliceagg@example.com');
    const bob = await registerUser('bobagg@example.com');
    const aAcct = await createAccount(alice.token);
    await request(app).post('/api/import').set({ Authorization: `Bearer ${alice.token}` }).send({ accountId: aAcct.id, csv: TOS_CSV });

    // Bob has no accounts → his aggregate is empty, never sees Alice's trades
    const bobAll = await request(app).get('/api/metrics?accountId=all').set({ Authorization: `Bearer ${bob.token}` });
    expect(bobAll.body.metrics.totalTrades).toBe(0);
  });
});

describe('period-scoped metrics & analytics', () => {
  it('scopes metrics, score, and analytics to a date range', async () => {
    const user = await registerUser('period@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    // All time: both trades (AAPL +298 on 03-04, TSLA +149 on 03-05) → 447
    const all = await request(app).get(`/api/metrics?accountId=${acct.id}`).set(h);
    expect(all.body.metrics.netPnl).toBe(447);
    expect(all.body.metrics.totalTrades).toBe(2);

    // Scope to just 2024-03-04 → only AAPL
    const day1 = await request(app)
      .get(`/api/metrics?accountId=${acct.id}&from=2024-03-04&to=2024-03-04`)
      .set(h);
    expect(day1.body.metrics.netPnl).toBe(298);
    expect(day1.body.metrics.totalTrades).toBe(1);
    expect(day1.body.equityCurve).toHaveLength(1);

    const an = await request(app)
      .get(`/api/analytics?accountId=${acct.id}&from=2024-03-05&to=2024-03-05`)
      .set(h);
    expect(an.body.analytics.overall.netPnl).toBe(149);
    expect(an.body.analytics.bySymbol.map((s) => s.key)).toEqual(['TSLA']);
  });

  it('switches metrics and calendar between net and gross basis', async () => {
    const user = await registerUser('basis@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    // Net: AAPL 298 + TSLA 149 = 447; Gross: 300 + 150 = 450 (3 total commission)
    const net = await request(app).get(`/api/metrics?accountId=${acct.id}`).set(h);
    expect(net.body.metrics.netPnl).toBe(447);
    const gross = await request(app).get(`/api/metrics?accountId=${acct.id}&basis=gross`).set(h);
    expect(gross.body.metrics.netPnl).toBe(450);

    const calNet = await request(app).get(`/api/calendar?accountId=${acct.id}&year=2024&month=3`).set(h);
    expect(calNet.body.calendar.monthlyPnl).toBe(447);
    const calGross = await request(app).get(`/api/calendar?accountId=${acct.id}&year=2024&month=3&basis=gross`).set(h);
    expect(calGross.body.calendar.monthlyPnl).toBe(450);
  });

  it('returns a yearly P&L heatmap (basis-aware)', async () => {
    const user = await registerUser('year@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const net = await request(app).get(`/api/year?accountId=${acct.id}&year=2024`).set(h);
    expect(net.body.heatmap.year).toBe(2024);
    expect(net.body.heatmap.yearlyPnl).toBe(447);
    expect(net.body.heatmap.tradingDays).toBe(2);

    const gross = await request(app).get(`/api/year?accountId=${acct.id}&year=2024&basis=gross`).set(h);
    expect(gross.body.heatmap.yearlyPnl).toBe(450);
  });

  it('rejects a malformed from/to on metrics', async () => {
    const user = await registerUser('periodbad@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const res = await request(app).get(`/api/metrics?accountId=${acct.id}&from=2024-3-4`).set(h);
    expect(res.status).toBe(400);
  });
});

describe('account management', () => {
  it('updates and deletes an account (with cascade) over the API', async () => {
    const user = await registerUser('mgmt@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const patch = await request(app)
      .patch(`/api/accounts/${acct.id}`)
      .set(h)
      .send({ name: 'Renamed', startingBalance: 50000 });
    expect(patch.status).toBe(200);
    expect(patch.body.account.name).toBe('Renamed');
    expect(patch.body.account.startingBalance).toBe(50000);

    const del = await request(app).delete(`/api/accounts/${acct.id}`).set(h);
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/accounts').set(h);
    expect(list.body.accounts).toHaveLength(0);
    // trades are gone with the account
    const trades = await request(app).get(`/api/trades?accountId=${acct.id}`).set(h);
    expect(trades.status).toBe(404);
  });

  it('renames and deletes tags across the account over the API', async () => {
    const user = await registerUser('tagmgmt@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    await request(app).patch(`/api/trades/${trades[0].id}`).set(h).send({ tags: ['Breakout'] });
    await request(app).patch(`/api/trades/${trades[1].id}`).set(h).send({ tags: ['Breakout'] });

    const ren = await request(app).post(`/api/accounts/${acct.id}/tags/rename`).set(h).send({ from: 'Breakout', to: 'Momentum' });
    expect(ren.body.result.affected).toBe(2);
    let after = (await request(app).get(`/api/trades?accountId=${acct.id}&tag=Momentum`).set(h)).body.trades;
    expect(after).toHaveLength(2);

    const del = await request(app).post(`/api/accounts/${acct.id}/tags/delete`).set(h).send({ tag: 'Momentum' });
    expect(del.body.result.affected).toBe(2);
    after = (await request(app).get(`/api/trades?accountId=${acct.id}&tag=Momentum`).set(h)).body.trades;
    expect(after).toHaveLength(0);
  });

  it('enforces RLS on update and delete', async () => {
    const alice = await registerUser('alice6@example.com');
    const bob = await registerUser('bob6@example.com');
    const aliceAcct = await createAccount(alice.token);
    const hb = { Authorization: `Bearer ${bob.token}` };
    expect((await request(app).patch(`/api/accounts/${aliceAcct.id}`).set(hb).send({ name: 'X' })).status).toBe(404);
    expect((await request(app).delete(`/api/accounts/${aliceAcct.id}`).set(hb)).status).toBe(404);
  });
});

describe('import → state transition', () => {
  it('importing a CSV updates metrics, trades, and calendar atomically', async () => {
    const user = await registerUser('flow@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    // Before import: everything empty
    const before = await request(app).get(`/api/metrics?accountId=${acct.id}`).set(h);
    expect(before.body.metrics.totalTrades).toBe(0);

    // Import
    const imp = await request(app)
      .post('/api/import')
      .set(h)
      .send({ accountId: acct.id, csv: TOS_CSV });
    expect(imp.status).toBe(200);
    expect(imp.body.broker).toBe('thinkorswim');
    expect(imp.body.imported.trades).toBe(2);
    expect(imp.body.errors).toHaveLength(0);

    // Trades log reflects the import
    const trades = await request(app).get(`/api/trades?accountId=${acct.id}`).set(h);
    expect(trades.body.trades).toHaveLength(2);
    const aapl = trades.body.trades.find((t) => t.symbol === 'AAPL');
    // AAPL: +3 * 100 - 2 commission = 298
    expect(aapl.netPnl).toBe(298);

    // Metrics reflect the import
    const metrics = await request(app).get(`/api/metrics?accountId=${acct.id}`).set(h);
    expect(metrics.body.metrics.totalTrades).toBe(2);
    // AAPL +298, TSLA short 182→179 = +3*50 -1 = 149 → net 447
    expect(metrics.body.metrics.netPnl).toBe(447);
    expect(metrics.body.equityCurve).toHaveLength(2);
    // Composite trade score travels with the metrics snapshot
    expect(metrics.body.score.score).toBeGreaterThanOrEqual(0);
    expect(metrics.body.score.score).toBeLessThanOrEqual(100);
    expect(metrics.body.score.components).toHaveLength(5);

    // Calendar reflects the import for March 2024
    const cal = await request(app)
      .get(`/api/calendar?accountId=${acct.id}&year=2024&month=3`)
      .set(h);
    expect(cal.body.calendar.tradingDays).toBe(2);
    expect(cal.body.calendar.monthlyPnl).toBe(447);
  });

  it('append mode merges multiple files (and re-appending de-dupes)', async () => {
    const user = await registerUser('append@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    // File 1 (ThinkOrSwim): AAPL + TSLA → 2 trades
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    // File 2 (generic): NVDA round-trip → append, total 3
    const nvda = [
      'Symbol,Action,Quantity,Price,Timestamp',
      'NVDA,BUY,10,500,2024-03-06 11:00:00',
      'NVDA,SELL,10,510,2024-03-06 12:00:00',
    ].join('\n');
    const appended = await request(app).post('/api/import').set(h)
      .send({ accountId: acct.id, csv: nvda, mode: 'append' });
    expect(appended.body.mode).toBe('append');
    expect(appended.body.imported.trades).toBe(3); // 2 + 1

    // Re-append the same NVDA file → de-duped, still 3
    const again = await request(app).post('/api/import').set(h)
      .send({ accountId: acct.id, csv: nvda, mode: 'append' });
    expect(again.body.imported.trades).toBe(3);
  });

  it('append matches a position opened on one broker and closed on another', async () => {
    const user = await registerUser('crossbroker@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    // Broker A: open 100 AAPL
    const openCsv = 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,100,170,2024-03-04 09:31:00';
    // Broker B: close 100 AAPL
    const closeCsv = 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,SELL,100,175,2024-03-05 10:00:00';

    const first = await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: openCsv });
    expect(first.body.imported.trades).toBe(0); // still open
    expect(first.body.openPositions).toHaveLength(1);

    const second = await request(app).post('/api/import').set(h)
      .send({ accountId: acct.id, csv: closeCsv, mode: 'append' });
    expect(second.body.imported.trades).toBe(1); // opened on A, closed on B → matched
    expect(second.body.openPositions).toHaveLength(0);

    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades[0].netPnl).toBe(500); // (175-170)*100
  });

  it('reports the distinct brokers present after an append merge', async () => {
    const user = await registerUser('brokers@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const webull = [
      'Symbol,Side,Filled,Avg Price,Filled Time',
      'NVDA,BUY,10,500,2024-03-06 11:00:00',
      'NVDA,SELL,10,510,2024-03-06 12:00:00',
    ].join('\n');
    const res = await request(app).post('/api/import').set(h)
      .send({ accountId: acct.id, csv: webull, mode: 'append' });
    expect(res.body.accountBrokers.sort()).toEqual(['ThinkOrSwim', 'Webull']);
  });

  it('previews an unknown CSV then imports it with an explicit mapping', async () => {
    const user = await registerUser('mapcsv@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = [
      'Ticker,Direction,Filled,ExecPrice,Fee,When',
      'AAPL,Bought,100,170.00,1.50,2024-03-04 09:31:00',
      'AAPL,Sold,100,173.00,1.50,2024-03-04 14:00:00',
    ].join('\n');

    const preview = await request(app).post('/api/import/preview').set(h).send({ csv });
    expect(preview.body.headers).toContain('Ticker');
    expect(preview.body.detectedBroker).toBe('generic'); // unrecognized → fell back
    expect(preview.body.sampleRows).toHaveLength(2);

    const res = await request(app).post('/api/import').set(h).send({
      accountId: acct.id,
      csv,
      mapping: { symbol: 'Ticker', action: 'Direction', quantity: 'Filled', price: 'ExecPrice', commission: 'Fee', executedAt: 'When' },
    });
    expect(res.body.broker).toBe('custom');
    expect(res.body.imported.trades).toBe(1);
    expect(res.body.metrics.netPnl).toBe(297); // (173-170)*100 - 3 commission
  });

  it('re-importing replaces prior data (idempotent)', async () => {
    const user = await registerUser('reimport@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const trades = await request(app).get(`/api/trades?accountId=${acct.id}`).set(h);
    // still 2, not 4 — re-import wipes and replaces
    expect(trades.body.trades).toHaveLength(2);
  });

  it('reports parse errors for corrupted rows but imports the good ones', async () => {
    const user = await registerUser('errs@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    const csv = [
      'Symbol,Action,Quantity,Price,Timestamp',
      'AAPL,BUY,100,170,2024-03-04 09:31:00',
      'AAPL,SELL,100,173,2024-03-04 14:00:00',
      'BADROW,BUY,xyz,10,2024-03-04', // corrupted qty
    ].join('\n');

    const imp = await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv });
    expect(imp.body.errors).toHaveLength(1);
    expect(imp.body.imported.trades).toBe(1);
  });
});

describe('day drill-down', () => {
  it('returns daily stats, the day\'s trades, and an intraday P&L curve', async () => {
    const user = await registerUser('day@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    // 2024-03-04: AAPL only, +298 net
    const day = await request(app)
      .get(`/api/day?accountId=${acct.id}&date=2024-03-04`)
      .set(h);
    expect(day.status).toBe(200);
    expect(day.body.stats.netPnl).toBe(298);
    expect(day.body.stats.totalTrades).toBe(1);
    expect(day.body.trades).toHaveLength(1);
    expect(day.body.trades[0].symbol).toBe('AAPL');
    expect(day.body.cumulative).toHaveLength(1);
    expect(day.body.cumulative[0].value).toBe(298);
  });

  it('returns an empty (but well-formed) snapshot for a day with no trades', async () => {
    const user = await registerUser('emptyday@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const day = await request(app)
      .get(`/api/day?accountId=${acct.id}&date=2024-03-10`)
      .set(h);
    expect(day.status).toBe(200);
    expect(day.body.stats.totalTrades).toBe(0);
    expect(day.body.trades).toEqual([]);
    expect(day.body.cumulative).toEqual([]);
  });

  it('rejects a malformed date', async () => {
    const user = await registerUser('baddate@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const res = await request(app)
      .get(`/api/day?accountId=${acct.id}&date=03-04-2024`)
      .set(h);
    expect(res.status).toBe(400);
  });

  it('enforces RLS — a user cannot read another user\'s day', async () => {
    const alice = await registerUser('alice3@example.com');
    const bob = await registerUser('bob3@example.com');
    const aliceAcct = await createAccount(alice.token);
    const res = await request(app)
      .get(`/api/day?accountId=${aliceAcct.id}&date=2024-03-04`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });
});

describe('trade log filtering', () => {
  it('filters trades by query params', async () => {
    const user = await registerUser('filter@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const all = await request(app).get(`/api/trades?accountId=${acct.id}`).set(h);
    expect(all.body.trades).toHaveLength(2);

    const aapl = await request(app).get(`/api/trades?accountId=${acct.id}&symbol=aapl`).set(h);
    expect(aapl.body.trades).toHaveLength(1);
    expect(aapl.body.trades[0].symbol).toBe('AAPL');

    const shorts = await request(app).get(`/api/trades?accountId=${acct.id}&side=SHORT`).set(h);
    expect(shorts.body.trades).toHaveLength(1);
    expect(shorts.body.trades[0].symbol).toBe('TSLA');

    const wins = await request(app).get(`/api/trades?accountId=${acct.id}&outcome=win`).set(h);
    expect(wins.body.trades).toHaveLength(2); // both round-trips are profitable
  });

  it('rejects a non-canonical from/to date', async () => {
    const user = await registerUser('filterdate@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const res = await request(app).get(`/api/trades?accountId=${acct.id}&from=2024-3-5`).set(h);
    expect(res.status).toBe(400);
  });
});

describe('daily journal notes', () => {
  it('saves a note and returns it on the day endpoint', async () => {
    const user = await registerUser('note@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const put = await request(app)
      .put('/api/day/note')
      .set(h)
      .send({ accountId: acct.id, date: '2024-03-04', note: 'Good discipline today.' });
    expect(put.status).toBe(200);
    expect(put.body.note).toBe('Good discipline today.');

    const day = await request(app).get(`/api/day?accountId=${acct.id}&date=2024-03-04`).set(h);
    expect(day.body.note).toBe('Good discipline today.');

    // calendar reports the noted day
    const cal = await request(app).get(`/api/calendar?accountId=${acct.id}&year=2024&month=3`).set(h);
    expect(cal.body.notedDays).toContain('2024-03-04');
  });

  it('clears a note when sent empty', async () => {
    const user = await registerUser('clearnote@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).put('/api/day/note').set(h).send({ accountId: acct.id, date: '2024-03-04', note: 'x' });
    await request(app).put('/api/day/note').set(h).send({ accountId: acct.id, date: '2024-03-04', note: '' });
    const day = await request(app).get(`/api/day?accountId=${acct.id}&date=2024-03-04`).set(h);
    expect(day.body.note).toBe('');
  });

  it('rejects a malformed date and enforces RLS', async () => {
    const alice = await registerUser('alice5@example.com');
    const bob = await registerUser('bob5@example.com');
    const aliceAcct = await createAccount(alice.token);
    const ha = { Authorization: `Bearer ${alice.token}` };

    const bad = await request(app).put('/api/day/note').set(ha).send({ accountId: aliceAcct.id, date: 'nope', note: 'x' });
    expect(bad.status).toBe(400);

    const rls = await request(app)
      .put('/api/day/note')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ accountId: aliceAcct.id, date: '2024-03-04', note: 'hacked' });
    expect(rls.status).toBe(404);
  });
});

describe('analytics report', () => {
  it('returns performance breakdowns for the account\'s trades', async () => {
    const user = await registerUser('reports@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const res = await request(app).get(`/api/analytics?accountId=${acct.id}`).set(h);
    expect(res.status).toBe(200);
    const a = res.body.analytics;
    expect(a.overall.netPnl).toBe(447);
    // AAPL long +298, TSLA short +149
    const symbols = Object.fromEntries(a.bySymbol.map((s) => [s.key, s.netPnl]));
    expect(symbols.AAPL).toBe(298);
    expect(symbols.TSLA).toBe(149);
    const sides = Object.fromEntries(a.bySide.map((s) => [s.key, s.netPnl]));
    expect(sides.LONG).toBe(298);
    expect(sides.SHORT).toBe(149);
    expect(a.byTag[0].key).toBe('Untagged');
  });

  it('enforces RLS on the analytics endpoint', async () => {
    const alice = await registerUser('alice4@example.com');
    const bob = await registerUser('bob4@example.com');
    const aliceAcct = await createAccount(alice.token);
    const res = await request(app)
      .get(`/api/analytics?accountId=${aliceAcct.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });
});

describe('trade tagging', () => {
  it('persists interactive tags on a trade', async () => {
    const user = await registerUser('tags@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const trades = await request(app).get(`/api/trades?accountId=${acct.id}`).set(h);
    const id = trades.body.trades[0].id;

    const patch = await request(app)
      .patch(`/api/trades/${id}`)
      .set(h)
      .send({ tags: ['Breakout', 'Revenge Trade'] });
    expect(patch.body.trade.tags).toEqual(['Breakout', 'Revenge Trade']);
  });

  it('preserves tags across a re-import (durable by trade signature)', async () => {
    const user = await registerUser('durabletags@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    let trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL');
    await request(app).patch(`/api/trades/${aapl.id}`).set(h).send({ tags: ['Breakout'] });

    // Re-import the same CSV: trade rows are regenerated with new ids.
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aaplAfter = trades.find((t) => t.symbol === 'AAPL');
    expect(aaplAfter.tags).toEqual(['Breakout']); // survived the re-import
  });

  it('sets per-trade risk, exposes R-multiple stats, and survives re-import', async () => {
    const user = await registerUser('risk@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    let trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL'); // netPnl 298

    const patch = await request(app)
      .patch(`/api/trades/${aapl.id}`)
      .set(h)
      .send({ riskAmount: 149 });
    expect(patch.body.trade.riskAmount).toBe(149);

    // Analytics reflects R-multiple (298 / 149 = 2R)
    const a = await request(app).get(`/api/analytics?accountId=${acct.id}`).set(h);
    expect(a.body.analytics.rMultiple.count).toBe(1);
    expect(a.body.analytics.rMultiple.avgR).toBe(2);

    // Risk survives re-import (durable by signature)
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades.find((t) => t.symbol === 'AAPL').riskAmount).toBe(149);
  });

  it('saves a per-trade note that survives a re-import', async () => {
    const user = await registerUser('tradenote@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    let trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL');

    const patch = await request(app)
      .patch(`/api/trades/${aapl.id}`)
      .set(h)
      .send({ note: 'Entered late, still worked.' });
    expect(patch.body.trade.note).toBe('Entered late, still worked.');

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades.find((t) => t.symbol === 'AAPL').note).toBe('Entered late, still worked.');

    // Clearing removes it
    const cleared = await request(app).patch(`/api/trades/${trades.find((t) => t.symbol === 'AAPL').id}`).set(h).send({ note: '  ' });
    expect(cleared.body.trade.note).toBe('');
  });

  it('de-duplicates tags', async () => {
    const user = await registerUser('dupetags@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const patch = await request(app)
      .patch(`/api/trades/${trades[0].id}`)
      .set(h)
      .send({ tags: ['Scalp', 'Scalp', 'News'] });
    expect(patch.body.trade.tags).toEqual(['Scalp', 'News']);
  });
});

// ---------------------------------------------------------------------------
// Deep end-to-end coverage for the multi-broker / aggregate / mapping features.
// ---------------------------------------------------------------------------

// Distinct broker-format CSVs (each a single round-trip) so a merged account
// holds several recognized brokers.
const ROBINHOOD_CSV = [
  'Activity Date,Instrument,Trans Code,Quantity,Price,Fees',
  '03/07/2024,AMD,buy,100,200.00,0',
  '03/07/2024,AMD,sell,100,205.00,0',
].join('\n');
const WEBULL_CSV = [
  'Symbol,Side,Filled,Avg Price,Filled Time',
  'NVDA,BUY,10,500,2024-03-06 11:00:00',
  'NVDA,SELL,10,510,2024-03-06 12:00:00',
].join('\n');
const GENERIC_SPY_CSV = [
  'Symbol,Action,Quantity,Price,Timestamp',
  'SPY,BUY,10,400,2024-03-08 09:30:00',
  'SPY,SELL,10,405,2024-03-08 15:00:00',
].join('\n');

const findDay = (cal, date) => cal.weeks.flat().find((c) => c && c.date === date);
const imp = (h, body) => request(app).post('/api/import').set(h).send(body);

describe('append / merge — deep coverage', () => {
  it('append into an empty account behaves like a first import', async () => {
    const user = await registerUser('emptyappend@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const res = await imp(h, { accountId: acct.id, csv: TOS_CSV, mode: 'append' });
    expect(res.body.mode).toBe('append');
    expect(res.body.addedExecutions).toBe(4);
    expect(res.body.imported.trades).toBe(2);
    expect(res.body.accountBrokers).toEqual(['ThinkOrSwim']);
  });

  it('durable tags survive an append re-derivation', async () => {
    const user = await registerUser('appendtags@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await imp(h, { accountId: acct.id, csv: TOS_CSV });
    let trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL');
    await request(app).patch(`/api/trades/${aapl.id}`).set(h).send({ tags: ['breakout'], note: 'clean A+' });

    // Appending a different broker's file re-derives the trade set...
    await imp(h, { accountId: acct.id, csv: WEBULL_CSV, mode: 'append' });
    trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aaplAfter = trades.find((t) => t.symbol === 'AAPL');
    // ...but the durable tag + note (keyed by trade signature) carry over.
    expect(aaplAfter.tags).toEqual(['breakout']);
    expect(aaplAfter.note).toBe('clean A+');
    expect(trades).toHaveLength(3); // AAPL, TSLA, NVDA
  });

  it('merges three recognized brokers, then a replace shrinks the set', async () => {
    const user = await registerUser('threebrokers@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await imp(h, { accountId: acct.id, csv: TOS_CSV });
    await imp(h, { accountId: acct.id, csv: ROBINHOOD_CSV, mode: 'append' });
    const three = await imp(h, { accountId: acct.id, csv: WEBULL_CSV, mode: 'append' });
    expect(three.body.accountBrokers.sort()).toEqual(['Robinhood', 'ThinkOrSwim', 'Webull']);
    expect(three.body.imported.trades).toBe(4); // AAPL, TSLA, AMD, NVDA

    // A replace (default mode) wipes the union back to just the new file.
    const replaced = await imp(h, { accountId: acct.id, csv: GENERIC_SPY_CSV });
    expect(replaced.body.accountBrokers).toEqual(['Generic']);
    expect(replaced.body.imported.trades).toBe(1);
  });
});

describe('cross-account aggregate — deep coverage', () => {
  it('combines same-day P&L across accounts in the calendar', async () => {
    const user = await registerUser('aggcal@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const a1 = await createAccount(user.token, { name: 'A1' });
    const a2 = await createAccount(user.token, { name: 'A2' });
    // Both close a trade on 2024-03-04: A1 +300, A2 +100.
    await imp(h, { accountId: a1.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,100,170,2024-03-04 09:31:00\nAAPL,SELL,100,173,2024-03-04 14:00:00' });
    await imp(h, { accountId: a2.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nMSFT,BUY,10,400,2024-03-04 10:00:00\nMSFT,SELL,10,410,2024-03-04 15:00:00' });

    const cal = (await request(app).get('/api/calendar?accountId=all&year=2024&month=3').set(h)).body.calendar;
    expect(cal.monthlyPnl).toBe(400);
    expect(findDay(cal, '2024-03-04').pnl).toBe(400); // 300 + 100 on one cell
    expect(cal.tradingDays).toBe(1);
  });

  it('aggregate honors period (from/to) across accounts', async () => {
    const user = await registerUser('aggperiod@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const a1 = await createAccount(user.token, { name: 'Mar' });
    const a2 = await createAccount(user.token, { name: 'Apr' });
    await imp(h, { accountId: a1.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,100,170,2024-03-04 09:31:00\nAAPL,SELL,100,173,2024-03-04 14:00:00' });
    await imp(h, { accountId: a2.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nNVDA,BUY,10,500,2024-04-10 11:00:00\nNVDA,SELL,10,520,2024-04-10 12:00:00' });

    const apr = (await request(app).get('/api/metrics?accountId=all&from=2024-04-01&to=2024-04-30').set(h)).body.metrics;
    expect(apr.totalTrades).toBe(1); // only the April account's trade
    expect(apr.netPnl).toBe(200);
    const allTime = (await request(app).get('/api/metrics?accountId=all').set(h)).body.metrics;
    expect(allTime.totalTrades).toBe(2);
    expect(allTime.netPnl).toBe(500); // 300 + 200
  });

  it('aggregate respects net vs gross basis across accounts', async () => {
    const user = await registerUser('aggbasis@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const a1 = await createAccount(user.token, { name: 'A1' });
    const a2 = await createAccount(user.token, { name: 'A2' });
    await imp(h, { accountId: a1.id, csv: TOS_CSV }); // commissions present → net 447, gross 450
    await imp(h, { accountId: a2.id, csv: WEBULL_CSV }); // +100, no commission
    const net = (await request(app).get('/api/metrics?accountId=all&basis=net').set(h)).body.metrics.netPnl;
    const gross = (await request(app).get('/api/metrics?accountId=all&basis=gross').set(h)).body.metrics.netPnl;
    expect(net).toBe(547); // 447 + 100
    expect(gross).toBe(550); // 450 + 100 (commissions excluded)
    expect(gross).toBeGreaterThan(net);
  });

  it('aggregate trade filter by symbol spans accounts', async () => {
    const user = await registerUser('aggfilter@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const a1 = await createAccount(user.token, { name: 'A1' });
    const a2 = await createAccount(user.token, { name: 'A2' });
    await imp(h, { accountId: a1.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,100,170,2024-03-04 09:31:00\nAAPL,SELL,100,173,2024-03-04 14:00:00' });
    await imp(h, { accountId: a2.id, csv: 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,50,170,2024-03-05 09:31:00\nAAPL,SELL,50,175,2024-03-05 14:00:00\nMSFT,BUY,10,400,2024-03-05 10:00:00\nMSFT,SELL,10,410,2024-03-05 15:00:00' });
    const aapl = (await request(app).get('/api/trades?accountId=all&symbol=AAPL').set(h)).body.trades;
    expect(aapl).toHaveLength(2); // one AAPL trade from each account
    expect(aapl.every((t) => t.symbol === 'AAPL')).toBe(true);
  });

  it('aggregate equals the single account when only one exists', async () => {
    const user = await registerUser('aggsingle@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const acct = await createAccount(user.token);
    await imp(h, { accountId: acct.id, csv: TOS_CSV });
    const one = (await request(app).get(`/api/metrics?accountId=${acct.id}`).set(h)).body.metrics;
    const all = (await request(app).get('/api/metrics?accountId=all').set(h)).body.metrics;
    expect(all.totalTrades).toBe(one.totalTrades);
    expect(all.netPnl).toBe(one.netPnl);
  });

  it('aggregate for a user with no accounts is empty but well-formed', async () => {
    const user = await registerUser('aggnone@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const res = await request(app).get('/api/metrics?accountId=all').set(h);
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalTrades).toBe(0);
    expect(res.body.metrics.startingBalance).toBe(0);
    expect(res.body.equityCurve).toEqual([]);
    expect(res.body.score.components).toHaveLength(5);
  });
});

describe('column mapping — deep coverage', () => {
  it('infers action from signed quantity when no side column is mapped', async () => {
    const user = await registerUser('mapsign@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = 'Sym,Qty,Px,T\nAAPL,100,170,2024-03-04 09:31:00\nAAPL,-100,173,2024-03-04 14:00:00';
    const res = await imp(h, {
      accountId: acct.id,
      csv,
      mapping: { symbol: 'Sym', quantity: 'Qty', price: 'Px', executedAt: 'T' },
    });
    expect(res.body.broker).toBe('custom');
    expect(res.body.imported.trades).toBe(1);
    expect(res.body.metrics.netPnl).toBe(300);
  });

  it('combines a mapped custom file with a recognized broker via append', async () => {
    const user = await registerUser('mapappend@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await imp(h, { accountId: acct.id, csv: TOS_CSV }); // 2 trades, ThinkOrSwim
    const csv = 'Ticker,Direction,Filled,ExecPrice,When\nMSFT,Bought,50,400,2024-03-07 09:30:00\nMSFT,Sold,50,410,2024-03-07 15:00:00';
    const res = await imp(h, {
      accountId: acct.id,
      mode: 'append',
      csv,
      mapping: { symbol: 'Ticker', action: 'Direction', quantity: 'Filled', price: 'ExecPrice', executedAt: 'When' },
    });
    expect(res.body.imported.trades).toBe(3);
    expect(res.body.accountBrokers.sort()).toEqual(['Custom mapping', 'ThinkOrSwim']);
  });

  it('preview rejects an empty CSV and detects a recognized broker', async () => {
    const user = await registerUser('mappreview@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const empty = await request(app).post('/api/import/preview').set(h).send({ csv: '' });
    expect(empty.status).toBe(400);
    const known = await request(app).post('/api/import/preview').set(h).send({ csv: TOS_CSV });
    expect(known.body.detectedBroker).toBe('thinkorswim');
    expect(known.body.fields).toContain('symbol');
  });

  it('a mapping that omits a required column routes rows to errors', async () => {
    const user = await registerUser('mapbad@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = 'Sym,Qty,Px,T\nAAPL,100,170,2024-03-04 09:31:00\nAAPL,-100,173,2024-03-04 14:00:00';
    // price intentionally left unmapped → every row fails validation
    const res = await imp(h, {
      accountId: acct.id,
      csv,
      mapping: { symbol: 'Sym', quantity: 'Qty', executedAt: 'T' },
    });
    expect(res.body.imported.trades).toBe(0);
    expect(res.body.errors.length).toBe(2);
    expect(res.body.errors[0].reason).toBe('invalid price');
  });
});

describe('SQLite-backed app (persistence wiring)', () => {
  it('runs the import → metrics flow against a SqliteRepository', async () => {
    const { SqliteRepository } = await import('../core/sqlite-repository.js');
    const sqliteApp = createApp(new SqliteRepository(':memory:'));

    const reg = await request(sqliteApp).post('/api/auth/register').send({ email: 'sql@example.com', password: 'secret123' });
    const h = { Authorization: `Bearer ${reg.body.token}` };
    const acct = (await request(sqliteApp).post('/api/accounts').set(h).send({ name: 'SQL', startingBalance: 10000 })).body.account;

    const imp = await request(sqliteApp).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    expect(imp.body.imported.trades).toBe(2);

    const metrics = await request(sqliteApp).get(`/api/metrics?accountId=${acct.id}`).set(h);
    expect(metrics.body.metrics.netPnl).toBe(447);

    // Tag a trade, re-import, confirm durability through the SQL layer.
    const trades = (await request(sqliteApp).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    await request(sqliteApp).patch(`/api/trades/${trades[0].id}`).set(h).send({ tags: ['A+'] });
    await request(sqliteApp).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const reTagged = (await request(sqliteApp).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(reTagged.find((t) => t.id === trades[0].id || t.symbol === trades[0].symbol).tags).toContain('A+');
  });
});

describe('options & futures import (contract multipliers)', () => {
  it('imports an options CSV and scales P&L by 100x', async () => {
    const user = await registerUser('optimport@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = [
      'Symbol,Side,Quantity,Price,Timestamp',
      'AAPL240315C00170000,BUY,2,1.50,2024-03-04 09:31:00',
      'AAPL240315C00170000,SELL,2,2.00,2024-03-04 14:00:00',
    ].join('\n');
    const res = await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv });
    expect(res.body.imported.trades).toBe(1);
    expect(res.body.metrics.netPnl).toBe(100); // (2.0-1.5)*2*100
    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades[0]).toMatchObject({ instrument: 'option', multiplier: 100, right: 'CALL', strike: 170 });
  });

  it('imports a futures CSV using the symbol-derived point value', async () => {
    const user = await registerUser('futimport@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = [
      'Symbol,Side,Quantity,Price,Timestamp',
      '/ESZ4,BUY,1,5000,2024-03-04 09:31:00',
      '/ESZ4,SELL,1,5010,2024-03-04 14:00:00',
    ].join('\n');
    const res = await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv });
    expect(res.body.metrics.netPnl).toBe(500); // 10 pts * 1 * $50
    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades[0]).toMatchObject({ instrument: 'future', multiplier: 50 });
  });

  it('respects an explicit multiplier column for unknown contracts', async () => {
    const user = await registerUser('multcol@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    const csv = [
      'Symbol,Side,Quantity,Price,Timestamp,Multiplier',
      'XYZ,BUY,1,100,2024-03-04 09:31:00,10',
      'XYZ,SELL,1,110,2024-03-04 14:00:00,10',
    ].join('\n');
    const res = await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv });
    expect(res.body.metrics.netPnl).toBe(100); // (110-100)*1*10
  });
});

describe('setup playbook', () => {
  it('assigns setups, reports per-strategy stats, and filters by setup', async () => {
    const user = await registerUser('playbook@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    const trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL');
    const tsla = trades.find((t) => t.symbol === 'TSLA');

    await request(app).patch(`/api/trades/${aapl.id}`).set(h).send({ setup: 'Opening Range Breakout' });
    await request(app).patch(`/api/trades/${tsla.id}`).set(h).send({ setup: 'VWAP Reversion' });

    const pb = (await request(app).get(`/api/playbook?accountId=${acct.id}`).set(h)).body;
    expect(pb.setups).toEqual(['Opening Range Breakout', 'VWAP Reversion']);
    const orb = pb.playbook.find((r) => r.setup === 'Opening Range Breakout');
    expect(orb).toMatchObject({ trades: 1, netPnl: 298 });

    // Filter the trade log by setup
    const filtered = (await request(app).get(`/api/trades?accountId=${acct.id}&setup=VWAP Reversion`).set(h)).body.trades;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].symbol).toBe('TSLA');
  });

  it('setup assignment survives a re-import (durable by signature)', async () => {
    const user = await registerUser('playbookdur@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    let trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    const aapl = trades.find((t) => t.symbol === 'AAPL');
    await request(app).patch(`/api/trades/${aapl.id}`).set(h).send({ setup: 'Gap and Go' });

    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    trades = (await request(app).get(`/api/trades?accountId=${acct.id}`).set(h)).body.trades;
    expect(trades.find((t) => t.symbol === 'AAPL').setup).toBe('Gap and Go');
  });
});

describe('OAuth sign-in (Google / Apple)', () => {
  // Inject a fake verifier so the endpoint logic is tested without network/JWKS.
  const fakeOauth = {
    google: async (idToken) => {
      if (idToken === 'bad') throw new Error('invalid signature');
      return { provider: 'google', sub: 'google-123', email: 'oauth@example.com', emailVerified: true };
    },
  };

  it('advertises configured providers via /api/auth/config', async () => {
    const configured = createApp(new (await import('../core/repository.js')).Repository(), {
      oauth: fakeOauth, googleClientId: 'client-abc',
    });
    const res = await request(configured).get('/api/auth/config');
    expect(res.body.providers.google).toEqual({ enabled: true, clientId: 'client-abc' });
    expect(res.body.providers.apple.enabled).toBe(false);
  });

  it('signs in with a verified Google token, then logs the same identity back in', async () => {
    const { Repository } = await import('../core/repository.js');
    const oauthApp = createApp(new Repository(), { oauth: fakeOauth });

    const first = await request(oauthApp).post('/api/auth/google').send({ idToken: 'good' });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(first.body.user.email).toBe('oauth@example.com');

    // Token works against a protected route, and the account is usable.
    const h = { Authorization: `Bearer ${first.body.token}` };
    const acct = await request(oauthApp).post('/api/accounts').set(h).send({ name: 'G', startingBalance: 1000 });
    expect(acct.status).toBe(201);

    // Same provider identity → same user (idempotent), still no second account owner.
    const second = await request(oauthApp).post('/api/auth/google').send({ credential: 'good' });
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('rejects an invalid token and an unconfigured provider', async () => {
    const { Repository } = await import('../core/repository.js');
    const oauthApp = createApp(new Repository(), { oauth: fakeOauth });
    expect((await request(oauthApp).post('/api/auth/google').send({ idToken: 'bad' })).status).toBe(401);
    expect((await request(oauthApp).post('/api/auth/apple').send({ idToken: 'x' })).status).toBe(501);
    expect((await request(oauthApp).post('/api/auth/google').send({})).status).toBe(400);
  });
});

describe('billing — trial + paywall gating', () => {
  it('new users get a live trial and can access data', async () => {
    const user = await registerUser('trial@example.com');
    const h = { Authorization: `Bearer ${user.token}` };
    const status = await request(app).get('/api/billing/status').set(h);
    expect(status.body.billing).toMatchObject({ entitled: true, status: 'trialing' });
    expect(status.body.billing.daysLeft).toBeGreaterThan(0);
    expect(status.body.mode).toBe('dev');
    // Data routes are reachable during the trial.
    expect((await request(app).get('/api/accounts').set(h)).status).toBe(200);
  });

  it('blocks data with 402 once the trial has expired, then mock-checkout restores access', async () => {
    // Use a repo we can age the trial on directly.
    const { Repository } = await import('../core/repository.js');
    const repo = new Repository();
    const billingApp = createApp(repo);
    const reg = await request(billingApp).post('/api/auth/register').send({ email: 'expired@example.com', password: 'secret123' });
    const h = { Authorization: `Bearer ${reg.body.token}` };

    // Expire the trial.
    repo.setSubscription(reg.body.user.id, { trialEndsAt: new Date(Date.now() - 1000).toISOString() });

    const blocked = await request(billingApp).get('/api/accounts').set(h);
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('subscription_required');
    expect(blocked.body.billing.status).toBe('trial_expired');

    // /api/me and billing routes stay reachable so the paywall can render.
    expect((await request(billingApp).get('/api/me').set(h)).status).toBe(200);

    // Start (mock) checkout, complete it → active subscription → access restored.
    const checkout = await request(billingApp).post('/api/billing/checkout').set(h);
    expect(checkout.body.url).toContain('checkout=mock');
    const done = await request(billingApp).post('/api/billing/mock-complete').set(h);
    expect(done.body.billing).toMatchObject({ entitled: true, status: 'active' });

    expect((await request(billingApp).get('/api/accounts').set(h)).status).toBe(200);
  });

  it('hides the dev mock-complete endpoint when a real billing provider is configured', async () => {
    const { Repository } = await import('../core/repository.js');
    const stripeApp = createApp(new Repository(), { billing: { mode: 'stripe', createCheckout: async () => ({ url: 'https://stripe/checkout' }) } });
    const reg = await request(stripeApp).post('/api/auth/register').send({ email: 'stripe@example.com', password: 'secret123' });
    const h = { Authorization: `Bearer ${reg.body.token}` };
    expect((await request(stripeApp).post('/api/billing/mock-complete').set(h)).status).toBe(404);
    const checkout = await request(stripeApp).post('/api/billing/checkout').set(h);
    expect(checkout.body.url).toBe('https://stripe/checkout');
  });
});

describe('billing — Stripe provider (checkout + signed webhook)', () => {
  const WHSEC = 'whsec_itest';

  // Build a Stripe provider with injected fetch (no network).
  async function makeStripeApp() {
    const crypto = (await import('node:crypto')).default;
    const { stripeBilling } = await import('../core/stripe-billing.js');
    const { Repository } = await import('../core/repository.js');
    const periodEnd = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
    const fetchImpl = async (url) => {
      if (url.includes('/checkout/sessions')) {
        return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) };
      }
      if (url.includes('/subscriptions/')) {
        return { ok: true, json: async () => ({ id: 'sub_1', current_period_end: periodEnd }) };
      }
      if (url.includes('/billing_portal/sessions')) {
        return { ok: true, json: async () => ({ url: 'https://billing.stripe.com/p/session_1' }) };
      }
      throw new Error(`unexpected stripe call: ${url}`);
    };
    const billing = stripeBilling({ secretKey: 'sk_test', priceId: 'price_1', webhookSecret: WHSEC, fetchImpl });
    const repo = new Repository();
    return { app: createApp(repo, { billing }), repo, crypto };
  }

  it('runs trial-expiry → 402 → checkout → signed webhook → active access', async () => {
    const { app: sApp, repo, crypto } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-e2e@example.com', password: 'secret123' });
    const userId = reg.body.user.id;
    const h = { Authorization: `Bearer ${reg.body.token}` };

    // Expire the trial → data is gated.
    repo.setSubscription(userId, { trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(402);

    // Checkout returns the Stripe-hosted URL.
    const checkout = await request(sApp).post('/api/billing/checkout').set(h);
    expect(checkout.body.url).toBe('https://checkout.stripe.com/c/cs_1');

    // Stripe posts a signed checkout.session.completed webhook → activates user.
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: userId, customer: 'cus_1', subscription: 'sub_1' } } };
    const raw = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
    const hook = await request(sApp)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${ts},v1=${v1}`)
      .send(raw);
    expect(hook.status).toBe(200);

    // Now entitled, data flows again.
    const status = await request(sApp).get('/api/billing/status').set(h);
    expect(status.body).toMatchObject({ mode: 'stripe' });
    expect(status.body.billing).toMatchObject({ entitled: true, status: 'active' });
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(200);

    // An active subscriber can open the billing portal to manage/cancel.
    const portal = await request(sApp).post('/api/billing/portal').set(h);
    expect(portal.status).toBe(200);
    expect(portal.body.url).toBe('https://billing.stripe.com/p/session_1');
  });

  it('billing portal 404s before there is a Stripe customer to manage', async () => {
    const { app: sApp } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-noportal@example.com', password: 'secret123' });
    const h = { Authorization: `Bearer ${reg.body.token}` };
    expect((await request(sApp).post('/api/billing/portal').set(h)).status).toBe(404);
  });

  it('billing portal 404s with the dev provider (no portal support)', async () => {
    const reg = await registerUser('dev-noportal@example.com');
    const h = { Authorization: `Bearer ${reg.token}` };
    expect((await request(app).post('/api/billing/portal').set(h)).status).toBe(404);
  });

  it('rejects a forged webhook with 400 and does not activate', async () => {
    const { app: sApp, repo } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-forge@example.com', password: 'secret123' });
    repo.setSubscription(reg.body.user.id, { trialEndsAt: new Date(Date.now() - 1000).toISOString() });

    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: reg.body.user.id } } });
    const forged = await request(sApp)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .send(raw);
    expect(forged.status).toBe(400);

    const h = { Authorization: `Bearer ${reg.body.token}` };
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(402); // still gated
  });

  it('past_due keeps soft access (grace), then a cancel hard-locks the user', async () => {
    const { app: sApp, repo, crypto } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-dunning@example.com', password: 'secret123' });
    const userId = reg.body.user.id;
    const h = { Authorization: `Bearer ${reg.body.token}` };
    repo.setSubscription(userId, { trialEndsAt: new Date(Date.now() - 1000).toISOString() }); // trial already over

    const sendEvent = async (event) => {
      const raw = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
      return request(sApp).post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', `t=${ts},v1=${v1}`)
        .send(raw);
    };

    // A failed renewal: Stripe marks the subscription past_due (period just lapsed).
    const lapsed = Math.floor((Date.now() - 86_400_000) / 1000); // 1 day ago → within grace
    expect((await sendEvent({
      id: 'evt_pd', type: 'customer.subscription.updated',
      data: { object: { metadata: { userId }, status: 'past_due', current_period_end: lapsed, customer: 'cus_1' } },
    })).status).toBe(200);

    // Grace: still entitled, surfaced as past_due so the UI nudges for payment.
    const grace = await request(sApp).get('/api/billing/status').set(h);
    expect(grace.body.billing).toMatchObject({ entitled: true, status: 'past_due' });
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(200);

    // Dunning exhausted: Stripe cancels → hard paywall.
    expect((await sendEvent({
      id: 'evt_del', type: 'customer.subscription.deleted',
      data: { object: { metadata: { userId }, status: 'canceled', customer: 'cus_1' } },
    })).status).toBe(200);
    expect(repo.getSubscription(userId).subscriptionStatus).toBe('canceled');
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(402);
  });

  it('reflects a portal cancellation (active until period end) and a resume', async () => {
    const { app: sApp, repo, crypto } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-cancel@example.com', password: 'secret123' });
    const userId = reg.body.user.id;
    const h = { Authorization: `Bearer ${reg.body.token}` };
    repo.setSubscription(userId, { subscriptionStatus: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z', stripeCustomerId: 'cus_1' });

    const sendEvent = async (id, object) => {
      const raw = JSON.stringify({ id, type: 'customer.subscription.updated', data: { object } });
      const ts = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
      return request(sApp).post('/api/billing/webhook')
        .set('Content-Type', 'application/json').set('Stripe-Signature', `t=${ts},v1=${v1}`).send(raw);
    };

    // User cancels in the portal → still active, but flagged to end at period end.
    const periodEnd = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
    await sendEvent('evt_cancel', { metadata: { userId }, status: 'active', cancel_at_period_end: true, current_period_end: periodEnd, customer: 'cus_1' });
    let status = (await request(sApp).get('/api/billing/status').set(h)).body;
    expect(status.billing).toMatchObject({ entitled: true, status: 'active', cancelAtPeriodEnd: true });
    expect(status.billing.currentPeriodEnd).toBe('2099-01-01T00:00:00.000Z');
    expect((await request(sApp).get('/api/accounts').set(h)).status).toBe(200); // full access retained

    // User resumes before the period ends → flag clears.
    await sendEvent('evt_resume', { metadata: { userId }, status: 'active', cancel_at_period_end: false, current_period_end: periodEnd, customer: 'cus_1' });
    status = (await request(sApp).get('/api/billing/status').set(h)).body;
    expect(status.billing.cancelAtPeriodEnd).toBe(false);
  });

  it('applies each webhook event id once (idempotent against replay/out-of-order)', async () => {
    const { app: sApp, repo, crypto } = await makeStripeApp();
    const reg = await request(sApp).post('/api/auth/register').send({ email: 'stripe-idem@example.com', password: 'secret123' });
    const userId = reg.body.user.id;
    const h = { Authorization: `Bearer ${reg.body.token}` };
    repo.setSubscription(userId, { subscriptionStatus: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z', stripeCustomerId: 'cus_1' });
    const periodEnd = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);

    const send = (id, object) => {
      const raw = JSON.stringify({ id, type: 'customer.subscription.updated', data: { object } });
      const ts = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
      return request(sApp).post('/api/billing/webhook')
        .set('Content-Type', 'application/json').set('Stripe-Signature', `t=${ts},v1=${v1}`).send(raw);
    };
    const cancelFlag = () => request(sApp).get('/api/billing/status').set(h).then((r) => r.body.billing.cancelAtPeriodEnd);

    // evt_A: cancel scheduled.
    expect((await send('evt_A', { metadata: { userId }, status: 'active', cancel_at_period_end: true, current_period_end: periodEnd, customer: 'cus_1' })).body)
      .toMatchObject({ received: true });
    expect(await cancelFlag()).toBe(true);

    // evt_B (newer): resumed.
    await send('evt_B', { metadata: { userId }, status: 'active', cancel_at_period_end: false, current_period_end: periodEnd, customer: 'cus_1' });
    expect(await cancelFlag()).toBe(false);

    // A late re-delivery of evt_A must NOT revert the resume — it's a duplicate.
    const replay = await send('evt_A', { metadata: { userId }, status: 'active', cancel_at_period_end: true, current_period_end: periodEnd, customer: 'cus_1' });
    expect(replay.body).toMatchObject({ duplicate: true });
    expect(await cancelFlag()).toBe(false);
  });
});

describe('advanced statistics endpoint', () => {
  it('returns daily, kelly, sharpe, and economics for the scoped trades', async () => {
    const user = await registerUser('stats@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const res = await request(app).get(`/api/statistics?accountId=${acct.id}`).set(h);
    expect(res.status).toBe(200);
    const s = res.body.statistics;
    // TOS_CSV → AAPL +298 on 03-04, TSLA +149 on 03-05: two green days, no losses.
    expect(s.daily.tradingDays).toBe(2);
    expect(s.daily.greenDays).toBe(2);
    expect(s.daily.dayWinRate).toBe(1);
    expect(s.daily.bestDay).toMatchObject({ date: '2024-03-04' });
    expect(s.payoffRatio).toBeNull(); // no losing trades yet
    expect(s.expectancy).toBeGreaterThan(0);
    expect(s).toHaveProperty('sharpe');
    expect(s.kelly).toHaveProperty('clamped');
  });

  it('scopes statistics to a date range', async () => {
    const user = await registerUser('statsrange@example.com');
    const acct = await createAccount(user.token);
    const h = { Authorization: `Bearer ${user.token}` };
    await request(app).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });

    const res = await request(app).get(`/api/statistics?accountId=${acct.id}&from=2024-03-05&to=2024-03-05`).set(h);
    expect(res.body.statistics.daily.tradingDays).toBe(1); // only the TSLA day
  });

  it('requires authentication and entitlement', async () => {
    const res = await request(app).get('/api/statistics?accountId=all');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed date range', async () => {
    const user = await registerUser('statsbad@example.com');
    const acct = await createAccount(user.token);
    const res = await request(app).get(`/api/statistics?accountId=${acct.id}&from=03-2024`)
      .set({ Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(400);
  });
});

describe('paywall toggle (open-access launch mode)', () => {
  it('bypasses the paywall when billing is not enforced, even past trial', async () => {
    const { Repository } = await import('../core/repository.js');
    const repo = new Repository();
    const openApp = createApp(repo, { billingEnforced: false });

    const reg = await request(openApp).post('/api/auth/register').send({ email: 'open@example.com', password: 'secret123' });
    const userId = reg.body.user.id;
    const h = { Authorization: `Bearer ${reg.body.token}` };

    // Expire the trial outright — with the paywall off, access continues.
    repo.setSubscription(userId, { trialEndsAt: new Date(Date.now() - 1000).toISOString(), subscriptionStatus: 'trialing' });

    expect((await request(openApp).get('/api/accounts').set(h)).status).toBe(200);

    const status = await request(openApp).get('/api/billing/status').set(h);
    expect(status.body.enforced).toBe(false);

    // Data routes work end to end (import + statistics) despite the lapsed trial.
    const acct = (await request(openApp).post('/api/accounts').set(h).send({ name: 'Main', startingBalance: 10000 })).body.account;
    await request(openApp).post('/api/import').set(h).send({ accountId: acct.id, csv: TOS_CSV });
    expect((await request(openApp).get(`/api/statistics?accountId=${acct.id}`).set(h)).body.statistics.daily.tradingDays).toBe(2);
  });

  it('still enforces the paywall by default (enforced=true)', async () => {
    const { Repository } = await import('../core/repository.js');
    const repo = new Repository();
    const gatedApp = createApp(repo, {}); // default

    const reg = await request(gatedApp).post('/api/auth/register').send({ email: 'gated@example.com', password: 'secret123' });
    repo.setSubscription(reg.body.user.id, { trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    const h = { Authorization: `Bearer ${reg.body.token}` };

    expect((await request(gatedApp).get('/api/accounts').set(h)).status).toBe(402);
    expect((await request(gatedApp).get('/api/billing/status').set(h)).body.enforced).toBe(true);
  });
});
