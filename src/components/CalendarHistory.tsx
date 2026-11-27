import { CalendarRange, Filter, RotateCcw, Search, Trash2 } from 'lucide-react';
import { CALENDAR_DAY_LABELS, MONTH_NAMES, formatDayRange, type CalendarDay } from '@/lib/attendance';
import { useCalendarHistory } from '@/lib/calendarHistory';

const formatSaved = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

const groupByMonth = (days: CalendarDay[]) => {
  const groups: { key: string; label: string; items: CalendarDay[] }[] = [];
  for (const day of [...days].sort((a, b) => a.day_date.localeCompare(b.day_date))) {
    const date = new Date(`${day.day_date.slice(0, 10)}T00:00:00`);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const label = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(day);
    else groups.push({ key, label, items: [day] });
  }
  return groups;
};

type Props = {
  days: CalendarDay[];
  emptyText: string;
  onRemove: (dayDate: string) => void;
};

export function CalendarHistoryList({ days, emptyText, onRemove }: Props) {
  const { filters, filtered, years, activeCount, open, setOpen, update, clear } = useCalendarHistory(days);

  return (
    <>
      <div className="cal-filter-bar">
        <button
          type="button"
          className={`cal-filter-toggle ${activeCount > 0 ? 'on' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Filter size={15} />
          <span>Filters</span>
          {activeCount > 0 && <b>{activeCount}</b>}
        </button>
        <span className="cal-filter-summary">
          Showing <b>{filtered.length}</b> of <b>{days.length}</b> saved {days.length === 1 ? 'entry' : 'entries'}
        </span>
        {activeCount > 0 && (
          <button type="button" className="cal-clear-button" onClick={clear}>
            <RotateCcw size={14} /> Clear Filters
          </button>
        )}
      </div>

      {open && (
        <div className="cal-filter-grid">
          <label className="control-field cal-filter-search">Search
            <span className="cal-filter-input">
              <Search size={15} />
              <input
                value={filters.query}
                onChange={(event) => update({ query: event.target.value })}
                placeholder="Search by title or notes"
              />
            </span>
          </label>
          <label className="control-field">Year
            <select value={filters.year} onChange={(event) => update({ year: event.target.value })}>
              <option value="">All Years</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="control-field">Month
            <select value={filters.month} onChange={(event) => update({ month: event.target.value })}>
              <option value="">All Months</option>
              {MONTH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </label>
          <label className="control-field">From Date
            <input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
          </label>
          <label className="control-field">To Date
            <input type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
          </label>
          <button type="button" className="secondary-button cal-clear-button inline" onClick={clear} disabled={activeCount === 0}>
            <RotateCcw size={15} /> Clear Filters
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="cal-empty">
          {activeCount > 0
            ? 'No saved entry matches these filters. Try widening the date range.'
            : emptyText}
        </p>
      ) : (
        <div className="cal-list">
          {groupByMonth(filtered).map((group) => (
            <div className="cal-month" key={group.key}>
              <span className="cal-month-label">{group.label}</span>
              {group.items.map((day) => {
                const spans = (day.end_date || day.day_date).slice(0, 10) !== day.day_date.slice(0, 10);
                return (
                  <div className={`cal-item ${day.day_type}`} key={day.id}>
                    <span className="cal-item-date">
                      {spans ? (
                        <>
                          <CalendarRange size={13} />
                          {formatDayRange(day.day_date, day.end_date)}
                        </>
                      ) : formatSaved(day.day_date)}
                    </span>
                    <span className="cal-item-copy">
                      <strong>{day.title}</strong>
                      <small>
                        {CALENDAR_DAY_LABELS[day.day_type]}
                        {spans ? ' · Multi-day entry' : ''}
                        {day.notes ? ` · ${day.notes}` : ''}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="cal-item-remove"
                      aria-label={`Remove ${day.title}`}
                      onClick={() => onRemove(day.day_date.slice(0, 10))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
