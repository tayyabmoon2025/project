import { supabase } from '@/lib/supabase';
import { SCHOOL_NAME, SCHOOL_NAME_UR, formatAbsenteeDate } from '@/lib/noticeText';
import { loadSchoolProfile } from '@/lib/schoolProfile';
import type { NoticeCategory, NoticeLanguage, NoticeTemplate, SentNotice, Student } from '@/lib/schoolTypes';

const TEMPLATE_COLUMNS = 'id, notice_type, language, title, category, body_english, body_urdu, is_active, updated_at';

// The table stores one row per language. Only the language is read off the row itself;
// the two bodies are folded onto a single template before the app sees them.
type NoticeTemplateRow = Omit<NoticeTemplate, 'body_english' | 'body_urdu'> & {
  language: 'English' | 'Urdu';
  body_english: string;
  body_urdu: string;
};

export type NoticeTemplateDraft = {
  id: string | null;
  title: string;
  category: NoticeCategory;
  noticeType: string;
  bodyEnglish: string;
  bodyUrdu: string;
  isActive: boolean;
};

// The database keeps one row per language, but the office thinks in bilingual messages,
// so the rows are folded back into one template keyed by their notice_type.
export function groupNoticeTemplates(rows: NoticeTemplateRow[]): NoticeTemplate[] {
  const byType = new Map<string, NoticeTemplate>();
  // English rows are folded first so the template carries the English row's id: that is
  // the row an edit is written back to, which keeps the older single-column wording and
  // the English body on the same record.
  const ordered = [...rows].sort((a, b) => (a.language === b.language ? 0 : a.language === 'English' ? -1 : 1));
  for (const row of ordered) {
    const existing = byType.get(row.notice_type);
    if (!existing) {
      byType.set(row.notice_type, { ...row });
      continue;
    }
    // English and Urdu rows carry the same title, category and active flag, so only the
    // two bodies need merging.
    if (!existing.body_english && row.body_english) existing.body_english = row.body_english;
    if (!existing.body_urdu && row.body_urdu) existing.body_urdu = row.body_urdu;
    if (row.updated_at > existing.updated_at) existing.updated_at = row.updated_at;
  }
  return Array.from(byType.values()).sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchNoticeTemplates(): Promise<{ templates: NoticeTemplate[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_notice_templates')
      .select(TEMPLATE_COLUMNS)
      .order('title');
    if (error) return { templates: [], error: error.message };
    return { templates: groupNoticeTemplates((data ?? []) as NoticeTemplateRow[]), error: null };
  } catch {
    return { templates: [], error: 'The saved message templates could not be loaded.' };
  }
}

// Creating and editing both go through one database function, so the title, category
// and both language bodies are validated in one place and the older single-column
// wording stays in step for the absentee and homework features.
export async function saveNoticeTemplate(draft: NoticeTemplateDraft): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('save_notice_template', {
      p_id: draft.id,
      p_title: draft.title,
      p_category: draft.category,
      p_notice_type: draft.noticeType || null,
      p_body_english: draft.bodyEnglish,
      p_body_urdu: draft.bodyUrdu,
      p_is_active: draft.isActive,
    });
    if (error) return { id: null, error: error.message };
    return { id: (data as string | null) ?? null, error: null };
  } catch {
    return { id: null, error: 'The template could not be saved.' };
  }
}

export async function deleteNoticeTemplate(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('delete_notice_template', { p_id: id });
    return error ? error.message : null;
  } catch {
    return 'The template could not be deleted.';
  }
}

const SENT_NOTICE_COLUMNS =
  'id, student_id, template_id, title, category, language, rendered_text, delivery_channels, status, whatsapp_number, sent_by_name, created_at, student:school_students(full_name, class_name, section_name)';

type SentNoticeRow = Omit<SentNotice, 'student_name' | 'class_name' | 'section_name'> & {
  student: { full_name: string; class_name: string | null; section_name: string | null } | null;
};

export async function fetchSentNotices(studentId?: string | null): Promise<{ notices: SentNotice[]; error: string | null }> {
  try {
    let query = supabase
      .from('school_sent_notices')
      .select(SENT_NOTICE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(200);
    if (studentId) query = query.eq('student_id', studentId);
    const { data, error } = await query;
    if (error) return { notices: [], error: error.message };
    const notices = ((data ?? []) as unknown as SentNoticeRow[]).map((row) => ({
      ...row,
      student_name: row.student?.full_name ?? null,
      class_name: row.student?.class_name ?? null,
      section_name: row.student?.section_name ?? null,
    }));
    return { notices, error: null };
  } catch {
    return { notices: [], error: 'The sent notices history could not be loaded.' };
  }
}

export type NoticeContext = 'fee' | 'warning' | 'attendance' | 'general';

export type NoticePlaceholderValues = {
  student_name: string;
  father_name: string;
  class_name: string;
  roll_no: string;
  due_amount: string;
  date: string;
  school_name: string;
};

export function noticePlaceholderValues(student: Student | null, schoolName?: string | null): NoticePlaceholderValues {
  const profileName = schoolName?.trim();
  return {
    student_name: student?.full_name?.trim() ?? '',
    father_name: (student?.fathers_name || student?.guardian_name || '').trim(),
    class_name: [student?.class_name, student?.section_name].filter(Boolean).join(' · ').trim(),
    roll_no: (student?.roll_number ?? '').trim(),
    due_amount: student ? `Rs ${Math.max(0, Number(student.fee_balance ?? 0)).toLocaleString()}` : '',
    date: formatAbsenteeDate(new Date().toISOString()),
    school_name: profileName || SCHOOL_NAME,
  };
}

// Every placeholder the office can write, in the order the settings screen lists them.
export const NOTICE_PLACEHOLDERS = [
  'student_name', 'father_name', 'class_name', 'roll_no', 'due_amount', 'date', 'school_name',
] as const;

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}|\{\s*([a-z_]+)\s*\}/g;

