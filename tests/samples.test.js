// End-to-end verification against the bundled sample broker exports.
// Asserts exact, hand-computed expected values so regressions in parsing,
// matching, or metric math are caught immediately.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseExecutions } from '../core/parser.js';
import { matchTrades } from '../core/matcher.js';
import { computeMetrics } from '../core/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = (name) => readFileSync(join(here, '..', 'samples', name), 'utf8');

function run(file) {
  const { broker, executions, errors } = parseExecutions(sample(file));
  const { trades, open } = matchTrades(executions, { accountId: 'acct' });
  const metrics = computeMetrics(trades, { startingBalance: 10000 });
  return { broker, executions, errors, trades, open, metrics };
}

function netBySymbol(trades) {
  const m = {};
  for (const t of trades) m[t.symbol] = (m[t.symbol] || 0) + t.netPnl;
  return m;
}

describe('sample: ThinkOrSwim', () => {
  const r = run('thinkorswim.csv');

  it('detects broker and parses cleanly', () => {
    expect(r.broker).toBe('thinkorswim');
    expect(r.errors).toHaveLength(0);
    expect(r.open).toHaveLength(0);
  });

  it('produces the expected trades', () => {
    expect(r.trades).toHaveLength(3);
    const net = netBySymbol(r.trades);
    // AAPL: (173.10-170.25)*100 - 2 commission = 285 - 2 = 283
    expect(net.AAPL).toBeCloseTo(283, 2);
    // TSLA short: (182.40-179.90)*50 - 1 = 125 - 1 = 124
    expect(net.TSLA).toBeCloseTo(124, 2);
    // NVDA: -880*200 + 875.50*100 + 872*100 - 4 = -1250 - 4 = -1254
    expect(net.NVDA).toBeCloseTo(-1254, 2);
  });

  it('computes correct metrics', () => {
    const m = r.metrics;
    expect(m.netPnl).toBeCloseTo(-847, 2);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3, 4);
    expect(m.profitFactor).toBeCloseTo(407 / 1254, 2); // 0.32
  });
});

describe('sample: Robinhood', () => {
  const r = run('robinhood.csv');

  it('detects broker, normalizes mixed-case actions, parses cleanly', () => {
    expect(r.broker).toBe('robinhood');
    expect(r.errors).toHaveLength(0);
    // actions in file: Buy, Sell, buy, SELL, sold
    expect(r.executions.map((e) => e.action)).toEqual(['BUY', 'SELL', 'BUY', 'SELL', 'SELL']);
  });

  it('groups AMD split exits into one trade', () => {
    expect(r.trades).toHaveLength(2);
    const amd = r.trades.find((t) => t.symbol === 'AMD');
    expect(amd.quantity).toBe(150);
    expect(amd.exitPrice).toBeCloseTo(202.25, 2); // (203.50+201)/2
    // -205*150 + 203.50*75 + 201*75 - 0.04 = -412.50 - 0.04
    expect(amd.netPnl).toBeCloseTo(-412.54, 2);
  });

  it('computes correct net P&L (SPY win + AMD loss)', () => {
    const net = netBySymbol(r.trades);
    expect(net.SPY).toBeCloseTo(22.47, 2);
    expect(r.metrics.netPnl).toBeCloseTo(-390.07, 2);
    expect(r.metrics.wins).toBe(1);
    expect(r.metrics.losses).toBe(1);
  });
});

describe('sample: Webull', () => {
  const r = run('webull.csv');

  it('detects broker and parses cleanly', () => {
    expect(r.broker).toBe('webull');
    expect(r.errors).toHaveLength(0);
    expect(r.trades).toHaveLength(3);
  });

  it('handles the COIN short round-trip', () => {
    const coin = r.trades.find((t) => t.symbol === 'COIN');
    expect(coin.side).toBe('SHORT');
    // sold 30@255, covered 30@248 → (255-248)*30 = 210
    expect(coin.netPnl).toBeCloseTo(210, 2);
  });

  it('computes correct metrics', () => {
    const net = netBySymbol(r.trades);
    expect(net.META).toBeCloseTo(420, 2); // (490.25-485)*80
    expect(net.QQQ).toBeCloseTo(-60, 2); // (436.50-438)*40
    expect(net.COIN).toBeCloseTo(210, 2);
    expect(r.metrics.netPnl).toBeCloseTo(570, 2);
    expect(r.metrics.wins).toBe(2);
    expect(r.metrics.losses).toBe(1);
    expect(r.metrics.profitFactor).toBeCloseTo(630 / 60, 2); // 10.5
  });
});
