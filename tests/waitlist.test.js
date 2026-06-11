import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

const ADMIN = 'admin@site.com';
let app;
beforeEach(() => { app = createApp(undefined, { adminEmails: [ADMIN] }); });

const waitlist = (email) => request(app).post('/api/waitlist').send({ email });

async function waitlistCount() {
  const admin = (await request(app).post('/api/auth/register').send({ email: ADMIN, password: 'secret123' })).body;
  const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${admin.token}`);
  return res.body.waitlistCount;
}

describe('waitlist', () => {
  it('accepts a valid email (public, no auth)', async () => {
    await waitlist('trader@example.com').expect(201);
  });

  it('rejects an invalid or missing email', async () => {
    await waitlist('not-an-email').expect(400);
    await request(app).post('/api/waitlist').send({}).expect(400);
  });

  it('dedupes case-insensitively', async () => {
    await waitlist('Dup@Example.com').expect(201);
    await waitlist('dup@example.com').expect(201);
    await waitlist('  DUP@example.com  '.trim()).expect(201);
    expect(await waitlistCount()).toBe(1);
  });

  it('counts distinct emails', async () => {
    await waitlist('a@example.com');
    await waitlist('b@example.com');
    expect(await waitlistCount()).toBe(2);
  });
});
