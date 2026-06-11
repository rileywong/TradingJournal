// Pluggable transactional email. Mirrors the billing-provider pattern: without
// a real provider configured, a dev provider records messages (and logs a line)
// so flows stay testable and visible locally. A production provider only needs
// to implement `send({ to, subject, text, html })`.

/** Dev/no-op provider: captures sent messages in `.sent` for tests + local dev. */
export function devEmailProvider({ log = true } = {}) {
  const sent = [];
  return {
    name: 'dev',
    sent,
    async send(msg) {
      sent.push({ ...msg, sentAt: new Date().toISOString() });
      if (log) console.log(`✉  [dev email] to=${msg.to} subj=${JSON.stringify(msg.subject)}`);
      return { ok: true, id: `dev-${sent.length}` };
    },
  };
}

const BRAND = 'Greenstreak';

function shell(bodyHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#16241c">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2ece6;margin:24px 0"/>
<p style="color:#93a79c;font-size:12px">${BRAND} — the trading journal with serious statistics.</p>
</div>`;
}

const link = (url) => (url ? String(url).replace(/\/+$/, '') : '');

/** Welcome email sent right after signup. */
export function renderWelcomeEmail({ email, appUrl } = {}) {
  const url = link(appUrl) || '';
  const cta = url
    ? `<p><a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Open your dashboard</a></p>`
    : '';
  return {
    to: email,
    subject: 'Welcome to Greenstreak — let’s find your edge',
    text: `Welcome to ${BRAND}!\n\nYou're all set. Three quick steps to get going:\n1. Create a trading account (one per broker)\n2. Import a CSV export of your trades\n3. See your Trade Score, stats, calendar, and reports\n\n${url ? `Open your dashboard: ${url}\n\n` : ''}Your 14-day free trial has started. Happy trading.`,
    html: shell(`<h1 style="font-size:22px;margin:0 0 10px">Welcome to ${BRAND} 📈</h1>
<p style="font-size:15px;line-height:1.6;color:#5e7268">You're all set. Three quick steps to bring your dashboard to life:</p>
<ol style="font-size:15px;line-height:1.7;color:#16241c;padding-left:20px">
<li>Create a trading account (one per broker)</li>
<li>Import a CSV export of your trades</li>
<li>See your Trade Score, stats, calendar, and reports</li>
</ol>
${cta}
<p style="font-size:13px;color:#93a79c">Your 14-day free trial has started.</p>`),
  };
}

/** Password-reset email with a one-time link. */
export function renderPasswordResetEmail({ email, resetUrl } = {}) {
  const url = link(resetUrl);
  return {
    to: email,
    subject: 'Reset your Greenstreak password',
    text: `Someone requested a password reset for your ${BRAND} account.\n\nReset it here (link expires in 1 hour):\n${url}\n\nIf this wasn't you, you can safely ignore this email.`,
    html: shell(`<h1 style="font-size:20px;margin:0 0 10px">Reset your password</h1>
<p style="font-size:15px;line-height:1.6;color:#5e7268">Someone requested a password reset for your ${BRAND} account. This link expires in 1 hour.</p>
<p><a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Choose a new password</a></p>
<p style="font-size:13px;color:#93a79c">If this wasn't you, you can safely ignore this email.</p>`),
  };
}

const fmtMoney = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const fmtPct = (r) => `${Math.round((r || 0) * 100)}%`;

/** Weekly performance digest email. `digest` is from buildWeeklyDigest(). */
export function renderWeeklyDigestEmail({ email, appUrl, digest } = {}) {
  const url = link(appUrl);
  const d = digest || {};
  const sign = d.netPnl >= 0 ? '+' : '';
  const bestLine = d.bestDay ? `Best day: ${d.bestDay.date} (${fmtMoney(d.bestDay.pnl)})` : '';
  const worstLine = d.worstDay ? `Toughest day: ${d.worstDay.date} (${fmtMoney(d.worstDay.pnl)})` : '';
  return {
    to: email,
    subject: `Your trading week: ${sign}${fmtMoney(d.netPnl)} over ${d.trades} trades`,
    text: `Here's your week on ${BRAND}:\n\n`
      + `Net P&L: ${sign}${fmtMoney(d.netPnl)}\n`
      + `Trades: ${d.trades} (${d.wins}W / ${d.losses}L, ${fmtPct(d.winRate)} win rate)\n`
      + `${bestLine}\n${worstLine}\n\n`
      + (url ? `See the full breakdown: ${url}\n` : ''),
    html: shell(`<h1 style="font-size:20px;margin:0 0 12px">Your week on ${BRAND}</h1>
<table style="width:100%;border-collapse:collapse;font-size:15px">
<tr><td style="padding:6px 0;color:#5e7268">Net P&L</td><td style="padding:6px 0;text-align:right;font-weight:800;color:${d.netPnl >= 0 ? '#10b981' : '#ef4444'}">${sign}${fmtMoney(d.netPnl)}</td></tr>
<tr><td style="padding:6px 0;color:#5e7268">Trades</td><td style="padding:6px 0;text-align:right;font-weight:700">${d.trades} · ${fmtPct(d.winRate)} win rate</td></tr>
${d.bestDay ? `<tr><td style="padding:6px 0;color:#5e7268">Best day</td><td style="padding:6px 0;text-align:right;font-weight:700">${d.bestDay.date} (${fmtMoney(d.bestDay.pnl)})</td></tr>` : ''}
${d.worstDay ? `<tr><td style="padding:6px 0;color:#5e7268">Toughest day</td><td style="padding:6px 0;text-align:right;font-weight:700">${d.worstDay.date} (${fmtMoney(d.worstDay.pnl)})</td></tr>` : ''}
</table>
${url ? `<p style="margin-top:18px"><a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">See the full breakdown</a></p>` : ''}`),
  };
}
