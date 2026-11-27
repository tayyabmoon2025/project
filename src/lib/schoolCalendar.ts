import { supabase } from '@/lib/supabase';
import {
  DEFAULT_CALENDAR_POLICY,
  type CalendarDay,
  type CalendarDayType,
  type CalendarPolicy,
} from '@/lib/attendance';

const CALENDAR_DAY_COLUMNS = 'id, day_date, end_date, day_type, title, notes';

export type SchoolCalendar = {
  policy: CalendarPolicy;
  days: CalendarDay[];
  error: string | null;
};

const LOAD_ERROR = 'The school calendar could not be loaded, so these are the default settings. Do not save until it loads.';

export async function loadSchoolCalendar(): Promise<SchoolCalendar> {
  try {
    const [policyResult, daysResult] = await Promise.all([
      supabase
        .from('school_calendar_policy')
        .select('working_days, low_attendance_threshold, exclude_leave_from_denominator')
        .eq('id', 'default')
        .maybeSingle(),
      supabase.from('school_calendar_days').select(CALENDAR_DAY_COLUMNS).order('day_date'),
    ]);

    if (policyResult.error || daysResult.error) {
      return { policy: DEFAULT_CALENDAR_POLICY, days: [], error: LOAD_ERROR };
    }

    const row = policyResult.data as {
      working_days: number[] | null;
      low_attendance_threshold: number | string | null;
      exclude_leave_from_denominator: boolean | null;
    } | null;
    const threshold = Number(row?.low_attendance_threshold);
    const policy: CalendarPolicy = row
      ? {
        working_days: Array.isArray(row.working_days) ? row.working_days.map(Number) : DEFAULT_CALENDAR_POLICY.working_days,
        low_attendance_threshold: Number.isFinite(threshold) ? threshold : DEFAULT_CALENDAR_POLICY.low_attendance_threshold,
        exclude_leave_from_denominator: Boolean(row.exclude_leave_from_denominator),
      }
      : DEFAULT_CALENDAR_POLICY;

    return { policy, days: (daysResult.data ?? []) as CalendarDay[], error: null };
  } catch {
    return { policy: DEFAULT_CALENDAR_POLICY, days: [], error: LOAD_ERROR };
  }
}

export async function saveCalendarPolicy(policy: CalendarPolicy, userId: string | null): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_calendar_policy')
      .update({
        working_days: policy.working_days,
        low_attendance_threshold: policy.low_attendance_threshold,
        exclude_leave_from_denominator: policy.exclude_leave_from_denominator,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', 'default');
    if (error) return 'The school working schedule could not be saved. Please try again.';
    return null;
  } catch {
    return 'Could not reach the school server. Check your connection and try again.';
  }
}

export async function saveCalendarDay(
  entry: { day_date: string; end_date: string; day_type: CalendarDayType; title: string; notes?: string | null },
  userId: string | null,
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_calendar_days')
      .upsert(
        {
          day_date: entry.day_date,
          end_date: entry.end_date < entry.day_date ? entry.day_date : entry.end_date,
          day_type: entry.day_type,
          title: entry.title.trim() || 'School closed',
          notes: entry.notes?.trim() ? entry.notes.trim() : null,
          created_by: userId,
        },
        { onConflict: 'day_date' },
      );
    if (error) return 'That date could not be saved. Please try again.';
    return null;
  } catch {
    return 'Could not reach the school server. Check your connection and try again.';
  }
}

export async function removeCalendarDay(dayDate: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_calendar_days').delete().eq('day_date', dayDate);
    if (error) return 'That date could not be removed. Please try again.';
    return null;
  } catch {
    return 'Could not reach the school server. Check your connection and try again.';
  }
}
