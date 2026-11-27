import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

export type PassingRule = 'aggregate' | 'compulsory' | 'both';

export type ExamType = {
  id: string;
  name: string;
  period_start: string | null;
  period_end: string | null;
  sort_order: number;
  is_active: boolean;
  min_pass_percentage: number;
  passing_rule: PassingRule;
};

export type ExamSubject = {
  id: string;
  exam_type_id: string;
  class_name: string;
  subject_name: string;
  max_marks: number;
  pass_marks: number;
  paper_split: boolean;
  paper_a_max: number;
  paper_b_max: number;
  is_compulsory: boolean;
  is_grade_only: boolean;
  is_optional: boolean;
  sort_order: number;
};

export type ExamMark = {
  id: string;
  exam_type_id: string;
  student_id: string;
  subject_id: string;
  class_name: string;
  obtained_marks: number | null;
  is_absent: boolean;
  paper_a_marks: number | null;
  paper_b_marks: number | null;
  grade: string | null;
};

export type ExamTypeDraft = {
  name: string;
  period_start: string;
  period_end: string;
  is_active: boolean;
  min_pass_percentage: string;
  passing_rule: PassingRule;
};

export type ExamSubjectDraft = {
  exam_type_id: string;
  class_name: string;
  subject_name: string;
  max_marks: string;
  pass_marks: string;
  is_compulsory: boolean;
  is_grade_only: boolean;
  is_optional: boolean;
  sort_order: string;
};

export type MarkEntry = {
  subject_id: string;
  obtained: string;
  absent: boolean;
  paper_a: string;
  paper_b: string;
  grade: string;
};

// The letters a grade-only subject can be awarded, best first.
export const GRADE_OPTIONS = ['A+', 'A', 'B', 'C', 'D', 'F'] as const;

export const PASSING_RULES: { value: PassingRule; label: string; hint: string }[] = [
  { value: 'aggregate', label: 'Aggregate Percentage Only', hint: 'Passes when the overall percentage reaches the minimum.' },
  { value: 'compulsory', label: 'Compulsory Subjects Only', hint: 'Passes when every Compulsory subject meets its pass mark.' },
  { value: 'both', label: 'Both Compulsory Subjects & Aggregate', hint: 'Every Compulsory subject must pass AND the aggregate must reach the minimum.' },
];

export const passingRuleLabel = (rule: PassingRule): string =>
  PASSING_RULES.find((item) => item.value === rule)?.label ?? 'Both Compulsory Subjects & Aggregate';

// The passing policy an exam is judged by. Used by every screen that works out a
// result, so a single stored setting drives marks entry, report cards and reports.
export const passingPolicyFor = (exam: ExamType | null | undefined) => ({
  minPassPercentage: exam?.min_pass_percentage ?? 40,
  passingRule: (exam?.passing_rule ?? 'both') as PassingRule,
});

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ruleOr = (value: unknown): PassingRule =>
  value === 'aggregate' || value === 'compulsory' || value === 'both' ? value : 'both';

// numeric columns can arrive as text, so every figure is normalised on the way in.
export const normaliseMark = (row: Record<string, unknown>): ExamMark => ({
  id: String(row.id),
  exam_type_id: String(row.exam_type_id),
  student_id: String(row.student_id),
  subject_id: String(row.subject_id),
  class_name: String(row.class_name ?? ''),
  obtained_marks: row.obtained_marks === null || row.obtained_marks === undefined ? null : numberOr(row.obtained_marks),
  is_absent: Boolean(row.is_absent),
  paper_a_marks: row.paper_a_marks === null || row.paper_a_marks === undefined ? null : numberOr(row.paper_a_marks),
  paper_b_marks: row.paper_b_marks === null || row.paper_b_marks === undefined ? null : numberOr(row.paper_b_marks),
  grade: row.grade ? String(row.grade) : null,
});

