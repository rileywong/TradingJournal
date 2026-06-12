import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { analyzeDuplicates, executionKey } from '../core/parser.js';

const e = (over) => ({ symbol: 'AAPL', action: 'BUY', quantity: 100, price: 170, commission: 1, executedAt: '2024-03-04T09:31:05.000Z', broker: 'tos', ...over });

describe('analyzeDuplicates', () => {
  it('counts new vs duplicate fills against existing', () => {
    const existing = [e()];
    const parsed = [e(), e({ price: 173, action: 'SELL' })]; // first is a dup, second is new
    const r = analyzeDuplicates(existing, parsed);
    expect(r).toEqual({ parsed: 2, added: 1, duplicates: 1, allDuplicate: false });
  });

  it('flags an all-duplicate re-upload', () => {
    const fills = [e(), e({ action: 'SELL', price: 173 })];
    const r = analyzeDuplicates(fills, fills);
    expect(r.duplicates).toBe(2);
    expect(r.added).toBe(0);
    expect(r.allDuplicate).toBe(true);
  });

  it('treats exact repeats within the same file as duplicates', () => {
    const r = analyzeDuplicates([], [e(), e()]);
    expect(r).toEqual({ parsed: 2, added: 1, duplicates: 1, allDuplicate: false });
  });

  it('handles empty inputs', () => {
    expect(analyzeDuplicates([], [])).toEqual({ parsed: 0, added: 0, duplicates: 0, allDuplicate: false });
    expect(typeof executionKey(e())).toBe('string');
  });
});

const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
].join('\n');

describe('import duplicate detection', () => {
  let app;
  beforeEach(() => { app = createApp(); });
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  async function setup() {
    const u = (await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'secret123' })).body;
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'M', startingBalance: 10000 })).body.account;
    return { u, acct };
  }

  it('reports zero duplicates on a first import', async () => {
    const { u, acct } = await setup();
    const res = await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' }).expect(200);
    expect(res.body.duplicates).toBe(0);
    expect(res.body.parsedFills).toBe(2);
    expect(res.body.allDuplicate).toBe(false);
  });

  it('flags a re-upload of the same file (append skips the dups)', async () => {
    const { u, acct } = await setup();
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' });
    const again = await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'append' }).expect(200);
    expect(again.body.duplicates).toBe(2);
    expect(again.body.allDuplicate).toBe(true);
    // append de-duped, so the account still has just the one round-trip
    expect(again.body.imported.executions).toBe(2);
    expect(again.body.imported.trades).toBe(1);
  });
});
