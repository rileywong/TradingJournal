import { describe, it, expect } from 'vitest';
import { aggregateDaily, buildMonthlyCalendar, buildYearHeatmap } from '../core/calendar.js';

function trade(netPnl, closedAt) {
  return { netPnl, closedAt };
}

describe('aggregateDaily', () => {
  it('buckets trades by calendar day', () => {
    const days = aggregateDaily([
      trade(100, '2024-03-04T10:00:00'),
      trade(-40, '2024-03-04T15:00:00'),
      trade(200, '2024-03-05T11:00:00'),
    ]);
    expect(days['2024-03-04']).toMatchObject({ pnl: 60, trades: 2, wins: 1, losses: 1 });
    expect(days['2024-03-05']).toMatchObject({ pnl: 200, trades: 1, wins: 1, losses: 0 });
  });
});

describe('buildMonthlyCalendar', () => {
  it('lays out a month into Sun-first weeks', () => {
    // March 2024: 1st is a Friday; 31 days
    const cal = buildMonthlyCalendar([], 2024, 3);
    expect(cal.year).toBe(2024);
    expect(cal.month).toBe(3);
    // first week has 5 leading blanks (Sun..Thu) then Fri the 1st
    expect(cal.weeks[0].slice(0, 5).every((c) => c === null)).toBe(true);
    expect(cal.weeks[0][5]).toMatchObject({ day: 1 });
    // every week has exactly 7 cells
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true);
    // 31 day cells total
    const dayCells = cal.weeks.flat().filter(Boolean);
    expect(dayCells).toHaveLength(31);
  });

  it('places aggregated P&L on the correct day cells', () => {
    const cal = buildMonthlyCalendar(
      [trade(100, '2024-03-04T10:00:00'), trade(-40, '2024-03-04T15:00:00'), trade(200, '2024-03-15T11:00:00')],
      2024,
      3
    );
    const cells = cal.weeks.flat().filter(Boolean);
    const d4 = cells.find((c) => c.day === 4);
    const d15 = cells.find((c) => c.day === 15);
    const d6 = cells.find((c) => c.day === 6);
    expect(d4.pnl).toBe(60);
    expect(d4.trades).toBe(2);
    expect(d15.pnl).toBe(200);
    expect(d6.pnl).toBe(0);
    expect(d6.trades).toBe(0);
    expect(cal.monthlyPnl).toBe(260);
    expect(cal.tradingDays).toBe(2);
  });

  it('rolls up per-week summaries aligned with the weeks', () => {
    // March 2024: 1st is Friday. Week 0 = Sun..Sat containing Mar 1-2.
    const cal = buildMonthlyCalendar(
      [
        trade(100, '2024-03-01T10:00:00'), // Fri, week 0
        trade(50, '2024-03-04T10:00:00'),  // Mon, week 1
        trade(-20, '2024-03-05T10:00:00'), // Tue, week 1
      ],
      2024,
      3
    );
    expect(cal.weekSummaries).toHaveLength(cal.weeks.length);
    expect(cal.weekSummaries[0]).toMatchObject({ pnl: 100, trades: 1, tradingDays: 1 });
    expect(cal.weekSummaries[1]).toMatchObject({ pnl: 30, trades: 2, tradingDays: 2 });
    // weeks with no trades summarize to zero
    expect(cal.weekSummaries[cal.weeks.length - 1].trades).toBe(0);
  });

  it('excludes trades from other months', () => {
    const cal = buildMonthlyCalendar([trade(999, '2024-04-01T10:00:00')], 2024, 3);
    expect(cal.monthlyPnl).toBe(0);
    expect(cal.tradingDays).toBe(0);
  });
});

describe('buildYearHeatmap', () => {
  it('lays out the whole year in Sun-first week columns', () => {
    const hm = buildYearHeatmap([], 2024);
    expect(hm.year).toBe(2024);
    expect(hm.weeks.every((w) => w.length === 7)).toBe(true);
    // 2024 has 366 days; with leading/trailing padding it spans 53 columns.
    const dayCells = hm.weeks.flat().filter(Boolean);
    expect(dayCells).toHaveLength(366);
    // Jan 1 2024 is a Monday → first column has a leading null (Sun Dec 31 '23).
    expect(hm.weeks[0][0]).toBeNull();
    expect(hm.weeks[0][1]).toMatchObject({ date: '2024-01-01', month: 0 });
  });

  it('places daily P&L and totals, excluding other years', () => {
    const hm = buildYearHeatmap(
      [
        trade(100, '2024-03-04T10:00:00'),
        trade(-40, '2024-03-04T15:00:00'),
        trade(200, '2024-07-15T11:00:00'),
        trade(999, '2023-12-31T10:00:00'), // prior year — excluded
      ],
      2024
    );
    const cells = hm.weeks.flat().filter(Boolean);
    const d4 = cells.find((c) => c.date === '2024-03-04');
    expect(d4).toMatchObject({ pnl: 60, trades: 2 });
    expect(hm.yearlyPnl).toBe(260);
    expect(hm.tradingDays).toBe(2);
    expect(hm.maxAbs).toBe(200);
  });
});
