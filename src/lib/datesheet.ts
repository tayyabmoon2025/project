import { WEEKDAY_SHORT, type CalendarDay, type CalendarPolicy } from '@/lib/attendance';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatDisplayDate } from '@/lib/classOffDays';

export type DatesheetRow = {
  date: string;
  weekday: string;
  subject: string;
};

export type DatesheetRules = {
  startDate: string;
  subjects: string[];
  // Weekdays the school is closed by default (used only when no calendar is loaded).
  workingDays: number[];
  // When true, an exam paper is written every other working day instead of daily.
  alternateDays: boolean;
  // Optional paper start time, shown on the sheet when set.
  startTime: string;
};

const toDateKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parseDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`);

// A day is closed when it is a school holiday/vacation/exam in the calendar, or
// falls outside the working week. The calendar wins where it has an entry, so a
// special working day opens even if it falls on a usual weekly off.
export function isClosedDay(date: Date, policy: CalendarPolicy, calendarDays: CalendarDay[]): boolean {
  const key = toDateKey(date);
  const entry = calendarDays.find((day) => {
    const start = day.day_date.slice(0, 10);
    const end = (day.end_date ?? day.day_date).slice(0, 10);
    return key >= start && key <= end;
  });
  if (entry) return entry.day_type !== 'special_working';
  return !policy.working_days.includes(date.getDay());
}

// Lays one paper per working day, in the order the subjects were given. Closed
// days are skipped, and in alternate-day mode one working day is left free between
// papers so students get a gap to revise.
export function buildDatesheet(rules: DatesheetRules, policy: CalendarPolicy, calendarDays: CalendarDay[]): DatesheetRow[] {
  const subjects = rules.subjects.map((subject) => subject.trim()).filter(Boolean);
  if (!rules.startDate || subjects.length === 0) return [];

  const rows: DatesheetRow[] = [];
  const cursor = parseDate(rules.startDate);
  if (Number.isNaN(cursor.getTime())) return [];

  // Guard against a runaway loop if the calendar has no open days at all.
  let scanned = 0;
  let index = 0;
  let skipNext = false;

  while (index < subjects.length && scanned < 400) {
    scanned += 1;
    const closed = isClosedDay(cursor, policy, calendarDays);
    if (!closed) {
      if (rules.alternateDays && skipNext) {
        skipNext = false;
      } else {
        rows.push({
          date: toDateKey(cursor),
          weekday: WEEKDAY_SHORT[cursor.getDay()],
          subject: subjects[index],
        });
        index += 1;
        skipNext = rules.alternateDays;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return rows;
}

export function datesheetText(className: string, examName: string, rows: DatesheetRow[], startTime: string): string {
  const lines = [
    SCHOOL_NAME,
    `${examName || 'Examination'} — Datesheet`,
    className ? `Class: ${className}` : '',
    '',
  ].filter((line) => line !== '');

  for (const row of rows) {
    const time = startTime.trim() ? ` at ${startTime.trim()}` : '';
    lines.push(`${formatDisplayDate(row.date)} (${row.weekday}) — ${row.subject}${time}`);
  }
  return lines.join('\n');
}

export function datesheetNotice(className: string, examName: string, rows: DatesheetRow[], startTime: string): string {
  return [
    'Dear Parent or Guardian,',
    `Please find below the ${examName || 'examination'} datesheet for ${className || 'your child'}. Kindly make sure your child reaches school on time on each paper day.`,
    '',
    datesheetText(className, examName, rows, startTime),
    '',
    'Thank you.',
  ].join('\n');
}
