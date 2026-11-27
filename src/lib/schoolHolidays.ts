import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatDisplayDate } from '@/lib/classOffDays';
import { isClosedDayType, toDateKey, type CalendarDay, type CalendarDayType } from '@/lib/attendance';
import { whatsappLink } from '@/lib/whatsapp';

// Every date covered by a closed calendar day, as a fast lookup set. A holiday row can
// span several dates (a vacation, or Eid), so the whole range is walked out rather than
// only its first day being considered.
const MAX_CLOSED_SPAN_DAYS = 400;

export function expandClosedDays(days: CalendarDay[]): Set<string> {
  const closed = new Set<string>();
  for (const day of days) {
    if (!isClosedDayType(day.day_type)) continue;
    const cursor = new Date(`${day.day_date.slice(0, 10)}T00:00:00`);
    const last = new Date(`${(day.end_date || day.day_date).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) continue;
    let guard = 0;
    while (cursor <= last && guard < MAX_CLOSED_SPAN_DAYS) {
      closed.add(toDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return closed;
}

// ============================================================================
// Pakistan public holidays
// ============================================================================

// The six holidays the Government of Pakistan notifies every year on the same date.
// The lunar holidays (Eid, Muharram, Eid Milad-un-Nabi) move about eleven days earlier
// each year and are announced by moon sighting, so they are offered as named templates
// and the office fills in the actual dates.
export type GazettedHoliday = { title: string; month: number; day: number };

export const PAKISTAN_GAZETTED_HOLIDAYS: GazettedHoliday[] = [
  { title: 'Kashmir Day', month: 2, day: 5 },
  { title: 'Pakistan Day', month: 3, day: 23 },
  { title: 'Labour Day', month: 5, day: 1 },
  { title: 'Independence Day', month: 8, day: 14 },
  { title: 'Iqbal Day', month: 11, day: 9 },
  { title: 'Quaid-e-Azam Day', month: 12, day: 25 },
];

// Named holidays whose dates change every year. They are listed so the office can add
// them in one tap and then adjust the dates, which is exactly how a lunar calendar is
// handled in practice.
export const LUNAR_HOLIDAYS: { title: string; dayType: CalendarDayType; notes: string }[] = [
  { title: 'Eid-ul-Fitr', dayType: 'holiday', notes: 'Dates depend on the moon sighting — adjust when announced.' },
  { title: 'Eid-ul-Adha', dayType: 'holiday', notes: 'Dates depend on the moon sighting — adjust when announced.' },
  { title: '9th & 10th Muharram', dayType: 'holiday', notes: 'Ashura — dates depend on the Islamic calendar.' },
  { title: 'Eid Milad-un-Nabi', dayType: 'holiday', notes: '12 Rabi-ul-Awwal — dates depend on the Islamic calendar.' },
  { title: 'Summer Vacation', dayType: 'vacation', notes: 'Long vacation — set the first and last day.' },
  { title: 'Winter Vacation', dayType: 'vacation', notes: 'Long vacation — set the first and last day.' },
];

// What the Holidays screen can save. A closed day and a special working day are the two
// kinds the office needs; exam days are created by the examination module itself.
export const HOLIDAY_DAY_TYPES: CalendarDayType[] = ['holiday', 'vacation', 'special_working'];

export type HolidayDraft = {
  dayDate: string;
  endDate: string;
  dayType: CalendarDayType;
  title: string;
  notes: string;
};

const pad = (value: number) => String(value).padStart(2, '0');

// Adds whole days to a YYYY-MM-DD key without going through UTC, so the result never
// slips a day for users east of Greenwich.
export function addDays(dayKey: string, days: number): string {
  const parsed = new Date(`${dayKey.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dayKey.slice(0, 10);
  parsed.setDate(parsed.getDate() + days);
  return toDateKey(parsed);
}

// The date this holiday falls on in a given year, e.g. 14 August of that year.
export const gazettedDateInYear = (holiday: GazettedHoliday, year: number) =>
  `${year}-${pad(holiday.month)}-${pad(holiday.day)}`;

// The six gazetted holidays for this year and next, minus the ones already on the
// calendar. Used by the one-tap "add Pakistan public holidays" action, so the office
// never has to type the same six dates every year.
export function missingGazettedHolidays(existingDayKeys: string[], fromDate: string): { title: string; dayDate: string }[] {
  const year = Number(fromDate.slice(0, 4)) || new Date().getFullYear();
  const taken = new Set(existingDayKeys.map((key) => key.slice(0, 10)));
  const wanted = [year, year + 1].flatMap((target) =>
    PAKISTAN_GAZETTED_HOLIDAYS.map((holiday) => ({
      title: holiday.title,
      dayDate: gazettedDateInYear(holiday, target),
    })),
  );
  return wanted.filter((entry) => !taken.has(entry.dayDate));
}

// ============================================================================
// "Is tomorrow a holiday?"
// ============================================================================

export type UpcomingHoliday = {
  day: CalendarDay;
  // The first date of the holiday that tomorrow falls on, so a range can be described.
  title: string;
  notes: string | null;
  dayType: CalendarDayType;
  dayKey: string;
  isFirstDay: boolean;
  isLastDay: boolean;
};

// A holiday row covers every date from its start to its end, so tomorrow counts as a
// holiday when it falls anywhere inside a closed range — not only on the first day.
export function holidayOn(dayKey: string, days: CalendarDay[]): UpcomingHoliday | null {
  const target = dayKey.slice(0, 10);
  const match = days.find((day) => {
    if (!isClosedDayType(day.day_type)) return false;
    const start = day.day_date.slice(0, 10);
    const end = (day.end_date || day.day_date).slice(0, 10);
    return target >= start && target <= end;
  });
  if (!match) return null;
  return {
    day: match,
    title: match.title || 'School holiday',
    notes: match.notes,
    dayType: match.day_type,
    dayKey: target,
    isFirstDay: target === match.day_date.slice(0, 10),
    isLastDay: target === (match.end_date || match.day_date).slice(0, 10),
  };
}

export const holidayTomorrow = (days: CalendarDay[], todayKeyValue: string): UpcomingHoliday | null =>
  holidayOn(addDays(todayKeyValue, 1), days);

// ============================================================================
// The notice the office forwards to parents
// ============================================================================

export function schoolClosedNotice(holiday: { title: string; dayKey: string; notes?: string | null }): string {
  const reason = holiday.notes?.trim() ? ` (${holiday.notes.trim()})` : '';
  return [
    SCHOOL_NAME,
    `Holiday notice — ${holiday.title}`,
    `Dear Parents and Staff, please note that the school will remain closed tomorrow, ${formatDisplayDate(holiday.dayKey)}${reason}, on account of ${holiday.title}.`,
    'Regular classes will resume the following working day. Thank you.',
  ].join('\n');
}

// A holiday notice is a message without a recipient: the office forwards it to a parent
// group or pastes it wherever the class groups live, so no phone number is dialled.
export const holidayWhatsAppLink = (holiday: { title: string; dayKey: string; notes?: string | null }) =>
  whatsappLink(null, schoolClosedNotice(holiday), 'web');

// A short date range for the holidays table: one date, or two joined by an en dash.
export function formatHolidayDays(start: string, end: string | null | undefined): string {
  const first = formatCompactDate(start);
  const last = end ? formatCompactDate(end) : first;
  return !last || last === first ? first : `${first} — ${last}`;
}

function formatCompactDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

// A starting point for a named holiday that is added in one tap. A vacation is offered as
// a month-long window because that is what a vacation normally is; everything stays
// editable, which is how a moon-sighted date is handled.
const VACATION_DEFAULT_DAYS = 30;

export function suggestedHolidayDraft(
  entry: { title: string; dayType: CalendarDayType; notes: string },
  today: string,
  existing: { title: string; day_date: string }[] = [],
): HolidayDraft {
  const alreadyOnCalendar = existing.some((row) => row.title.trim().toLowerCase() === entry.title.trim().toLowerCase());
  const dayDate = alreadyOnCalendar ? nextYearDate(today) : today;
  return {
    dayDate,
    endDate: entry.dayType === 'vacation' ? addDays(dayDate, VACATION_DEFAULT_DAYS - 1) : dayDate,
    dayType: entry.dayType,
    title: entry.title,
    notes: entry.notes,
  };
}

const nextYearDate = (value: string) => `${(Number(value.slice(0, 4)) || new Date().getFullYear()) + 1}${value.slice(4, 10)}`;

export const HOLIDAY_NOTICE_TYPE = 'holiday';

// The dismissal is remembered per date, so the banner comes back for the next holiday
// but does not nag on every screen of the same day.
export const holidayBannerDismissKey = (holidayDayKey: string) => `schooldesk_holiday_banner_${holidayDayKey.slice(0, 10)}`;
export const holidayNoticeSentKey = (holidayDayKey: string) => `schooldesk_holiday_notice_${holidayDayKey.slice(0, 10)}`;
