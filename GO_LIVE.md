# Go-live runbook

Everything below is wired in code and reads from env vars — going live is
configuration, not development. Do the steps in order; you can launch in
**open/early-access** mode first (no payments) and flip the paywall on later.

## 0. Deploy (Render)

1. Push to `main` (already done).
2. Render → **New + → Blueprint** → pick this repo. The included
   [`render.yaml`](./render.yaml) provisions a Node 22 web service, a **1 GB
   persistent disk** at `/var/data` for the SQLite DB (required — without it,
   every deploy wipes data), and auto-generates `TJS_SECRET`.
3. First deploy will boot in **open access if you set `PAYWALL_ENABLED=false`**,
   or with the paywall on by default. Either is fine to start.
4. Note your URL, e.g. `https://greenstreak.onrender.com`. `APP_URL` is optional
   on Render (the app falls back to `RENDER_EXTERNAL_URL`).

> ⚠️ In production the server **refuses to boot** with the default `TJS_SECRET`.
> The blueprint generates one for you; if deploying elsewhere, set it to
> `openssl rand -hex 32`.

## 1. Email (Resend) — needed for welcome / password-reset / digest

1. Create a [Resend](https://resend.com) account, **verify your sending domain**.
2. Create an API key.
3. In Render → service → **Environment**, set:
   - `RESEND_API_KEY` = your key
   - `EMAIL_FROM` = `Greenstreak <hi@yourdomain.com>` (must be on the verified domain)
4. Without these, emails just log to the console (safe, but users get nothing).

## 2. Google sign-in (optional)

1. Google Cloud Console → **APIs & Services → Credentials → OAuth client ID**
   (type: Web application).
2. **Authorized JavaScript origins** = your app URL (e.g.
   `https://greenstreak.onrender.com`) — add `http://localhost:5173` for local dev.
3. Set `GOOGLE_CLIENT_ID` in Render. The "Continue with Google" button appears
   automatically when it's set. (Apple is analogous via `APPLE_CLIENT_ID`.)

## 3. Stripe billing — needed to charge

1. Stripe Dashboard → **Product** → add a product, then a **recurring price of
   $10/month**. Copy the **price ID** (`price_…`).
2. **Developers → API keys** → copy the **Secret key** (`sk_live_…`).
3. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<your-app>/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_…`).
4. Set in Render: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
   (If `STRIPE_WEBHOOK_SECRET` is missing, the server warns and rejects every
   webhook, so subscriptions never activate — set it.)

## 4. Admin dashboard

Set `ADMIN_EMAILS=you@example.com` (comma-separated for more). Those accounts
get the **Admin** tab (users, MRR, acquisition funnel, drop-off, cohorts, CSV
export, weekly-digest trigger).

## 5. Flip the paywall on

Set `PAYWALL_ENABLED=true` (the default). New users get a **14-day trial**, then
need an active **$10/mo** subscription.

## 6. Weekly digest (optional)

`POST /api/admin/send-digests` emails the weekly performance digest to everyone
who traded that week. Trigger it from the Admin dashboard button, or schedule a
weekly **Render Cron Job** that curls it with an admin token.

## Smoke test (after setting keys)

1. Sign up → you should receive a **welcome email**.
2. **Forgot password** → reset link arrives → reset works.
3. With the paywall on, let the trial lapse (or test in Stripe test mode):
   subscribe via the paywall → Stripe checkout → returns active; the
   **Manage subscription** button opens the Stripe portal.
4. Visit `/admin` (as an `ADMIN_EMAILS` user) and confirm stats load.

## Env var quick reference

| Var | Required? | Purpose |
| --- | --- | --- |
| `TJS_SECRET` | **prod** | Token signing (Render auto-generates) |
| `DB_PATH` | **prod** | SQLite path on the persistent disk |
| `PAYWALL_ENABLED` | no | `false` = open access; default enforces trial+paywall |
| `RESEND_API_KEY` / `EMAIL_FROM` | for email | Deliver welcome / reset / digest |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | to charge | Live billing |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | no | Social sign-in |
| `ADMIN_EMAILS` | no | Admin dashboard access |
| `APP_URL` | no | Public URL (Render uses `RENDER_EXTERNAL_URL`) |
