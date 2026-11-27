import { supabase } from '@/lib/supabase';
import type { AbsenteeAlertStatus, AbsenteeQueueEntry, AbsenteeTemplate, PortalNotification, Student } from '@/lib/schoolTypes';
import { renderAbsenteeText } from '@/lib/noticeText';
import { ALERT_NOTICE_TYPES, ALERT_NOTICE_TYPE_LIST, ALERT_STATUSES, alertWordingFrom, isAlertStatus } from '@/lib/alertStatuses';
import { pickWhatsAppContact, type AlertSendMode } from '@/lib/whatsapp';
import { fetchClassOffSet } from '@/lib/classOffDays';

const QUEUE_COLUMNS =
  'id, student_id, student_name, class_name, section_name, parent_phone, attendance_date, attendance_status, language, message_body, status, sent_at, created_at, attachment_url, attachment_name';

// The register only needs the handful of fields an alert uses, so the row is typed
// narrowly instead of pretending it is a full student record. `attendance_status` comes
// from the attendance row itself, not from the student record.
export type AbsentStudent = Pick<
  Student,
  'id' | 'full_name' | 'class_name' | 'section_name' | 'status'
  | 'messaging_number' | 'father_contact_number' | 'whatsapp_number'
> & { attendance_status: string | null };

// The queue stores the number exactly as it will be dialled, taken from the student's
// WhatsApp Number whenever one is saved.
const alertNumber = (student: AbsentStudent) => pickWhatsAppContact(student).number || null;

export function buildAbsenteeEntries(
  language: AbsenteeTemplate['language'],
  wordingByStatus: Record<AbsenteeAlertStatus, string>,
  roster: AbsentStudent[],
  forDate: string,
  attachment?: { url: string; name: string } | null,
): NewAbsenteeEntry[] {
  return roster.map((student) => {
    const status: AbsenteeAlertStatus = isAlertStatus(student.attendance_status) ? student.attendance_status : 'absent';
    return {
      student_id: student.id,
      student_name: student.full_name,
      class_name: student.class_name,
      section_name: student.section_name,
      parent_phone: alertNumber(student),
      attendance_date: forDate,
      attendance_status: status,
      language,
      message_body: renderAbsenteeText(wordingByStatus[status], {
        student_name: student.full_name,
        class_name: student.class_name,
        section_name: student.section_name,
        date: forDate,
      }),
      attachment_url: attachment?.url ?? null,
      attachment_name: attachment?.name ?? null,
    };
  });
}

// Every absence, leave and late arrival saved for the date, across all classes and
// sections, so the office can work through a whole day in one pass.
export async function fetchAbsentStudentsForDate(forDate: string): Promise<{ students: AbsentStudent[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_attendance')
      .select('student_id, status, student:school_students(id, full_name, class_name, section_name, status, messaging_number, father_contact_number, whatsapp_number)')
      .eq('attendance_date', forDate)
      .in('status', ALERT_STATUSES);
    if (error) return { students: [], error: error.message };
    const rows = (data ?? []) as unknown as { student_id: string; status: string | null; student: Omit<AbsentStudent, 'attendance_status'> | null }[];
    // A class marked off for the day was never expected in school, so its students are
    // left out of the alert list and no parent is messaged for that class.
    const offClasses = await fetchClassOffSet(forDate);
    const students = rows.flatMap((row) => (row.student ? [{ ...row.student, attendance_status: row.status }] : []))
      .filter((student) => student.status !== 'withdrawn')
      .filter((student) => !student.class_name || !offClasses.has(student.class_name));
    return { students, error: null };
  } catch {
    return { students: [], error: 'The absentee list could not be loaded.' };
  }
}

// Called after the register is saved: pulls the saved absences, leave days and late
// arrivals for the day into the alert list, each worded by its own template. Adding a
// row is what raises the parent portal notice, so saving the register notifies parents
// on its own.
export async function syncAbsenteesForDate(forDate: string): Promise<string | null> {
  const [language, templates, roster] = await Promise.all([
    fetchAbsenteeLanguage(),
    fetchAbsenteeTemplates(),
    fetchAbsentStudentsForDate(forDate),
  ]);
  if (roster.error) return roster.error;
  if (roster.students.length === 0) return null;

  const wording = alertWordingFrom(templates.error ? [] : templates.templates);
  const wordingByStatus = ALERT_STATUSES.reduce((accumulator, status) => {
    accumulator[status] = wording[status][language];
    return accumulator;
  }, {} as Record<AbsenteeAlertStatus, string>);

  const result = await syncAbsentees(
    buildAbsenteeEntries(language, wordingByStatus, roster.students, forDate),
    roster.students.map((student) => student.id),
    forDate,
  );
  return result.error;
}

