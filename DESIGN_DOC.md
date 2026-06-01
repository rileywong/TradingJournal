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
│  ├─ metrics.js             # Net P&L, Win%, Profit Factor, Expectancy, Max DD
│  ├─ calendar.js            # Daily / monthly P&L aggregation
│  ├─ auth.js                # HMAC token sign/verify + password hashing
│  ├─ repository.js          # In-memory RLS-scoped data adapter
│  └─ index.js               # Barrel exports
├─ server/
│  └─ index.js               # Express API (auth + accounts + import + analytics)
├─ src/                       # React frontend
│  ├─ main.jsx
│  ├─ App.jsx
│  ├─ api.js                 # fetch wrapper + token storage
│  ├─ styles.css             # Light-theme design tokens
│  └─ components/
│     ├─ Auth.jsx
│     ├─ MetricsGrid.jsx
│     ├─ PnlCalendar.jsx
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
   └─ integration.test.js     # Full import → state-transition flow
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
`metrics`, `trades`, and `calendar` in one pass, so the snapshot grid, trade log,
and calendar update atomically — the core state-transition guarantee verified in
`tests/integration.test.js`.

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

## 8. Execution Plan Status

1. ✅ `DESIGN_DOC.md`
2. ⏳ Scaffold + dependencies
3. ⏳ Core engine (csv, parser, matcher, metrics, calendar) + tests
4. ⏳ Express API + integration tests
5. ⏳ Light-theme React dashboard
