# TradeJournalSimplified

A lightweight, high-performance trading journal & analytics platform — a fast,
clean **Light Theme** take on the best of TradeZella. Import brokerage CSV
exports, automatically normalize raw executions into closed trades, and view
institutional-grade performance metrics on a professional dashboard.

## Features

- **Auth & user isolation** — register/login with HMAC (JWT-shaped) tokens;
  every data access is RLS-scoped to the owning user. **Sign in with Google /
  Apple** verifies the provider's OIDC ID token (RS256 against the provider
  JWKS; issuer/audience/expiry checked) and links by verified email — enabled by
  setting `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID`.
- **CSV import engine** — auto-detects ThinkOrSwim / Robinhood / Webull / generic
  exports; tolerant date & number parsing; corrupted rows routed to an error
  bucket instead of failing the import. **Append mode** merges several brokers
  into one account (re-deriving trades from the combined fills, so a position
  opened on one broker and closed on another still matches; re-uploads de-dupe).
  Unrecognized export? A preview + **manual column-mapping** UI lets you point
  each field at the right column. After a merge, the import confirms which
  brokers the account now holds.
- **Multi-account & aggregate** — keep an account per broker, then switch to
  **All accounts** for a combined dashboard, score, calendar, reports, and log.
- **Trade matching** — groups executions into closed round-trips, handling split
  entries/exits, shorts, and position flips (overshoot-zero splitting).
- **Options & futures** — contract multipliers applied to P&L (options ×100,
  futures point values like ES $50/pt); OCC option symbols parsed for
  underlying/expiry/strike/right; explicit multiplier column honored. The trade
  log badges OPT/FUT rows.
- **Statistical engine** — Net P&L, Win Rate, Profit Factor, Expectancy, Max
  Drawdown, equity curve, avg win/loss.
- **Trade Score** — a composite 0–100 grade (à la TradeZella's Zella Score)
  blending win rate, profit factor, win/loss ratio, drawdown control, and
  consistency, with a weighted breakdown.
- **Day drill-down** — click any calendar day for a TradeZella-style daily
  snapshot: stats, an intraday cumulative-P&L chart, that day's trades, and a
  persistent journal note (notes survive re-imports and show as calendar dots).
- **Reports** — a GitHub-style **yearly P&L heatmap**, a weekday × hour **P&L
  heatmap**, performance breakdowns by
  symbol / side / day-of-week / hour / tag, winners-vs-losers comparison,
  win/loss streaks, hold-time analysis, R-multiple expectancy (set planned risk
  per trade), and an underwater drawdown chart.
- **Period & basis controls** — scope the whole dashboard to All / Last 30 days
  / MTD / YTD and toggle **Net vs Gross** P&L.
- **Per-trade journal notes** — inline notes on any trade, persisted across
  re-imports (alongside durable tags and risk) and surfaced in the day chart's
  crosshair tooltip.
- **Tag management** — rename or delete a tag across every trade from one screen.
- **Accounts** — create, edit, and delete accounts (delete cascades to all of
  the account's trades, notes, and tags). The calendar shows weekly P&L
  roll-ups beside the month grid, and the trade log exports to CSV.
- **Charts** — equity curve, intraday P&L, and drawdown rendered with
  [lightweight-charts](https://github.com/tradingview/lightweight-charts).
- **Light-theme dashboard** — score gauge, metrics snapshot grid, monthly P&L
  calendar, and a filterable, sortable trade log (filter by symbol / side /
  outcome / tag / date) with interactive custom tags that persist across
  re-imports.
- **Setup playbook** — assign a strategy to each trade and see per-setup win
  rate, profit factor, expectancy, and average R; filter the log by setup.
- **Trial & paywall** — every account starts a 7-day free trial; afterwards a
  subscription is required (data routes return `402`, the UI shows a paywall).
  Billing is provider-pluggable — a dev provider completes checkout locally;
  wire Stripe by passing a billing provider to `createApp`.

## Stack

- **Core** (`core/`): framework-free ES modules — parser, matcher, metrics,
  calendar, auth, repository.
- **Backend** (`server/`): Express API.
- **Frontend** (`src/`): React + Vite, hand-rolled light-theme CSS.
- **Persistence**: **SQLite** (`node:sqlite`, zero native deps) by default —
  data survives restarts; set `DB_PATH` (or `:memory:` for ephemeral). Tests use
  an in-memory repository behind the identical interface, so the same logic runs
  on either store (swap to Postgres without touching app code).

## Getting started

```bash
npm install
npm run dev      # starts API (:4000) + Vite client (:5173) together
```

Open http://localhost:5173, register, create an account, then drag in a CSV from
`samples/`.

Run only one side:

```bash
npm run dev:server   # Express API on :4000
npm run dev:client   # Vite dev server on :5173 (proxies /api → :4000)
```

### Single-process (production / preview)

Build the client and let Express serve the UI and API from one port:

```bash
npm run serve        # vite build, then node serves dist/ + /api on :4000
```

Open http://localhost:4000. (`npm start` runs the server alone, serving an
existing `dist/` build.)

## Testing

```bash
npm test
```

256 tests across the CSV tokenizer, tolerant date parser, broker detection,
execution de-duplication, append/merge imports, cross-account aggregation,
trade-matching engine (splits/shorts/flips), metric math (zero-loss / zero-trade
edge cases, drawdown series), calendar/day/weekly/yearly aggregation, analytics
breakdowns (incl. winners-vs-losers, R-multiple, and the weekday×hour heatmap),
the composite Trade Score, period ranges, net/gross basis, trade filtering, CSV
export, journal-note persistence (daily and per-trade), durable tags & risk, tag
rename/delete, and full API integration (auth, RLS isolation,
import→state-transition, re-import idempotency, account update/delete cascade,
tag management, period/basis-scoped metrics, and the day/analytics/year/notes/
filter endpoints).

A `SessionStart` hook (`.claude/hooks/session-start.sh`) installs dependencies
automatically so the suite is ready to run in Claude Code on the web sessions.

## Layout

See [DESIGN_DOC.md](DESIGN_DOC.md) for the folder hierarchy, ER schema, matching
algorithm, metric definitions, and state mapping.
