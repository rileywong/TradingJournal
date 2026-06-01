import { describe, it, expect } from 'vitest';
import { matchTrades } from '../core/matcher.js';

function ex(symbol, action, quantity, price, executedAt, commission = 0) {
  return { symbol, action, quantity, price, commission, executedAt, broker: 'Test' };
}

describe('matchTrades', () => {
  it('matches a simple long round-trip', () => {
    const { trades, open } = matchTrades([
      ex('AAPL', 'BUY', 100, 170, '2024-03-04T09:31:00Z'),
      ex('AAPL', 'SELL', 100, 173, '2024-03-04T14:00:00Z'),
    ]);
    expect(open).toHaveLength(0);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: 'AAPL',
      side: 'LONG',
      quantity: 100,
      entryPrice: 170,
      exitPrice: 173,
      grossPnl: 300,
      netPnl: 300,
    });
  });

  it('matches a short round-trip (sell then buy)', () => {
    const { trades } = matchTrades([
      ex('TSLA', 'SELL', 50, 182, '2024-03-05T10:00:00Z'),
      ex('TSLA', 'BUY', 50, 179, '2024-03-05T15:00:00Z'),
    ]);
    expect(trades[0]).toMatchObject({ side: 'SHORT', quantity: 50 });
    // short: sold @182, covered @179 → +3 * 50 = 150
    expect(trades[0].netPnl).toBe(150);
  });

  it('groups split exits into a single trade (buy 100, sell 50 + 50)', () => {
    const { trades, open } = matchTrades([
      ex('AMD', 'BUY', 100, 205, '2024-03-07T09:30:00Z'),
      ex('AMD', 'SELL', 50, 203, '2024-03-07T11:00:00Z'),
      ex('AMD', 'SELL', 50, 201, '2024-03-07T13:00:00Z'),
    ]);
    expect(open).toHaveLength(0);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.quantity).toBe(100);
    expect(t.exitPrice).toBe(202); // (203*50 + 201*50)/100
    // pnl: -205*100 + 203*50 + 201*50 = -20500 + 10150 + 10050 = -300
    expect(t.netPnl).toBe(-300);
  });

  it('groups split entries (buy 50 + 50, sell 100)', () => {
    const { trades } = matchTrades([
      ex('MSFT', 'BUY', 50, 400, '2024-03-07T09:30:00Z'),
      ex('MSFT', 'BUY', 50, 402, '2024-03-07T09:45:00Z'),
      ex('MSFT', 'SELL', 100, 410, '2024-03-07T14:00:00Z'),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].entryPrice).toBe(401);
    expect(trades[0].quantity).toBe(100);
    // -400*50 -402*50 + 410*100 = -20050 + 41000 ... wait compute: -20000-20100+41000 = 900
    expect(trades[0].netPnl).toBe(900);
  });

  it('splits a fill that overshoots zero into two trades (flip)', () => {
    const { trades, open } = matchTrades([
      ex('NVDA', 'BUY', 100, 880, '2024-03-06T09:30:00Z'),
      ex('NVDA', 'SELL', 150, 875, '2024-03-06T11:00:00Z'), // closes 100 long, opens 50 short
      ex('NVDA', 'BUY', 50, 870, '2024-03-06T13:00:00Z'), // covers the short
    ]);
    expect(open).toHaveLength(0);
    expect(trades).toHaveLength(2);

    const long = trades.find((t) => t.side === 'LONG');
    const short = trades.find((t) => t.side === 'SHORT');
    expect(long.quantity).toBe(100);
    // long: -880*100 + 875*100 = -500
    expect(long.netPnl).toBe(-500);
    expect(short.quantity).toBe(50);
    // short: +875*50 - 870*50 = +250
    expect(short.netPnl).toBe(250);
  });

  it('reports an unclosed position as open, not a trade', () => {
    const { trades, open } = matchTrades([
      ex('AAPL', 'BUY', 100, 170, '2024-03-04T09:31:00Z'),
      ex('AAPL', 'SELL', 40, 173, '2024-03-04T14:00:00Z'),
    ]);
    expect(trades).toHaveLength(0);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ symbol: 'AAPL', position: 60, side: 'LONG' });
  });

  it('sorts by timestamp regardless of input order', () => {
    const { trades } = matchTrades([
      ex('AAPL', 'SELL', 100, 173, '2024-03-04T14:00:00Z'),
      ex('AAPL', 'BUY', 100, 170, '2024-03-04T09:31:00Z'),
    ]);
    expect(trades[0].side).toBe('LONG');
    expect(trades[0].openedAt).toBe('2024-03-04T09:31:00.000Z');
  });

  it('keeps separate symbols independent', () => {
    const { trades } = matchTrades([
      ex('AAPL', 'BUY', 10, 100, '2024-03-04T09:00:00Z'),
      ex('TSLA', 'BUY', 10, 200, '2024-03-04T09:00:00Z'),
      ex('AAPL', 'SELL', 10, 110, '2024-03-04T10:00:00Z'),
      ex('TSLA', 'SELL', 10, 190, '2024-03-04T10:00:00Z'),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades.map((t) => t.symbol).sort()).toEqual(['AAPL', 'TSLA']);
  });

  it('aggregates per-leg commissions and applies simulated per-trade commission', () => {
    const { trades } = matchTrades(
      [
        ex('AAPL', 'BUY', 100, 170, '2024-03-04T09:31:00Z', 1),
        ex('AAPL', 'SELL', 100, 173, '2024-03-04T14:00:00Z', 1),
      ],
      { commissionPerTrade: 5 }
    );
    // explicit 2 + simulated 5 = 7 commission; gross 300 → net 293
    expect(trades[0].commission).toBe(7);
    expect(trades[0].netPnl).toBe(293);
  });

  it('pro-rates commission across a split fill at zero-crossing', () => {
    const { trades } = matchTrades([
      ex('NVDA', 'BUY', 100, 100, '2024-03-06T09:30:00Z', 0),
      ex('NVDA', 'SELL', 200, 100, '2024-03-06T11:00:00Z', 2), // 100 closes long, 100 opens short
      ex('NVDA', 'BUY', 100, 100, '2024-03-06T13:00:00Z', 0),
    ]);
    const long = trades.find((t) => t.side === 'LONG');
    const short = trades.find((t) => t.side === 'SHORT');
    // the 2.00 commission on the 200-share sell is split 50/50
    expect(long.commission).toBe(1);
    expect(short.commission).toBe(1);
  });
});
