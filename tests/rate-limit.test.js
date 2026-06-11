import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

describe('auth rate limiting', () => {
  it('returns 429 after too many login attempts from one client', async () => {
    const app = createApp(undefined, { authRateLimit: { windowMs: 60_000, max: 3 } });
    await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'secret123' }).expect(201);

    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrongpass' }).expect(401);
    }
    const limited = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'secret123' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('does not throttle registration (login limiter is separate from data routes)', async () => {
    const app = createApp(undefined, { authRateLimit: { windowMs: 60_000, max: 2 } });
    // Several signups in a row are fine — only login/forgot/reset are throttled.
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/register').send({ email: `u${i}@x.com`, password: 'secret123' }).expect(201);
    }
  });
});
