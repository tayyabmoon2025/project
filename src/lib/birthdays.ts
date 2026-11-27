import { supabase } from '@/lib/supabase';
import { cleanPhoneNumber, whatsappLink } from '@/lib/whatsapp';

export type BirthdayKind = 'student' | 'staff';

// A birthday person is ready to display and to message: the name, where they belong
// (class or job title) and a WhatsApp Web link that opens with the wish already written.
export type BirthdayPerson = {
  kind: BirthdayKind;
  id: string;
  name: string;
  label: string;
  phone: string;
  display: string;
  message: string;
  link: string;
};

// Used on the client only when a caller already holds the raw records (for example a
// component that has just loaded students). The everyday path is the database call.
export type BirthdaySource = {
  kind: BirthdayKind;
  id: string;
  name: string;
  label?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
};

export function birthdayMessage(name: string): string {
  return `Happy Birthday ${name}! Warmest birthday wishes from The Ujala School family.`;
}

// Only the day and month matter, and the stored value is a plain YYYY-MM-DD date.
export function isBirthdayOn(dateOfBirth: string | null | undefined, date: Date): boolean {
  if (!dateOfBirth) return false;
  const parts = String(dateOfBirth).slice(0, 10).split('-');
  if (parts.length !== 3) return false;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;
  return month === date.getMonth() + 1 && day === date.getDate();
}

export function toBirthdayPerson(source: BirthdaySource): BirthdayPerson {
  const message = birthdayMessage(source.name);
  const number = cleanPhoneNumber(source.phone);
  return {
    kind: source.kind,
    id: source.id,
    name: source.name,
    label: (source.label ?? '').trim() || (source.kind === 'student' ? 'Student' : 'Staff'),
    phone: number,
    display: number,
    message,
    link: whatsappLink(number || null, message, 'web'),
  };
}

export function pickBirthdays(sources: BirthdaySource[], date = new Date()): BirthdayPerson[] {
  return sources
    .filter((source) => isBirthdayOn(source.date_of_birth, date))
    .map(toBirthdayPerson)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toRawBirthday(entry: unknown): BirthdaySource | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  const kind = row.kind === 'staff' ? 'staff' : row.kind === 'student' ? 'student' : null;
  if (!kind || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  return {
    kind,
    id: row.id,
    name: row.name,
    label: typeof row.label === 'string' ? row.label : '',
    phone: typeof row.phone === 'string' ? row.phone : null,
  };
}

export function parseBirthdays(data: unknown): BirthdayPerson[] {
  if (!Array.isArray(data)) return [];
  const people: BirthdayPerson[] = [];
  for (const entry of data) {
    const raw = toRawBirthday(entry);
    if (raw) people.push(toBirthdayPerson(raw));
  }
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

// Read-only: used by the navbar button and whenever the day's wishes have already been
// written, so opening the app a second time in the day never writes anything again.
export async function fetchTodaysBirthdays(dateKey: string): Promise<BirthdayPerson[]> {
  try {
    const { data, error } = await supabase.rpc('fetch_todays_birthdays', { p_date: dateKey });
    if (error) return [];
    return parseBirthdays(data);
  } catch {
    return [];
  }
}

// Writes one wish per birthday person for the day (the database refuses duplicates) and
// returns the same list. Safe to call from every staff member's browser.
export async function runDailyBirthdayCheck(dateKey: string): Promise<BirthdayPerson[]> {
  try {
    const { data, error } = await supabase.rpc('run_daily_birthday_check', { p_date: dateKey });
    if (error) return [];
    return parseBirthdays(data);
  } catch {
    return [];
  }
}

export async function setStaffBirthday(userId: string, dateOfBirth: string | null): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_set_staff_birthday', {
      p_user_id: userId,
      p_date_of_birth: dateOfBirth || null,
    });
    if (error) {
      if (error.message === 'Only administrators can change staff birthdays') {
        return { error: 'Only administrators can change staff birthdays.' };
      }
      return { error: 'The date of birth could not be saved.' };
    }
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

const SEEN_PREFIX = 'schooldesk_birthday_seen';

function seenKey(userId: string, dateKey: string): string {
  return `${SEEN_PREFIX}:${userId}:${dateKey}`;
}

export function hasSeenBirthdaysToday(userId: string, dateKey: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId, dateKey)) === '1';
  } catch {
    return false;
  }
}

export function markBirthdaysSeen(userId: string, dateKey: string): void {
  try {
    window.localStorage.setItem(seenKey(userId, dateKey), '1');
  } catch {
    // A browser with storage disabled simply sees the popup again next time.
  }
}
