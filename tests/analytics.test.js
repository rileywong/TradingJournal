import { describe, it, expect } from 'vitest';
import {
  summarize,
  bySymbol,
  bySide,
  byDayOfWeek,
  byHourOfDay,
  byTag,
  holdTimeStats,
  streaks,
  winLossComparison,
  rMultiple,
  rMultipleStats,
  pnlHeatmap,
  buildAnalytics,
} from '../core/analytics.js';

function trade(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    symbol: over.symbol || 'AAPL',
    side: over.side || 'LONG',
    quantity: over.quantity ?? 100,
    netPnl: over.netPnl ?? 0,
    tags: over.tags || [],
    riskAmount: over.riskAmount ?? 0,
    openedAt: over.openedAt || over.closedAt,
    closedAt: over.closedAt,
  };
}

describe('summarize', () => {
  it('computes bucket stats with profit factor', () => {
    const s = summarize([
      trade({ netPnl: 100 }),
      trade({ netPnl: -40 }),
      trade({ netPnl: 60 }),
      trade({ netPnl: 0 }),
    ]);
    expect(s.trades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.breakeven).toBe(1);
    expect(s.netPnl).toBe(120);
    expect(s.grossProfit).toBe(160);
    expect(s.grossLoss).toBe(40);
    expect(s.winRate).toBe(0.5);
    expect(s.profitFactor).toBe(4);
    expect(s.avgWin).toBe(80);
    expect(s.avgLoss).toBe(40);
  });

  it('reports Infinity profit factor when there are no losses', () => {
    expect(summarize([trade({ netPnl: 10 })]).profitFactor).toBe(Infinity);
  });

  it('is total for empty input', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ trades: 0, netPnl: 0, winRate: 0, profitFactor: 0 });
  });
});

describe('bySymbol / bySide', () => {
  const trades = [
    trade({ symbol: 'AAPL', side: 'LONG', netPnl: 100 }),
    trade({ symbol: 'AAPL', side: 'LONG', netPnl: -30 }),
    trade({ symbol: 'TSLA', side: 'SHORT', netPnl: 200 }),
  ];

  it('groups by symbol, sorted by net P&L desc', () => {
    const g = bySymbol(trades);
    expect(g.map((x) => x.key)).toEqual(['TSLA', 'AAPL']);
    expect(g.find((x) => x.key === 'AAPL').netPnl).toBe(70);
    expect(g.find((x) => x.key === 'TSLA').trades).toBe(1);
  });

  it('groups by side', () => {
    const g = bySide(trades);
    const long = g.find((x) => x.key === 'LONG');
    const short = g.find((x) => x.key === 'SHORT');
    expect(long.netPnl).toBe(70);
    expect(short.netPnl).toBe(200);
  });
});

describe('byDayOfWeek / byHourOfDay', () => {
  it('orders weekdays Mon..Sun and labels them', () => {
    // 2024-03-04 is a Monday, 2024-03-06 a Wednesday
    const g = byDayOfWeek([
      trade({ netPnl: 50, closedAt: '2024-03-06T10:00:00' }), // Wed
      trade({ netPnl: 10, closedAt: '2024-03-04T10:00:00' }), // Mon
    ]);
    expect(g.map((x) => x.key)).toEqual(['Monday', 'Wednesday']);
  });

  it('orders hours ascending and labels them HH:00', () => {
    const g = byHourOfDay([
      trade({ netPnl: 50, closedAt: '2024-03-04T14:30:00' }),
      trade({ netPnl: 10, closedAt: '2024-03-04T09:45:00' }),
    ]);
    expect(g.map((x) => x.key)).toEqual(['09:00', '14:00']);
    expect(g[0].hour).toBe(9);
  });

  it('excludes trades whose closedAt is unparseable (no NaN bucket)', () => {
    const g = byDayOfWeek([
      trade({ netPnl: 50, closedAt: '2024-03-04T10:00:00' }), // Monday
      trade({ netPnl: 10, closedAt: 'not-a-date' }),
    ]);
    expect(g.map((x) => x.key)).toEqual(['Monday']);
    expect(byHourOfDay([trade({ netPnl: 10, closedAt: 'not-a-date' })])).toEqual([]);
  });
});

describe('byTag', () => {
  it('counts a trade under each of its tags', () => {
    const g = byTag([
      trade({ netPnl: 100, tags: ['Breakout', 'News'] }),
      trade({ netPnl: -20, tags: ['Breakout'] }),
    ]);
    const breakout = g.find((x) => x.key === 'Breakout');
    const news = g.find((x) => x.key === 'News');
    expect(breakout.trades).toBe(2);
    expect(breakout.netPnl).toBe(80);
    expect(news.trades).toBe(1);
  });

  it('buckets untagged trades under "Untagged"', () => {
    const g = byTag([trade({ netPnl: 10, tags: [] })]);
    expect(g[0].key).toBe('Untagged');
  });
});

describe('holdTimeStats', () => {
  it('averages hold time in minutes, split by outcome', () => {
    const h = holdTimeStats([
      trade({ netPnl: 100, openedAt: '2024-03-04T10:00:00Z', closedAt: '2024-03-04T10:30:00Z' }),
      trade({ netPnl: -50, openedAt: '2024-03-04T11:00:00Z', closedAt: '2024-03-04T11:10:00Z' }),
    ]);
    expect(h.avgMinutes).toBe(20);
    expect(h.avgWinMinutes).toBe(30);
    expect(h.avgLossMinutes).toBe(10);
  });
});

