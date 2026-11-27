import { supabase } from '@/lib/supabase';
import type { Coordinates } from '@/lib/geofence';

export type StaffAttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

// The check-in / check-out details recorded alongside a day. Every field is
// nullable because a day recorded only by the school office has no location and
// no times at all.
export type StaffAttendanceGeoColumns = {
  check_in_at: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_distance_m: number | null;
  check_in_inside: boolean | null;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_distance_m: number | null;
  check_out_inside: boolean | null;
};

export type StaffAttendanceRecord = StaffAttendanceGeoColumns & {
  staff_user_id: string;
  attendance_date: string;
  status: StaffAttendanceStatus;
  note: string | null;
};

export const STAFF_ATTENDANCE_GEO_COLUMNS =
  'check_in_at, check_in_lat, check_in_lng, check_in_distance_m, check_in_inside, '
  + 'check_out_at, check_out_lat, check_out_lng, check_out_distance_m, check_out_inside';

const STAFF_ATTENDANCE_SELECT = `staff_user_id, attendance_date, status, note, ${STAFF_ATTENDANCE_GEO_COLUMNS}`;

export const STAFF_ATTENDANCE_STATUSES: StaffAttendanceStatus[] = ['present', 'absent', 'late', 'leave'];

export const STAFF_ATTENDANCE_LABELS: Record<StaffAttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  leave: 'On leave',
};

// Pulls just the location columns off a loaded row so an administrator's edit of
// the status or the note never wipes the check-in details that were captured on
// the phone.
export function attendanceGeoColumns(record: StaffAttendanceRecord | null): StaffAttendanceGeoColumns {
  return {
    check_in_at: record?.check_in_at ?? null,
    check_in_lat: record?.check_in_lat ?? null,
    check_in_lng: record?.check_in_lng ?? null,
    check_in_distance_m: record?.check_in_distance_m ?? null,
    check_in_inside: record?.check_in_inside ?? null,
    check_out_at: record?.check_out_at ?? null,
    check_out_lat: record?.check_out_lat ?? null,
    check_out_lng: record?.check_out_lng ?? null,
    check_out_distance_m: record?.check_out_distance_m ?? null,
    check_out_inside: record?.check_out_inside ?? null,
  };
}

export async function fetchStaffAttendance(date: string): Promise<StaffAttendanceRecord[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_attendance')
      .select(STAFF_ATTENDANCE_SELECT)
      .eq('attendance_date', date);
    if (error) return [];
    return (data ?? []) as StaffAttendanceRecord[];
  } catch {
    return [];
  }
}

// Payroll needs a whole month at once: the first day of the month up to (but not
// including) the first day of the next one.
export async function fetchStaffAttendanceMonth(monthStart: string): Promise<StaffAttendanceRecord[]> {
  try {
    const [year, month] = monthStart.slice(0, 10).split('-').map(Number);
    if (!year || !month) return [];
    const next = new Date(year, month, 1).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('school_staff_attendance')
      .select(STAFF_ATTENDANCE_SELECT)
      .gte('attendance_date', monthStart)
      .lt('attendance_date', next);
    if (error) return [];
    return (data ?? []) as StaffAttendanceRecord[];
  } catch {
    return [];
  }
}

// The unique key on (staff_user_id, attendance_date) makes this a true "save the day"
// write: a staff member marked twice on the same date updates their one row instead of
// adding a duplicate.
export async function saveStaffAttendance(
  date: string,
  entries: { staff_user_id: string; status: StaffAttendanceStatus; note: string; record?: StaffAttendanceRecord | null }[],
  markedBy: string | null,
): Promise<{ error: string | null }> {
  try {
    const rows = entries.map((entry) => ({
      staff_user_id: entry.staff_user_id,
      attendance_date: date,
      status: entry.status,
      note: entry.note.trim() ? entry.note.trim() : null,
      ...attendanceGeoColumns(entry.record ?? null),
      marked_by: markedBy,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('school_staff_attendance')
      .upsert(rows, { onConflict: 'staff_user_id,attendance_date' });
    if (error) return { error: 'Staff attendance could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// Saves a single day for one person — used when an administrator adds a missing day
// or corrects the note on a day that is already recorded. The same unique key is
// targeted, so the write lands on that one row and nothing else is touched.
export async function saveStaffAttendanceDay(params: {
  staffUserId: string;
  date: string;
  status: StaffAttendanceStatus;
  note: string;
  markedBy: string | null;
  record?: StaffAttendanceRecord | null;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('school_staff_attendance')
      .upsert({
        staff_user_id: params.staffUserId,
        attendance_date: params.date,
        status: params.status,
        note: params.note.trim() ? params.note.trim() : null,
        ...attendanceGeoColumns(params.record ?? null),
        marked_by: params.markedBy,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'staff_user_id,attendance_date' });
    if (error) return { error: 'The attendance note could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export type SelfCheckResult = {
  ok: boolean;
  message: string;
  distance_m: number | null;
  inside: boolean | null;
  check_in_at: string | null;
  check_out_at: string | null;
};

const offlineResult = (message: string): SelfCheckResult => ({
  ok: false,
  message,
  distance_m: null,
  inside: null,
  check_in_at: null,
  check_out_at: null,
});

const asResult = (value: unknown): SelfCheckResult => {
  const raw = (value ?? {}) as Partial<SelfCheckResult>;
  return {
    ok: raw.ok === true,
    message: typeof raw.message === 'string' ? raw.message : 'Your attendance could not be recorded.',
    distance_m: typeof raw.distance_m === 'number' ? raw.distance_m : null,
    inside: typeof raw.inside === 'boolean' ? raw.inside : null,
    check_in_at: typeof raw.check_in_at === 'string' ? raw.check_in_at : null,
    check_out_at: typeof raw.check_out_at === 'string' ? raw.check_out_at : null,
  };
};

// Both calls are server-side functions: the browser is only ever allowed to mark
// the signed-in person's own day, and only for today. The location is optional —
// a check-in with no position is still recorded, just without a distance.
async function selfMark(
  fn: 'staff_self_check_in' | 'staff_self_check_out',
  coords: Coordinates | null,
): Promise<SelfCheckResult> {
  try {
    const { data, error } = await supabase.rpc(fn, {
      p_lat: coords?.latitude ?? null,
      p_lng: coords?.longitude ?? null,
    });
    if (error) return offlineResult('Could not reach the school server. Check your connection and try again.');
    return asResult(data);
  } catch {
    return offlineResult('Could not reach the school server. Check your connection and try again.');
  }
}

export const selfCheckIn = (coords: Coordinates | null) => selfMark('staff_self_check_in', coords);

export const selfCheckOut = (coords: Coordinates | null) => selfMark('staff_self_check_out', coords);
