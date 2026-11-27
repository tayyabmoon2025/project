import { supabase } from '@/lib/supabase';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatDisplayDate } from '@/lib/classOffDays';

// One assignment, written for a class and section on a day. It stays a draft
// until the teacher publishes it, so parents never read half-finished work.
export type HomeworkStatus = 'draft' | 'published';
export type HomeworkCompletionStatus = 'pending' | 'submitted' | 'late' | 'missing';

export type HomeworkEntry = {
  id: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  title: string;
  details: string | null;
  homework_date: string;
  due_date: string | null;
  attachment_url: string | null;
  status: HomeworkStatus;
  assigned_by: string | null;
  assigned_by_name: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HomeworkCompletion = {
  id: string;
  homework_id: string;
  student_id: string;
  status: HomeworkCompletionStatus;
  remarks: string | null;
  updated_at: string;
};

export type HomeworkDraft = {
  class_name: string;
  section_name: string;
  subject_name: string;
  title: string;
  details: string;
  homework_date: string;
  due_date: string;
  attachment_url: string;
  status: HomeworkStatus;
};

// One staff member's record of having opened an assignment. Marked for the
// signed-in account only, so nobody can record a reading on someone else's behalf.
export type HomeworkView = {
  id: string;
  homework_id: string;
  user_id: string;
  seen_at: string;
};

// The school's staff list, names and roles only, used to show who has read an
// assignment and who has not.
export type StaffDirectoryEntry = { id: string; full_name: string; role: string };

// What a parent or a student is handed by the read-only function: the published
// work for their own record, or nothing at all while a fee balance is pending.
export type PortalHomeworkStudent = {
  id: string;
  full_name: string;
  class_name: string;
  section_name: string;
  due_amount: number;
};

export type PortalHomeworkEntry = {
  id: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  title: string;
  details: string | null;
  homework_date: string;
  due_date: string | null;
  attachment_url: string | null;
  assigned_by_name: string | null;
  published_at: string | null;
  created_at: string;
  completions: { student_id: string; status: HomeworkCompletionStatus; remarks: string | null }[];
};

export type PortalHomeworkPayload = {
  blocked: boolean;
  students: PortalHomeworkStudent[];
  entries: PortalHomeworkEntry[];
  due_amount?: number;
  error?: string;
};

export const HOMEWORK_STATUS_LABELS: Record<HomeworkStatus, string> = {
  draft: 'Draft',
  published: 'Published',
};

export const COMPLETION_LABELS: Record<HomeworkCompletionStatus, string> = {
  pending: 'Not marked',
  submitted: 'Submitted',
  late: 'Submitted late',
  missing: 'Not submitted',
};

export const COMPLETION_TONES: Record<HomeworkCompletionStatus, string> = {
  pending: 'neutral',
  submitted: 'paid',
  late: 'partial',
  missing: 'unpaid',
};

export const HOMEWORK_COLUMNS =
  'id, class_name, section_name, subject_name, title, details, homework_date, due_date, attachment_url, status, assigned_by, assigned_by_name, published_at, created_at, updated_at';

export const emptyHomeworkDraft = (className: string, sectionName: string, today: string): HomeworkDraft => ({
  class_name: className,
  section_name: sectionName,
  subject_name: '',
  title: '',
  details: '',
  homework_date: today,
  due_date: '',
  attachment_url: '',
  status: 'draft',
});

// ---------------------------------------------------------------------------
// Staff: read and write
// ---------------------------------------------------------------------------

export async function fetchHomework(limit = 200): Promise<{ entries: HomeworkEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_homework')
      .select(HOMEWORK_COLUMNS)
      .order('homework_date', { ascending: false })
      .order('class_name')
      .limit(limit);
    if (error) return { entries: [], error: 'The homework list could not be loaded.' };
    return { entries: (data ?? []) as HomeworkEntry[], error: null };
  } catch {
    return { entries: [], error: 'The homework list could not be loaded. Check your connection and try again.' };
  }
}

export async function fetchCompletions(homeworkIds: string[]): Promise<{ completions: HomeworkCompletion[]; error: string | null }> {
  if (homeworkIds.length === 0) return { completions: [], error: null };
  try {
    const { data, error } = await supabase
      .from('school_homework_completions')
      .select('id, homework_id, student_id, status, remarks, updated_at')
      .in('homework_id', homeworkIds);
    if (error) return { completions: [], error: 'The submission records could not be loaded.' };
    return { completions: (data ?? []) as HomeworkCompletion[], error: null };
  } catch {
    return { completions: [], error: 'The submission records could not be loaded. Check your connection and try again.' };
  }
}

