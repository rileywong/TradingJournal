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

import { resendEmailProvider, emailProviderFromEnv } from '../core/email.js';

describe('resend email provider', () => {
  it('POSTs to the Resend API with auth + payload', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, async json() { return { id: 're_123' }; } };
    };
    const p = resendEmailProvider({ apiKey: 'rk_test', from: 'Greenstreak <hi@greenstreak.app>', fetchImpl });
    const res = await p.send({ to: 'a@b.com', subject: 'Hi', text: 'hello', html: '<p>hello</p>' });
    expect(res.id).toBe('re_123');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer rk_test');
    const body = JSON.parse(calls[0].opts.body);
    expect(body).toMatchObject({ from: 'Greenstreak <hi@greenstreak.app>', to: 'a@b.com', subject: 'Hi' });
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422, async text() { return 'bad domain'; } });
    const p = resendEmailProvider({ apiKey: 'rk', from: 'x@y.com', fetchImpl });
    await expect(p.send({ to: 'a@b.com', subject: 's' })).rejects.toThrow(/resend 422/);
  });

  it('requires apiKey + from', () => {
    expect(() => resendEmailProvider({ from: 'x@y.com' })).toThrow(/apiKey/);
    expect(() => resendEmailProvider({ apiKey: 'k' })).toThrow(/from/);
  });

  it('emailProviderFromEnv selects resend when configured, else dev', () => {
    expect(emailProviderFromEnv({}).name).toBe('dev');
    expect(emailProviderFromEnv({ RESEND_API_KEY: 'rk', EMAIL_FROM: 'x@y.com' }).name).toBe('resend');
  });
});
