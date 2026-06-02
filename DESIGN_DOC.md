# TradeJournalSimplified — Design Document

A lightweight, high-performance trading journal & analytics platform. It ingests
brokerage CSV exports, normalizes raw executions into closed **Trades**, computes
institutional-grade performance metrics, and renders them in a crisp **Light
Theme** dashboard inspired by TradeZella.

---

## 1. Technology Stack

| Layer            | Choice                                   | Rationale                                                            |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Shared Core      | Pure ES Modules (no framework)           | Parser / matcher / metrics are environment-agnostic & 100% testable |
| Backend          | Node.js + Express (ESM)                  | Tiny, fast, zero-build API surface                                  |
| Persistence      | In-memory **Repository** adapter         | Mirrors SQL relations now; swap to Postgres later w/o touching logic |
| Auth             | HMAC-signed token (JWT-shaped) stub      | Structurally identical to JWT for painless migration                |
| Frontend         | React 18 + Vite                          | Fast HMR, minimal config, light-mode optimized                      |
| Styling          | Hand-rolled CSS design tokens            | Full control over the light palette, zero CSS framework weight      |
| Testing          | Vitest + Supertest                       | Same runtime for unit + API integration tests                       |

> The persistence layer hides behind a `Repository` interface. The in-memory
> implementation enforces the same **user-isolation (RLS)** invariants a real
> Postgres `row level security` policy would, so swapping the adapter is a
> drop-in change.

---

## 2. Folder Hierarchy

```
TradeJournal/
├─ DESIGN_DOC.md
├─ package.json
├─ vite.config.js
├─ vitest.config.js
├─ index.html
├─ core/                      # Shared, framework-free business logic
│  ├─ csv.js                  # Quote-aware CSV tokenizer
│  ├─ dates.js               # Tolerant multi-format date parser
│  ├─ parser.js              # Broker detection + execution normalization
│  ├─ matcher.js             # Execution → closed Trade matching engine
│  ├─ metrics.js             # Net P&L, Win%, PF, Expectancy, Max DD, drawdown series
│  ├─ calendar.js            # Daily / monthly P&L aggregation
│  ├─ day.js                 # Per-day stats, trade list, intraday P&L series
│  ├─ analytics.js           # Breakdowns (symbol/side/weekday/hour/tag), streaks
│  ├─ score.js               # Composite 0–100 Trade Score + grade
│  ├─ filters.js             # Shared trade-log filter predicate
│  ├─ auth.js                # HMAC token sign/verify + password hashing
│  ├─ repository.js          # In-memory RLS-scoped adapter (trades, notes, tags)
│  └─ index.js               # Barrel exports
├─ server/
│  └─ index.js               # Express API (auth + accounts + import + analytics)
├─ src/                       # React frontend
│  ├─ main.jsx
│  ├─ App.jsx                # Dashboard / Reports tabs + day drill-down wiring
│  ├─ api.js                 # fetch wrapper + token storage
│  ├─ styles.css             # Light-theme design tokens
│  └─ components/
│     ├─ Auth.jsx
│     ├─ ScoreCard.jsx        # SVG ring gauge + weighted component bars
│     ├─ MetricsGrid.jsx
│     ├─ EquityChart.jsx      # lightweight-charts equity area series
│     ├─ DrawdownChart.jsx    # underwater drawdown area series
│     ├─ PnlCalendar.jsx      # clickable days + journal-note dots
│     ├─ DayDetail.jsx        # day drill-down panel (stats + chart + note + log)
│     ├─ DayChart.jsx         # intraday cumulative-P&L baseline series
│     ├─ Reports.jsx          # breakdown tables + drawdown chart
│     ├─ TradeLog.jsx         # filter bar wrapping the trade table
│     ├─ TradesTable.jsx
│     └─ ImportPanel.jsx
├─ samples/                   # Example broker exports for manual testing
│  ├─ thinkorswim.csv
│  ├─ robinhood.csv
│  └─ webull.csv
└─ tests/
   ├─ csv.test.js
   ├─ parser.test.js
   ├─ matcher.test.js
   ├─ metrics.test.js
   ├─ calendar.test.js
   ├─ day.test.js
   ├─ analytics.test.js
   ├─ score.test.js
   ├─ filters.test.js
   ├─ notes.test.js
   ├─ samples.test.js
   └─ integration.test.js     # Full import → state-transition flow + endpoints
```

