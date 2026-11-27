export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day';

export type AttendanceSummary = {
  total: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  half_day: number;
  percentage: number;
};

export type AttendanceRecord = { student_id: string; attendance_date: string; status: string };

export type CalendarDayType = 'holiday' | 'vacation' | 'exam' | 'special_working';

export type CalendarDay = {
  id: string;
  day_date: string;
  end_date: string;
  day_type: CalendarDayType;
  title: string;
  notes: string | null;
};

export type CalendarPolicy = {
  working_days: number[];
  low_attendance_threshold: number;
  exclude_leave_from_denominator: boolean;
};

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// A single calendar entry can cover one date or a whole span (a winter break, an
// exam week). This guards the expansion so a mistyped range can never loop.
const MAX_SPAN_DAYS = 400;

const formatShortDate = (value: string) => {
  const date = parseDate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
};

export function formatDayRange(start: string, end?: string | null) {
  const last = (end || start).slice(0, 10);
  if (last === start.slice(0, 10)) return formatShortDate(start);
  return `${formatShortDate(start)} – ${formatShortDate(last)}`;
}

// Days the school is closed. A special working day is the opposite: the school
// opens even though the working-week schedule would normally keep it shut.
export const CLOSED_DAY_TYPES: CalendarDayType[] = ['holiday', 'vacation', 'exam'];

export const CALENDAR_DAY_LABELS: Record<CalendarDayType, string> = {
  holiday: 'Holiday',
  vacation: 'Vacation',
  exam: 'Exam / off day',
  special_working: 'Special working day',
};

// Monday to Saturday, matching the register's long-standing Sunday off.
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];

export const DEFAULT_CALENDAR_POLICY: CalendarPolicy = {
  working_days: [...DEFAULT_WORKING_DAYS],
  low_attendance_threshold: 75,
  exclude_leave_from_denominator: false,
};

export const EMPTY_SUMMARY: AttendanceSummary = { total: 0, present: 0, absent: 0, late: 0, leave: 0, half_day: 0, percentage: 0 };

const pad = (value: number) => String(value).padStart(2, '0');

export const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseDate = (value: string) => {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function monthStart(value: string) {
  const date = parseDate(value) ?? new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export function todayKey() {
  return toDateKey(new Date());
}

// Inclusive first and last day of a calendar month.
export function monthRange(year: number, monthIndex: number) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return { start: toDateKey(start), end: toDateKey(end) };
}

export function attendancePercentage(present: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

export function formatPercentage(value: number) {
  return `${value.toFixed(1)}%`;
}

export function isLowAttendance(percentage: number, threshold: number) {
  return percentage < threshold;
}

export const isClosedDayType = (type: CalendarDayType) => CLOSED_DAY_TYPES.includes(type);

const addSpan = (target: Set<string>, start: string, end: string) => {
  const cursor = new Date(`${start.slice(0, 10)}T00:00:00`);
  const last = new Date(`${(end || start).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return;
  let guard = 0;
  while (cursor <= last && guard < MAX_SPAN_DAYS) {
    target.add(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
};

// The dates the school actually opened in a period: the working week, minus
// holidays, vacations and exam off days, plus any special working day.
export function effectiveSchoolDays(
  start: string,
  end: string,
  policy: CalendarPolicy = DEFAULT_CALENDAR_POLICY,
  calendarDays: CalendarDay[] = [],
): string[] {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to || to < from) return [];

  const closed = new Set<string>();
  const special = new Set<string>();
  for (const day of calendarDays) {
    addSpan(
      isClosedDayType(day.day_type) ? closed : special,
      day.day_date,
      day.end_date || day.day_date,
    );
  }

  const days: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const key = toDateKey(cursor);
    if (!closed.has(key)) {
      if (special.has(key) || policy.working_days.includes(cursor.getDay())) days.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// A late arrival still counts as a day the student was in school, so `present`
// includes late days. An approved leave day is reported on its own and only
// leaves the denominator when the school's policy asks for it.
export function summariseAttendance(
  records: AttendanceRecord[],
  start: string,
  end: string,
  policy: CalendarPolicy = DEFAULT_CALENDAR_POLICY,
  calendarDays: CalendarDay[] = [],
): AttendanceSummary {
  const days = effectiveSchoolDays(start, end, policy, calendarDays);
  if (days.length === 0) return EMPTY_SUMMARY;

  const byDate = new Map<string, string>();
  for (const record of records) byDate.set(record.attendance_date.slice(0, 10), record.status);

  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let half_day = 0;
  for (const day of days) {
    const status = byDate.get(day);
    if (status === 'present') present += 1;
    else if (status === 'late') late += 1;
    else if (status === 'leave') leave += 1;
    else if (status === 'half_day') half_day += 1;
    else absent += 1;
  }

  const excludeLeave = policy.exclude_leave_from_denominator;
  // With leave excluded from the total, an approved leave day is not an absence
  // and is not a day the school counted for that student.
  const absentTotal = excludeLeave ? absent + leave : absent;
  const presentTotal = present + late;
  const denominator = excludeLeave ? days.length - leave : days.length;
  return {
    total: denominator,
    present: presentTotal,
    absent: absentTotal,
    late,
    leave,
    half_day,
    percentage: attendancePercentage(presentTotal, denominator),
  };
}

export type DayCounts = { present: number; absent: number; late: number; leave: number; half_day: number; marked: number };

export const EMPTY_DAY_COUNTS: DayCounts = { present: 0, absent: 0, late: 0, leave: 0, half_day: 0, marked: 0 };

// A late arrival still counts as a day the student was in school. When the
// school excludes approved leave from the denominator, a leave day is dropped
// from both the total and the absent count instead of being held against the
// student; otherwise it is reported on its own and counted as a day away.
export function countByStatus(statuses: string[], excludeLeave = false): DayCounts {
  const counts: DayCounts = { ...EMPTY_DAY_COUNTS };
  for (const status of statuses) {
    if (status === 'present') { counts.present += 1; counts.marked += 1; }
    else if (status === 'absent') { counts.absent += 1; counts.marked += 1; }
    else if (status === 'late') { counts.late += 1; counts.marked += 1; }
    else if (status === 'leave') {
      counts.leave += 1;
      counts.marked += 1;
      if (excludeLeave) { counts.absent += 1; counts.leave -= 1; }
    }
    else if (status === 'half_day') { counts.half_day += 1; counts.marked += 1; }
  }
  return counts;
}
