import { describe, it, expect } from 'vitest';
import {
  classifyInstrument,
  parseOccSymbol,
  futuresMultiplier,
} from '../core/instruments.js';

describe('parseOccSymbol', () => {
  it('parses spaced and tight OCC symbols', () => {
    expect(parseOccSymbol('AAPL  240315C00170000')).toEqual({
      underlying: 'AAPL', expiry: '2024-03-15', right: 'CALL', strike: 170,
    });
    expect(parseOccSymbol('SPY240920P00450500')).toEqual({
      underlying: 'SPY', expiry: '2024-09-20', right: 'PUT', strike: 450.5,
    });
  });
  it('returns null for non-option symbols', () => {
    expect(parseOccSymbol('AAPL')).toBeNull();
    expect(parseOccSymbol('/ESZ4')).toBeNull();
  });
});

describe('futuresMultiplier', () => {
  it('resolves roots, slashes, and month codes', () => {
    expect(futuresMultiplier('ES')).toBe(50);
    expect(futuresMultiplier('/ESZ4')).toBe(50);
    expect(futuresMultiplier('MNQH25')).toBe(2);
    expect(futuresMultiplier('CL')).toBe(1000);
  });
  it('returns null for non-futures', () => {
    expect(futuresMultiplier('AAPL')).toBeNull();
  });
});

describe('classifyInstrument', () => {
  it('detects options from an OCC symbol with 100x multiplier + metadata', () => {
    const c = classifyInstrument('AAPL240315C00170000');
    expect(c).toMatchObject({ instrument: 'option', multiplier: 100, right: 'CALL', strike: 170 });
  });
  it('detects options from a type hint', () => {
    expect(classifyInstrument('SPY', { type: 'OPTION' })).toMatchObject({ instrument: 'option', multiplier: 100 });
  });
  it('detects futures from a known root', () => {
    expect(classifyInstrument('/ESZ4')).toEqual({ instrument: 'future', multiplier: 50 });
  });
  it('honors an explicit multiplier column over defaults', () => {
    expect(classifyInstrument('FOO', { multiplier: '50' })).toEqual({ instrument: 'stock', multiplier: 50 });
    expect(classifyInstrument('SPY', { type: 'option', multiplier: '10' })).toMatchObject({ instrument: 'option', multiplier: 10 });
  });
  it('defaults unknown symbols to stock 1x', () => {
    expect(classifyInstrument('AAPL')).toEqual({ instrument: 'stock', multiplier: 1 });
  });
});