---

## 3. Entity-Relationship Schema

The mock adapter mirrors this relational model exactly:

```
USERS (1) ───< (N) ACCOUNTS (1) ───< (N) EXECUTIONS
                       │
                       └────< (N) TRADES (1) ───< (N) EXECUTIONS
```

### `users`
| column        | type        | notes                          |
| ------------- | ----------- | ------------------------------ |
| id            | uuid (PK)   |                                |
| email         | text UNIQUE |                                |
| password_hash | text        | salted scrypt hash             |
| created_at    | timestamptz |                                |

### `accounts`
| column           | type           | notes                                  |
| ---------------- | -------------- | -------------------------------------- |
| id               | uuid (PK)      |                                        |
| user_id          | uuid (FK→users)| **RLS key**                            |
| name             | text           | e.g. "Main TOS"                        |
| starting_balance | numeric        | seeds the equity curve for Max DD      |
| commission_per_trade | numeric    | simulated commission when CSV lacks it |
| created_at       | timestamptz    |                                        |

### `executions` (raw normalized fills)
| column      | type              | notes                          |
| ----------- | ----------------- | ------------------------------ |
| id          | uuid (PK)         |                                |
| account_id  | uuid (FK→accounts)| **RLS via account.user_id**    |
| trade_id    | uuid (FK→trades)  | nullable until matched         |
| symbol      | text              | upper-cased ticker             |
| action      | enum(BUY,SELL)    |                                |
| quantity    | numeric           | always positive                |
| price       | numeric           |                                |
| commission  | numeric           |                                |
| executed_at | timestamptz       |                                |
| broker      | text              | source format                  |

### `trades` (closed round-trip positions)
| column      | type              | notes                                   |
| ----------- | ----------------- | --------------------------------------- |
| id          | uuid (PK)         |                                         |
| account_id  | uuid (FK→accounts)| **RLS key**                             |
| symbol      | text              |                                         |
| side        | enum(LONG,SHORT)  | direction of the opening leg            |
| quantity    | numeric           | max position size                       |
| entry_price | numeric           | qty-weighted avg of opening legs        |
| exit_price  | numeric           | qty-weighted avg of closing legs        |
| opened_at   | timestamptz       | first execution                         |
| closed_at   | timestamptz       | flattening execution                    |
| gross_pnl   | numeric           | before commissions                      |
| commission  | numeric           | total across legs                       |
| net_pnl     | numeric           | gross_pnl − commission                  |
| tags        | text[]            | e.g. {Breakout, Revenge Trade}          |

**Row-Level Security:** every read/write in the repository is parameterized by
`userId`. Account/trade/execution lookups verify the owning chain
(`execution → account → user`) before returning a row, emulating a Postgres
policy `USING (user_id = current_setting('app.user_id'))`.

---

## 4. Trade Matching Algorithm

Per `(account, symbol)`, executions are sorted by `executed_at` (stable by import
order). A signed running position is maintained (`BUY = +qty`, `SELL = −qty`):

1. When position is flat (`0`) and a fill arrives, a new trade **opens** with
   `side = sign(fill)`.
2. Fills in the same direction grow the position; opposite fills shrink it.
3. When the position returns to exactly `0`, the trade **closes**.
4. If a fill **overshoots** zero (e.g. long 100, then sell 150), it is split: the
   first 100 closes the current trade, the remaining 50 opens a new short trade.

**P&L (cash-flow method):** within a closed trade the signed quantity nets to
zero, so realized P&L is simply the signed cash flow:

```
gross_pnl = Σ (action == SELL ? +1 : −1) × price × quantity
net_pnl   = gross_pnl − Σ commission
```

This is direction-agnostic (works for both long and short) and naturally handles
partial fills / scaled exits.

---

## 5. Metric Definitions (edge-case behavior)

