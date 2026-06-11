// One-shot visual capture: starts the app on an in-memory repo, seeds demo +
// real + paywalled accounts, and screenshots every page/state with Playwright.
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { Repository } from '../core/repository.js';
import { demoCsv } from '../core/demo-data.js';

const PORT = 4137;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('../shots/', import.meta.url).pathname;
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const repo = new Repository();
const server = createApp(repo, { billingEnforced: true, adminEmails: ['alex@demo.test'] }).listen(PORT);
await new Promise((r) => server.once('listening', r));

const post = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const csv = demoCsv();

// 1) demo session (paywall-bypassed, fully populated)
const demo = await post('/api/demo');

// 2) real trialing user with imported data (shows trial banner + import + modals)
const a = await post('/api/auth/register', { email: 'alex@demo.test', password: 'password1' });
const { account: acctA } = await post("/api/accounts", { name: "Main — Live", startingBalance: 25000, commissionPerTrade: 0 }, a.token);
await post('/api/import', { accountId: acctA.id, csv, mode: 'replace' }, a.token);

// 3) paywalled user: register, then backdate the trial so it has expired
const b = await post('/api/auth/register', { email: 'blair@demo.test', password: 'password1' });
const { account: acctB } = await post("/api/accounts", { name: "Main", startingBalance: 25000, commissionPerTrade: 0 }, b.token);
await post('/api/import', { accountId: acctB.id, csv, mode: 'replace' }, b.token);
repo.setSubscription(b.user.id, {
  subscriptionStatus: 'trialing',
  trialEndsAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
});

// 4) Seed a richer population so the admin dashboard has something to show:
// spread signups across the last 30 days with varied subscription states.
const DAY = 86_400_000;
const names = ['mia', 'liam', 'noah', 'ava', 'ethan', 'sofia', 'lucas', 'emma', 'leo', 'isla', 'kai', 'zoe'];
let seeded = 0;
for (let i = 0; i < names.length; i++) {
  const u = await post('/api/auth/register', { email: `${names[i]}@demo.test`, password: 'password1' });
  // Backdate the signup date for the sparkline.
  repo.users.get(u.user.id).createdAt = new Date(Date.now() - ((i * 29) / names.length) * DAY).toISOString();
  // Give a few of them imported data (activation) — while still on a live trial.
  if (i % 2 === 0) {
    const { account } = await post('/api/accounts', { name: 'Main', startingBalance: 10000 }, u.token);
    await post('/api/import', { accountId: account.id, csv, mode: 'replace' }, u.token);
    seeded++;
  }
  // Then vary subscription state: ~third paying, some lapsed, rest still trialing.
  if (i % 3 === 0) {
    repo.setSubscription(u.user.id, { subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString() });
  } else if (i % 5 === 0) {
    repo.setSubscription(u.user.id, { subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() - 2 * DAY).toISOString() });
  }
}
void seeded;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setSession = async (sess) => {
  await page.goto(BASE + '/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('tjs_token', token);
    localStorage.setItem('tjs_user', JSON.stringify(user));
  }, sess);
};
const clear = async () => {
  await page.goto(BASE + '/');
  await page.evaluate(() => localStorage.clear());
};
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: OUT + name + '.png', ...opts });
  console.log('shot:', name);
};

// ---- logged-out: landing + auth ----
await clear();
await page.goto(BASE + '/'); await sleep(500);
await shot('01-landing', { fullPage: true });

await page.getByRole('button', { name: 'Sign in', exact: true }).first().click(); await sleep(400);
await shot('02-auth-login');
await page.getByRole('button', { name: 'Sign up' }).click().catch(() => {}); await sleep(300);
await shot('03-auth-register');

// ---- demo session: dashboard, reports, day modal ----
await setSession(demo);
await page.goto(BASE + '/'); await sleep(900);
await shot('04-dashboard-demo', { fullPage: true });

await page.getByRole('button', { name: 'Reports', exact: true }).click(); await sleep(900);
await shot('05-reports-demo', { fullPage: true });

await page.getByRole('button', { name: 'Dashboard', exact: true }).click(); await sleep(700);
const dayCell = page.locator('.cal-cell.clickable').filter({ hasText: /\$/ }).first();
if (await dayCell.count()) { await dayCell.click(); await sleep(700); await shot('06-day-modal'); }
await page.keyboard.press('Escape').catch(() => {});

// ---- real trialing account: trial banner, import panel, log, modals ----
await setSession(a);
await page.goto(BASE + '/'); await sleep(900);
await shot('07-dashboard-trial', { fullPage: true });

const manageTags = page.getByRole('button', { name: 'Manage tags' });
if (await manageTags.count()) { await manageTags.click(); await sleep(500); await shot('08-tag-manager'); }
await page.goto(BASE + '/'); await sleep(900);

const addAcct = page.getByRole('button', { name: '+ Account' });
if (await addAcct.count()) { await addAcct.click(); await sleep(400); await shot('09-new-account'); }

// ---- paywalled user: lockout screen ----
await setSession(b);
await page.goto(BASE + '/'); await sleep(900);
await shot('10-paywall', { fullPage: true });

// ---- admin dashboard (alex is the configured admin) ----
await setSession(a);
await page.goto(BASE + '/'); await sleep(900);
const adminBtn = page.getByRole('button', { name: 'Admin', exact: true });
if (await adminBtn.count()) { await adminBtn.click(); await sleep(900); await shot('11-admin', { fullPage: true }); }

await browser.close();
server.close();
console.log('DONE ->', OUT);
