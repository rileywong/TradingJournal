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
