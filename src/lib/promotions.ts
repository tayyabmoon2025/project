import { supabase } from '@/lib/supabase';

export const CLASS_OPTIONS = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
  'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
];

export const DEFAULT_SECTION_OPTIONS = ['A', 'B', 'C', 'D'];

// The last year of school: students here pass out instead of moving up a class.
export const FINAL_CLASS = 'Class 10';

export type FinalResultStatus = 'passed' | 'failed' | 'pending';

export type PromotionOutcome = 'promoted' | 'conditional' | 'passed_out';

export type FinalResult = {
  student_id: string;
  status: FinalResultStatus;
  remarks: string | null;
  updated_at: string;
};

export type PromotionRecord = {
  id: string;
  student_id: string;
  student_name: string;
  from_class: string | null;
  from_section: string | null;
  to_class: string | null;
  to_section: string | null;
  outcome: PromotionOutcome;
  condition_note: string | null;
  session: string;
  promoted_at: string;
};

export type PromotionEntry = {
  student_id: string;
  outcome: PromotionOutcome;
  to_class: string | null;
  to_section: string | null;
  condition_note: string | null;
};

export const OUTCOME_LABELS: Record<PromotionOutcome, string> = {
  promoted: 'Promoted',
  conditional: 'Conditional',
  passed_out: 'Passed out',
};

export const RESULT_LABELS: Record<FinalResultStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  pending: 'Result pending',
};

export const isFinalClass = (className: string | null | undefined, finalClass: string = FINAL_CLASS) =>
  (className ?? '').trim() === finalClass;

// Each student moves up from their own class: the class after this one in the school's
// own list. The caller passes the list in, so a school that renames its classes or adds
// one above the old top gets the right answer. The built-in list is only the fallback.
export function nextClassFor(className: string | null | undefined, options: string[] = CLASS_OPTIONS): string | null {
  const index = options.indexOf((className ?? '').trim());
  if (index < 0) return null;
  return options[index + 1] ?? null;
}

// School sessions run April to March, so the label follows the year the school is in.
export function currentSession(now: Date = new Date()): string {
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export async function fetchFinalResults(session: string): Promise<{ results: FinalResult[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_final_results')
      .select('student_id, status, remarks, updated_at')
      .eq('session', session);
    if (error) return { results: [], error: 'The final term results could not be loaded.' };
    return { results: (data ?? []) as FinalResult[], error: null };
  } catch {
    return { results: [], error: 'The final term results could not be loaded. Check your connection and try again.' };
  }
}

export async function saveFinalResult(
  studentId: string,
  session: string,
  status: FinalResultStatus,
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_final_results')
      .upsert(
        { student_id: studentId, session, status, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,session' },
      );
    return error ? 'The result could not be saved. Please try again.' : null;
  } catch {
    return 'The result could not be saved. Check your connection and try again.';
  }
}

export async function fetchPromotionRecords(limit = 25): Promise<{ records: PromotionRecord[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_promotion_records')
      .select('id, student_id, student_name, from_class, from_section, to_class, to_section, outcome, condition_note, session, promoted_at')
      .order('promoted_at', { ascending: false })
      .limit(limit);
    if (error) return { records: [], error: 'The promotion history could not be loaded.' };
    return { records: (data ?? []) as PromotionRecord[], error: null };
  } catch {
    return { records: [], error: 'The promotion history could not be loaded. Check your connection and try again.' };
  }
}

// The whole batch is promoted by the database in one transaction, so the history record
// and the class change can never disagree about what happened.
export async function promoteStudents(
  entries: PromotionEntry[],
  session: string,
): Promise<{ promoted: number; error: string | null }> {
  if (entries.length === 0) return { promoted: 0, error: null };
  try {
    const { data, error } = await supabase.rpc('promote_students', {
      p_promotions: entries,
      p_session: session,
    });
    if (error) {
      // The database's own checks raise plain, readable reasons (a missing condition,
      // for example). Anything else is reported generically.
      if (error.code === 'P0001' && error.message) return { promoted: 0, error: error.message };
      return { promoted: 0, error: 'The students could not be promoted. Please try again.' };
    }
    const promoted = (data as { promoted?: number } | null)?.promoted ?? entries.length;
    return { promoted, error: null };
  } catch {
    return { promoted: 0, error: 'The students could not be promoted. Check your connection and try again.' };
  }
}
