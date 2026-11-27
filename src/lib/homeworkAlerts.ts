import { supabase } from '@/lib/supabase';
import type { AbsenteeTemplate, HomeworkAlertEntry, HomeworkAlertKind } from '@/lib/schoolTypes';
import type { HomeworkEntry } from '@/lib/homework';
import { renderHomeworkText } from '@/lib/noticeText';
import {
  DEFAULT_HOMEWORK_REMINDER_WORDING, DEFAULT_HOMEWORK_WORDING, homeworkReminderWordingFrom,
  homeworkWordingFrom, type HomeworkWording,
} from '@/lib/alertStatuses';

const ALERT_COLUMNS =
  'id, homework_id, student_id, student_name, class_name, section_name, parent_phone, homework_date, language, message_body, attachment_url, status, sent_at, created_at, alert_kind, reminder_days_before';

export type HomeworkAlertFilters = {
  date: string;
  status: '' | 'queued' | 'sent';
  kind?: '' | HomeworkAlertKind;
};

// The publishing trigger and the reminder function write one row per student, so the
// screen only ever reads and updates them — nothing is built here.
export async function fetchHomeworkAlerts(
  filters: HomeworkAlertFilters,
): Promise<{ entries: HomeworkAlertEntry[]; error: string | null }> {
  try {
    let query = supabase
      .from('school_homework_alerts')
      .select(ALERT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(400);
    if (filters.date) query = query.eq('homework_date', filters.date);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.kind) query = query.eq('alert_kind', filters.kind);
    const { data, error } = await query;
    if (error) return { entries: [], error: error.message };
    return { entries: (data ?? []) as HomeworkAlertEntry[], error: null };
  } catch {
    return { entries: [], error: 'The homework alert list could not be loaded. Check your connection and try again.' };
  }
}

// How many guardians are waiting for a homework message, used for the sidebar badge.
export async function fetchQueuedHomeworkAlertCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('school_homework_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function markHomeworkAlertsSent(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  try {
    const { error } = await supabase
      .from('school_homework_alerts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in('id', ids);
    return error ? error.message : null;
  } catch {
    return 'The sent status could not be recorded.';
  }
}

export async function removeHomeworkAlerts(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  try {
    const { error } = await supabase.from('school_homework_alerts').delete().in('id', ids);
    return error ? error.message : null;
  } catch {
    return 'Those rows could not be removed.';
  }
}

export async function fetchHomeworkWording(): Promise<{ wording: HomeworkWording; reminder: HomeworkWording; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_notice_templates')
      .select('id, notice_type, language, template_text, updated_at')
      .in('notice_type', ['homework_alert', 'homework_reminder']);
    if (error) {
      return {
        wording: { ...DEFAULT_HOMEWORK_WORDING },
        reminder: { ...DEFAULT_HOMEWORK_REMINDER_WORDING },
        error: error.message,
      };
    }
    const templates = (data ?? []) as AbsenteeTemplate[];
    return {
      wording: homeworkWordingFrom(templates),
      reminder: homeworkReminderWordingFrom(templates),
      error: null,
    };
  } catch {
    return {
      wording: { ...DEFAULT_HOMEWORK_WORDING },
      reminder: { ...DEFAULT_HOMEWORK_REMINDER_WORDING },
      error: 'The saved homework wording could not be loaded.',
    };
  }
}

export async function saveHomeworkWording(
  kind: 'homework_alert' | 'homework_reminder',
  language: AbsenteeTemplate['language'],
  templateText: string,
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_notice_templates')
      .upsert(
        {
          notice_type: kind,
          language,
          template_text: templateText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'notice_type,language' },
      );
    return error ? error.message : null;
  } catch {
    return 'The homework wording could not be saved.';
  }
}

// Re-words the rows that are still waiting so a change to the wording reaches them
// without touching anything already sent. The message is rebuilt from the assignment
// the row points at, which is where the subject, title and hand-in date live. Each
// kind of message uses its own wording, so a reminder stays a reminder.
export async function rewordHomeworkAlerts(
  rows: HomeworkAlertEntry[],
  homework: HomeworkEntry[],
  language: AbsenteeTemplate['language'],
  wording: HomeworkWording,
  reminderWording: HomeworkWording,
): Promise<string | null> {
  const byId = new Map(homework.map((entry) => [entry.id, entry]));
  const pending = rows.filter((row) => row.status === 'queued' && byId.has(row.homework_id));
  if (pending.length === 0) return null;

  const updates = pending.flatMap((row) => {
    const entry = byId.get(row.homework_id);
    if (!entry) return [];
    const template = row.alert_kind === 'reminder' ? reminderWording[language] : wording[language];
    const body = renderHomeworkText(template, language, {
      student_name: row.student_name,
      class_name: row.class_name ?? entry.class_name,
      section_name: row.section_name ?? entry.section_name,
      subject: entry.subject_name,
      title: entry.title,
      date: row.homework_date,
      due_date: entry.due_date,
    });
    if (body === row.message_body && language === row.language) return [];
    return [{ id: row.id, body }];
  });
  if (updates.length === 0) return null;

  try {
    const results = await Promise.all(updates.map((update) => supabase
      .from('school_homework_alerts')
      .update({ message_body: update.body, language })
      .eq('id', update.id)));
    const failed = results.find((result) => result.error);
    return failed?.error ? failed.error.message : null;
  } catch {
    return 'The waiting homework messages could not be re-worded.';
  }
}

// Prepares the reminders for every assignment falling due in the given number of
// days. Running it again the same day adds nothing, so a guardian is never messaged
// twice about the same piece of work.
export async function runHomeworkDeadlineReminders(
  days: number,
): Promise<{ prepared: number; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('run_homework_deadline_reminders', { p_days: days });
    if (error) return { prepared: 0, error: error.message };
    return { prepared: typeof data === 'number' ? data : 0, error: null };
  } catch {
    return { prepared: 0, error: 'The reminders could not be prepared. Check your connection and try again.' };
  }
}