export type NewAbsenteeEntry = {
  student_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  parent_phone: string | null;
  attendance_date: string;
  attendance_status: AbsenteeAlertStatus;
  language: AbsenteeTemplate['language'];
  message_body: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
};

export async function fetchAbsenteeQueue(forDate: string): Promise<{ entries: AbsenteeQueueEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_absentee_queue')
      .select(QUEUE_COLUMNS)
      .eq('attendance_date', forDate)
      .order('student_name');
    if (error) return { entries: [], error: error.message };
    return { entries: (data ?? []) as AbsenteeQueueEntry[], error: null };
  } catch {
    return { entries: [], error: 'The absentee list could not be loaded.' };
  }
}

// Keeps the alert list in step with the register: new absentees are added, students
// who are no longer absent are dropped, and the wording of anything still waiting is
// refreshed. Already-sent rows are left untouched so the sent history stays accurate.
export async function syncAbsentees(
  entries: NewAbsenteeEntry[],
  absentStudentIds: string[],
  forDate: string,
): Promise<{ entries: AbsenteeQueueEntry[]; added: number; removed: number; error: string | null }> {
  const existing = await fetchAbsenteeQueue(forDate);
  if (existing.error) return { entries: [], added: 0, removed: 0, error: existing.error };

  const byStudent = new Map(existing.entries.map((entry) => [entry.student_id, entry]));
  const toInsert = entries.filter((entry) => !byStudent.has(entry.student_id));
  // Only rows still waiting are dropped: a sent row is history and stays put.
  const toDelete = existing.entries
    .filter((entry) => entry.status === 'queued' && !absentStudentIds.includes(entry.student_id))
    .map((entry) => entry.id);
  const toReword = entries.filter((entry) => {
    const saved = byStudent.get(entry.student_id);
    return saved?.status === 'queued'
      && (saved.message_body !== entry.message_body
        || saved.language !== entry.language
        || saved.parent_phone !== entry.parent_phone
        || saved.attendance_status !== entry.attendance_status);
  });

  try {
    if (toInsert.length > 0) {
      const { error } = await supabase.from('school_absentee_queue').insert(toInsert);
      if (error) return { entries: existing.entries, added: 0, removed: 0, error: error.message };
    }
    if (toDelete.length > 0) {
      const { error } = await supabase.from('school_absentee_queue').delete().in('id', toDelete);
      if (error) return { entries: existing.entries, added: toInsert.length, removed: 0, error: error.message };
    }
    if (toReword.length > 0) {
      const results = await Promise.all(toReword.map((entry) => {
        const saved = byStudent.get(entry.student_id);
        return supabase
          .from('school_absentee_queue')
          .update({
            language: entry.language,
            message_body: entry.message_body,
            parent_phone: entry.parent_phone,
            attendance_status: entry.attendance_status,
          })
          .eq('id', saved?.id ?? '');
      }));
      const failed = results.find((result) => result.error);
      if (failed?.error) return { entries: existing.entries, added: toInsert.length, removed: toDelete.length, error: failed.error.message };
    }
  } catch {
    return { entries: existing.entries, added: 0, removed: 0, error: 'The absentee list could not be updated.' };
  }

  const reloaded = await fetchAbsenteeQueue(forDate);
  if (reloaded.error) return { entries: existing.entries, added: toInsert.length, removed: toDelete.length, error: reloaded.error };
  return { entries: reloaded.entries, added: toInsert.length, removed: toDelete.length, error: null };
}

export async function markAbsenteesSent(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  try {
    const { error } = await supabase
      .from('school_absentee_queue')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in('id', ids);
    return error ? error.message : null;
  } catch {
    return 'The sent status could not be recorded.';
  }
}

export async function removeAbsentees(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  try {
    const { error } = await supabase.from('school_absentee_queue').delete().in('id', ids);
    return error ? error.message : null;
  } catch {
    return 'Those rows could not be removed.';
  }
}

