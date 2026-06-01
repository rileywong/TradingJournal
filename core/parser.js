// Broker CSV → normalized executions.
//
// A normalized execution is:
//   { symbol, action: 'BUY'|'SELL', quantity (>0), price, commission, executedAt (ISO), broker, raw }
//
// We auto-detect the broker by header signature, then map columns via synonyms.
// Unparseable rows are collected in `errors` instead of throwing.

import { parseCsv } from './csv.js';
import { parseDate } from './dates.js';
import { classifyInstrument } from './instruments.js';

// Synonyms for the (optional) instrument-type and contract-multiplier columns,
// used to classify options/futures regardless of the matched broker.
const TYPE_COLUMNS = ['type', 'instrument type', 'instrument', 'sec type', 'security type', 'asset type'];
const MULTIPLIER_COLUMNS = ['multiplier', 'contract multiplier', 'mult'];

// --- action normalization -------------------------------------------------
const BUY_TOKENS = new Set(['buy', 'b', 'bought', 'bto', 'btc', 'buytoopen', 'buytoclose']);
const SELL_TOKENS = new Set(['sell', 's', 'sold', 'sto', 'stc', 'selltoopen', 'selltoclose', 'sld']);

export function normalizeAction(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toLowerCase().replace(/[\s_]+/g, '');
  if (BUY_TOKENS.has(t)) return 'BUY';
  if (SELL_TOKENS.has(t)) return 'SELL';
  // Some exports embed direction in the qty sign and leave side blank.
  return null;
}

// --- number normalization -------------------------------------------------
export function normalizeNumber(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (s === '') return NaN;
  let negative = false;
  // Accounting-style negatives: (123.45)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const num = Number(s);
  if (Number.isNaN(num)) return NaN;
  return negative ? -num : num;
}

// --- broker column maps ---------------------------------------------------
// Each broker maps canonical fields to a list of candidate header names
// (case-insensitive). `quantitySigned` means the action is encoded in the
// quantity sign and the side column may be absent.
const BROKERS = {
  thinkorswim: {
    label: 'ThinkOrSwim',
    signature: ['exec time', 'pos effect'],
    fields: {
      symbol: ['symbol', 'underlying symbol'],
      action: ['side'],
      quantity: ['qty', 'quantity'],
      price: ['price', 'net price'],
      commission: ['commission', 'commissions', 'fees'],
      executedAt: ['exec time', 'time'],
    },
  },
  robinhood: {
    label: 'Robinhood',
    signature: ['trans code', 'activity date'],
    fields: {
      symbol: ['instrument', 'symbol'],
      action: ['trans code', 'side'],
      quantity: ['quantity', 'qty'],
      price: ['price'],
      commission: ['fees', 'commission'],
      executedAt: ['activity date', 'process date', 'date'],
    },
  },
  webull: {
    label: 'Webull',
    signature: ['filled time', 'avg price'],
    fields: {
      symbol: ['symbol'],
      action: ['side'],
      quantity: ['filled', 'filled qty', 'quantity', 'total qty'],
      price: ['avg price', 'price', 'filled price'],
      commission: ['commission', 'fees'],
      executedAt: ['filled time', 'time'],
    },
  },
  generic: {
    label: 'Generic',
    signature: [], // fallback
    fields: {
      symbol: ['symbol', 'ticker'],
      action: ['action', 'side', 'trans code', 'type'],
      quantity: ['quantity', 'qty', 'shares', 'filled'],
      price: ['price', 'exec price', 'execution price', 'avg price'],
      commission: ['commission', 'commissions', 'fees', 'fee'],
      executedAt: ['timestamp', 'time', 'date', 'datetime', 'executed at', 'exec time'],
    },
  },
};

function lowerKeyMap(record) {
  const map = {};
  for (const k of Object.keys(record)) map[k.trim().toLowerCase()] = record[k];
  return map;
}

function pick(lowerRecord, candidates) {
  for (const c of candidates || []) {
    if (c in lowerRecord && lowerRecord[c] !== '') return lowerRecord[c];
  }
  return undefined;
}

// Canonical fields, in display order, used by custom mappings and previews.
const FIELD_KEYS = ['symbol', 'action', 'quantity', 'price', 'commission', 'executedAt'];

// Build a broker-style column map from an explicit { field: headerName } object,
// for CSVs from brokers we don't auto-detect. Unmapped fields resolve to nothing.
function customDef(mapping) {
  const fields = {};
  for (const k of FIELD_KEYS) {
    const v = mapping[k];
    const arr = v == null || v === '' ? [] : Array.isArray(v) ? v : [v];
    fields[k] = arr.map((s) => String(s).trim().toLowerCase());
  }
  return { label: 'Custom mapping', fields };
}

/**
 * Detect the broker from header names.
 * @param {string[]} headers
 * @returns {string} broker key
 */
