import React from 'react';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function PnlCalendar({ calendar, notedDays = [], onPrev, onNext, onSelectDay, selectedDate }) {
  if (!calendar) return null;
  const { year, month, weeks, weekSummaries = [], monthlyPnl } = calendar;
  const noted = new Set(notedDays);
  const pnlClass = monthlyPnl > 0 ? 'pos' : monthlyPnl < 0 ? 'neg' : 'muted';

  const renderCell = (cell, i) => {
    if (!cell) return <div className="cal-cell empty" key={`e${i}`} />;
    const cls = cell.trades === 0 ? 'flat' : cell.pnl > 0 ? 'win' : cell.pnl < 0 ? 'loss' : 'flat';
    const pnlCls = cell.pnl > 0 ? 'pos' : cell.pnl < 0 ? 'neg' : 'muted';
    const hasNote = noted.has(cell.date);
    const clickable = (cell.trades > 0 || hasNote) && typeof onSelectDay === 'function';
    const selected = selectedDate === cell.date;
    return (
      <div
        className={`cal-cell ${cls}${clickable ? ' clickable' : ''}${selected ? ' selected' : ''}`}
        key={cell.date}
        onClick={clickable ? () => onSelectDay(cell.date) : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDay(cell.date); } } : undefined}
        aria-label={clickable ? `${cell.date}: ${cell.trades} trades, P&L ${fmtCompact(cell.pnl)}` : undefined}
      >
        <div className="day">
          {cell.day}
          {hasNote && <span className="cell-note-dot" title="Journal note" />}
        </div>
        {cell.trades > 0 ? (
          <>
            <div className={`cell-pnl ${pnlCls}`}>{fmtCompact(cell.pnl)}</div>
            <div className="cell-trades">{cell.trades} trade{cell.trades > 1 ? 's' : ''}</div>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <h3>{MONTHS[month - 1]} {year}</h3>
        <div className="cal-nav">
          <span className={`cal-month-pnl ${pnlClass}`}>
            {monthlyPnl >= 0 ? '+' : '-'}${Math.abs(monthlyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <button onClick={onPrev} aria-label="Previous month">‹</button>
          <button onClick={onNext} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => (
          <div className="cal-dow" key={d}>{d}</div>
        ))}
        <div className="cal-dow">Week</div>
        {weeks.map((week, wi) => {
          const sum = weekSummaries[wi] || { pnl: 0, trades: 0, tradingDays: 0 };
          const sumCls = sum.pnl > 0 ? 'pos' : sum.pnl < 0 ? 'neg' : 'muted';
          return (
            <React.Fragment key={`w${wi}`}>
              {week.map((cell, i) => renderCell(cell, wi * 7 + i))}
              <div className="cal-week-sum">
                <div className="cal-week-label">Wk {wi + 1}</div>
                {sum.trades > 0 ? (
                  <>
                    <div className={`cell-pnl ${sumCls}`}>{fmtCompact(sum.pnl)}</div>
                    <div className="cell-trades">{sum.tradingDays}d · {sum.trades}t</div>
                  </>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
