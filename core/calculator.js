// Position-sizing / risk calculator. Pure: given account size, risk %, entry,
// and stop, return how many shares keep the loss at your risk budget — plus the
// reward:risk multiple when a target is supplied. Works for longs and shorts
// (uses absolute distances). Returns null on invalid input.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pos = (n) => Number.isFinite(n) && n > 0;

export function positionSize({ accountSize, riskPct, entry, stop, target } = {}) {
  const acct = Number(accountSize);
  const rp = Number(riskPct);
  const e = Number(entry);
  const s = Number(stop);
  if (!pos(acct) || !pos(rp) || !pos(e) || !pos(s) || e === s) return null;

  const riskPerShare = Math.abs(e - s);
  const riskAmount = acct * (rp / 100);
  const shares = Math.floor(riskAmount / riskPerShare);
  const result = {
    riskPerShare: round2(riskPerShare),
    riskAmount: round2(riskAmount),
    shares,
    positionValue: round2(shares * e),
    // actual $ at risk with the (floored) whole-share count
    actualRisk: round2(shares * riskPerShare),
  };

  const t = Number(target);
  if (pos(t)) {
    const rewardPerShare = Math.abs(t - e);
    result.rMultiple = round2(rewardPerShare / riskPerShare);
    result.targetProfit = round2(rewardPerShare * shares);
  }
  return result;
}