| Metric        | Formula                                                        | Edge case                                            |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Net P&L       | `Σ net_pnl`                                                   | 0 trades → `0`                                       |
| Win Rate      | `wins / closedTrades`                                         | 0 trades → `0`                                       |
| Profit Factor | `grossProfit / grossLoss`                                     | 0 losses → `Infinity` (UI shows `∞`); 0 of both → `0`|
| Avg Win/Loss  | `grossProfit / wins`, `grossLoss / losses`                    | divisor 0 → `0`                                      |
| Expectancy    | `(winRate × avgWin) − (lossRate × avgLoss)`                   | 0 trades → `0`                                       |
| Max Drawdown  | largest peak→trough drop on `startingBalance + cumPnl` curve  | non-positive peak → % omitted (abs still reported)   |

Breakeven trades (`net_pnl === 0`) count toward total trades but neither wins nor
losses.

---

## 6. State Mapping (Frontend)

```
App
 ├─ session            { token, user }              ← localStorage persisted
 ├─ accounts[]         ← GET /api/accounts
 ├─ activeAccountId
 └─ dashboard (derived per active account)
     ├─ metrics        ← GET /api/metrics
     ├─ trades[]       ← GET /api/trades
     └─ calendar{}     ← GET /api/calendar?year&month
```

A successful **import** (`POST /api/import`) invalidates and re-fetches
`metrics` (which now also carries `equityCurve`, `drawdownCurve`, and the
composite `score`), `trades`, `calendar` (with `notedDays`), and `analytics` in
one pass, so the snapshot grid, score gauge, charts, trade log, calendar, and
reports update atomically — the core state-transition guarantee verified in
`tests/integration.test.js`.

### API surface

| Method & path            | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `POST /api/auth/register`| Create user → token                                           |
| `POST /api/auth/login`   | Authenticate → token                                          |
| `GET  /api/accounts`     | List the caller's accounts                                    |
| `POST /api/accounts`     | Create an account                                             |
| `PATCH /api/accounts/:id`| Edit an account (name / balance / commission)                |
| `DELETE /api/accounts/:id`| Delete an account; cascades to its trades, notes, and tags  |
| `POST /api/import`       | Import a brokerage CSV (RLS-gated)                            |
| `GET  /api/trades`       | Trade log; optional `symbol/side/tag/outcome/from/to` filters |
| `PATCH /api/trades/:id`  | Update tags and/or planned `riskAmount` (durable by signature)|
| `GET  /api/metrics`      | Snapshot + `equityCurve` + `drawdownCurve` + `score` (optional `from/to`) |
| `GET  /api/calendar`     | Monthly P&L grid (+ weekly roll-ups) + `notedDays` (`basis`)  |
| `GET  /api/year`         | GitHub-style yearly P&L heatmap (`basis`)                     |
| `POST /api/accounts/:id/tags/rename` | Rename a tag across all trades                  |
| `POST /api/accounts/:id/tags/delete` | Remove a tag from all trades                    |
| `GET  /api/day`          | Daily stats + that day's trades + intraday curve + note       |
| `PUT  /api/day/note`     | Upsert a day's journal note (empty clears)                    |
| `GET  /api/analytics`    | Breakdowns, streaks, hold time, winners-vs-losers, R-multiple, heatmap (optional `from/to`, `basis`) |

Every data route is RLS-gated through the owning `user → account` chain.

---

## 7. Light Theme Design Tokens

| Token            | Value     | Usage                          |
| ---------------- | --------- | ------------------------------ |
| `--bg`           | `#f6f8fb` | App background                 |
| `--surface`      | `#ffffff` | Cards / panels                 |
| `--border`       | `#e6eaf0` | Hairline dividers              |
| `--text`         | `#1e293b` | Deep slate primary text        |
| `--muted`        | `#64748b` | Secondary text                 |
| `--positive`     | `#10b981` | Emerald — gains                |
| `--negative`     | `#ef4444` | Crimson — losses               |
| `--accent`       | `#6366f1` | Indigo — interactive accents   |

---

## 8. Composite Trade Score

