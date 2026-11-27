import { useMemo, useState } from 'react';
import type { CalendarDay } from '@/lib/attendance';

export type HistoryFilters = {
  query: string;
  year: string;
  month: string;
  from: string;
  to: string;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilters = { query: '', year: '', month: '', from: '', to: '' };

export type CalendarHistoryState = {
  filters: HistoryFilters;
  filtered: CalendarDay[];
  years: number[];
  activeCount: number;
  open: boolean;
  setOpen: (value: boolean) => void;
  update: (patch: Partial<HistoryFilters>) => void;
  clear: () => void;
};

const dayKey = (value: string) => value.slice(0, 10);

// Every calendar month a span touches, so a vacation that runs across a month or
// year boundary is still found by the month and year filters.
export function monthKeys(start: string, end: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${dayKey(start)}T00:00:00`);
  const last = new Date(`${dayKey(end)}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return keys;
  while (cursor <= last && keys.length < 400) {
    keys.push(`${cursor.getFullYear()}-${cursor.getMonth()}`);
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  return keys;
}

export function filterCalendarDays(days: CalendarDay[], filters: HistoryFilters): CalendarDay[] {
  const term = filters.query.trim().toLowerCase();
  const year = filters.year === '' ? null : Number(filters.year);
  const month = filters.month === '' ? null : Number(filters.month);
  const from = filters.from || null;
  const to = filters.to || null;

  return days.filter((day) => {
    const start = dayKey(day.day_date);
    const end = dayKey(day.end_date || day.day_date);

    if (term
      && !day.title.toLowerCase().includes(term)
      && !(day.notes ?? '').toLowerCase().includes(term)) return false;

    if (year !== null || month !== null) {
      const keys = monthKeys(start, end);
      if (year !== null && !keys.some((key) => key.startsWith(`${year}-`))) return false;
      if (month !== null && !keys.some((key) => Number(key.split('-')[1]) === month
        && (year === null || key.startsWith(`${year}-`)))) return false;
    }

    // Overlap: the entry is kept when any part of its span sits in the range.
    if (from && end < from) return false;
    if (to && start > to) return false;

    return true;
  });
}

export function useCalendarHistory(days: CalendarDay[]): CalendarHistoryState {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [open, setOpen] = useState(false);

  const years = useMemo(
    () => Array.from(new Set(days.map((day) => Number(dayKey(day.day_date).slice(0, 4)))))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a),
    [days],
  );

  const filtered = useMemo(() => filterCalendarDays(days, filters), [days, filters]);

  const activeCount = (['query', 'year', 'month', 'from', 'to'] as const)
    .filter((key) => filters[key] !== '').length;

  return {
    filters,
    filtered,
    years,
    activeCount,
    open,
    setOpen,
    update: (patch) => setFilters((current) => ({ ...current, ...patch })),
    clear: () => setFilters(EMPTY_HISTORY_FILTERS),
  };
}
