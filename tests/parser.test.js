import { describe, it, expect } from 'vitest';
import { parseDate } from '../core/dates.js';
import {
  parseExecutions,
  detectBroker,
  normalizeAction,
  normalizeNumber,
  dedupeExecutions,
  inspectCsv,
} from '../core/parser.js';

describe('parseDate (tolerant)', () => {
  it('parses ISO 8601', () => {
    expect(parseDate('2024-03-04T09:31:05Z')).toBe('2024-03-04T09:31:05.000Z');
  });

  it('parses US M/D/YYYY with time', () => {
    const iso = parseDate('03/04/2024 09:31:00');
    expect(iso).toMatch(/^2024-03-04T/);
  });

  it('parses YYYY/M/D', () => {
    expect(parseDate('2024/3/4')).toMatch(/^2024-03-04T/);
  });

  it('disambiguates D/M when first part > 12', () => {
    // 25/03/2024 must be March 25, not month 25
    expect(parseDate('25/03/2024')).toMatch(/^2024-03-25T/);
  });

  it('parses month-name formats', () => {
    expect(parseDate('Jan 5, 2024 9:30 AM')).toMatch(/^2024-01-05T/);
    expect(parseDate('5 Mar 2024')).toMatch(/^2024-03-05T/);
  });

  it('handles 12-hour AM/PM correctly', () => {
    const pm = parseDate('03/04/2024 01:00 PM');
    expect(new Date(pm).getHours()).toBe(13);
    const midnight = parseDate('03/04/2024 12:00 AM');
    expect(new Date(midnight).getHours()).toBe(0);
  });

  it('returns null for corrupted / empty dates', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('99/99/9999')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('normalizeAction (casing & synonyms)', () => {
  it('maps buy variants', () => {
    for (const v of ['buy', 'BUY', 'Buy', 'B', 'Bought', 'BTO', 'buy_to_open']) {
      expect(normalizeAction(v)).toBe('BUY');
    }
  });
  it('maps sell variants', () => {
    for (const v of ['sell', 'SELL', 'Sold', 'S', 'STC', 'sld']) {
      expect(normalizeAction(v)).toBe('SELL');
    }
  });
  it('returns null for unknown actions', () => {
    expect(normalizeAction('hold')).toBeNull();
    expect(normalizeAction('')).toBeNull();
  });
});

describe('normalizeNumber', () => {
  it('strips currency and thousands separators', () => {
    expect(normalizeNumber('$1,234.56')).toBe(1234.56);
  });
  it('handles accounting negatives', () => {
    expect(normalizeNumber('(50.00)')).toBe(-50);
  });
  it('handles signed values', () => {
    expect(normalizeNumber('-100')).toBe(-100);
    expect(normalizeNumber('+100')).toBe(100);
  });
  it('returns NaN for junk', () => {
    expect(Number.isNaN(normalizeNumber('abc'))).toBe(true);
    expect(Number.isNaN(normalizeNumber(''))).toBe(true);
  });
});

describe('broker detection', () => {
  it('detects ThinkOrSwim', () => {
    expect(detectBroker(['Exec Time', 'Side', 'Qty', 'Pos Effect', 'Symbol', 'Price'])).toBe(
      'thinkorswim'
    );
  });
  it('detects Robinhood', () => {
    expect(detectBroker(['Activity Date', 'Instrument', 'Trans Code', 'Quantity'])).toBe(
      'robinhood'
    );
  });
  it('detects Webull', () => {
    expect(detectBroker(['Symbol', 'Side', 'Filled', 'Avg Price', 'Filled Time'])).toBe('webull');
  });
  it('falls back to generic', () => {
    expect(detectBroker(['Symbol', 'Action', 'Quantity', 'Price', 'Timestamp'])).toBe('generic');
  });
});

describe('parseExecutions', () => {
  it('parses ThinkOrSwim rows', () => {
    const csv = [
      'Exec Time,Side,Qty,Pos Effect,Symbol,Price,Commission',
      '2024-03-04 09:31:05,BUY,100,TO OPEN,AAPL,170.25,1.00',
      '2024-03-04 14:02:11,SELL,100,TO CLOSE,AAPL,173.10,1.00',
    ].join('\n');
    const { broker, executions, errors } = parseExecutions(csv);
    expect(broker).toBe('thinkorswim');
    expect(errors).toHaveLength(0);
    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({
      symbol: 'AAPL',
      action: 'BUY',
      quantity: 100,
      price: 170.25,
      commission: 1,
    });
  });

  it('normalizes mixed casing actions (Robinhood)', () => {
    const csv = [
      'Activity Date,Instrument,Trans Code,Quantity,Price,Fees',
      '03/07/2024,AMD,buy,150,205.00,0.00',
      '03/07/2024,AMD,SELL,75,203.50,0.02',
      '03/07/2024,AMD,sold,75,201.00,0.02',
    ].join('\n');
    const { executions, errors } = parseExecutions(csv);
    expect(errors).toHaveLength(0);
    expect(executions.map((e) => e.action)).toEqual(['BUY', 'SELL', 'SELL']);
  });

  it('routes corrupted rows to errors without throwing', () => {
    const csv = [
      'Symbol,Action,Quantity,Price,Timestamp',
      'AAPL,BUY,100,170.25,2024-03-04 09:31:00', // good
      ',BUY,100,170.25,2024-03-04', // missing symbol
      'TSLA,BUY,abc,170.25,2024-03-04', // bad qty
      'NVDA,BUY,100,-5,2024-03-04', // bad price
      'MSFT,BUY,100,400,not-a-date', // bad date
    ].join('\n');
    const { executions, errors } = parseExecutions(csv);
    expect(executions).toHaveLength(1);
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.reason)).toEqual([
      'missing symbol',
      'invalid quantity',
      'invalid price',
      'invalid date',
    ]);
  });

  it('infers action from quantity sign when side is blank', () => {
    const csv = [
      'Symbol,Quantity,Price,Timestamp',
      'AAPL,100,170.25,2024-03-04 09:31:00',
      'AAPL,-100,173.10,2024-03-04 14:00:00',
    ].join('\n');
    const { executions } = parseExecutions(csv);
    expect(executions.map((e) => e.action)).toEqual(['BUY', 'SELL']);
    expect(executions.every((e) => e.quantity === 100)).toBe(true);
  });

  it('upper-cases symbols and absolutes quantities', () => {
    const csv = 'Symbol,Side,Quantity,Price,Timestamp\naapl,sell,-50,10,2024-01-01';
    const { executions } = parseExecutions(csv);
    expect(executions[0].symbol).toBe('AAPL');
    expect(executions[0].quantity).toBe(50);
  });
});

describe('dedupeExecutions', () => {
  const ex = (over = {}) => ({
    symbol: 'AAPL', action: 'BUY', quantity: 100, price: 170, commission: 1,
    executedAt: '2024-03-04T09:31:00.000Z', broker: 'ThinkOrSwim', ...over,
  });

  it('drops exact duplicates, keeps first occurrence', () => {
    const out = dedupeExecutions([ex(), ex(), ex({ price: 171 })]);
    expect(out).toHaveLength(2);
    expect(out[1].price).toBe(171);
  });

  it('keeps fills that differ in any field', () => {
    const out = dedupeExecutions([
      ex(),
      ex({ action: 'SELL' }),
      ex({ executedAt: '2024-03-04T10:00:00.000Z' }),
      ex({ broker: 'Webull' }),
    ]);
    expect(out).toHaveLength(4);
  });

  it('is a no-op on an empty list', () => {
    expect(dedupeExecutions([])).toEqual([]);
  });
});

describe('custom column mapping (unknown brokers)', () => {
  const csv = [
    'Ticker,Direction,Filled,ExecPrice,Fee,When',
    'AAPL,Bought,100,170.00,1.50,2024-03-04 09:31:00',
    'AAPL,Sold,100,173.00,1.50,2024-03-04 14:00:00',
  ].join('\n');

  const mapping = {
    symbol: 'Ticker',
    action: 'Direction',
    quantity: 'Filled',
    price: 'ExecPrice',
    commission: 'Fee',
    executedAt: 'When',
  };

  it('parses via an explicit field-to-header mapping', () => {
    const { broker, executions, errors } = parseExecutions(csv, { mapping });
    expect(broker).toBe('custom');
    expect(errors).toHaveLength(0);
    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({ symbol: 'AAPL', action: 'BUY', quantity: 100, price: 170, commission: 1.5 });
    expect(executions[1].action).toBe('SELL');
  });

  it('treats unmapped optional fields as absent (commission defaults to 0)', () => {
    const { executions } = parseExecutions(csv, { mapping: { ...mapping, commission: '' } });
    expect(executions[0].commission).toBe(0);
  });

  it('inspectCsv returns headers, samples, and a best-guess mapping', () => {
    const generic = 'Symbol,Action,Quantity,Price,Timestamp\nAAPL,BUY,100,170,2024-03-04 09:31:00';
    const info = inspectCsv(generic);
    expect(info.headers).toEqual(['Symbol', 'Action', 'Quantity', 'Price', 'Timestamp']);
    expect(info.detectedBroker).toBe('generic');
    expect(info.sampleRows[0]).toEqual(['AAPL', 'BUY', '100', '170', '2024-03-04 09:31:00']);
    expect(info.suggested).toMatchObject({
      symbol: 'Symbol', action: 'Action', quantity: 'Quantity', price: 'Price', executedAt: 'Timestamp',
    });
    expect(info.suggested.commission).toBe('');
  });
});
