import { supabase } from '@/lib/supabase';
import { todayKey, type AttendanceRecord } from '@/lib/attendance';
import { currentSession } from '@/lib/promotions';
import {
  EMPTY_REPORT_CARD_ATTENDANCE,
  reportCardAttendanceFor,
  type ReportCardAttendance,
} from '@/lib/reportCardAttendance';
import { loadSchoolCalendar } from '@/lib/schoolCalendar';
import type { AdmissionFormState, Student } from '@/lib/schoolTypes';

// Withdrawing a student and the "Leaving Info" section of their admission form are two
// views of one record. Everything either screen writes goes through the helpers here, so
// the leaving fields and the student's status can never drift apart.

export type WithdrawalStatus = 'Inactive' | 'Pass Out';

export const WITHDRAWAL_STATUS_OPTIONS: { value: WithdrawalStatus; studentStatus: Student['status']; hint: string }[] = [
  {
    value: 'Inactive',
    studentStatus: 'withdrawn',
    hint: 'The student has left the school. They drop off the active class lists.',
  },
  {
    value: 'Pass Out',
    studentStatus: 'promoted',
    hint: 'The student finished school. Their full record stays in the school history.',
  },
];

export const STUDENT_STATUS_LABELS: Record<Student['status'], string> = {
  active: 'Active',
  pending: 'Pending',
  withdrawn: 'Inactive',
  promoted: 'Pass Out',
};

export const LEAVING_RATING_OPTIONS = ['Excellent', 'Good', 'Satisfactory', 'Fair', 'Needs Improvement'];

// The leaving record as the office thinks about it, whether it is being read from a
// student row or typed into a form.
export type LeavingRecord = {
  status: string;
  leavingDate: string;
  leavingClass: string;
  reason: string;
  remarks: string;
  feePaidUpto: string;
  conduct: string;
  progress: string;
  slcSerialNumber: string;
  attendanceSummary: string;
  certificateNumber: string;
  certificateDate: string;
};

export type LeavingFieldKey =
  | 'leaving_status' | 'leaving_class' | 'leaving_date' | 'leaving_reason' | 'leaving_remarks'
  | 'progress' | 'conduct' | 'fee_paid_upto' | 'attendance_summary' | 'slc_serial_number'
  | 'leaving_certificate_number' | 'leaving_certificate_date';

// The whole leaving record blanked out. Used both when clearing the form and when a
// student is restored to Active, so nothing stale is left behind.
export const EMPTY_LEAVING_FIELDS: Pick<AdmissionFormState, LeavingFieldKey> = {
  leaving_status: '',
  leaving_class: '',
  leaving_date: '',
  leaving_reason: '',
  leaving_remarks: '',
  progress: '',
  conduct: '',
  fee_paid_upto: '',
  attendance_summary: '',
  slc_serial_number: '',
  leaving_certificate_number: '',
  leaving_certificate_date: '',
};

// The certificate reference the school issues. It follows the admission number so the
// leaving certificate can always be matched back to the student's file.
export function certificateNumberFor(admissionNumber: string): string {
  const trimmed = admissionNumber.trim();
  return trimmed ? `LTC-${trimmed}` : '';
}

export function leavingStatusLabel(status: Student['status'] | null | undefined): string {
  if (status === 'withdrawn') return 'Inactive';
  if (status === 'promoted') return 'Pass Out';
  return '';
}

export function studentStatusForLeaving(label: string | null | undefined): Student['status'] | null {
  const wanted = (label ?? '').trim().toLowerCase();
  const found = WITHDRAWAL_STATUS_OPTIONS.find((option) => option.value.toLowerCase() === wanted);
  return found ? found.studentStatus : null;
}

const textOrNull = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export function leavingRecordFromStudent(student: Student): LeavingRecord {
  return {
    status: text(student.leaving_status),
    leavingDate: text(student.leaving_date).slice(0, 10),
    leavingClass: text(student.leaving_class),
    reason: text(student.leaving_reason),
    remarks: text(student.leaving_remarks),
    feePaidUpto: text(student.fee_paid_upto),
    conduct: text(student.conduct),
    progress: text(student.progress),
    slcSerialNumber: text(student.slc_serial_number),
    attendanceSummary: text(student.attendance_summary),
    certificateNumber: text(student.leaving_certificate_number),
    certificateDate: text(student.leaving_certificate_date).slice(0, 10),
  };
}