A single 0–100 number summarizing trading quality, blending five normalized
sub-scores with fixed weights (see `core/score.js`):

| Component         | Weight | Mapping (0→100)                                  |
| ----------------- | ------ | ----------------------------------------------- |
| Win Rate          | 0.20   | `winRate / 0.60` (≥60% → 100)                    |
| Profit Factor     | 0.25   | `(PF − 1) × 100` (1.0 → 0, ≥2.0 → 100; ∞ → 100)  |
| Win/Loss Ratio    | 0.20   | `avgWin/avgLoss / 2 × 100` (no losses → 100)     |
| Drawdown Control  | 0.20   | `1 − ddPct/0.30` (0% → 100, ≥30% → 0)            |
| Consistency       | 0.15   | `1 − bestDayShare` of total positive daily P&L   |

Score → grade: `A+ ≥90`, `A ≥80`, `B ≥70`, `C ≥60`, `D ≥50`, else `F`; 0 trades
→ `N/A`. The weighted breakdown is returned so the UI can show contributions.

---

## 9. Execution Plan Status

1. ✅ `DESIGN_DOC.md`
2. ✅ Scaffold + dependencies
3. ✅ Core engine (csv, parser, matcher, metrics, calendar) + tests
4. ✅ Express API + integration tests
5. ✅ Light-theme React dashboard
6. ✅ Day drill-down (daily stats, intraday chart, trade list)
7. ✅ Reports (breakdowns, streaks, hold time, drawdown chart)
8. ✅ Daily journal notes (persistent, per-day)
9. ✅ Composite Trade Score
10. ✅ Trade-log filtering + durable custom tags
11. ✅ Winners-vs-losers report + trade-log CSV export
12. ✅ Account management (edit / delete with cascade)
13. ✅ Weekly P&L roll-ups on the calendar
14. ✅ Per-trade risk + R-multiple analytics
15. ✅ Reports→trade-log drill filtering; shared BaseChart
16. ✅ Dashboard period selector (All / 30d / MTD / YTD)
17. ✅ Net vs Gross P&L toggle
18. ✅ Weekday × hour P&L heatmap
19. ✅ Persisted per-trade journal notes
20. ✅ Yearly P&L heatmap; per-trade notes in the day chart tooltip; tag management
21. ✅ Append import mode — merge multiple brokers into one account
22. ✅ Cross-account aggregate scope (`accountId=all`)
23. ✅ Manual column mapping for unrecognized brokers; post-import broker feedback
24. ✅ SQLite persistence (`node:sqlite`) behind the repository interface
25. ✅ Options & futures support (contract multipliers, OCC parsing)
26. ✅ Setup playbook (per-strategy expectancy / R analytics)
27. ✅ Sign in with Google / Apple (OIDC ID-token verification, account linking)
28. ✅ 7-day trial + paywall gating (provider-pluggable billing)
29. ✅ Stripe billing provider (REST checkout + signed-webhook subscription sync)
30. ✅ Stripe billing portal (self-serve manage/cancel for active subscribers)
31. ✅ Dunning grace window (past_due keeps soft access + update-payment banner)

### Billing security notes

- **Webhook trust**: subscription state is only mutated from Stripe webhooks
  whose `Stripe-Signature` HMAC verifies against `STRIPE_WEBHOOK_SECRET` (with a
  300s timestamp tolerance). The `userId` applied comes from the signed payload
  (`client_reference_id` / `subscription.metadata.userId`), never from the
  client. A bad signature returns `400`.
- **Redirect targets**: checkout/portal `success`/`cancel`/`return` URLs prefer
  the server-configured `APP_URL` over the client `Origin` header, so they
  aren't attacker-influenced.
- **Error leakage**: Stripe API/SDK error text is logged server-side only;
  clients receive a generic `500` (only our own `RepoError` messages surface).
- **Known limitation — replay/idempotency**: events are not yet de-duplicated by
  event id, so a webhook replayed within the 300s tolerance (or a Stripe retry)
  is re-applied. Re-applying a subscription snapshot is idempotent, so impact is
  low; persistent event-id dedup is a future hardening if stricter guarantees
  are needed.
