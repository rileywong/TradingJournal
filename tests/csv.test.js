import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRows } from '../core/csv.js';

describe('CSV tokenizer', () => {
  it('parses simple rows into header-keyed objects', () => {
    const { headers, records } = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(records).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    const rows = parseCsvRows('name,note\n"Doe, John","buys, sells"');
    expect(rows[1]).toEqual(['Doe, John', 'buys, sells']);
  });

  it('handles escaped double quotes', () => {
    const rows = parseCsvRows('x\n"say ""hi"""');
    expect(rows[1]).toEqual(['say "hi"']);
  });

  it('handles embedded newlines inside quotes', () => {
    const rows = parseCsvRows('x\n"line1\nline2"');
    expect(rows[1]).toEqual(['line1\nline2']);
  });

  it('handles \\r\\n line endings', () => {
    const { records } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(records).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('drops fully blank lines', () => {
    const { records } = parseCsv('a,b\n1,2\n\n\n3,4\n');
    expect(records).toHaveLength(2);
  });

  it('returns empty structures for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], records: [] });
  });

  it('trims header whitespace', () => {
    const { headers } = parseCsv('  a , b \n1,2');
    expect(headers).toEqual(['a', 'b']);
  });
});
