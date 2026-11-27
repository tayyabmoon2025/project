import { supabase } from '@/lib/supabase';
import { normaliseMark, normaliseSubject, type ExamMark, type ExamSubject, type ExamType } from '@/lib/exams';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatesheetEntry = {
  id: string;
  exam_type_id: string;
  class_name: string;
  exam_date: string;
  weekday: string | null;
  subject_name: string;
  start_time: string | null;
  end_time: string | null;
  room_number: string | null;
};

export type DatesheetDraft = {
  exam_date: string;
  subject_name: string;
  start_time: string;
  end_time: string;
  room_number: string;
};

export type GradeRemark = {
  id: string;
  grade: string;
  remark: string;
};

export type ConditionalPass = {
  id: string;
  exam_type_id: string;
  student_id: string;
  failed_subjects: string;
  condition_note: string;
  decision_by: string | null;
};

export type ClassTest = {
  id: string;
  title: string;
  test_date: string;
  class_name: string;
  subject_name: string;
  max_marks: number;
};

export type ClassTestMark = {
  id: string;
  test_id: string;
  student_id: string;
  obtained_marks: number | null;
  is_absent: boolean;
};

export type BoardResult = {
  id: string;
  student_id: string;
  class_name: string;
  board_name: string;
  exam_year: number;
  board_roll_number: string;
  total_marks: number;
  obtained_marks: number;
  grade_division: string | null;
};

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const trimmed = (value: string) => value.trim();

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

const normaliseDatesheet = (row: Record<string, unknown>): DatesheetEntry => ({
  id: String(row.id),
  exam_type_id: String(row.exam_type_id),
  class_name: String(row.class_name ?? ''),
  exam_date: String(row.exam_date).slice(0, 10),
  weekday: row.weekday === null || row.weekday === undefined ? null : String(row.weekday),
  subject_name: String(row.subject_name ?? ''),
  start_time: row.start_time === null || row.start_time === undefined ? null : String(row.start_time),
  end_time: row.end_time === null || row.end_time === undefined ? null : String(row.end_time),
  room_number: row.room_number === null || row.room_number === undefined ? null : String(row.room_number),
});

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weekdayFor = (date: string): string => {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAY_LONG[parsed.getDay()];
};

// ---------------------------------------------------------------------------
// Date sheet
// ---------------------------------------------------------------------------

