// Quote-aware CSV tokenizer. Zero dependencies.
// Handles: quoted fields, escaped quotes (""), embedded commas/newlines,
// \r\n and \n line endings, and trailing whitespace.

/**
 * Parse CSV text into an array of string-cell rows.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // swallow; \n handles the row break
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // flush trailing field/row if the file didn't end with a newline
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // drop fully blank rows (e.g. trailing empty lines, separator lines)
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Parse CSV text into objects keyed by header. Headers are trimmed.
 * @param {string} text
 * @returns {{ headers: string[], records: Record<string,string>[] }}
 */
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, records };
}