describe('streaks', () => {
  it('tracks longest win/loss runs and the signed current streak', () => {
    const s = streaks([
      trade({ netPnl: 10, closedAt: '2024-03-01T10:00:00' }),
      trade({ netPnl: 20, closedAt: '2024-03-02T10:00:00' }),
      trade({ netPnl: -5, closedAt: '2024-03-03T10:00:00' }),
      trade({ netPnl: -5, closedAt: '2024-03-04T10:00:00' }),
      trade({ netPnl: -5, closedAt: '2024-03-05T10:00:00' }),
    ]);
    expect(s.longestWin).toBe(2);
    expect(s.longestLoss).toBe(3);
    expect(s.current).toBe(-3);
  });

  it('returns zeros for no trades', () => {
    expect(streaks([])).toEqual({ longestWin: 0, longestLoss: 0, current: 0 });
  });
});

describe('winLossComparison', () => {
  it('compares winners and losers and computes the payoff ratio', () => {
    const c = winLossComparison([
      trade({ netPnl: 100, openedAt: '2024-03-04T10:00:00Z', closedAt: '2024-03-04T10:20:00Z' }),
      trade({ netPnl: 60, openedAt: '2024-03-04T11:00:00Z', closedAt: '2024-03-04T11:10:00Z' }),
      trade({ netPnl: -40, openedAt: '2024-03-04T12:00:00Z', closedAt: '2024-03-04T12:30:00Z' }),
    ]);
    expect(c.winners.count).toBe(2);
    expect(c.winners.total).toBe(160);
    expect(c.winners.avg).toBe(80);
    expect(c.winners.largest).toBe(100);
    expect(c.losers.count).toBe(1);
    expect(c.losers.avg).toBe(-40);
    expect(c.payoffRatio).toBe(2); // 80 / 40
  });

  it('reports Infinity payoff with wins but no losses', () => {
    expect(winLossComparison([trade({ netPnl: 10 })]).payoffRatio).toBe(Infinity);
  });
});

describe('rMultiple / rMultipleStats', () => {
  it('computes R as netPnl / planned risk, null when no risk', () => {
    expect(rMultiple({ netPnl: 200, riskAmount: 100 })).toBe(2);
    expect(rMultiple({ netPnl: -50, riskAmount: 100 })).toBe(-0.5);
    expect(rMultiple({ netPnl: 200, riskAmount: 0 })).toBeNull();
    expect(rMultiple({ netPnl: 200 })).toBeNull();
  });

  it('summarizes only trades with a risk set', () => {
    const s = rMultipleStats([
      trade({ netPnl: 200, riskAmount: 100 }), // 2R
      trade({ netPnl: -100, riskAmount: 100 }), // -1R
      trade({ netPnl: 300, riskAmount: 100 }), // 3R
      trade({ netPnl: 50 }), // no risk → excluded
    ]);
    expect(s.count).toBe(3);
    expect(s.totalR).toBe(4);
    expect(s.avgR).toBe(1.33);
    expect(s.expectancyR).toBe(1.33);
    expect(s.bestR).toBe(3);
    expect(s.worstR).toBe(-1);
  });

  it('is total when no trade has risk', () => {
    expect(rMultipleStats([trade({ netPnl: 10 })])).toMatchObject({ count: 0, avgR: 0 });
  });
});

describe('pnlHeatmap', () => {
  it('buckets P&L by weekday and hour, present-only, Mon..Sun ordered', () => {
    const h = pnlHeatmap([
      trade({ netPnl: 100, closedAt: '2024-03-04T10:30:00' }), // Mon 10:00
      trade({ netPnl: -40, closedAt: '2024-03-04T10:45:00' }), // Mon 10:00 (same bucket)
      trade({ netPnl: 50, closedAt: '2024-03-06T14:00:00' }),  // Wed 14:00
    ]);
    expect(h.weekdays).toEqual([1, 3]); // Mon, Wed (present only, Mon-first)
    expect(h.hours).toEqual([10, 14]);
    const mon10 = h.cells.find((c) => c.weekday === 1 && c.hour === 10);
    expect(mon10).toMatchObject({ pnl: 60, trades: 2 });
    expect(h.maxAbs).toBe(60);
  });

  it('ignores unparseable close times and is empty for no trades', () => {
    expect(pnlHeatmap([])).toEqual({ weekdays: [], hours: [], cells: [], maxAbs: 0 });
    expect(pnlHeatmap([trade({ netPnl: 10, closedAt: 'nope' })]).cells).toEqual([]);
  });
});

describe('buildAnalytics', () => {
  it('assembles the full report payload', () => {
    const a = buildAnalytics([
      trade({ symbol: 'AAPL', side: 'LONG', netPnl: 100, tags: ['Breakout'], closedAt: '2024-03-04T10:00:00' }),
    ]);
    expect(a.overall.netPnl).toBe(100);
    expect(a.bySymbol[0].key).toBe('AAPL');
    expect(a.bySide[0].key).toBe('LONG');
    expect(a.byTag[0].key).toBe('Breakout');
    expect(a).toHaveProperty('byDayOfWeek');
    expect(a).toHaveProperty('byHourOfDay');
    expect(a).toHaveProperty('holdTime');
    expect(a).toHaveProperty('streaks');
  });
});
