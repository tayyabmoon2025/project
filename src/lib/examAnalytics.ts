import type { Student } from '@/lib/schoolTypes';
import {
  buildClassResults,
  gradeFor,
  type ExamMark,
  type ExamSubject,
  type ExamType,
  type PassingRule,
  type StudentResult,
} from '@/lib/exams';

// Every report in the Exam Reports tab is worked out from marks that are already
// stored. Nothing here is written back to the database, so a corrected mark changes
// every report at once and no two reports can disagree.

export type PassingPolicy = { minPassPercentage: number; passingRule: PassingRule };

export type ExamPart = { exam: ExamType; subjects: ExamSubject[]; marks: ExamMark[] };

export const EMPTY_POLICY: PassingPolicy = { minPassPercentage: 40, passingRule: 'both' };

// The classes that actually have students, so a dropdown can never offer an empty one.
export function activeClassNames(students: Student[]): string[] {
  return Array.from(new Set(students.filter((student) => student.status === 'active').map((student) => student.class_name))).sort();
}

// Roll number order first, because that is how a teacher reads a printed sheet. A
// student without a roll number falls back to their name so the order is still stable.
export function classRoster(students: Student[], className: string): Student[] {
  return students
    .filter((student) => student.status === 'active' && student.class_name === className)
    .sort((a, b) => {
      const left = a.roll_number?.trim();
      const right = b.roll_number?.trim();
      if (left && right) {
        const compared = left.localeCompare(right, undefined, { numeric: true });
        if (compared !== 0) return compared;
      } else if (left) return -1;
      else if (right) return 1;
      return a.full_name.localeCompare(b.full_name);
    });
}

export const subjectsForClass = (subjects: ExamSubject[], className: string): ExamSubject[] =>
  subjects.filter((subject) => subject.class_name === className);

export const round1 = (value: number) => Math.round(value * 10) / 10;

export function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export const percentOf = (part: number, whole: number): number => (whole <= 0 ? 0 : round1((part / whole) * 100));

// ---------------------------------------------------------------------------
// Cumulative result sheet — several terms added into one annual total
// ---------------------------------------------------------------------------

export type CumulativeTerm = {
  examId: string;
  examName: string;
  totalMax: number;
  totalObtained: number;
  percentage: number;
  grade: string;
  complete: boolean;
};

export type CumulativeRow = {
  student: Student;
  terms: CumulativeTerm[];
  totalMax: number;
  totalObtained: number;
  percentage: number;
  grade: string;
  gradeTone: string;
  complete: boolean;
  position: number | null;
};