// One school-wide notice per date, written by the database function so the "once a day"
// rule is enforced where it cannot be bypassed. Returns how many rows were written: 1 the
// first time the notice goes out for a date, 0 every time after that.
export async function publishHolidayNotice(
  holidayDate: string,
  title: string,
  body: string,
  audience: 'all' | 'staff' | 'parents' | 'students' = 'all',
): Promise<{ inserted: number; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('publish_holiday_notice', {
      p_holiday_date: holidayDate.slice(0, 10),
      p_title: title,
      p_body: body,
      p_audience: audience,
    });
    if (error) return { inserted: 0, error: error.message };
    return { inserted: Number(data) || 0, error: null };
  } catch {
    return { inserted: 0, error: 'The holiday notice could not be published.' };
  }
}

export async function fetchAbsenteeTemplates(): Promise<{ templates: AbsenteeTemplate[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_notice_templates')
      .select('id, notice_type, language, template_text, updated_at')
      .in('notice_type', ALERT_NOTICE_TYPE_LIST);
    if (error) return { templates: [], error: error.message };
    return { templates: (data ?? []) as AbsenteeTemplate[], error: null };
  } catch {
    return { templates: [], error: 'The saved absentee wording could not be loaded.' };
  }
}

export async function saveAbsenteeTemplate(
  status: AbsenteeAlertStatus,
  language: AbsenteeTemplate['language'],
  templateText: string,
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_notice_templates')
      .upsert(
        {
          notice_type: ALERT_NOTICE_TYPES[status],
          language,
          template_text: templateText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'notice_type,language' },
      );
    return error ? error.message : null;
  } catch {
    return 'The absentee wording could not be saved.';
  }
}

// The chosen language and the way WhatsApp is opened are school-wide settings, so they
// are stored server-side rather than in the browser.
export async function fetchAbsenteeLanguage(): Promise<AbsenteeTemplate['language']> {
  try {
    const { data } = await supabase
      .from('school_absentee_settings')
      .select('language')
      .eq('id', 'default')
      .maybeSingle();
    const stored = (data as { language: string | null } | null)?.language;
    return stored === 'Urdu' ? 'Urdu' : 'English';
  } catch {
    return 'English';
  }
}

export async function saveAbsenteeLanguage(language: AbsenteeTemplate['language']): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_absentee_settings')
      .upsert({ id: 'default', language, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return error ? error.message : null;
  } catch {
    return 'The chosen language could not be saved.';
  }
}

export async function fetchAbsenteeSendMode(): Promise<AlertSendMode> {
  try {
    const { data } = await supabase
      .from('school_absentee_settings')
      .select('send_mode')
      .eq('id', 'default')
      .maybeSingle();
    const stored = (data as { send_mode: string | null } | null)?.send_mode;
    if (stored === 'app' || stored === 'web' || stored === 'wa.me') return stored;
    // Legacy 'desktop' maps to the desktop app; anything else defaults to WhatsApp Web,
    // which opens the chat directly on a computer.
    return stored === 'desktop' ? 'app' : 'web';
  } catch {
    return 'web';
  }
}

export async function saveAbsenteeSendMode(sendMode: AlertSendMode): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_absentee_settings')
      .upsert({ id: 'default', send_mode: sendMode, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return error ? error.message : null;
  } catch {
    return 'The WhatsApp sending option could not be saved.';
  }
}

export async function fetchPortalNotifications(studentIds: string[]): Promise<{ notifications: PortalNotification[]; error: string | null }> {
  try {
    // School-wide notices carry no student, so they are fetched alongside the child's own
    // notices — a holiday announcement has to reach every parent, not only the ones with
    // an absence that day. The `.or` keeps the two kinds in a single round trip.
    let query = supabase
      .from('school_portal_notifications')
      .select('id, student_id, notification_type, title, body, attendance_date, created_at, attachment_url, challan_id')
      .order('created_at', { ascending: false })
      .limit(40);
    query = studentIds.length > 0
      ? query.or(`student_id.is.null,student_id.in.(${studentIds.join(',')})`)
      : query.is('student_id', null);
    const { data, error } = await query;
    if (error) return { notifications: [], error: error.message };
    return { notifications: (data ?? []) as PortalNotification[], error: null };
  } catch {
    return { notifications: [], error: 'Your notices could not be loaded.' };
  }
}
