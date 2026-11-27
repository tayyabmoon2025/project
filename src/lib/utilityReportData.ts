import { supabase } from '@/lib/supabase';

// ============================================================================
// Types — the rows the eleven printable reports are worked out from
// ============================================================================

export type VisitorEntry = {
  id: string;
  person_name: string;
  designation: string;
  phone: string;
  organization: string;
  card_type: string;
  notes: string | null;
  created_at: string;
};

export type JobEntry = {
  id: string;
  applicant_name: string;
  position_applied: string;
  phone: string;
  email: string;
  applied_date: string;
  status: string;
  notes: string | null;
};

export type EventEntry = {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  location: string;
  description: string | null;
  event_type: string;
  status: string;
};

export type AnnouncementEntry = {
  id: string;
  title: string;
  body: string;
  audience: string;
  priority: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

export type HolidayEntry = {
  id: string;
  day_date: string;
  end_date: string | null;
  day_type: string;
  title: string;
  notes: string | null;
};

export type PeriodEntry = {
  id: string;
  class_name: string;
  section_name: string;
  day_of_week: number;
  period: number;
  subject: string;
  teacher_name: string;
  start_time: string;
  end_time: string;
  room: string;
};

export type AssignmentEntry = {
  id: string;
  staff_user_id: string;
  staff_name: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  weekly_periods: number;
};

export type SmsEntry = {
  id: string;
  student_name: string;
  class_name: string;
  section_name: string;
  parent_phone: string | null;
  message_type: string;
  message_body: string;
  status: string;
  sent_at: string;
};

export type StudentEntry = {
  id: string;
  full_name: string;
  class_name: string;
  section_name: string;
  roll_number: string | null;
  status: string;
};

export type SectionEntry = {
  class_name: string;
  section_name: string;
  class_teacher: string | null;
};

export type TeacherEntry = {
  id: string;
  full_name: string;
};

export type SubjectEntry = {
  class_name: string;
  subject_name: string;
};

export type UtilityReportBundle = {
  visitors: VisitorEntry[];
  jobs: JobEntry[];
  events: EventEntry[];
  announcements: AnnouncementEntry[];
  holidays: HolidayEntry[];
  periods: PeriodEntry[];
  assignments: AssignmentEntry[];
  sms: SmsEntry[];
  students: StudentEntry[];
  sections: SectionEntry[];
  teachers: TeacherEntry[];
  subjects: SubjectEntry[];
  error: string | null;
};

export type UtilityReportFilters = {
  className: string;
  teacherName: string;
  dateFrom: string;
  dateTo: string;
};

// ============================================================================
// Reads
// ============================================================================

// Everything the eleven reports need, in one round trip. Each table is read with a
// plain select so a report can be worked out in the browser and the same figures can be
// printed or exported without asking the database a second time.
export async function fetchUtilityReportBundle(): Promise<UtilityReportBundle> {
  const empty: UtilityReportBundle = {
    visitors: [], jobs: [], events: [], announcements: [], holidays: [],
    periods: [], assignments: [], sms: [], students: [], sections: [],
    teachers: [], subjects: [], error: null,
  };

  try {
    const [visitorsR, jobsR, eventsR, annR, holidaysR, periodsR, assignR, smsR, studentsR, sectionsR, staffR, subjectsR] =
      await Promise.all([
        supabase.from('school_visiting_cards').select('id, person_name, designation, phone, organization, card_type, notes, created_at').order('created_at', { ascending: false }),
        supabase.from('school_job_applications').select('id, applicant_name, position_applied, phone, email, applied_date, status, notes').order('applied_date', { ascending: false }),
        supabase.from('school_events').select('id, title, event_date, end_date, location, description, event_type, status').order('event_date', { ascending: true }),
        supabase.from('school_announcements').select('id, title, body, audience, priority, start_date, end_date, is_active').order('start_date', { ascending: false }),
        supabase.from('school_calendar_days').select('id, day_date, end_date, day_type, title, notes').order('day_date', { ascending: true }),
        supabase.from('school_timetables').select('id, class_name, section_name, day_of_week, period, subject, teacher_name, start_time, end_time, room').order('day_of_week').order('period'),
        supabase.from('school_staff_subject_assignments').select('id, staff_user_id, class_name, section_name, subject_name, weekly_periods'),
        supabase.from('school_sms_log').select('id, student_name, class_name, section_name, parent_phone, message_type, message_body, status, sent_at').order('sent_at', { ascending: false }).limit(600),
        supabase.from('school_students').select('id, full_name, class_name, section_name, roll_number, status'),
        supabase.from('school_sections').select('class_name, section_name, class_teacher'),
        supabase.from('user_profiles').select('id, full_name, role, status'),
        supabase.from('school_exam_subjects').select('class_name, subject_name'),
      ]);

    const failure = visitorsR.error ?? jobsR.error ?? eventsR.error ?? annR.error ?? holidaysR.error
      ?? periodsR.error ?? assignR.error ?? smsR.error ?? studentsR.error ?? sectionsR.error
      ?? staffR.error ?? subjectsR.error;
    if (failure) return { ...empty, error: failure.message };

    const staffRows = (staffR.data ?? []) as { id: string; full_name: string; role: string; status: string }[];
    const teachers = staffRows
      .filter((row) => row.role === 'teacher' && row.status === 'active')
      .map((row) => ({ id: row.id, full_name: row.full_name }));
    const nameById = new Map(staffRows.map((row) => [row.id, row.full_name]));

    const assignments = ((assignR.data ?? []) as Omit<AssignmentEntry, 'staff_name'>[]).map((row) => ({
      ...row,
      staff_name: nameById.get(row.staff_user_id) ?? '—',
    }));

    return {
      visitors: (visitorsR.data ?? []) as VisitorEntry[],
      jobs: (jobsR.data ?? []) as JobEntry[],
      events: (eventsR.data ?? []) as EventEntry[],
      announcements: (annR.data ?? []) as AnnouncementEntry[],
      holidays: (holidaysR.data ?? []) as HolidayEntry[],
      periods: (periodsR.data ?? []) as PeriodEntry[],
      assignments,
      sms: (smsR.data ?? []) as SmsEntry[],
      students: (studentsR.data ?? []) as StudentEntry[],
      sections: ((sectionsR.data ?? []) as SectionEntry[]).map((row) => ({ ...row, section_name: row.section_name ?? '' })),
      teachers,
      subjects: (subjectsR.data ?? []) as SubjectEntry[],
      error: null,
    };
  } catch (err) {
    console.error('The utility report data could not be loaded.', err);
    return { ...empty, error: 'The utility report data could not be loaded.' };
  }
}
