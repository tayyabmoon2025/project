import { useState } from 'react';
import { monthRange, todayKey } from '@/lib/attendance';

export type RangePreset = 'month' | 'year' | 'all' | 'custom';

export const RANGE_PRESETS: { value: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

// A wide but finite floor, so "all time" still asks the database for a bounded
// range rather than every row that will ever exist.
export const ALL_TIME_START = '2000-01-01';

export type FinanceRangeValue = {
  preset: RangePreset;
  setPreset: (value: RangePreset) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  from: string;
  to: string;
};

// Every finance screen filters on the same period, so the presets and the custom
// pickers live in one place and the module owns the value.
export function useFinanceRange(): FinanceRangeValue {
  const today = new Date();
  const monthBounds = monthRange(today.getFullYear(), today.getMonth());
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customFrom, setCustomFrom] = useState(monthBounds.start);
  const [customTo, setCustomTo] = useState(monthBounds.end);

  const bounds = preset === 'month'
    ? { from: monthBounds.start, to: monthBounds.end }
    : preset === 'year'
      ? { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` }
      : preset === 'all'
        ? { from: ALL_TIME_START, to: todayKey() }
        : { from: customFrom, to: customTo };

  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, from: bounds.from, to: bounds.to };
}
