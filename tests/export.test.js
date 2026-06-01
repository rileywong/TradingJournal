import { describe, it, expect } from 'vitest';
import { tradesToCsv } from '../core/export.js';
import { parseCsvRows } from '../core/csv.js';

const trades = [
  {
    symbol: 'AAPL', side: 'LONG', quantity: 100, entryPrice: 170, exitPrice: 173,
    openedAt: '2024-03-04T09:31:05.000Z', closedAt: '2024-03-04T14:02:11.000Z',
    grossPnl: 300, commission: 2, netPnl: 298, tags: ['Breakout', 'News'],
  },
  {
    symbol: 'TSLA', side: 'SHORT', quantity: 50, entryPrice: 182, exitPrice: 179,
    openedAt: '2024-03-05T10:15:00.000Z', closedAt: '2024-03-05T15:45:30.000Z',
    grossPnl: 150, commission: 1, netPnl: 149, tags: [],
  },
];

describe('tradesToCsv', () => {
  it('emits a header and one row per trade', () => {
    const csv = tradesToCsv(trades);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Symbol,Side,Quantity/);
    expect(lines[1]).toContain('AAPL');
    expect(lines[1]).toContain('298');
  });

  it('joins tags into one cell', () => {
    const csv = tradesToCsv(trades);
    expect(csv).toContain('Breakout; News');
  });

  it('is parseable by the project CSV tokenizer (round-trip)', () => {
    const rows = parseCsvRows(tradesToCsv(trades));
    expect(rows).toHaveLength(3); // header + 2
    expect(rows[0][0]).toBe('Symbol');
    expect(rows[1][0]).toBe('AAPL');
    expect(rows[1][1]).toBe('LONG');
    expect(rows[1][10]).toBe('Breakout; News');
  });

  it('handles an empty trade list (header only)', () => {
    expect(tradesToCsv([])).toBe(
      'Symbol,Side,Quantity,EntryPrice,ExitPrice,OpenedAt,ClosedAt,GrossPnl,Commission,NetPnl,Tags'
    );
  });
});