const draftPayload = (draft: HomeworkDraft, profile: { id: string; full_name: string } | null) => ({
  class_name: draft.class_name.trim(),
  section_name: draft.section_name.trim(),
  subject_name: draft.subject_name.trim(),
  title: draft.title.trim(),
  details: draft.details.trim() ? draft.details.trim() : null,
  homework_date: draft.homework_date,
  due_date: draft.due_date ? draft.due_date : null,
  attachment_url: draft.attachment_url.trim() ? draft.attachment_url.trim() : null,
  status: draft.status,
  assigned_by: profile?.id ?? null,
  assigned_by_name: profile?.full_name ?? null,
});

export function validateHomeworkDraft(draft: HomeworkDraft): string | null {
  if (!draft.class_name.trim()) return 'Choose the class the work is for.';
  if (!draft.section_name.trim()) return 'Choose the section the work is for.';
  if (!draft.subject_name.trim()) return 'Enter the subject.';
  if (draft.title.trim().length < 2) return 'Enter a short title for the homework.';
  if (!draft.homework_date) return 'Choose the date the work is set.';
  if (draft.due_date && draft.due_date < draft.homework_date) return 'The hand-in date cannot be before the date the work is set.';
  return null;
}

export async function createHomework(
  draft: HomeworkDraft,
  profile: { id: string; full_name: string } | null,
): Promise<{ error: string | null; entry: HomeworkEntry | null }> {
  const invalid = validateHomeworkDraft(draft);
  if (invalid) return { error: invalid, entry: null };
  try {
    const { data, error } = await supabase
      .from('school_homework')
      .insert(draftPayload(draft, profile))
      .select(HOMEWORK_COLUMNS)
      .maybeSingle();
    if (error) {
      // The uniqueness rule is on the class, section, subject and date together,
      // so this is the one clash worth explaining in the school's own words.
      if (error.code === '23505') return { error: 'Homework for that class, subject and date already exists. Open it from the list to edit it.', entry: null };
      return { error: 'The homework could not be saved. Please try again.', entry: null };
    }
    return { error: null, entry: (data ?? null) as HomeworkEntry | null };
  } catch {
    return { error: 'The homework could not be saved. Check your connection and try again.', entry: null };
  }
}

// One uploaded sheet often carries the work for several subjects at once, so this
// saves the same sheet as one entry per subject, all sharing the same file link.
// A subject that already has work for that class and date is left alone rather than
// failing the whole sheet.
export async function createHomeworkSheet(
  base: HomeworkDraft,
  subjects: string[],
  profile: { id: string; full_name: string } | null,
): Promise<{ error: string | null; created: number; skipped: number; ids: string[] }> {
  const wanted = Array.from(new Set(subjects.map((subject) => subject.trim()).filter(Boolean)));
  if (wanted.length === 0) {
    return { error: 'Choose at least one subject for this sheet.', created: 0, skipped: 0, ids: [] };
  }

  let created = 0;
  let skipped = 0;
  let firstError: string | null = null;
  const ids: string[] = [];

  for (const subject of wanted) {
    const result = await createHomework({ ...base, subject_name: subject }, profile);
    if (result.error) {
      if (result.error.startsWith('Homework for that class')) { skipped += 1; continue; }
      if (!firstError) firstError = result.error;
      continue;
    }
    created += 1;
    if (result.entry) ids.push(result.entry.id);
  }

  if (created === 0) {
    return { error: firstError ?? 'Every subject on that sheet already has homework for this date.', created, skipped, ids };
  }
  return { error: null, created, skipped, ids };
}

export async function updateHomework(id: string, draft: HomeworkDraft): Promise<{ error: string | null; entry: HomeworkEntry | null }> {
  const invalid = validateHomeworkDraft(draft);
  if (invalid) return { error: invalid, entry: null };
  try {
    const { data, error } = await supabase
      .from('school_homework')
      .update(draftPayload(draft, null))
      .eq('id', id)
      .select(HOMEWORK_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return { error: 'Another entry already covers that class, subject and date.', entry: null };
      return { error: 'The homework could not be updated. Please try again.', entry: null };
    }
    return { error: null, entry: (data ?? null) as HomeworkEntry | null };
  } catch {
    return { error: 'The homework could not be updated. Check your connection and try again.', entry: null };
  }
}

