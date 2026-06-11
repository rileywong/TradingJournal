import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { sanitizeSavedViews } from '../core/repository.js';

describe('sanitizeSavedViews', () => {
  it('keeps only valid named views with the allowed filter keys', () => {
    const out = sanitizeSavedViews([
      { name: '  Winners on SPY ', filter: { symbol: 'SPY', outcome: 'win', junk: 'x' } },
      { name: '', filter: {} },           // dropped: no name
      { filter: { side: 'LONG' } },        // dropped: no name
      'nope',                              // dropped: not an object
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Winners on SPY');
    expect(out[0].filter).toEqual({ symbol: 'SPY', side: '', outcome: 'win', tag: '', setup: '' });
    expect(out[0].filter.junk).toBeUndefined();
  });

  it('caps at 20 and ignores non-arrays', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `v${i}`, filter: {} }));
    expect(sanitizeSavedViews(many)).toHaveLength(20);
    expect(sanitizeSavedViews('nope')).toEqual([]);
    expect(sanitizeSavedViews(null)).toEqual([]);
  });
});

describe('saved views API', () => {
  let app;
  beforeEach(() => { app = createApp(); });
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const user = async (email = 'a@x.com') =>
    (await request(app).post('/api/auth/register').send({ email, password: 'secret123' })).body;

  it('defaults to empty and round-trips saved views (RLS-scoped)', async () => {
    const u = await user();
    expect((await request(app).get('/api/me/views').set(auth(u.token))).body.views).toEqual([]);

    const views = [{ name: 'Longs', filter: { side: 'LONG' } }, { name: 'AAPL', filter: { symbol: 'AAPL' } }];
    const put = await request(app).put('/api/me/views').set(auth(u.token)).send({ views }).expect(200);
    expect(put.body.views).toHaveLength(2);
    expect(put.body.views[0]).toEqual({ name: 'Longs', filter: { symbol: '', side: 'LONG', outcome: '', tag: '', setup: '' } });

    const got = (await request(app).get('/api/me/views').set(auth(u.token))).body.views;
    expect(got.map((v) => v.name)).toEqual(['Longs', 'AAPL']);

    // Another user doesn't see them.
    const other = await user('b@x.com');
    expect((await request(app).get('/api/me/views').set(auth(other.token))).body.views).toEqual([]);
  });

  it('sanitizes junk on save and blocks the demo session', async () => {
    const u = await user();
    const saved = (await request(app).put('/api/me/views').set(auth(u.token))
      .send({ views: [{ name: 'x'.repeat(100), filter: { evil: 1 } }] })).body.views;
    expect(saved[0].name).toHaveLength(40);
    expect(Object.keys(saved[0].filter).sort()).toEqual(['outcome', 'setup', 'side', 'symbol', 'tag']);

    const demo = (await request(app).post('/api/demo')).body;
    await request(app).put('/api/me/views').set(auth(demo.token)).send({ views: [] }).expect(403);
  });
});
