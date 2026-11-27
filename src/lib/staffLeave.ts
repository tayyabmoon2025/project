import { supabase } from '@/lib/supabase';

// Staff leave, from the first application to the final decision. Every write goes through a
// server-side function: the browser is never allowed to insert or edit a leave row directly,
// so an approval always carries the administrator who made it and an approval always reaches
// the attendance register.

export type StaffLeaveType = 'casual' | 'sick' | 'half_day' | 'annual' | 'unpaid' | 'maternity' | 'other';
export type StaffLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

// The four the office uses every day come first; the rest are kept because the school's
// leave register already records them.
export const STAFF_LEAVE_TYPES: StaffLeaveType[] = ['casual', 'sick', 'half_day', 'unpaid', 'annual', 'maternity', 'other'];

export const STAFF_LEAVE_TYPE_LABELS: Record<StaffLeaveType, string> = {
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  half_day: 'Half-Day / Short Leave',
  unpaid: 'Unpaid Leave',
  annual: 'Annual Leave',
  maternity: 'Maternity Leave',
  other: 'Other Leave',
};

// Shown under the leave-type dropdown so the office knows which ones cost pay.
export const STAFF_LEAVE_TYPE_HINTS: Record<StaffLeaveType, string> = {
  casual: 'Paid leave from the casual balance',
  sick: 'Paid leave taken when unwell',
  half_day: 'A short leave or part of a day, marked for the day only',
  unpaid: 'Leave without pay, deducted on the salary screen',
  annual: 'Paid annual leave',
  maternity: 'Maternity leave',
  other: 'Any other approved leave',
};

export const STAFF_LEAVE_STATUSES: StaffLeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export const STAFF_LEAVE_STATUS_LABELS: Record<StaffLeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// The pill colour on the table row.
export const STAFF_LEAVE_STATUS_TONES: Record<StaffLeaveStatus, string> = {
  pending: 'leave-pill-pending',
  approved: 'leave-pill-approved',
  rejected: 'leave-pill-rejected',
  cancelled: 'leave-pill-cancelled',
};

