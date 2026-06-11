import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.js';

let app;
beforeEach(() => { app = createApp(); });

const TOS_CSV = [
  'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
  '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.00,1.00',
  '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.00,1.00',
].join('\n');

async function user(email = 'trader@x.com', password = 'original1') {
  const { body } = await request(app).post('/api/auth/register').send({ email, password });
  return body; // { token, user }
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('change password', () => {
  it('changes the password after verifying the current one', async () => {
    const u = await user();
    await request(app).post('/api/auth/change-password').set(auth(u.token))
      .send({ currentPassword: 'original1', newPassword: 'brandnew1' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'trader@x.com', password: 'original1' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'trader@x.com', password: 'brandnew1' }).expect(200);
  });

  it('rejects a wrong current password or too-short new password', async () => {
    const u = await user();
    await request(app).post('/api/auth/change-password').set(auth(u.token))
      .send({ currentPassword: 'wrong', newPassword: 'brandnew1' }).expect(400);
    await request(app).post('/api/auth/change-password').set(auth(u.token))
      .send({ currentPassword: 'original1', newPassword: 'short' }).expect(400);
  });

  it('requires auth', async () => {
    await request(app).post('/api/auth/change-password').send({ currentPassword: 'a', newPassword: 'brandnew1' }).expect(401);
  });
});

describe('data export', () => {
  it('returns the user’s accounts and trades, scoped to them', async () => {
    const u = await user();
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'Main', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' });

    const other = await user('other@x.com');
    await request(app).post('/api/accounts').set(auth(other.token)).send({ name: 'Theirs', startingBalance: 5000 });

    const res = await request(app).get('/api/me/export').set(auth(u.token)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/greenstreak-export\.json/);
    expect(res.body.user.email).toBe('trader@x.com');
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].name).toBe('Main');
    expect(res.body.accounts[0].trades.length).toBe(1);
  });
});

describe('delete account', () => {
  it('removes the user and all their data', async () => {
    const u = await user();
    const acct = (await request(app).post('/api/accounts').set(auth(u.token)).send({ name: 'Main', startingBalance: 10000 })).body.account;
    await request(app).post('/api/import').set(auth(u.token)).send({ accountId: acct.id, csv: TOS_CSV, mode: 'replace' });

    await request(app).delete('/api/me').set(auth(u.token)).expect(200);

    // The session no longer resolves to a user; login fails; the email is free to reuse.
    await request(app).get('/api/accounts').set(auth(u.token)).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'trader@x.com', password: 'original1' }).expect(401);
    await request(app).post('/api/auth/register').send({ email: 'trader@x.com', password: 'fresh1234' }).expect(201);
  });
});
