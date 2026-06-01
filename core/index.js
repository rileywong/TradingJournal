// Barrel exports for the shared core engine.
export { parseCsv, parseCsvRows } from './csv.js';
export { parseDate } from './dates.js';
export {
  parseExecutions,
  detectBroker,
  normalizeAction,
  normalizeNumber,
} from './parser.js';
export { matchTrades } from './matcher.js';
export { computeMetrics, computeMaxDrawdown, equityCurve } from './metrics.js';
export { aggregateDaily, buildMonthlyCalendar } from './calendar.js';
export {
  tradesForDay,
  dailyStats,
  dailyCumulativePnl,
  isValidDateKey,
} from './day.js';
export {
  summarize,
  groupBy,
  bySymbol,
  bySide,
  byDayOfWeek,
  byHourOfDay,
  byTag,
  holdTimeStats,
  streaks,
  buildAnalytics,
} from './analytics.js';
export {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
} from './auth.js';
export { Repository, RepoError } from './repository.js';