export type StaffLeaveRequest = {
  id: string;
  staff_user_id: string;
  leave_type: StaffLeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: StaffLeaveStatus;
  applied_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

const LEAVE_SELECT =
  'id, staff_user_id, leave_type, start_date, end_date, reason, status, applied_at, decided_by, decided_at, decision_note';

const asType = (value: unknown): StaffLeaveType =>
  STAFF_LEAVE_TYPES.includes(value as StaffLeaveType) ? (value as StaffLeaveType) : 'other';

const asStatus = (value: unknown): StaffLeaveStatus =>
  STAFF_LEAVE_STATUSES.includes(value as StaffLeaveStatus) ? (value as StaffLeaveStatus) : 'pending';

const asRequest = (value: unknown): StaffLeaveRequest | null => {
  const raw = (value ?? {}) as Partial<StaffLeaveRequest>;
  if (!raw.id || !raw.staff_user_id) return null;
  return {
    id: raw.id,
    staff_user_id: raw.staff_user_id,
    leave_type: asType(raw.leave_type),
    start_date: String(raw.start_date ?? '').slice(0, 10),
    end_date: String(raw.end_date ?? '').slice(0, 10),
    reason: raw.reason ?? null,
    status: asStatus(raw.status),
    applied_at: raw.applied_at ?? '',
    decided_by: raw.decided_by ?? null,
    decided_at: raw.decided_at ?? null,
    decision_note: raw.decision_note ?? null,
  };
};

// A day is counted the way the office counts it: the first day and the last day are both
// leave, so a single-day request is one day, not zero.
export function leaveDayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

export function leaveDateRange(startDate: string, endDate: string): string[] {
  const days = leaveDayCount(startDate, endDate);
  if (days === 0) return [];
  const first = Date.parse(`${startDate.slice(0, 10)}T00:00:00`);
  return Array.from({ length: days }, (_, index) => new Date(first + index * 86400000).toISOString().slice(0, 10));
}

export function leaveDateLabel(value: string): string {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// "12 Nov 2026" for a one-day request, "12 Nov 2026 to 15 Nov 2026" otherwise.
export function leaveRangeLabel(startDate: string, endDate: string): string {
  if (startDate.slice(0, 10) === endDate.slice(0, 10)) return leaveDateLabel(startDate);
  return `${leaveDateLabel(startDate)} to ${leaveDateLabel(endDate)}`;
}

export function monthKeyOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function currentMonthStart(): string {
  return monthKeyOf(new Date().toISOString());
}

export type StaffLeaveSummary = {
  pending: number;
  approvedThisMonth: number;
  rejected: number;
  approvedDaysThisMonth: number;
  onLeaveToday: number;
};

// The three cards above the table. "Approved this month" counts requests decided this month,
// which is what the office means by it, and the day total uses the leave dates themselves.
export function leaveSummary(rows: StaffLeaveRequest[], monthStart: string, today: string): StaffLeaveSummary {
  const month = monthStart.slice(0, 7);
  let pending = 0;
  let approvedThisMonth = 0;
  let rejected = 0;
  let approvedDaysThisMonth = 0;
  let onLeaveToday = 0;

  for (const row of rows) {
    if (row.status === 'pending') pending += 1;
    if (row.status === 'rejected') rejected += 1;
    if (row.status === 'approved') {
      const decidedMonth = row.decided_at ? monthKeyOf(row.decided_at.slice(0, 10)).slice(0, 7) : monthKeyOf(row.end_date).slice(0, 7);
      if (decidedMonth === month) approvedThisMonth += 1;
      for (const day of leaveDateRange(row.start_date, row.end_date)) {
        if (day.slice(0, 7) === month) approvedDaysThisMonth += 1;
        if (day === today) onLeaveToday += 1;
      }
    }
  }

  return { pending, approvedThisMonth, rejected, approvedDaysThisMonth, onLeaveToday };
}

// Staff see their own requests and administrators see everyone's — the database decides
// which rows come back, so the same call serves both screens.
export async function fetchStaffLeave(): Promise<StaffLeaveRequest[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_leave_requests')
      .select(LEAVE_SELECT)
      .order('start_date', { ascending: false })
      .order('applied_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map(asRequest).filter((row): row is StaffLeaveRequest => row !== null);
  } catch {
    return [];
  }
}

// How many unpaid leave days were approved in a month. The Pay Salary screen adds these to
// the absent days it already reads from the attendance register.
export async function fetchUnpaidLeaveDays(staffUserId: string, periodMonth: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('staff_unpaid_leave_days', {
      p_staff_user_id: staffUserId,
      p_period_month: periodMonth,
    });
    if (error) return 0;
    const value = Number(data);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

const GENERIC = 'Could not reach the school server. Check your connection and try again.';

function friendly(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const map: Record<string, string> = {
    'Only administrators can record staff leave': 'Only an administrator can record leave for another staff member.',
    'Only administrators can approve staff leave': 'Only an administrator can approve or reject a leave request.',
    'Only administrators can remove staff leave': 'Only an administrator can remove a leave request.',
    'Only an active staff member can apply for leave': 'Your account is not able to apply for leave. Please contact the office.',
    'That staff member could not be found': 'That staff member could not be found.',
    'Enter both the from and to dates': 'Choose both the from and to dates.',
    'The to date cannot be before the from date': 'The to date cannot be before the from date.',
    'Choose a valid leave type': 'Choose a valid leave type.',
    'Choose a valid leave decision': 'Choose a valid leave decision.',
    'That leave request could not be found': 'That leave request could not be found.',
  };
  return map[message] ?? message;
}

export type LeaveWriteResult = { error: string | null; request: StaffLeaveRequest | null };

// Administrator: record leave for any staff member, or correct an existing request.
export async function saveStaffLeave(params: {
  id: string | null;
  staffUserId: string;
  leaveType: StaffLeaveType;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<LeaveWriteResult> {
  try {
    const { data, error } = await supabase.rpc('admin_save_staff_leave', {
      p_id: params.id,
      p_staff_user_id: params.staffUserId,
      p_leave_type: params.leaveType,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_reason: params.reason.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'The leave request could not be saved.'), request: null };
    return { error: null, request: asRequest(data) };
  } catch {
    return { error: GENERIC, request: null };
  }
}

// A staff member applying for their own leave. The staff member is taken from the signed-in
// account on the server, so this call cannot record leave for anybody else.
export async function applyForStaffLeave(params: {
  leaveType: StaffLeaveType;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<LeaveWriteResult> {
  try {
    const { data, error } = await supabase.rpc('staff_apply_for_leave', {
      p_leave_type: params.leaveType,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_reason: params.reason.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'Your leave request could not be saved.'), request: null };
    return { error: null, request: asRequest(data) };
  } catch {
    return { error: GENERIC, request: null };
  }
}

export type LeaveDecisionResult = { error: string | null; request: StaffLeaveRequest | null; markedDays: number };

// Approving writes an "On leave" row into the daily attendance register for each day in the
// range, so the office does not have to mark them by hand. `markedDays` is how many days were
// newly marked — days the office had already recorded are left as they were.
export async function setStaffLeaveStatus(
  id: string,
  status: StaffLeaveStatus,
  note: string,
): Promise<LeaveDecisionResult> {
  try {
    const { data, error } = await supabase.rpc('admin_set_staff_leave_status', {
      p_id: id,
      p_status: status,
      p_note: note.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'The leave decision could not be saved.'), request: null, markedDays: 0 };
    const raw = (data ?? {}) as { attendance_days_marked?: unknown };
    const marked = Number(raw.attendance_days_marked);
    return {
      error: null,
      request: asRequest(data),
      markedDays: Number.isFinite(marked) && marked > 0 ? Math.round(marked) : 0,
    };
  } catch {
    return { error: GENERIC, request: null, markedDays: 0 };
  }
}

export async function deleteStaffLeave(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_staff_leave', { p_id: id });
    if (error) return { error: friendly(error.message, 'The leave request could not be removed.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}
