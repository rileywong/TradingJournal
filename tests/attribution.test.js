import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { sanitizeSource } from '../core/repository.js';

describe('sanitizeSource', () => {
  it('normalises and defaults to direct', () => {
    expect(sanitizeSource('  Twitter ')).toBe('twitter');
    expect(sanitizeSource('promo!! $$')).toBe('promo');
    expect(sanitizeSource('')).toBe('direct');
    expect(sanitizeSource(undefined)).toBe('direct');
    expect(sanitizeSource('x'.repeat(100)).length).toBe(40);
  });
});

const ADMIN = 'admin@site.com';
describe('signup source attribution', () => {
  let app;
  beforeEach(() => { app = createApp(undefined, { adminEmails: [ADMIN] }); });

  it('records the source and breaks it down for admins', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'secret123', source: 'Twitter' }).expect(201);
    await request(app).post('/api/auth/register').send({ email: 'b@x.com', password: 'secret123', source: 'twitter' }).expect(201);
    await request(app).post('/api/auth/register').send({ email: 'c@x.com', password: 'secret123' }).expect(201); // direct
    const admin = (await request(app).post('/api/auth/register').send({ email: ADMIN, password: 'secret123', source: 'reddit' })).body;

    const body = (await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${admin.token}`)).body;
    const map = Object.fromEntries(body.sourceBreakdown.map((s) => [s.source, s.count]));
    expect(map.twitter).toBe(2);
    expect(map.direct).toBe(1);
    expect(map.reddit).toBe(1);
  });
});
