import { supabase } from '@/lib/supabase';
import type { GradeRemark } from '@/lib/examExtras';

// The Teacher's Remarks printed on a report card come from three places, in order:
//
//   1. a remark saved for that one student on that exam (the teacher's tweak),
//   2. the Grade Remarks Bank entry for the student's overall grade,
//   3. a plain sentence, when the bank has no entry for the grade.
//
// Only the first is stored per student, so editing the bank flows straight through to
// every report card that was not individually overridden.

export type ReportCardRemark = {
  id: string;
  exam_type_id: string;
  student_id: string;
  grade: string;
  remark: string;
};

export type RemarkSource = 'override' | 'bank' | 'fallback';

export type ResolvedRemark = {
  remark: string;
  source: RemarkSource;
};

const trimmed = (value: string) => value.trim();
const sameGrade = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function fallbackRemark(status: 'pass' | 'fail' | 'incomplete'): string {
  if (status === 'fail') return 'Please review this result with the class teacher.';
  if (status === 'incomplete') return 'Some papers are still to be marked.';
  return 'A satisfactory result. Keep working steadily.';
}

// The bank wording for a grade, or an empty string when that grade has no entry.
export const bankRemarkFor = (bank: GradeRemark[], grade: string): string =>
  bank.find((entry) => sameGrade(entry.grade, grade))?.remark.trim() ?? '';

export function resolveReportCardRemark(params: {
  grade: string;
  status: 'pass' | 'fail' | 'incomplete';
  bank: GradeRemark[];
  override: ReportCardRemark | null;
}): ResolvedRemark {
  // An override written for a different grade is stale — the student's grade has moved
  // since — so it is ignored and the bank wording is used instead.
  if (params.override && sameGrade(params.override.grade, params.grade) && trimmed(params.override.remark)) {
    return { remark: trimmed(params.override.remark), source: 'override' };
  }
  const banked = bankRemarkFor(params.bank, params.grade);
  if (banked) return { remark: banked, source: 'bank' };
  return { remark: fallbackRemark(params.status), source: 'fallback' };
}

export const remarkSourceLabel = (source: RemarkSource, grade: string): string => {
  if (source === 'override') return 'Saved for this student only';
  if (source === 'bank') return `From the Grade Remarks Bank for grade ${grade}`;
  return 'No bank remark for this grade yet — a default sentence is used';
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function fetchReportCardRemarks(examTypeId: string): Promise<{ overrides: ReportCardRemark[]; error: string | null }> {
  if (!examTypeId) return { overrides: [], error: null };
  try {
    const { data, error } = await supabase
      .from('school_report_card_remarks')
      .select('id, exam_type_id, student_id, grade, remark')
      .eq('exam_type_id', examTypeId);
    if (error) return { overrides: [], error: 'The saved report card remarks could not be loaded.' };
    return {
      overrides: (data ?? []).map((row) => ({
        id: String(row.id),
        exam_type_id: String(row.exam_type_id),
        student_id: String(row.student_id),
        grade: String(row.grade ?? ''),
        remark: String(row.remark ?? ''),
      })),
      error: null,
    };
  } catch {
    return { overrides: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveReportCardRemark(params: {
  examTypeId: string;
  studentId: string;
  grade: string;
  remark: string;
}): Promise<{ error: string | null }> {
  const value = trimmed(params.remark);
  if (!trimmed(params.examTypeId) || !trimmed(params.studentId)) return { error: 'Choose the exam and the student first.' };
  if (value.length < 3) return { error: 'Please write a remark of at least 3 characters.' };
  if (value.length > 300) return { error: 'The remark cannot be longer than 300 characters.' };
  try {
    const { error } = await supabase
      .from('school_report_card_remarks')
      .upsert({
        exam_type_id: params.examTypeId,
        student_id: params.studentId,
        grade: trimmed(params.grade).toUpperCase(),
        remark: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'exam_type_id,student_id' });
    if (error) return { error: 'The remark could not be saved for this student. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// Clears the per-student tweak so the report card falls back to the bank wording.
export async function clearReportCardRemark(examTypeId: string, studentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('school_report_card_remarks')
      .delete()
      .eq('exam_type_id', examTypeId)
      .eq('student_id', studentId);
    if (error) return { error: 'The saved remark could not be reset. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}