export const normaliseSubject = (row: Record<string, unknown>): ExamSubject => ({
  id: String(row.id),
  exam_type_id: String(row.exam_type_id),
  class_name: String(row.class_name ?? ''),
  subject_name: String(row.subject_name ?? ''),
  max_marks: numberOr(row.max_marks, 100),
  pass_marks: numberOr(row.pass_marks, 40),
  paper_split: Boolean(row.paper_split),
  paper_a_max: numberOr(row.paper_a_max, 50),
  paper_b_max: numberOr(row.paper_b_max, 50),
  is_compulsory: row.is_compulsory !== false,
  is_grade_only: Boolean(row.is_grade_only),
  is_optional: Boolean(row.is_optional),
  sort_order: numberOr(row.sort_order, 0),
});

export async function fetchExamTypes(): Promise<{ exams: ExamType[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_exam_types')
      .select('id, name, period_start, period_end, sort_order, is_active, min_pass_percentage, passing_rule')
      .order('sort_order')
      .order('name');
    if (error) return { exams: [], error: 'The exam list could not be loaded.' };
    return {
      exams: (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        period_start: row.period_start ?? null,
        period_end: row.period_end ?? null,
        sort_order: numberOr(row.sort_order),
        is_active: row.is_active !== false,
        min_pass_percentage: numberOr(row.min_pass_percentage, 40),
        passing_rule: ruleOr(row.passing_rule),
      })),
      error: null,
    };
  } catch {
    return { exams: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveExamType(id: string | null, draft: ExamTypeDraft): Promise<{ error: string | null }> {
  const name = draft.name.trim();
  if (name.length < 2) return { error: 'Please give the exam a name of at least 2 characters.' };
  if (draft.period_start && draft.period_end && draft.period_end < draft.period_start) {
    return { error: 'The exam end date cannot be before its start date.' };
  }
  const minPass = Number(draft.min_pass_percentage);
  if (!Number.isFinite(minPass) || minPass < 0 || minPass > 100) {
    return { error: 'The minimum aggregate pass percentage must be between 0 and 100.' };
  }
  try {
    const payload = {
      name,
      period_start: draft.period_start || null,
      period_end: draft.period_end || null,
      is_active: draft.is_active,
      min_pass_percentage: minPass,
      passing_rule: draft.passing_rule,
      updated_at: new Date().toISOString(),
    };
    const { error } = id
      ? await supabase.from('school_exam_types').update(payload).eq('id', id)
      : await supabase.from('school_exam_types').insert(payload);
    if (error) {
      return {
        error: error.code === '23505'
          ? 'An exam with this name already exists.'
          : 'The exam could not be saved. Please try again.',
      };
    }
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function deleteExamType(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_exam_types').delete().eq('id', id);
    if (error) return { error: 'The exam could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function fetchExamSubjects(examTypeId: string): Promise<{ subjects: ExamSubject[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_exam_subjects')
      .select('id, exam_type_id, class_name, subject_name, max_marks, pass_marks, paper_split, paper_a_max, paper_b_max, is_compulsory, is_grade_only, is_optional, sort_order')
      .eq('exam_type_id', examTypeId)
      .order('class_name')
      .order('sort_order')
      .order('subject_name');
    if (error) return { subjects: [], error: 'The subject list for this exam could not be loaded.' };
    return { subjects: (data ?? []).map((row) => normaliseSubject(row as Record<string, unknown>)), error: null };
  } catch {
    return { subjects: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveExamSubject(id: string | null, draft: ExamSubjectDraft): Promise<{ error: string | null }> {
  const subject = draft.subject_name.trim();
  const className = draft.class_name.trim();
  if (!className) return { error: 'Please choose the class this subject belongs to.' };
  if (!subject) return { error: 'Please enter the subject name.' };

  const gradeOnly = draft.is_grade_only;
  const max = Number(draft.max_marks);
  const pass = Number(draft.pass_marks);
  // A grade-only subject is awarded a letter, so its paper total and pass mark are
  // not used; they are still stored so switching the toggle back is lossless.
  if (!gradeOnly) {
    if (!Number.isFinite(max) || max <= 0) return { error: 'Total marks must be a number greater than zero.' };
    if (!Number.isFinite(pass) || pass < 0) return { error: 'Pass marks must be zero or more.' };
    if (pass > max) return { error: 'Pass marks cannot be more than the total marks.' };
  }

  const order = Number(draft.sort_order);
  if (!Number.isInteger(order) || order < 0) return { error: 'Sort order must be a whole number of zero or more.' };

  try {
    const payload = {
      exam_type_id: draft.exam_type_id,
      class_name: className,
      subject_name: subject,
      max_marks: gradeOnly ? (Number.isFinite(max) && max > 0 ? max : 100) : max,
      pass_marks: gradeOnly ? 0 : pass,
      is_compulsory: draft.is_compulsory,
      is_grade_only: gradeOnly,
      is_optional: draft.is_optional,
      sort_order: order,
      updated_at: new Date().toISOString(),
    };
    const { error } = id
      ? await supabase.from('school_exam_subjects').update(payload).eq('id', id)
      : await supabase.from('school_exam_subjects').insert(payload);
    if (error) {
      return {
        error: error.code === '23505'
          ? 'That subject is already listed for this class and exam.'
          : 'The subject could not be saved. Please try again.',
      };
    }
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function deleteExamSubject(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_exam_subjects').delete().eq('id', id);
    if (error) return { error: 'The subject could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function fetchExamMarks(examTypeId: string): Promise<{ marks: ExamMark[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_exam_marks')
      .select('id, exam_type_id, student_id, subject_id, class_name, obtained_marks, is_absent, paper_a_marks, paper_b_marks, grade')
      .eq('exam_type_id', examTypeId);
    if (error) return { marks: [], error: 'The marks for this exam could not be loaded.' };
    return { marks: (data ?? []).map((row) => normaliseMark(row as Record<string, unknown>)), error: null };
  } catch {
    return { marks: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// Only the papers that were actually filled in are written. A blank cell is left
// alone so an untouched subject stays unmarked instead of being stored as a zero,
// which would then be read as a failed paper on the report card. A grade-only
// subject carries its letter instead of a number.
export async function saveStudentMarks(params: {
  examTypeId: string;
  studentId: string;
  className: string;
  entries: MarkEntry[];
  enteredBy: string | null;
  paperSplit: boolean;
}): Promise<{ error: string | null }> {
  const rows = params.entries
    .filter((entry) => entry.absent || entry.obtained.trim() !== '' || entry.grade.trim() !== '')
    .map((entry) => {
      const grade = entry.grade.trim();
      const gradeOnly = grade !== '';
      const obtained = entry.obtained.trim();
      return {
        exam_type_id: params.examTypeId,
        student_id: params.studentId,
        subject_id: entry.subject_id,
        class_name: params.className,
        obtained_marks: entry.absent || gradeOnly || obtained === '' ? null : Number(obtained),
        is_absent: entry.absent,
        grade: entry.absent || !gradeOnly ? null : grade,
        // The per-paper figures only exist on a split subject; they are cleared
        // otherwise so an old breakdown can never survive a toggle.
        paper_a_marks: params.paperSplit && !entry.absent && entry.paper_a.trim() !== '' ? Number(entry.paper_a) : null,
        paper_b_marks: params.paperSplit && !entry.absent && entry.paper_b.trim() !== '' ? Number(entry.paper_b) : null,
        entered_by: params.enteredBy,
        updated_at: new Date().toISOString(),
      };
    });

  if (rows.length === 0) return { error: 'Enter at least one mark before saving.' };

  const invalid = rows.find((row) => !row.is_absent && row.obtained_marks !== null && (!Number.isFinite(row.obtained_marks) || row.obtained_marks < 0));
  if (invalid) return { error: 'Marks must be a number of zero or more.' };

  try {
    const { error } = await supabase
      .from('school_exam_marks')
      .upsert(rows, { onConflict: 'student_id,subject_id' });
    if (error) {
      return {
        error: error.code === '23514'
          ? 'One of the marks is higher than that subject’s total. Please check the figures.'
          : 'The marks could not be saved. Please try again.',
      };
    }
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function clearStudentMarks(studentId: string, subjectIds: string[]): Promise<{ error: string | null }> {
  if (subjectIds.length === 0) return { error: null };
  try {
    const { error } = await supabase
      .from('school_exam_marks')
      .delete()
      .eq('student_id', studentId)
      .in('subject_id', subjectIds);
    if (error) return { error: 'The marks could not be cleared. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// Clears every student's mark for one paper, used when a whole column was entered
// against the wrong subject and needs to be redone.
export async function clearSubjectMarks(examTypeId: string, subjectId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('school_exam_marks')
      .delete()
      .eq('exam_type_id', examTypeId)
      .eq('subject_id', subjectId);
    if (error) return { error: 'The marks could not be cleared. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Results — worked out from the marks, never stored, so a corrected mark shows
// up everywhere at once.
// ---------------------------------------------------------------------------

export type GradeBand = { grade: string; tone: string };

const GRADE_BANDS: { min: number; grade: string; tone: string }[] = [
  { min: 80, grade: 'A+', tone: 'distinction' },
  { min: 70, grade: 'A', tone: 'excellent' },
  { min: 60, grade: 'B', tone: 'good' },
  { min: 50, grade: 'C', tone: 'fair' },
  { min: 40, grade: 'D', tone: 'pass' },
  { min: 0, grade: 'F', tone: 'fail' },
];

export function gradeFor(percentage: number): GradeBand {
  const band = GRADE_BANDS.find((item) => percentage >= item.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1];
  return { grade: band.grade, tone: band.tone };
}

export const gradeTone = (grade: string): string =>
  grade === 'F' ? 'fail' : grade === 'A+' ? 'distinction' : grade === 'A' ? 'excellent' : 'pass';

export type SubjectResult = {
  subject: ExamSubject;
  obtained: number | null;
  isAbsent: boolean;
  percentage: number;
  grade: string;
  failed: boolean;
  entered: boolean;
  paperA: number | null;
  paperB: number | null;
  gradeOnly: boolean;
  assignedGrade: string | null;
  compulsory: boolean;
  optional: boolean;
};

export type StudentResult = {
  student: Student;
  subjects: SubjectResult[];
  gradeOnlySubjects: SubjectResult[];
  totalMax: number;
  totalObtained: number;
  percentage: number;
  grade: string;
  gradeTone: string;
  failedSubjects: number;
  absentSubjects: number;
  enteredCount: number;
  complete: boolean;
  status: 'pass' | 'fail' | 'incomplete';
  position: number | null;
};

// Subjects are shown in their configured order so the report card, the broadsheet
// and the setup table all agree.
const orderedSubjects = (subjects: ExamSubject[]): ExamSubject[] =>
  [...subjects].sort((a, b) => a.sort_order - b.sort_order || a.subject_name.localeCompare(b.subject_name));

function subjectResults(subjects: ExamSubject[], marks: Map<string, ExamMark>): SubjectResult[] {
  return orderedSubjects(subjects).map((subject) => {
    const mark = marks.get(subject.id);
    const entered = Boolean(mark);
    const isAbsent = mark?.is_absent ?? false;

    // A grade-only subject is awarded a letter and never contributes a number.
    if (subject.is_grade_only) {
      const assignedGrade = mark && !isAbsent ? mark.grade : null;
      return {
        subject,
        obtained: null,
        isAbsent,
        percentage: 0,
        grade: assignedGrade ?? '—',
        failed: entered && !isAbsent && assignedGrade === 'F',
        entered,
        paperA: null,
        paperB: null,
        gradeOnly: true,
        assignedGrade,
        compulsory: subject.is_compulsory,
        optional: subject.is_optional,
      };
    }

    const obtained = mark && !mark.is_absent ? mark.obtained_marks : null;
    // An absent paper counts as zero towards the total, so the result still adds up.
    const scored = isAbsent ? 0 : obtained;
    const percentage = scored === null || subject.max_marks <= 0 ? 0 : Math.round((scored / subject.max_marks) * 1000) / 10;
    return {
      subject,
      obtained,
      isAbsent,
      percentage,
      grade: gradeFor(percentage).grade,
      failed: entered && scored !== null && scored < subject.pass_marks,
      entered,
      paperA: mark && subject.paper_split ? mark.paper_a_marks : null,
      paperB: mark && subject.paper_split ? mark.paper_b_marks : null,
      gradeOnly: false,
      assignedGrade: null,
      compulsory: subject.is_compulsory,
      optional: subject.is_optional,
    };
  });
}

// The stored passing policy decides the outcome. Grade-only subjects carry no
// number, so they never affect the aggregate; they only fail on an F when they
// are compulsory.
function evaluateStatus(rows: SubjectResult[], percentage: number, complete: boolean, policy: { minPassPercentage: number; passingRule: PassingRule }): StudentResult['status'] {
  if (!complete) return 'incomplete';
  const compulsoryFailed = rows.some((row) => row.compulsory && row.failed);
  const aggregateOk = percentage >= policy.minPassPercentage;
  if (policy.passingRule === 'aggregate') return aggregateOk ? 'pass' : 'fail';
  if (policy.passingRule === 'compulsory') return compulsoryFailed ? 'fail' : 'pass';
  return compulsoryFailed || !aggregateOk ? 'fail' : 'pass';
}

// One result per student for a class, with the class position worked out from the
// same figures that are printed. Grade-only subjects are left out of the totals
// and the ranking, so they cannot move a student's position. Only students who sat
// every paper are ranked, so a half-finished sheet never takes a position away
// from a finished one.
export function buildClassResults(
  students: Student[],
  subjects: ExamSubject[],
  marks: ExamMark[],
  policy: { minPassPercentage: number; passingRule: PassingRule } = { minPassPercentage: 40, passingRule: 'both' },
): StudentResult[] {
  const byStudent = new Map<string, Map<string, ExamMark>>();
  for (const mark of marks) {
    const forStudent = byStudent.get(mark.student_id);
    if (forStudent) forStudent.set(mark.subject_id, mark);
    else byStudent.set(mark.student_id, new Map([[mark.subject_id, mark]]));
  }

  const built = students.map((student) => {
    const rows = subjectResults(subjects, byStudent.get(student.id) ?? new Map());
    const numericRows = rows.filter((row) => !row.gradeOnly);
    const gradeOnlyRows = rows.filter((row) => row.gradeOnly);
    const totalMax = numericRows.reduce((sum, row) => sum + row.subject.max_marks, 0);
    const totalObtained = numericRows.reduce((sum, row) => {
      if (!row.entered) return sum;
      return sum + (row.isAbsent ? 0 : row.obtained ?? 0);
    }, 0);
    const enteredCount = rows.filter((row) => row.entered).length;
    const failedSubjects = rows.filter((row) => row.failed).length;
    const absentSubjects = rows.filter((row) => row.isAbsent).length;
    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 1000) / 10 : 0;
    const complete = subjects.length > 0 && enteredCount === subjects.length;
    const band = gradeFor(percentage);
    return {
      student,
      subjects: rows,
      gradeOnlySubjects: gradeOnlyRows,
      totalMax,
      totalObtained,
      percentage,
      grade: band.grade,
      gradeTone: band.tone,
      failedSubjects,
      absentSubjects,
      enteredCount,
      complete,
      status: evaluateStatus(rows, percentage, complete, policy),
      position: null as number | null,
    };
  });

  const ranked = built
    .filter((row) => row.complete)
    .sort((a, b) => b.percentage - a.percentage);
  let lastPercentage: number | null = null;
  let lastPosition = 0;
  ranked.forEach((row, index) => {
    const position = lastPercentage !== null && row.percentage === lastPercentage ? lastPosition : index + 1;
    row.position = position;
    lastPercentage = row.percentage;
    lastPosition = position;
  });

  return built;
}

export const resultStatusLabel = (status: StudentResult['status']) =>
  status === 'pass' ? 'Passed' : status === 'fail' ? 'Needs improvement' : 'Marks pending';

// "English (A: 42 + B: 45)" for a split subject, "English" otherwise. The full text
// is what the report card prints next to the subject name.
export function subjectResultLabel(result: SubjectResult): string {
  if (!result.subject.paper_split) return result.subject.subject_name;
  const part = (value: number | null) => (value === null ? '—' : String(value));
  return `${result.subject.subject_name} (A: ${part(result.paperA)} + B: ${part(result.paperB)})`;
}
