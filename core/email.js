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
