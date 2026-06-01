# TradeJournalSimplified

A lightweight, high-performance trading journal & analytics platform — a fast,
clean **Light Theme** take on the best of TradeZella. Import brokerage CSV
exports, automatically normalize raw executions into closed trades, and view
institutional-grade performance metrics on a professional dashboard.

## Features

- **Auth & user isolation** — register/login with HMAC (JWT-shaped) tokens;
  every data access is RLS-scoped to the owning user.
- **CSV import engine** — auto-detects ThinkOrSwim / Robinhood / Webull / generic
  exports; tolerant date & number parsing; corrupted rows routed to an error
  bucket instead of failing the import.
- **Trade matching** — groups executions into closed round-trips, handling split
  entries/exits, shorts, and position flips (overshoot-zero splitting).
- **Statistical engine** — Net P&L, Win Rate, Profit Factor, Expectancy, Max
  Drawdown, equity curve, avg win/loss.
- **Light-theme dashboard** — metrics snapshot grid, monthly P&L calendar,
  sortable trade log with interactive tags.

## Stack

- **Core** (`core/`): framework-free ES modules — parser, matcher, metrics,
  calendar, auth, repository.
- **Backend** (`server/`): Express API.
- **Frontend** (`src/`): React + Vite, hand-rolled light-theme CSS.
- **Persistence**: in-memory repository mirroring a `users → accounts →
  executions/trades` SQL schema (swap to Postgres without touching logic).

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

72 tests across the CSV tokenizer, tolerant date parser, broker detection,
trade-matching engine (splits/shorts/flips), metric math (zero-loss / zero-trade
edge cases), calendar aggregation, and full API integration (auth, RLS
isolation, import→state-transition, re-import idempotency, tagging).

## Layout

See [DESIGN_DOC.md](DESIGN_DOC.md) for the folder hierarchy, ER schema, matching
algorithm, metric definitions, and state mapping.
