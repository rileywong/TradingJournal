import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { signUnsubscribe, verifyUnsubscribe } from '../core/auth.js';

describe('unsubscribe token', () => {
  it('round-trips and rejects tampering', () => {
    const t = signUnsubscribe('user-123');
    expect(verifyUnsubscribe(t)).toBe('user-123');
    expect(verifyUnsubscribe(t + 'x')).toBeNull();
    expect(verifyUnsubscribe('garbage')).toBeNull();
    expect(verifyUnsubscribe('')).toBeNull();
  });
});

function fakeEmail() {
  const sent = [];
  return { name: 'fake', sent, async send(msg) { sent.push(msg); return { ok: true }; } };
}
const tick = () => new Promise((r) => setTimeout(r, 15));
const ADMIN = 'admin@site.com';
function recentCsv() {
  const d = new Date(Date.now() - 86_400_000);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return ['Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
    `${day} 09:31:00,BUY,100,TO OPEN,AAPL,100.00,0`,
    `${day} 14:00:00,SELL,100,TO CLOSE,AAPL,105.00,0`].join('\n');
}

describe('digest unsubscribe + prefs', () => {
  let app; let email;
  beforeEach(() => { email = fakeEmail(); app = createApp(undefined, { adminEmails: [ADMIN], email }); });
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function tradingUser(addr) {
    const u = (await request(app).post('/api/auth/register').send({ email: addr, password: 'secret123' })).body;
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'M', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: recentCsv(), mode: 'replace' });
    return u;
  }

  it('one-click unsubscribe opts the user out of digests', async () => {
    const admin = (await request(app).post('/api/auth/register').send({ email: ADMIN, password: 'secret123' })).body;
    const u = await tradingUser('tom@x.com');

    const token = signUnsubscribe(u.user.id);
    const page = await request(app).get(`/api/unsubscribe?token=${token}`).expect(200);
    expect(page.text).toMatch(/unsubscribed/i);

    const sent = (await request(app).post('/api/admin/send-digests').set(auth(admin.token)).expect(200)).body.sent;
    expect(sent).toBe(0); // opted out → skipped
  });

  it('email-prefs endpoint toggles the digest and is reflected in sends', async () => {
    const admin = (await request(app).post('/api/auth/register').send({ email: ADMIN, password: 'secret123' })).body;
    const u = await tradingUser('amy@x.com');

    expect((await request(app).get('/api/me/email-prefs').set(auth(u.token))).body).toEqual({ digest: true });
    await request(app).put('/api/me/email-prefs').set(auth(u.token)).send({ digest: false }).expect(200);
    expect((await request(app).get('/api/me/email-prefs').set(auth(u.token))).body).toEqual({ digest: false });

    expect((await request(app).post('/api/admin/send-digests').set(auth(admin.token))).body.sent).toBe(0);

    await request(app).put('/api/me/email-prefs').set(auth(u.token)).send({ digest: true }).expect(200);
    expect((await request(app).post('/api/admin/send-digests').set(auth(admin.token))).body.sent).toBe(1);
  });
});
