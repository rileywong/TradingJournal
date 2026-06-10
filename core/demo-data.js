// Deterministic sample-trade generator for the public demo. Produces a generic
// broker CSV (Symbol,Action,Quantity,Price,Timestamp,Commission) that flows
// through the exact same parse → match → store pipeline as a real import, so the
// demo dashboard is populated by genuine computed analytics — not faked numbers.

const SYMBOLS = [
  { sym: 'AAPL', price: 195 },
  { sym: 'NVDA', price: 120 },
  { sym: 'TSLA', price: 245 },
  { sym: 'MSFT', price: 420 },
  { sym: 'AMD', price: 165 },
  { sym: 'SPY', price: 545 },
  { sym: 'META', price: 510 },
];

// Small deterministic PRNG (mulberry32) so the demo is identical every seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d, h, m) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h)}:${pad(m)}:00`;
}

/**
 * Generate a demo CSV of ~`weeks` of trading ending at `now`. A realistic mix:
 * ~57% win rate, varied size/hold, the odd outsized win or loss, several
 * symbols, both long and short.
 * @param {{ now?: number, weeks?: number, seed?: number }} [opts]
 */
export function demoCsv({ now = Date.now(), weeks = 10, seed = 20240517 } = {}) {
  const rnd = rng(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const rows = ['Symbol,Action,Quantity,Price,Timestamp,Commission'];

  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - weeks * 7 * 86_400_000);

  for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    // 0–3 trades per day (most days 1–2).
    const count = [0, 1, 1, 2, 2, 3][Math.floor(rnd() * 6)];
    for (let i = 0; i < count; i++) {
      const { sym, price } = pick(SYMBOLS);
      const long = rnd() < 0.62;
      const qty = pick([100, 100, 200, 200, 300, 500]);
      const entry = round2(price * (1 + (rnd() - 0.5) * 0.06));

      const win = rnd() < 0.57;
      // Move as a % of price; occasional outsized result on the tail.
      const tail = rnd() < 0.12 ? 2.4 : 1;
      const movePct = (win ? 0.003 + rnd() * 0.012 : -(0.002 + rnd() * 0.009)) * tail;
      const exit = round2(entry * (1 + (long ? movePct : -movePct)));

      const openH = 9 + Math.floor(rnd() * 6); // 9–14
      const openM = openH === 9 ? 31 + Math.floor(rnd() * 28) : Math.floor(rnd() * 60);
      const holdMin = 5 + Math.floor(rnd() * 220);
      const closeTotal = openH * 60 + openM + holdMin;
      const closeH = Math.min(15, Math.floor(closeTotal / 60));
      const closeM = closeH === 15 ? Math.min(59, closeTotal % 60) : closeTotal % 60;

      const openAction = long ? 'BUY' : 'SELL';
      const closeAction = long ? 'SELL' : 'BUY';
      rows.push(`${sym},${openAction},${qty},${entry},${stamp(day, openH, openM)},1.00`);
      rows.push(`${sym},${closeAction},${qty},${exit},${stamp(day, closeH, closeM)},1.00`);
    }
  }
  return rows.join('\n');
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
