// Tolerant date parser. Brokerage exports use wildly inconsistent formats and
// occasionally ship corrupted rows. parseDate() returns an ISO string or null
// (never throws) so the caller can route bad rows to an error bucket.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * @param {string} raw
 * @returns {string|null} ISO 8601 string, or null if unparseable
 */
export function parseDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  // 1) Native parse first (covers ISO 8601 and many locale strings).
  const native = new Date(s);
  if (!Number.isNaN(native.getTime()) && /\d/.test(s)) {
    // Guard: native Date will happily parse "garbage 2020" partials, so we
    // only trust it when the string actually looks date-like.
    if (looksDateLike(s)) return native.toISOString();
  }

  // 2) Explicit numeric patterns: M/D/YYYY, D-M-YYYY, YYYY/M/D, with optional time.
  const parsed = parseNumeric(s) || parseMonthName(s);
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return null;
}

function looksDateLike(s) {
  // Require either an ISO-ish core or two separators with digits.
  return (
    /^\d{4}-\d{2}-\d{2}/.test(s) ||
    /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(s) ||
    /[a-z]{3,}\.?\s+\d{1,2}/i.test(s)
  );
}

function parseTime(timePart) {
  // returns { h, m, sec } or null
  if (!timePart) return { h: 0, m: 0, sec: 0 };
  const m = timePart
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  const ampm = m[4] ? m[4].toLowerCase() : null;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return { h, m: min, sec };
}

function parseNumeric(s) {
  // Split date and time on whitespace or 'T'.
  const [datePart, ...rest] = s.split(/[T ]+/);
  const timePart = rest.join(' ');
  const sep = datePart.includes('/') ? '/' : datePart.includes('-') ? '-' : null;
  if (!sep) return null;
  const parts = datePart.split(sep).map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;

  let year, month, day;
  if (String(parts[0]).length === 4 || parts[0] > 31) {
    // YYYY-M-D
    [year, month, day] = parts;
  } else {
    // M/D/YYYY (US default) — disambiguate if first > 12 it's clearly D/M
    if (parts[0] > 12 && parts[1] <= 12) {
      [day, month, year] = parts;
    } else {
      [month, day, year] = parts;
    }
  }
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const t = parseTime(timePart);
  if (t === null) return null;
  return new Date(year, month - 1, day, t.h, t.m, t.sec);
}

function parseMonthName(s) {
  // e.g. "Jan 5, 2024 9:30 AM" or "5 Jan 2024"
  const m = s.match(
    /([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/i
  );
  if (!m) return null;
  let monName, day, year;
  if (m[1]) {
    monName = m[1];
    day = parseInt(m[2], 10);
    year = parseInt(m[3], 10);
  } else {
    day = parseInt(m[4], 10);
    monName = m[5];
    year = parseInt(m[6], 10);
  }
  const month = MONTHS[monName.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;

  const timeMatch = s.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(am|pm)?/i);
  const t = parseTime(timeMatch ? timeMatch[0] : null);
  if (t === null) return null;
  return new Date(year, month, day, t.h, t.m, t.sec);
}