export async function setHomeworkStatus(id: string, status: HomeworkStatus): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_homework').update({ status }).eq('id', id);
    return error ? 'The homework could not be updated. Please try again.' : null;
  } catch {
    return 'The homework could not be updated. Check your connection and try again.';
  }
}

export async function deleteHomework(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_homework').delete().eq('id', id);
    return error ? 'That homework could not be removed. Please try again.' : null;
  } catch {
    return 'That homework could not be removed. Check your connection and try again.';
  }
}

// ---------------------------------------------------------------------------
// Seen tracking
// ---------------------------------------------------------------------------

// Every staff member's reading of the assignments on screen, so a teacher can see
// at a glance which colleagues have opened the work.
export async function fetchHomeworkViews(homeworkIds: string[]): Promise<{ views: HomeworkView[]; error: string | null }> {
  if (homeworkIds.length === 0) return { views: [], error: null };
  try {
    const { data, error } = await supabase
      .from('school_homework_views')
      .select('id, homework_id, user_id, seen_at')
      .in('homework_id', homeworkIds);
    if (error) return { views: [], error: 'The seen records could not be loaded.' };
    return { views: (data ?? []) as HomeworkView[], error: null };
  } catch {
    return { views: [], error: 'The seen records could not be loaded. Check your connection and try again.' };
  }
}

export async function fetchStaffDirectory(): Promise<{ staff: StaffDirectoryEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('staff_directory');
    if (error) return { staff: [], error: 'The staff list could not be loaded.' };
    return { staff: (data ?? []) as StaffDirectoryEntry[], error: null };
  } catch {
    return { staff: [], error: 'The staff list could not be loaded. Check your connection and try again.' };
  }
}

// Records that the signed-in account has opened an assignment. Re-opening the same
// assignment only refreshes the timestamp, so one person never appears twice.
export async function markHomeworkSeen(homeworkId: string): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_homework_views')
      .upsert(
        { homework_id: homeworkId, seen_at: new Date().toISOString() },
        { onConflict: 'homework_id,user_id' },
      );
    return error ? 'The seen record could not be saved.' : null;
  } catch {
    return 'The seen record could not be saved.';
  }
}

// Marking the same class twice updates the rows rather than adding duplicates,
// because a student can only have one submission row per assignment.
export async function saveCompletions(
  homeworkId: string,
  rows: { student_id: string; status: HomeworkCompletionStatus; remarks: string }[],
): Promise<string | null> {
  if (rows.length === 0) return null;
  try {
    const { error } = await supabase
      .from('school_homework_completions')
      .upsert(
        rows.map((row) => ({
          homework_id: homeworkId,
          student_id: row.student_id,
          status: row.status,
          remarks: row.remarks.trim() ? row.remarks.trim() : null,
        })),
        { onConflict: 'homework_id,student_id' },
      );
    return error ? 'The submission records could not be saved. Please try again.' : null;
  } catch {
    return 'The submission records could not be saved. Check your connection and try again.';
  }
}

// ---------------------------------------------------------------------------
// Parent and student: published work only, through the read-only function
// ---------------------------------------------------------------------------

export async function fetchPortalHomework(): Promise<{ payload: PortalHomeworkPayload | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('portal_homework');
    if (error) return { payload: null, error: 'The homework diary could not be loaded.' };
    return { payload: (data ?? null) as PortalHomeworkPayload | null, error: null };
  } catch {
    return { payload: null, error: 'The homework diary could not be loaded. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Sharing the day's diary with parents
// ---------------------------------------------------------------------------

export function dailyDiaryText(entries: HomeworkEntry[], date: string): string {
  return portalDiaryText(entries, date);
}

// Works for both the staff list and the parent/student diary, since both carry the
// same fields the diary line needs.
export function portalDiaryText(
  entries: { subject_name: string; title: string; details?: string | null; due_date?: string | null }[],
  date: string,
): string {
  const lines = entries.map((entry) => {
    const handIn = entry.due_date ? ` — hand in by ${formatDisplayDate(entry.due_date)}` : '';
    const detail = entry.details ? `\n   ${entry.details.replace(/\s+/g, ' ').trim()}` : '';
    return `• ${entry.subject_name}: ${entry.title}${handIn}${detail}`;
  });
  return [
    `${SCHOOL_NAME}`,
    `Homework diary — ${formatDisplayDate(date)}`,
    '',
    ...lines,
    '',
    'Please make sure the work is completed and signed. Thank you.',
  ].join('\n');
}
