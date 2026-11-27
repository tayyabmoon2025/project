import type { UserRole } from '@/lib/auth';

// Staff accounts move through four states. Only "active" can sign in; the other three are
// kept as records so a former staff member can still be found in the directory.
export const STAFF_STATUSES = ['active', 'suspended', 'inactive', 'left'] as const;
export type StaffStatus = typeof STAFF_STATUSES[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive',
  left: 'Left',
};

export const STAFF_STATUS_HINTS: Record<StaffStatus, string> = {
  active: 'Working at the school and able to sign in',
  suspended: 'Sign-in blocked for now, record kept',
  inactive: 'Not working at the moment, record kept',
  left: 'Has left the school, record kept for reference',
};

// Which pill colour each state gets on the directory row.
export const STAFF_STATUS_TONES: Record<StaffStatus, string> = {
  active: '',
  suspended: 'status-suspended',
  inactive: 'status-pending',
  left: 'status-suspended',
};

export const isStaffActive = (status: string) => status === 'active';

// The three-way switch in the search bar. It is the same setting as the sub-tabs, so the
// two always agree: choosing All searches current and former staff together.
export type StaffScope = 'active' | 'inactive' | 'all';

export const STAFF_SCOPES: { value: StaffScope; label: string; hint: string }[] = [
  { value: 'active', label: 'Active', hint: 'Staff who are working now' },
  { value: 'inactive', label: 'Inactive', hint: 'Suspended, inactive and former staff' },
  { value: 'all', label: 'All', hint: 'Everyone on record, past and present' },
];

// A staff member has no separate ID column, so the record's own id gives a short, stable
// number that the office can quote. It never changes for that person.
export const staffId = (id: string) => `SD-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

export const cnicDigits = (value: string) => value.replace(/\D/g, '');

// CNIC is stored as 13 digits; it is shown and searched in the usual 5-7-1 grouping.
export const formatCnic = (value: string | null | undefined) => {
  const digits = cnicDigits(value ?? '');
  if (digits.length !== 13) return value ?? '';
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

export const cnicProblem = (value: string): string | null => {
  const digits = cnicDigits(value);
  if (!digits) return null;
  if (digits.length !== 13) return 'A CNIC must be exactly 13 digits.';
  return null;
};

// Phone numbers are typed with spaces, dashes and country codes. Matching ignores all of
// that, and a number starting 0 is matched against the same number written as 92....
const phoneVariants = (value: string) => {
  const digits = cnicDigits(value);
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith('0')) variants.add(`92${digits.slice(1)}`);
  if (digits.startsWith('92')) variants.add(`0${digits.slice(2)}`);
  return [...variants];
};

export type StaffSearchFields = {
  id: string;
  full_name: string;
  username: string;
  role: UserRole;
  mobile_number: string | null;
  cnic: string | null;
};

// One search box covers everything the office might have to hand: a name, the short staff
// ID, a username, a CNIC, a phone number, or a role such as "accountant".
export function matchesStaffSearch(staff: StaffSearchFields, term: string, roleLabel: (role: UserRole) => string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;

  const text = [
    staff.full_name,
    staff.username,
    staffId(staff.id),
    roleLabel(staff.role),
    formatCnic(staff.cnic),
  ].join(' ').toLowerCase();
  if (text.includes(needle)) return true;

  const digits = cnicDigits(needle);
  if (!digits) return false;

  const numbers = [...phoneVariants(staff.mobile_number ?? ''), ...(staff.cnic ? [cnicDigits(staff.cnic)] : [])];
  return numbers.some((number) => number.includes(digits));
}