// Replaces both {{name}} and {name}, so wording saved before this feature existed keeps
// working. Anything the app does not recognise is left exactly as written, which makes a
// typo visible instead of silently printing an empty space.
export function fillNoticePlaceholders(template: string, values: NoticePlaceholderValues): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, double: string | undefined, single: string | undefined) => {
    const key = (double ?? single ?? '') as keyof NoticePlaceholderValues;
    if (!(key in values)) return match;
    return values[key] || match;
  });
}

// The wording that actually goes out. Bilingual prints the English body, then a blank
// line, then the Urdu body, so one slip carries both.
export function renderStudentNotice(
  template: { body_english: string; body_urdu: string },
  language: NoticeLanguage,
  values: NoticePlaceholderValues,
): string {
  const english = fillNoticePlaceholders(template.body_english ?? '', values).trim();
  const urdu = fillNoticePlaceholders(template.body_urdu ?? '', values).trim();
  if (language === 'English') return english || urdu;
  if (language === 'Urdu') return urdu || english;
  return [english, urdu].filter(Boolean).join('\n\n');
}

// Which saved wording suits the screen the notice is being sent from.
const CONTEXT_CATEGORIES: Record<NoticeContext, NoticeCategory[]> = {
  fee: ['FEE', 'REMINDER'],
  warning: ['WARNING'],
  attendance: ['ATTENDANCE'],
  general: ['NOTICE', 'GENERAL'],
};

const CONTEXT_TYPES: Record<NoticeContext, string[]> = {
  fee: ['fee_due_reminder', 'fee_clearance_reminder', 'fee_reminder'],
  warning: ['warning_notice'],
  attendance: ['attendance_warning', 'absentee_alert'],
  general: ['general_notice'],
};

// Picks the template the office most likely wants, without ever hiding the others: the
// screen the action was opened from is the strongest signal, then the category tag, then
// a matching kind, and finally the first saved template.
export function pickTemplateForContext(templates: NoticeTemplate[], context: NoticeContext): NoticeTemplate | null {
  const active = templates.filter((template) => template.is_active);
  const pool = active.length > 0 ? active : templates;
  if (pool.length === 0) return null;
  const byType = pool.find((template) => CONTEXT_TYPES[context].includes(template.notice_type));
  if (byType) return byType;
  const byCategory = pool.find((template) => CONTEXT_CATEGORIES[context].includes(template.category));
  return byCategory ?? pool[0];
}

export type SendNoticeInput = {
  student: Student;
  template: NoticeTemplate | null;
  title: string;
  category: NoticeCategory;
  bodyEnglish: string;
  bodyUrdu: string;
  language: NoticeLanguage;
  renderedText: string;
  channels: string[];
  whatsappNumber: string;
};

// One database function writes the portal notice and the history row together, so a
// notice can never reach the parent's inbox without also appearing in the history.
export async function sendStudentNotice(input: SendNoticeInput): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('send_student_notice', {
      p_student_id: input.student.id,
      p_template_id: input.template?.id ?? null,
      p_title: input.title,
      p_category: input.category,
      p_body_english: input.bodyEnglish,
      p_body_urdu: input.bodyUrdu,
      p_language: input.language,
      p_rendered_text: input.renderedText,
      p_channels: input.channels,
      p_whatsapp_number: input.whatsappNumber,
    });
    if (error) return { id: null, error: error.message };
    return { id: (data as string | null) ?? null, error: null };
  } catch {
    return { id: null, error: 'The notice could not be posted to the parent portal.' };
  }
}

// The printed slip carries the school's own name and Urdu name, so the profile is read
// once and reused rather than fetched per document.
export async function noticeSchoolNames(): Promise<{ name: string; urduName: string }> {
  const profile = await loadSchoolProfile();
  return {
    name: profile?.school_name?.trim() || SCHOOL_NAME,
    urduName: profile?.school_name_urdu?.trim() || SCHOOL_NAME_UR,
  };
}
