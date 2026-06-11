// Theme/UX mockup generator: renders the dashboard under several candidate
// palettes (token overrides injected before load so charts adopt them too) and
// assembles a labeled contact sheet for comparison. Output → mockups/.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../server/index.js';
import { Repository } from '../core/repository.js';
import { demoCsv } from '../core/demo-data.js';

const PORT = 4191;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('../mockups/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const repo = new Repository();
const server = createApp(repo, { billingEnforced: true }).listen(PORT);
await new Promise((r) => server.once('listening', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

// Clean active-subscription user with demo data (no banners).
const u = await post('/api/auth/register', { email: 'sam@demo.test', password: 'password1' });
const { account } = await post('/api/accounts', { name: 'Main', startingBalance: 25000 }, u.token);
await post('/api/import', { accountId: account.id, csv: demoCsv(), mode: 'replace' }, u.token);
repo.setSubscription(u.user.id, { subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 25 * 86400000).toISOString() });

const THEMES = [
  { name: 'emerald', label: 'Emerald — current', vars: {} },
  { name: 'indigo', label: 'Indigo — classic SaaS', vars: {
    '--accent': '#6366f1', '--accent-bg': '#eef0fe', '--accent-strong': '#4f46e5',
    '--bg': '#f6f8fb', '--surface-2': '#fbfcfe', '--border': '#e6eaf0', '--text': '#1e293b', '--muted': '#64748b', '--muted-2': '#94a3b8' } },
  { name: 'ocean', label: 'Ocean — teal/cyan', vars: {
    '--accent': '#0891b2', '--accent-bg': '#e0f7fb', '--accent-strong': '#0e7490',
    '--bg': '#f1f8fa', '--surface-2': '#f4fafc', '--border': '#d9e9ef', '--text': '#0e2a33', '--muted': '#5b7c87', '--muted-2': '#9ab6bf' } },
  { name: 'violet', label: 'Violet — premium', vars: {
    '--accent': '#7c3aed', '--accent-bg': '#f3ecfe', '--accent-strong': '#6d28d9',
    '--bg': '#f8f6fc', '--surface-2': '#fbf9fe', '--border': '#e9e2f3', '--text': '#241a33', '--muted': '#6d6280', '--muted-2': '#a99fb8' } },
  { name: 'slate', label: 'Slate Pro — sharp blue', vars: {
    '--accent': '#2563eb', '--accent-bg': '#e7effe', '--accent-strong': '#1d4ed8', '--radius': '8px',
    '--bg': '#f1f5f9', '--surface-2': '#f8fafc', '--border': '#e2e8f0', '--text': '#0f172a', '--muted': '#64748b', '--muted-2': '#94a3b8' },
    extraCss: '.card,.metric-card,.calendar{border-radius:8px}.btn-primary,.btn-ghost{border-radius:6px}' },
  { name: 'midnight', label: 'Midnight — dark blue', vars: {
    '--bg': '#0b1220', '--surface': '#131c2e', '--surface-2': '#18233a', '--border': '#26324d',
    '--text': '#e6edf7', '--muted': '#93a4c0', '--muted-2': '#64748b',
    '--positive': '#34d399', '--positive-bg': '#0e2a20', '--negative': '#f87171', '--negative-bg': '#2a1717',
    '--accent': '#38bdf8', '--accent-bg': '#10243a', '--accent-strong': '#0ea5e9',
    '--shadow': '0 1px 2px rgba(0,0,0,.3),0 2px 10px rgba(0,0,0,.4)' },
    extraCss: '.cal-cell.win{border-color:#15402f}.cal-cell.loss{border-color:#45221f}' },
  { name: 'warm', label: 'Warm — cream/amber', vars: {
    '--accent': '#d97706', '--accent-bg': '#fdf0db', '--accent-strong': '#b45309',
    '--bg': '#faf6ef', '--surface': '#fffdf9', '--surface-2': '#fbf7f0', '--border': '#ece1d2', '--text': '#2b2419', '--muted': '#7b6f5e', '--muted-2': '#a79d8c' } },
  { name: 'mono', label: 'Mono — minimal', vars: {
    '--accent': '#111827', '--accent-bg': '#f3f4f6', '--accent-strong': '#000000', '--radius': '6px',
    '--bg': '#fafafa', '--surface': '#ffffff', '--surface-2': '#f7f7f8', '--border': '#e7e7e9', '--text': '#111827', '--muted': '#6b7280', '--muted-2': '#9ca3af', '--shadow': '0 1px 2px rgba(0,0,0,0.05)' },
    extraCss: '.card,.metric-card,.calendar{border-radius:6px}' },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const theme of THEMES) {
  const overrideCss = `:root{${Object.entries(theme.vars).map(([k, v]) => `${k}:${v} !important`).join(';')}}${theme.extraCss || ''}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('tjs_token', token); localStorage.setItem('tjs_user', JSON.stringify(user));
  }, u);
  await ctx.addInitScript((css) => {
    const apply = () => { const s = document.createElement('style'); s.id = '__theme'; s.textContent = css; document.head.appendChild(s); };
    if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply);
  }, overrideCss);
  const page = await ctx.newPage();
  await page.goto(BASE + '/'); await sleep(1300);
  await page.screenshot({ path: OUT + `theme-${theme.name}.png` });
  await ctx.close();
  console.log('mockup:', theme.name);
}

// Contact sheet: a labeled grid of all mockups for easy comparison.
const cells = THEMES.map((t) => `<figure><img src="file://${OUT}theme-${t.name}.png"/><figcaption>${t.label}</figcaption></figure>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:28px}
  h1{color:#e6edf3;font-size:22px;margin:0 0 4px}p.sub{color:#8b98a8;margin:0 0 22px;font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
  figure{margin:0;background:#161b22;border:1px solid #2a3340;border-radius:12px;overflow:hidden}
  figure img{display:block;width:100%;height:auto;border-bottom:1px solid #2a3340}
  figcaption{color:#e6edf3;font-weight:700;font-size:15px;padding:12px 16px}
</style>
<h1>Greenstreak — theme directions</h1><p class="sub">Same dashboard, different palettes & treatments. Pick a direction (or keep Emerald).</p>
<div class="grid">${cells}</div>`;
const sheetHtmlPath = OUT + 'contact-sheet.html';
writeFileSync(sheetHtmlPath, html);
const sheetPage = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.4 });
await sheetPage.goto('file://' + sheetHtmlPath); await sleep(800);
await sheetPage.screenshot({ path: OUT + 'contact-sheet.png', fullPage: true });
console.log('contact sheet done');

await browser.close();
server.close();
console.log('DONE ->', OUT);