// A leaving record as it will be stored on the student's own row. The status the office
// picks decides the student's overall status, so the roster and the record agree.
export function leavingPayload(student: Student, record: LeavingRecord): Partial<Student> {
  const status = studentStatusForLeaving(record.status);
  const leavingDate = textOrNull(record.leavingDate) ?? todayKey();
  return {
    ...(status ? { status } : {}),
    leaving_status: textOrNull(record.status),
    leaving_date: leavingDate,
    leaving_class: textOrNull(record.leavingClass),
    leaving_reason: textOrNull(record.reason),
    leaving_remarks: textOrNull(record.remarks),
    fee_paid_upto: textOrNull(record.feePaidUpto),
    conduct: textOrNull(record.conduct),
    progress: textOrNull(record.progress),
    slc_serial_number: textOrNull(record.slcSerialNumber),
    attendance_summary: textOrNull(record.attendanceSummary),
    leaving_certificate_number: textOrNull(record.certificateNumber) ?? certificateNumberFor(student.admission_number),
    leaving_certificate_date: textOrNull(record.certificateDate) ?? leavingDate,
  };
}

// The attendance figures written into the leaving record, in plain words.
export function attendanceSummaryText(summary: ReportCardAttendance): string {
  if (summary.schoolDays <= 0) return '';
  const parts = [`Present ${summary.present} of ${summary.total} school days (${summary.percentage.toFixed(1)}%)`];
  if (summary.absent > 0) parts.push(`Absent ${summary.absent}`);
  if (summary.late > 0) parts.push(`Late ${summary.late}`);
  if (summary.leave > 0) parts.push(`Leave ${summary.leave}`);
  if (summary.half_day > 0) parts.push(`Half day ${summary.half_day}`);
  return parts.join(' · ');
}

// Attendance is counted from the day the student joined, or from the start of the school
// session for a student admitted before the register began.
function attendanceStartFor(student: Student, end: string): string {
  const admitted = text(student.admission_date).slice(0, 10);
  if (admitted && admitted <= end) return admitted;
  const sessionStart = `${currentSession().slice(0, 4)}-04-01`;
  return sessionStart <= end ? sessionStart : end;
}

export type LeavingAttendance = {
  summary: ReportCardAttendance;
  text: string;
  error: string | null;
};

// Reads the student's own register rows and turns them into the figures printed on their
// leaving record. Nothing extra is stored — the same register that feeds the report card.
export async function fetchLeavingAttendance(student: Student, until: string): Promise<LeavingAttendance> {
  const end = (until || todayKey()).slice(0, 10);
  const start = attendanceStartFor(student, end);
  try {
    const [recordsResult, calendar] = await Promise.all([
      supabase
        .from('school_attendance')
        .select('student_id, attendance_date, status')
        .eq('student_id', student.id)
        .gte('attendance_date', start)
        .lte('attendance_date', end),
      loadSchoolCalendar(),
    ]);

    if (recordsResult.error) {
      return {
        summary: EMPTY_REPORT_CARD_ATTENDANCE,
        text: '',
        error: 'The attendance register could not be read, so the summary was left as it is.',
      };
    }

    const summary = reportCardAttendanceFor({
      records: (recordsResult.data ?? []) as AttendanceRecord[],
      start,
      end,
      policy: calendar.policy,
      calendarDays: calendar.days,
    });
    return { summary, text: attendanceSummaryText(summary), error: calendar.error };
  } catch {
    return {
      summary: EMPTY_REPORT_CARD_ATTENDANCE,
      text: '',
      error: 'The attendance register could not be read. Check your connection and try again.',
    };
  }
}

export type LeavingSaveResult = { ok: boolean; message: string };

export async function saveLeavingRecord(student: Student, record: LeavingRecord): Promise<LeavingSaveResult> {
  if (!studentStatusForLeaving(record.status)) {
    return { ok: false, message: 'Choose Inactive or Pass Out as the leaving status.' };
  }
  try {
    const { error } = await supabase.from('school_students').update(leavingPayload(student, record)).eq('id', student.id);
    if (error) return { ok: false, message: 'The leaving record could not be saved. Please try again.' };
    const label = record.status === 'Pass Out' ? 'passed out' : 'marked inactive';
    return { ok: true, message: `${student.full_name} was ${label} and the leaving record is on their profile.` };
  } catch {
    return { ok: false, message: 'The leaving record could not be saved because the school server could not be reached.' };
  }
}

// Bringing a student back onto the roll clears the leaving record, so the two views never
// contradict each other.
export async function restoreStudentToActive(student: Student): Promise<LeavingSaveResult> {
  try {
    const { error } = await supabase
      .from('school_students')
      .update({
        status: 'active',
        leaving_status: null,
        leaving_class: null,
        leaving_date: null,
        leaving_reason: null,
        leaving_remarks: null,
        progress: null,
        conduct: null,
        fee_paid_upto: null,
        attendance_summary: null,
        slc_serial_number: null,
        leaving_certificate_number: null,
        leaving_certificate_date: null,
      })
      .eq('id', student.id);
    if (error) return { ok: false, message: 'The student could not be restored. Please try again.' };
    return { ok: true, message: `${student.full_name} is active again and their leaving record has been cleared.` };
  } catch {
    return { ok: false, message: 'The student could not be restored because the school server could not be reached.' };
  }
}
