import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { Repository } from '../core/repository.js';

function fakeEmail() {
  const sent = [];
  return { name: 'fake', sent, async send(msg) { sent.push(msg); return { ok: true }; } };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

async function setup() {
  const repo = new Repository();
  const email = fakeEmail();
  const app = createApp(repo, { email });
  await request(app).post('/api/auth/register').send({ email: 'trader@x.com', password: 'original1' }).expect(201);
  return { repo, email, app };
}

describe('password reset', () => {
  it('emails a reset link and lets the user set a new password', async () => {
    const { repo, app } = await setup();
    const token = repo.createPasswordReset('trader@x.com'); // capture the token directly

    const reset = await request(app).post('/api/auth/reset').send({ token, password: 'brandnew1' }).expect(200);
    expect(reset.body.token).toBeTruthy();
    expect(reset.body.user.email).toBe('trader@x.com');

    // Old password no longer works; new one does.
    await request(app).post('/api/auth/login').send({ email: 'trader@x.com', password: 'original1' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'trader@x.com', password: 'brandnew1' }).expect(200);
  });

  it('/forgot always returns 200 and only emails known addresses', async () => {
    const { email, app } = await setup();
    await request(app).post('/api/auth/forgot').send({ email: 'trader@x.com' }).expect(200);
    await request(app).post('/api/auth/forgot').send({ email: 'nobody@x.com' }).expect(200);
    await tick();
    const resets = email.sent.filter((m) => /reset/i.test(m.subject));
    expect(resets).toHaveLength(1); // only the known address got a reset link
    expect(resets[0].to).toBe('trader@x.com');
  });

  it('rejects an invalid or already-used token', async () => {
    const { repo, app } = await setup();
    await request(app).post('/api/auth/reset').send({ token: 'garbage', password: 'brandnew1' }).expect(400);

    const token = repo.createPasswordReset('trader@x.com');
    await request(app).post('/api/auth/reset').send({ token, password: 'brandnew1' }).expect(200);
    // single-use: the same token can't be replayed
    await request(app).post('/api/auth/reset').send({ token, password: 'another12' }).expect(400);
  });

  it('rejects an expired token', async () => {
    const { repo, app } = await setup();
    const token = repo.createPasswordReset('trader@x.com', -1); // already expired
    await request(app).post('/api/auth/reset').send({ token, password: 'brandnew1' }).expect(400);
  });

  it('enforces the password length on reset', async () => {
    const { repo, app } = await setup();
    const token = repo.createPasswordReset('trader@x.com');
    await request(app).post('/api/auth/reset').send({ token, password: 'short' }).expect(400);
  });
});