// Adds each term's marks together into one annual figure. Only terms that actually
// have subjects for this class count, so a class that did not sit an exam is not
// penalised by a missing term. A student is only ranked once every counted term is
// complete, so a half-entered sheet never takes a position from a finished one.
export function buildCumulativeRows(params: {
  students: Student[];
  parts: ExamPart[];
  policy: PassingPolicy;
}): CumulativeRow[] {
  const counted = params.parts.filter((part) => part.subjects.length > 0);
  const perPart = counted.map((part) => ({
    exam: part.exam,
    results: new Map(buildClassResults(params.students, part.subjects, part.marks, params.policy).map((row) => [row.student.id, row])),
  }));

  const rows: CumulativeRow[] = params.students.map((student) => {
    const terms: CumulativeTerm[] = perPart.map((part) => {
      const result = part.results.get(student.id);
      return {
        examId: part.exam.id,
        examName: part.exam.name,
        totalMax: result?.totalMax ?? 0,
        totalObtained: result?.totalObtained ?? 0,
        percentage: result?.percentage ?? 0,
        grade: result?.grade ?? '—',
        complete: result?.complete ?? false,
      };
    });
    const totalMax = terms.reduce((sum, term) => sum + term.totalMax, 0);
    const totalObtained = terms.reduce((sum, term) => sum + term.totalObtained, 0);
    const percentage = percentOf(totalObtained, totalMax);
    const band = gradeFor(percentage);
    const complete = terms.length > 0 && terms.every((term) => term.complete);
    return {
      student,
      terms,
      totalMax,
      totalObtained,
      percentage,
      grade: totalMax > 0 ? band.grade : '—',
      gradeTone: band.tone,
      complete,
      position: null as number | null,
    };
  });

  const ranked = rows.filter((row) => row.complete).sort((a, b) => b.percentage - a.percentage);
  let lastPercentage: number | null = null;
  let lastPosition = 0;
  ranked.forEach((row, index) => {
    const position = lastPercentage !== null && row.percentage === lastPercentage ? lastPosition : index + 1;
    row.position = position;
    lastPercentage = row.percentage;
    lastPosition = position;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Missing marks audit
// ---------------------------------------------------------------------------

export type MissingMarkRow = { student: Student; subject: ExamSubject; kind: 'not_entered' | 'incomplete' };

// Every paper that still has to be filled in before the DMCs are printed: a student
// with no row at all, a number paper left blank, or a grade-only paper with no letter.
export function missingMarksAudit(params: {
  students: Student[];
  subjects: ExamSubject[];
  marks: ExamMark[];
}): MissingMarkRow[] {
  const byKey = new Map(params.marks.map((mark) => [`${mark.student_id}:${mark.subject_id}`, mark]));
  const rows: MissingMarkRow[] = [];
  for (const subject of params.subjects) {
    for (const student of params.students) {
      const mark = byKey.get(`${student.id}:${subject.id}`);
      if (!mark) { rows.push({ student, subject, kind: 'not_entered' }); continue; }
      if (mark.is_absent) continue;
      const incomplete = subject.is_grade_only ? !mark.grade : mark.obtained_marks === null;
      if (incomplete) rows.push({ student, subject, kind: 'incomplete' });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// At-risk and borderline students
// ---------------------------------------------------------------------------

export type AtRiskRow = {
  result: StudentResult;
  failedAny: boolean;
  borderline: boolean;
  gap: number;
  reasons: string[];
};

// Students a teacher should look at before the term ends: anyone who failed a paper,
// anyone whose aggregate fell short, and anyone sitting within `margin` points of the
// pass mark. The margin defaults to ten points because that is the band the school
// asked for.
export function atRiskRows(params: {
  results: StudentResult[];
  policy: PassingPolicy;
  margin?: number;
}): AtRiskRow[] {
  const margin = params.margin ?? 10;
  const rows: AtRiskRow[] = [];
  for (const result of params.results) {
    const failedPapers = result.subjects.filter((row) => row.failed);
    const gap = round1(result.percentage - params.policy.minPassPercentage);
    const failedAny = failedPapers.length > 0 || result.status === 'fail';
    const borderline = result.complete && gap >= 0 && gap <= margin;
    if (!failedAny && !borderline) continue;
    const reasons: string[] = [];
    if (failedPapers.length > 0) reasons.push(`Below the pass mark in ${failedPapers.map((row) => row.subject.subject_name).join(', ')}`);
    if (result.status === 'fail' && failedPapers.length === 0) reasons.push(`Aggregate ${result.percentage}% is under the ${params.policy.minPassPercentage}% pass mark`);
    if (borderline) reasons.push(`Only ${gap}% above the pass mark`);
    if (result.absentSubjects > 0) reasons.push(`Absent in ${result.absentSubjects} ${result.absentSubjects === 1 ? 'paper' : 'papers'}`);
    if (!result.complete && result.enteredCount > 0) reasons.push(`${result.subjects.length - result.enteredCount} paper(s) still to be entered`);
    rows.push({ result, failedAny, borderline, gap, reasons });
  }
  return rows.sort((a, b) => Number(b.failedAny) - Number(a.failedAny) || a.result.percentage - b.result.percentage);
}

// ---------------------------------------------------------------------------
// Term-over-term progress
// ---------------------------------------------------------------------------

export type ProgressRow = {
  student: Student;
  fromPercentage: number;
  toPercentage: number;
  delta: number;
  fromGrade: string;
  toGrade: string;
  status: 'improved' | 'dropped' | 'steady';
};

// Compares the same students between two exams. Only students present in both are
// listed, so a new admission is never shown as a score drop.
export function progressRows(params: { from: StudentResult[]; to: StudentResult[] }): ProgressRow[] {
  const before = new Map(params.from.map((row) => [row.student.id, row]));
  const rows: ProgressRow[] = [];
  for (const row of params.to) {
    const earlier = before.get(row.student.id);
    if (!earlier) continue;
    const delta = round1(row.percentage - earlier.percentage);
    rows.push({
      student: row.student,
      fromPercentage: earlier.percentage,
      toPercentage: row.percentage,
      delta,
      fromGrade: earlier.grade,
      toGrade: row.grade,
      status: delta > 0.05 ? 'improved' : delta < -0.05 ? 'dropped' : 'steady',
    });
  }
  return rows.sort((a, b) => b.delta - a.delta);
}

// ---------------------------------------------------------------------------
// School-wide class comparison
// ---------------------------------------------------------------------------

export type ClassPerformanceRow = {
  className: string;
  students: number;
  completed: number;
  passed: number;
  failed: number;
  conditional: number;
  pending: number;
  passPercentage: number;
  average: number;
  highest: number;
};

export function classPerformanceRows(params: {
  students: Student[];
  subjects: ExamSubject[];
  marks: ExamMark[];
  policy: PassingPolicy;
  conditionalStudentIds: Set<string>;
}): ClassPerformanceRow[] {
  const rows: ClassPerformanceRow[] = [];
  for (const className of activeClassNames(params.students)) {
    const roster = classRoster(params.students, className);
    const subjects = subjectsForClass(params.subjects, className);
    if (subjects.length === 0) continue;
    const results = buildClassResults(roster, subjects, params.marks, params.policy);
    const completed = results.filter((row) => row.complete);
    const passed = results.filter((row) => row.status === 'pass' && !params.conditionalStudentIds.has(row.student.id)).length;
    const conditional = results.filter((row) => params.conditionalStudentIds.has(row.student.id)).length;
    const failed = results.filter((row) => row.status === 'fail' && !params.conditionalStudentIds.has(row.student.id)).length;
    const pending = results.filter((row) => row.status === 'incomplete').length;
    const percentages = completed.map((row) => row.percentage);
    rows.push({
      className,
      students: roster.length,
      completed: completed.length,
      passed,
      failed,
      conditional,
      pending,
      passPercentage: percentOf(passed + conditional, completed.length),
      average: averageOf(percentages),
      highest: percentages.length ? Math.max(...percentages) : 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Teacher performance
// ---------------------------------------------------------------------------

export type SectionTeacher = { class_name: string; section_name: string | null; class_teacher: string | null };

export type TeacherClassRow = {
  teacher: string;
  className: string;
  sectionName: string;
  students: number;
  completed: number;
  passed: number;
  passPercentage: number;
  average: number;
  highest: number;
};

export type TeacherSubjectRow = {
  teacher: string;
  className: string;
  subject: string;
  appeared: number;
  passed: number;
  passPercentage: number;
  average: number;
  highest: number;
};

const UNASSIGNED = 'Not assigned';

// Class-wise: one row per section, credited to the teacher named on that section, with
// the class's pass rate and score spread. Subject-wise: one row per subject taught in
// each of that teacher's classes.
export function teacherPerformanceRows(params: {
  students: Student[];
  subjects: ExamSubject[];
  marks: ExamMark[];
  policy: PassingPolicy;
  sections: SectionTeacher[];
}): { classRows: TeacherClassRow[]; subjectRows: TeacherSubjectRow[] } {
  const classRows: TeacherClassRow[] = [];
  const subjectRows: TeacherSubjectRow[] = [];
  const markIndex = new Map(params.marks.map((mark) => [`${mark.student_id}:${mark.subject_id}`, mark]));

  const classes = activeClassNames(params.students);
  for (const className of classes) {
    const classSubjects = subjectsForClass(params.subjects, className);
    if (classSubjects.length === 0) continue;

    const classResults = buildClassResults(classRoster(params.students, className), classSubjects, params.marks, params.policy);
    const sectionNames = Array.from(new Set(params.students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .map((student) => student.section_name)))
      .sort();

    for (const sectionName of sectionNames) {
      const section = params.sections.find((row) => row.class_name === className && (row.section_name ?? '') === sectionName);
      const teacher = section?.class_teacher?.trim() || UNASSIGNED;
      const inSection = classResults.filter((row) => row.student.section_name === sectionName);
      const completed = inSection.filter((row) => row.complete);
      const passed = inSection.filter((row) => row.status === 'pass').length;
      const percentages = completed.map((row) => row.percentage);
      classRows.push({
        teacher,
        className,
        sectionName,
        students: inSection.length,
        completed: completed.length,
        passed,
        passPercentage: percentOf(passed, completed.length),
        average: averageOf(percentages),
        highest: percentages.length ? Math.max(...percentages) : 0,
      });
    }

    // The subject rows follow the class teacher, because the app records a teacher
    // against a class and section rather than against an individual paper.
    const classTeacher = params.sections.find((row) => row.class_name === className)?.class_teacher?.trim() || UNASSIGNED;
    for (const subject of classSubjects) {
      const scores: number[] = [];
      let appeared = 0;
      let passed = 0;
      for (const student of classRoster(params.students, className)) {
        const mark = markIndex.get(`${student.id}:${subject.id}`);
        if (!mark) continue;
        appeared += 1;
        if (mark.is_absent) continue;
        if (subject.is_grade_only) {
          if (mark.grade && mark.grade !== 'F') passed += 1;
          continue;
        }
        if (mark.obtained_marks === null) continue;
        scores.push(mark.obtained_marks);
        if (mark.obtained_marks >= subject.pass_marks) passed += 1;
      }
      subjectRows.push({
        teacher: classTeacher,
        className,
        subject: subject.subject_name,
        appeared,
        passed,
        passPercentage: percentOf(passed, appeared),
        average: averageOf(scores),
        highest: scores.length ? Math.max(...scores) : 0,
      });
    }
  }

  return {
    classRows: classRows.sort((a, b) => a.teacher.localeCompare(b.teacher) || a.className.localeCompare(b.className)),
    subjectRows: subjectRows.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject)),
  };
}

// ---------------------------------------------------------------------------
// One student's whole academic record
// ---------------------------------------------------------------------------

export type HistorySubjectRow = {
  name: string;
  max: number;
  obtained: number | null;
  grade: string;
  absent: boolean;
  gradeOnly: boolean;
};

export type HistoryTerm = {
  examId: string;
  examName: string;
  className: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalMax: number;
  totalObtained: number;
  percentage: number;
  grade: string;
  gradeTone: string;
  complete: boolean;
  subjects: HistorySubjectRow[];
};

// Every exam the student has sat, oldest first, using the class recorded on the marks
// themselves so a promoted student's earlier years stay under the class they were in.
export function studentAcademicHistory(params: {
  student: Student;
  exams: ExamType[];
  subjects: ExamSubject[];
  marks: ExamMark[];
}): HistoryTerm[] {
  const mine = params.marks.filter((mark) => mark.student_id === params.student.id);
  const terms: HistoryTerm[] = [];

  for (const exam of params.exams) {
    const examMarks = mine.filter((mark) => mark.exam_type_id === exam.id);
    if (examMarks.length === 0) continue;
    const recorded = examMarks.find((mark) => mark.class_name)?.class_name;
    const className = recorded || params.student.class_name;
    const subjects = params.subjects.filter((subject) => subject.exam_type_id === exam.id && subject.class_name === className);
    if (subjects.length === 0) continue;

    const [result] = buildClassResults([params.student], subjects, examMarks, { minPassPercentage: exam.min_pass_percentage, passingRule: exam.passing_rule });
    terms.push({
      examId: exam.id,
      examName: exam.name,
      className,
      periodStart: exam.period_start,
      periodEnd: exam.period_end,
      totalMax: result.totalMax,
      totalObtained: result.totalObtained,
      percentage: result.percentage,
      grade: result.grade,
      gradeTone: result.gradeTone,
      complete: result.complete,
      subjects: result.subjects.map((row) => ({
        name: row.subject.subject_name,
        max: row.subject.max_marks,
        obtained: row.obtained,
        grade: row.grade,
        absent: row.isAbsent,
        gradeOnly: row.gradeOnly,
      })),
    });
  }

  return terms.sort((a, b) => {
    const left = a.periodStart ?? '';
    const right = b.periodStart ?? '';
    if (left && right && left !== right) return left.localeCompare(right);
    return a.examName.localeCompare(b.examName);
  });
}