export async function fetchDatesheet(examTypeId: string, className: string): Promise<{ entries: DatesheetEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_exam_datesheet')
      .select('id, exam_type_id, class_name, exam_date, weekday, subject_name, start_time, end_time, room_number')
      .eq('exam_type_id', examTypeId)
      .eq('class_name', className)
      .order('exam_date')
      .order('subject_name');
    if (error) return { entries: [], error: 'The date sheet could not be loaded.' };
    return { entries: (data ?? []).map((row) => normaliseDatesheet(row as Record<string, unknown>)), error: null };
  } catch {
    return { entries: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function fetchAllDatesheets(examTypeId: string): Promise<{ entries: DatesheetEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_exam_datesheet')
      .select('id, exam_type_id, class_name, exam_date, weekday, subject_name, start_time, end_time, room_number')
      .eq('exam_type_id', examTypeId)
      .order('exam_date')
      .order('subject_name');
    if (error) return { entries: [], error: 'The date sheets could not be loaded.' };
    return { entries: (data ?? []).map((row) => normaliseDatesheet(row as Record<string, unknown>)), error: null };
  } catch {
    return { entries: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// Special row that blocks a day: no timing, no room, prints as its own label.
export const OFF_LABEL = 'OFF / Holiday';
const isOffLabel = (value: string) => trimmed(value).toUpperCase() === OFF_LABEL.toUpperCase();

// Saves the whole sheet for one class in one pass: every kept paper is rewritten
// from the editor, so no conflict clause is needed (the unique index uses SQL
// expressions and cannot be targeted by the client's onConflict).
export async function saveDatesheet(
  examTypeId: string,
  className: string,
  drafts: (DatesheetDraft & { id: string | null })[],
): Promise<{ error: string | null }> {
  const filled = drafts.filter((draft) => trimmed(draft.subject_name) !== '' && trimmed(draft.exam_date) !== '');
  const rows = filled.map((draft) => {
    const off = isOffLabel(draft.subject_name);
    return {
      exam_type_id: examTypeId,
      class_name: className,
      exam_date: draft.exam_date,
      weekday: weekdayFor(draft.exam_date),
      subject_name: off ? OFF_LABEL : trimmed(draft.subject_name),
      start_time: off ? null : trimmed(draft.start_time) || '08:30',
      end_time: off ? null : trimmed(draft.end_time) || '11:30',
      room_number: off ? null : trimmed(draft.room_number) || null,
      updated_at: new Date().toISOString(),
    };
  });

  try {
    const { error: deleteError } = await supabase
      .from('school_exam_datesheet')
      .delete()
      .eq('exam_type_id', examTypeId)
      .eq('class_name', className);
    if (deleteError) return { error: `The date sheet could not be updated: ${deleteError.message}` };
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('school_exam_datesheet').insert(rows);
      if (insertError) return { error: `The date sheet could not be saved: ${insertError.message}` };
    }
    return { error: null };
  } catch (err) {
    return { error: `Could not reach the school server: ${err instanceof Error ? err.message : 'check your connection and try again.'}` };
  }
}

// ---------------------------------------------------------------------------
// Grade remarks bank
// ---------------------------------------------------------------------------

export async function fetchGradeRemarks(): Promise<{ remarks: GradeRemark[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_grade_remarks')
      .select('id, grade, remark')
      .order('grade');
    if (error) return { remarks: [], error: 'The remarks bank could not be loaded.' };
    return {
      remarks: (data ?? []).map((row) => ({
        id: String(row.id),
        grade: String(row.grade ?? ''),
        remark: String(row.remark ?? ''),
      })),
      error: null,
    };
  } catch {
    return { remarks: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveGradeRemark(id: string, remark: string): Promise<{ error: string | null }> {
  const value = trimmed(remark);
  if (value.length < 3) return { error: 'Please write a remark of at least 3 characters.' };
  if (value.length > 300) return { error: 'The remark cannot be longer than 300 characters.' };
  try {
    const { error } = await supabase
      .from('school_grade_remarks')
      .update({ remark: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { error: 'The remark could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// A custom quick-pick remark that is not tied to one grade.
export async function addGradeRemark(grade: string, remark: string): Promise<{ error: string | null }> {
  const value = trimmed(remark);
  const letter = trimmed(grade).toUpperCase();
  if (!letter) return { error: 'Please write the grade this remark belongs to (for example A+ or B).' };
  if (value.length < 3) return { error: 'Please write a remark of at least 3 characters.' };
  try {
    const { error } = await supabase.from('school_grade_remarks').insert({ grade: letter, remark: value });
    if (error) {
      return {
        error: error.code === '23505'
          ? `A remark for grade ${letter} already exists. Edit it instead.`
          : 'The remark could not be added. Please try again.',
      };
    }
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function deleteGradeRemark(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_grade_remarks').delete().eq('id', id);
    if (error) return { error: 'The remark could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Conditional pass
// ---------------------------------------------------------------------------

export async function fetchConditionalPasses(examTypeId: string): Promise<{ decisions: ConditionalPass[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_conditional_pass')
      .select('id, exam_type_id, student_id, failed_subjects, condition_note, decision_by')
      .eq('exam_type_id', examTypeId);
    if (error) return { decisions: [], error: 'The conditional pass list could not be loaded.' };
    return {
      decisions: (data ?? []).map((row) => ({
        id: String(row.id),
        exam_type_id: String(row.exam_type_id),
        student_id: String(row.student_id),
        failed_subjects: String(row.failed_subjects ?? ''),
        condition_note: String(row.condition_note ?? ''),
        decision_by: row.decision_by === null || row.decision_by === undefined ? null : String(row.decision_by),
      })),
      error: null,
    };
  } catch {
    return { decisions: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function decideConditionalPass(params: {
  examTypeId: string;
  studentId: string;
  failedSubjects: string;
  conditionNote: string;
}): Promise<{ error: string | null }> {
  const note = trimmed(params.conditionNote);
  if (note.length < 3) return { error: 'Please write the condition the student must meet.' };
  try {
    const { error } = await supabase
      .from('school_conditional_pass')
      .upsert({
        exam_type_id: params.examTypeId,
        student_id: params.studentId,
        failed_subjects: trimmed(params.failedSubjects),
        condition_note: note,
        decision_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'exam_type_id,student_id' });
    if (error) return { error: 'The conditional pass could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function removeConditionalPass(decisionId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_conditional_pass').delete().eq('id', decisionId);
    if (error) return { error: 'The conditional pass could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Class tests (weekly / monthly)
// ---------------------------------------------------------------------------

export async function fetchClassTests(className: string): Promise<{ tests: ClassTest[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_class_tests')
      .select('id, title, test_date, class_name, subject_name, max_marks')
      .eq('class_name', className)
      .order('test_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return { tests: [], error: 'The class tests could not be loaded.' };
    return {
      tests: (data ?? []).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        test_date: String(row.test_date).slice(0, 10),
        class_name: String(row.class_name ?? ''),
        subject_name: String(row.subject_name ?? ''),
        max_marks: numberOr(row.max_marks, 10),
      })),
      error: null,
    };
  } catch {
    return { tests: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveClassTest(params: {
  id: string | null;
  title: string;
  testDate: string;
  className: string;
  subjectName: string;
  maxMarks: string;
}): Promise<{ error: string | null }> {
  const title = trimmed(params.title);
  if (title.length < 2) return { error: 'Please give the test a title of at least 2 characters.' };
  if (!trimmed(params.testDate)) return { error: 'Please pick the date of the test.' };
  if (!trimmed(params.className)) return { error: 'Please choose the class.' };
  if (!trimmed(params.subjectName)) return { error: 'Please write the subject.' };
  const max = Number(params.maxMarks);
  if (!Number.isFinite(max) || max <= 0) return { error: 'The test total must be a number greater than zero.' };
  try {
    const payload = {
      title,
      test_date: params.testDate,
      class_name: trimmed(params.className),
      subject_name: trimmed(params.subjectName),
      max_marks: max,
      updated_at: new Date().toISOString(),
    };
    const { error } = params.id
      ? await supabase.from('school_class_tests').update(payload).eq('id', params.id)
      : await supabase.from('school_class_tests').insert(payload);
    if (error) return { error: 'The test could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function deleteClassTest(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_class_tests').delete().eq('id', id);
    if (error) return { error: 'The test could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function fetchClassTestMarks(testId: string): Promise<{ marks: ClassTestMark[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_class_test_marks')
      .select('id, test_id, student_id, obtained_marks, is_absent')
      .eq('test_id', testId);
    if (error) return { marks: [], error: 'The test marks could not be loaded.' };
    return {
      marks: (data ?? []).map((row) => ({
        id: String(row.id),
        test_id: String(row.test_id),
        student_id: String(row.student_id),
        obtained_marks: row.obtained_marks === null || row.obtained_marks === undefined ? null : numberOr(row.obtained_marks),
        is_absent: Boolean(row.is_absent),
      })),
      error: null,
    };
  } catch {
    return { marks: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveClassTestMarks(params: {
  testId: string;
  entries: { studentId: string; obtained: string; absent: boolean; maxMarks: number }[];
}): Promise<{ error: string | null }> {
  const rows = params.entries
    .filter((entry) => entry.absent || entry.obtained.trim() !== '')
    .map((entry) => {
      const value = Number(entry.obtained);
      return {
        test_id: params.testId,
        student_id: entry.studentId,
        obtained_marks: entry.absent ? null : Number.isFinite(value) ? value : null,
        is_absent: entry.absent,
        updated_at: new Date().toISOString(),
      };
    });
  const invalid = params.entries.find((entry) => {
    if (entry.absent) return false;
    if (entry.obtained.trim() === '') return false;
    const value = Number(entry.obtained);
    return !Number.isFinite(value) || value < 0 || value > entry.maxMarks;
  });
  if (invalid) return { error: 'A mark is above the test total. Please check the figures.' };
  if (rows.length === 0) return { error: null };
  try {
    const { error } = await supabase
      .from('school_class_test_marks')
      .upsert(rows, { onConflict: 'test_id,student_id' });
    if (error) return { error: 'The test marks could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Board results
// ---------------------------------------------------------------------------

export async function fetchBoardResults(): Promise<{ results: BoardResult[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_board_results')
      .select('id, student_id, class_name, board_name, exam_year, board_roll_number, total_marks, obtained_marks, grade_division')
      .order('exam_year', { ascending: false });
    if (error) return { results: [], error: 'The board results could not be loaded.' };
    return {
      results: (data ?? []).map((row) => ({
        id: String(row.id),
        student_id: String(row.student_id),
        class_name: String(row.class_name ?? ''),
        board_name: String(row.board_name ?? ''),
        exam_year: numberOr(row.exam_year),
        board_roll_number: String(row.board_roll_number ?? ''),
        total_marks: numberOr(row.total_marks),
        obtained_marks: numberOr(row.obtained_marks),
        grade_division: row.grade_division === null || row.grade_division === undefined ? null : String(row.grade_division),
      })),
      error: null,
    };
  } catch {
    return { results: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function saveBoardResult(params: {
  id: string | null;
  studentId: string;
  className: string;
  boardName: string;
  examYear: string;
  boardRollNumber: string;
  totalMarks: string;
  obtainedMarks: string;
  gradeDivision: string;
}): Promise<{ error: string | null }> {
  if (!trimmed(params.studentId)) return { error: 'Please choose the student.' };
  if (!trimmed(params.className)) return { error: 'Please write the class.' };
  if (!trimmed(params.boardName)) return { error: 'Please write the board name.' };
  const year = Number(params.examYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Please write a valid exam year.' };
  if (!trimmed(params.boardRollNumber)) return { error: 'Please write the board roll number.' };
  const total = Number(params.totalMarks);
  const obtained = Number(params.obtainedMarks);
  if (!Number.isFinite(total) || total <= 0) return { error: 'The total marks must be a number greater than zero.' };
  if (!Number.isFinite(obtained) || obtained < 0) return { error: 'The obtained marks must be zero or more.' };
  if (obtained > total) return { error: 'The obtained marks cannot be more than the total marks.' };
  try {
    const payload = {
      student_id: params.studentId,
      class_name: trimmed(params.className),
      board_name: trimmed(params.boardName),
      exam_year: year,
      board_roll_number: trimmed(params.boardRollNumber),
      total_marks: total,
      obtained_marks: obtained,
      grade_division: trimmed(params.gradeDivision) || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = params.id
      ? await supabase.from('school_board_results').update(payload).eq('id', params.id)
      : await supabase.from('school_board_results').insert(payload);
    if (error) return { error: 'The board result could not be saved. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function deleteBoardResult(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_board_results').delete().eq('id', id);
    if (error) return { error: 'The board result could not be removed. Please try again.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Shared exam result pieces for the reports tab
// ---------------------------------------------------------------------------

export type ExamBundle = {
  exams: ExamType[];
  subjects: ExamSubject[];
  marks: ExamMark[];
};

// Everything the annual, progress and whole-school reports need in one pass: every
// exam, every subject and every mark. Those reports span terms and classes, so a
// per-exam load would mean one round trip per term.
export async function fetchExamArchive(): Promise<ExamBundle & { error: string | null }> {
  const [examsResult, subjectsResult, marksResult] = await Promise.all([
    supabase.from('school_exam_types').select('id, name, period_start, period_end, sort_order, is_active, min_pass_percentage, passing_rule').order('sort_order').order('name'),
    supabase.from('school_exam_subjects').select('id, exam_type_id, class_name, subject_name, max_marks, pass_marks, paper_split, paper_a_max, paper_b_max, is_compulsory, is_grade_only, is_optional, sort_order').order('class_name').order('sort_order').order('subject_name'),
    supabase.from('school_exam_marks').select('id, exam_type_id, student_id, subject_id, class_name, obtained_marks, is_absent, paper_a_marks, paper_b_marks, grade'),
  ]);
  if (examsResult.error || subjectsResult.error || marksResult.error) {
    return { exams: [], subjects: [], marks: [], error: 'The exam data for the reports could not be loaded.' };
  }
  return {
    exams: (examsResult.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      period_start: row.period_start ?? null,
      period_end: row.period_end ?? null,
      sort_order: numberOr(row.sort_order),
      is_active: row.is_active !== false,
      min_pass_percentage: numberOr(row.min_pass_percentage, 40),
      passing_rule: row.passing_rule === 'aggregate' || row.passing_rule === 'compulsory' || row.passing_rule === 'both' ? row.passing_rule : 'both',
    })),
    subjects: (subjectsResult.data ?? []).map((row) => normaliseSubject(row as Record<string, unknown>)),
    marks: (marksResult.data ?? []).map((row) => normaliseMark(row as Record<string, unknown>)),
    error: null,
  };
}

export async function fetchExamBundle(examTypeId: string): Promise<ExamBundle & { error: string | null }> {
  const [examsResult, subjectsResult, marksResult] = await Promise.all([
    supabase.from('school_exam_types').select('id, name, period_start, period_end, sort_order, is_active, min_pass_percentage, passing_rule').order('sort_order').order('name'),
    supabase.from('school_exam_subjects').select('id, exam_type_id, class_name, subject_name, max_marks, pass_marks, paper_split, paper_a_max, paper_b_max, is_compulsory, is_grade_only, is_optional, sort_order').eq('exam_type_id', examTypeId).order('class_name').order('sort_order').order('subject_name'),
    supabase.from('school_exam_marks').select('id, exam_type_id, student_id, subject_id, class_name, obtained_marks, is_absent, paper_a_marks, paper_b_marks, grade').eq('exam_type_id', examTypeId),
  ]);
  if (examsResult.error || subjectsResult.error || marksResult.error) {
    return { exams: [], subjects: [], marks: [], error: 'The exam data for the reports could not be loaded.' };
  }
  return {
    exams: (examsResult.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      period_start: row.period_start ?? null,
      period_end: row.period_end ?? null,
      sort_order: numberOr(row.sort_order),
      is_active: row.is_active !== false,
      min_pass_percentage: numberOr(row.min_pass_percentage, 40),
      passing_rule: row.passing_rule === 'aggregate' || row.passing_rule === 'compulsory' || row.passing_rule === 'both' ? row.passing_rule : 'both',
    })),
    subjects: (subjectsResult.data ?? []).map((row) => ({
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
    })),
    marks: (marksResult.data ?? []).map((row) => ({
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
    })),
    error: null,
  };
}
