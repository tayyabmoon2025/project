import {
  DEFAULT_CALENDAR_POLICY,
  effectiveSchoolDays,
  summariseAttendance,
  type AttendanceRecord,
  type AttendanceSummary,
  type CalendarDay,
  type CalendarPolicy,
} from '@/lib/attendance';

// The attendance block printed on a report card or DMC.
//
// "School days" is the number of days the school actually opened in the period — the
// working week minus holidays, vacations and exam off days, plus any special working
// day — read from the saved school calendar. The student's own figures are summarised
// against exactly those days, so the percentage printed on the card can never disagree
// with the register.
//
// Everything here is derived from data the school already has; nothing extra is stored.

export type ReportCardAttendance = AttendanceSummary & {
  // The days the school opened, before any leave policy trims the student's own
  // denominator. This is the figure printed as "Total school days".
  schoolDays: number;
};

export const EMPTY_REPORT_CARD_ATTENDANCE: ReportCardAttendance = {
  total: 0,
  present: 0,
  absent: 0,
  late: 0,
  leave: 0,
  half_day: 0,
  percentage: 0,
  schoolDays: 0,
};

// The days the school opened between two dates, using the saved calendar.
export function schoolDaysInPeriod(
  start: string,
  end: string,
  policy: CalendarPolicy = DEFAULT_CALENDAR_POLICY,
  calendarDays: CalendarDay[] = [],
): number {
  if (!start || !end || end < start) return 0;
  return effectiveSchoolDays(start, end, policy, calendarDays).length;
}

// Turns one student's register rows into the figures printed on their card.
export function reportCardAttendanceFor(params: {
  records: AttendanceRecord[];
  start: string;
  end: string;
  policy?: CalendarPolicy;
  calendarDays?: CalendarDay[];
}): ReportCardAttendance {
  const { start, end } = params;
  if (!start || !end || end < start) return EMPTY_REPORT_CARD_ATTENDANCE;

  const policy = params.policy ?? DEFAULT_CALENDAR_POLICY;
  const calendarDays = params.calendarDays ?? [];

  return {
    ...summariseAttendance(params.records, start, end, policy, calendarDays),
    schoolDays: schoolDaysInPeriod(start, end, policy, calendarDays),
  };
}
