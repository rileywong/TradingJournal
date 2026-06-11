import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { renderWelcomeEmail, renderPasswordResetEmail } from '../core/email.js';

function fakeEmail() {
  const sent = [];
  return { name: 'fake', sent, async send(msg) { sent.push(msg); return { ok: true }; } };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('transactional email', () => {
  it('sends a welcome email on signup', async () => {
    const email = fakeEmail();
    const app = createApp(undefined, { email });
    await request(app).post('/api/auth/register').send({ email: 'New@X.com', password: 'secret123' }).expect(201);
    await tick();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('new@x.com');
    expect(email.sent[0].subject).toMatch(/welcome/i);
  });

  it('does not send on a failed signup', async () => {
    const email = fakeEmail();
    const app = createApp(undefined, { email });
    await request(app).post('/api/auth/register').send({ email: 'bad', password: 'x' }).expect(400);
    await tick();
    expect(email.sent).toHaveLength(0);
  });

  it('signup still succeeds if the email provider throws', async () => {
    const email = { name: 'boom', async send() { throw new Error('smtp down'); } };
    const app = createApp(undefined, { email });
    await request(app).post('/api/auth/register').send({ email: 'ok@x.com', password: 'secret123' }).expect(201);
  });

  it('renders welcome + reset templates with text and html', () => {
    const w = renderWelcomeEmail({ email: 'a@b.com', appUrl: 'https://app.test/' });
    expect(w.html).toContain('app.test');
    expect(w.text).toMatch(/trial/i);
    const r = renderPasswordResetEmail({ email: 'a@b.com', resetUrl: 'https://app.test/reset?t=abc' });
    expect(r.html).toContain('reset?t=abc');
    expect(r.subject).toMatch(/reset/i);
  });
});
