import { supabase } from '@/lib/supabase';
import { SCHOOL_NAME } from '@/lib/noticeText';

// A class that is off on a date is left out of that day's absentee alerts, so no
// absence message reaches a parent for a class that was not expected in school.
export type ClassOffDay = {
  id: string;
  off_date: string;
  class_name: string;
  note: string | null;
  created_at: string;
};

export const formatDisplayDate = (value: string) => {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

export async function fetchClassOffDays(fromDate: string): Promise<{ days: ClassOffDay[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_class_off_days')
      .select('id, off_date, class_name, note, created_at')
      .gte('off_date', fromDate)
      .order('off_date')
      .order('class_name');
    if (error) return { days: [], error: 'The class-off list could not be loaded.' };
    return { days: (data ?? []) as ClassOffDay[], error: null };
  } catch {
    return { days: [], error: 'The class-off list could not be loaded. Check your connection and try again.' };
  }
}

// The classes that are off on one date, as a fast lookup set.
export async function fetchClassOffSet(forDate: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('school_class_off_days')
      .select('class_name')
      .eq('off_date', forDate);
    if (error) return new Set();
    return new Set(((data ?? []) as { class_name: string }[]).map((row) => row.class_name));
  } catch {
    return new Set();
  }
}

export async function saveClassOffDays(
  offDate: string,
  classNames: string[],
  note: string,
  userId: string | null,
): Promise<{ error: string | null }> {
  if (classNames.length === 0) return { error: 'Choose at least one class to mark off.' };
  try {
    const rows = classNames.map((className) => ({
      off_date: offDate,
      class_name: className,
      note: note.trim() ? note.trim() : null,
      created_by: userId,
    }));
    const { error } = await supabase
      .from('school_class_off_days')
      .upsert(rows, { onConflict: 'off_date,class_name' });
    return error ? { error: 'The class-off day could not be saved. Please try again.' } : { error: null };
  } catch {
    return { error: 'The class-off day could not be saved. Check your connection and try again.' };
  }
}

export async function removeClassOffDay(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_class_off_days').delete().eq('id', id);
    return error ? { error: 'That class-off day could not be removed. Please try again.' } : { error: null };
  } catch {
    return { error: 'That class-off day could not be removed. Check your connection and try again.' };
  }
}

// A short, ready-to-send notice telling guardians their class is not expected in
// school on the chosen day.
export function examOffNotice(className: string, date: string, note: string): string {
  const reason = note.trim() ? ` (${note.trim()})` : '';
  return [
    SCHOOL_NAME,
    `Class off notice — ${className}`,
    `Dear Parent or Guardian, please note that ${className} will remain closed on ${formatDisplayDate(date)}${reason}.`,
    'Regular classes will resume the following working day. Thank you.',
  ].join('\n');
}
