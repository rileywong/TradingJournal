// Execution matching engine: groups normalized executions into closed Trades.
//
// Algorithm (per symbol, chronological + stable):
//   - maintain a signed running position (BUY=+qty, SELL=-qty)
//   - flat → first fill opens a trade with side = sign(fill)
//   - same-direction fills grow; opposite fills shrink
//   - position back to 0 → trade closes
//   - a fill that overshoots 0 is split: the closing portion finishes the
//     current trade, the remainder opens a new opposite-side trade
//
// P&L uses the cash-flow method: within a closed trade signed qty nets to 0,
// so gross_pnl = Σ (SELL ? +1 : -1) * price * qty.

const EPS = 1e-9;

let _seq = 0;
function nextId() {
  _seq += 1;
  return `trade_${Date.now().toString(36)}_${_seq}`;
}

function signedQty(exec) {
  return exec.action === 'BUY' ? exec.quantity : -exec.quantity;
}

function buildTrade(accountId, legs) {
  const symbol = legs[0].symbol;
  // Side is determined by the first (opening) leg.
  const side = legs[0].action === 'BUY' ? 'LONG' : 'SHORT';

  // Contract multiplier (options 100×, futures point value); stocks are 1×.
  const multiplier = legs[0].multiplier || 1;
  const instrument = legs[0].instrument || 'stock';
  // Option contract metadata (if any) travels from the opening leg to the trade.
  const optionMeta = {};
  for (const k of ['underlying', 'expiry', 'strike', 'right']) {
    if (legs[0][k] != null) optionMeta[k] = legs[0][k];
  }

  let grossPnl = 0;
  let commission = 0;
  let entryQty = 0;
  let entryNotional = 0;
  let exitQty = 0;
  let exitNotional = 0;

  for (const leg of legs) {
    const cash = (leg.action === 'SELL' ? 1 : -1) * leg.price * leg.quantity * multiplier;
    grossPnl += cash;
    commission += leg.commission || 0;

    const isEntry =
      (side === 'LONG' && leg.action === 'BUY') ||
      (side === 'SHORT' && leg.action === 'SELL');
    if (isEntry) {
      entryQty += leg.quantity;
      entryNotional += leg.price * leg.quantity;
    } else {
      exitQty += leg.quantity;
      exitNotional += leg.price * leg.quantity;
    }
  }

  const netPnl = grossPnl - commission;
  const times = legs.map((l) => new Date(l.executedAt).getTime());

  return {
    id: nextId(),
    accountId,
    symbol,
    side,
    instrument,
    multiplier,
    ...optionMeta,
    quantity: entryQty,
    entryPrice: entryQty > 0 ? entryNotional / entryQty : 0,
    exitPrice: exitQty > 0 ? exitNotional / exitQty : 0,
    openedAt: new Date(Math.min(...times)).toISOString(),
    closedAt: new Date(Math.max(...times)).toISOString(),
    grossPnl: round2(grossPnl),
    commission: round2(commission),
    netPnl: round2(netPnl),
    executions: legs,
    tags: [],
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {object[]} executions normalized executions (single account)
 * @param {{ accountId?: string, commissionPerTrade?: number }} [opts]
 * @returns {{ trades: object[], open: object[] }}
 *   `trades` are closed round-trips; `open` describes still-open positions.
 */
export function matchTrades(executions, opts = {}) {
  const { accountId = null, commissionPerTrade = 0 } = opts;

  // group by symbol
  const bySymbol = new Map();
  executions.forEach((e, idx) => {
    if (!bySymbol.has(e.symbol)) bySymbol.set(e.symbol, []);
    // keep original index for stable sort on equal timestamps
    bySymbol.get(e.symbol).push({ ...e, _idx: idx });
  });

  const trades = [];
  const open = [];

  for (const [symbol, fills] of bySymbol) {
    fills.sort((a, b) => {
      const ta = new Date(a.executedAt).getTime();
      const tb = new Date(b.executedAt).getTime();
      if (ta !== tb) return ta - tb;
      return a._idx - b._idx;
    });

    let position = 0;
    let legs = [];

    for (const fill of fills) {
      let remaining = fill.quantity;
      let q = signedQty(fill);

      // If this fill crosses through zero, split it at the crossing.
      while (remaining > EPS) {
        const dir = fill.action === 'BUY' ? 1 : -1;

        if (Math.abs(position) < EPS) {
          // opening from flat: consume the whole remainder into a new trade
          const part = makeLeg(fill, remaining);
          legs.push(part);
          position += dir * remaining;
          remaining = 0;
        } else if (Math.sign(position) === dir) {
          // same direction: grows position, never crosses zero
          const part = makeLeg(fill, remaining);
          legs.push(part);
          position += dir * remaining;
          remaining = 0;
        } else {
          // opposite direction: reduces position, may overshoot zero
          const closeQty = Math.min(remaining, Math.abs(position));
          const part = makeLeg(fill, closeQty);
          legs.push(part);
          position += dir * closeQty;
          remaining -= closeQty;

          if (Math.abs(position) < EPS) {
            // trade fully closed
            const trade = buildTrade(accountId, legs);
            if (commissionPerTrade > 0) applySimCommission(trade, commissionPerTrade);
            trades.push(trade);
            legs = [];
            // loop continues; any remaining qty opens a new opposite trade
          }
        }
      }
      void q;
    }

    if (legs.length > 0) {
      // still-open position at end of data
      open.push({
        symbol,
        position: round2(position),
        side: position > 0 ? 'LONG' : 'SHORT',
        executions: legs,
      });
    }
  }

  // closed trades ordered by close time for a coherent equity curve
  trades.sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  return { trades, open };
}

function makeLeg(fill, quantity) {
  // Pro-rate commission to the split quantity.
  const ratio = fill.quantity > 0 ? quantity / fill.quantity : 0;
  return {
    symbol: fill.symbol,
    action: fill.action,
    quantity,
    price: fill.price,
    commission: (fill.commission || 0) * ratio,
    executedAt: fill.executedAt,
    broker: fill.broker,
    instrument: fill.instrument || 'stock',
    multiplier: fill.multiplier || 1,
    // Carry option metadata (underlying/expiry/strike/right) when present.
    ...(fill.underlying ? { underlying: fill.underlying } : {}),
    ...(fill.expiry ? { expiry: fill.expiry } : {}),
    ...(fill.strike != null ? { strike: fill.strike } : {}),
    ...(fill.right ? { right: fill.right } : {}),
  };
}

function applySimCommission(trade, perTrade) {
  trade.commission = round2(trade.commission + perTrade);
  trade.netPnl = round2(trade.grossPnl - trade.commission);
}