export function detectBroker(headers) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const [key, def] of Object.entries(BROKERS)) {
    if (def.signature.length && def.signature.every((sig) => lower.includes(sig))) {
      return key;
    }
  }
  return 'generic';
}

/**
 * Parse raw CSV text into normalized executions.
 * @param {string} text
 * @param {{ broker?: string, mapping?: object }} [opts] - force a broker or pass
 *   an explicit { field: headerName } mapping; else auto-detect.
 * @returns {{ broker: string, executions: object[], errors: {row:number, reason:string, raw:object}[] }}
 */
export function parseExecutions(text, opts = {}) {
  const { headers, records } = parseCsv(text);
  const usingMapping = opts.mapping && Object.keys(opts.mapping).length > 0;
  if (records.length === 0) {
    return { broker: usingMapping ? 'custom' : opts.broker || 'generic', executions: [], errors: [] };
  }

  const brokerKey = usingMapping ? 'custom' : opts.broker || detectBroker(headers);
  const def = usingMapping ? customDef(opts.mapping) : BROKERS[brokerKey] || BROKERS.generic;
  const executions = [];
  const errors = [];

  records.forEach((record, idx) => {
    const lower = lowerKeyMap(record);
    const rowNum = idx + 2; // +1 for header, +1 for 1-based

    const symbolRaw = pick(lower, def.fields.symbol);
    const qtyRaw = pick(lower, def.fields.quantity);
    const priceRaw = pick(lower, def.fields.price);
    const actionRaw = pick(lower, def.fields.action);
    const commissionRaw = pick(lower, def.fields.commission);
    const dateRaw = pick(lower, def.fields.executedAt);

    const symbol = symbolRaw ? String(symbolRaw).trim().toUpperCase() : '';
    if (!symbol) {
      errors.push({ row: rowNum, reason: 'missing symbol', raw: record });
      return;
    }

    const qtySigned = normalizeNumber(qtyRaw);
    if (Number.isNaN(qtySigned) || qtySigned === 0) {
      errors.push({ row: rowNum, reason: 'invalid quantity', raw: record });
      return;
    }

    const price = normalizeNumber(priceRaw);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ row: rowNum, reason: 'invalid price', raw: record });
      return;
    }

    // Action: prefer the explicit side column; fall back to the qty sign.
    let action = normalizeAction(actionRaw);
    if (!action) {
      action = qtySigned >= 0 ? 'BUY' : 'SELL';
    }

    const executedAt = parseDate(dateRaw);
    if (!executedAt) {
      errors.push({ row: rowNum, reason: 'invalid date', raw: record });
      return;
    }

    let commission = normalizeNumber(commissionRaw);
    if (Number.isNaN(commission)) commission = 0;

    // Classify the instrument (stock / option / future) and its contract
    // multiplier from the symbol plus any type/multiplier columns present.
    const { instrument, multiplier, ...optionMeta } = classifyInstrument(symbol, {
      type: pick(lower, TYPE_COLUMNS),
      multiplier: pick(lower, MULTIPLIER_COLUMNS),
    });

    executions.push({
      symbol,
      action,
      quantity: Math.abs(qtySigned),
      price,
      commission: Math.abs(commission),
      executedAt,
      broker: def.label,
      instrument,
      multiplier,
      ...optionMeta,
      raw: record,
    });
  });

  return { broker: brokerKey, executions, errors };
}

/**
 * Drop exact-duplicate executions (same symbol/action/qty/price/commission/time/
 * broker), keeping first occurrence. Makes appending a previously-imported file
 * idempotent when merging multiple brokers into one account.
 * @param {object[]} executions
 * @returns {object[]}
 */
/**
 * Inspect a CSV for the column-mapping UI: returns its headers, a few sample
 * rows, the auto-detected broker, and a best-guess field→header mapping built
 * from the generic synonym lists. Used when a broker isn't recognized.
 * @param {string} text
 * @param {number} [sampleSize=5]
 */
export function inspectCsv(text, sampleSize = 5) {
  const { headers, records } = parseCsv(text);
  const lowerHeaders = headers.map((h) => h.trim().toLowerCase());
  const suggested = {};
  for (const k of FIELD_KEYS) {
    const hit = (BROKERS.generic.fields[k] || []).find((c) => lowerHeaders.includes(c));
    suggested[k] = hit ? headers[lowerHeaders.indexOf(hit)] : '';
  }
  return {
    headers,
    fields: FIELD_KEYS,
    sampleRows: records.slice(0, sampleSize).map((r) => headers.map((h) => r[h] ?? '')),
    detectedBroker: detectBroker(headers),
    suggested,
  };
}

export function dedupeExecutions(executions) {
  const seen = new Set();
  const out = [];
  for (const e of executions) {
    const key = [e.symbol, e.action, e.quantity, e.price, e.commission, e.executedAt, e.broker].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
