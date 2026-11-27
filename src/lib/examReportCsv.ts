import { toCsv } from '@/lib/fees';
import { resultStatusLabel, type ExamSubject, type StudentResult } from '@/lib/exams';
import type { ConditionalPass } from '@/lib/examExtras';
import type { Student } from '@/lib/schoolTypes';
import type {
  AtRiskRow, ClassPerformanceRow, CumulativeRow, HistoryTerm, MissingMarkRow, ProgressRow,
  TeacherClassRow, TeacherSubjectRow,
} from '@/lib/examAnalytics';

// Every report in the Exam Reports tab, in the order they are offered.
export type ReportKind =
  | 'broadsheet' | 'award' | 'merit' | 'summary'
  | 'marksheet-blank' | 'marksheet-filled'
  | 'character-blank' | 'character-filled'
  | 'cumulative-broadsheet' | 'cumulative-dmc'
  | 'grade-only-a4' | 'grade-only-a5'
  | 'history'
  | 'teacher-class' | 'teacher-subject' | 'all-classes'
  | 'missing-marks' | 'at-risk' | 'progress' | 'ptm';

export type ExamReportData = {
  examName: string;
  className: string;
  subjects: ExamSubject[];
  students: Student[];
  roster: Student[];
  results: StudentResult[];
  meritList: StudentResult[];
  decisions: ConditionalPass[];
  decisionByStudent: Map<string, ConditionalPass>;
  cumulative: CumulativeRow[];
  cumulativeExams: string[];
  missing: MissingMarkRow[];
  atRisk: AtRiskRow[];
  atRiskMargin: number;
  progress: ProgressRow[];
  progressFrom: string;
  progressTo: string;
  classPerformance: ClassPerformanceRow[];
  teacherClass: TeacherClassRow[];
  teacherSubject: TeacherSubjectRow[];
  history: { student: Student; terms: HistoryTerm[] } | null;
  passMark: number;
};

export const emptyReportData: ExamReportData = {
  examName: '',
  className: '',
  subjects: [],
  students: [],
  roster: [],
  results: [],
  meritList: [],
  decisions: [],
  decisionByStudent: new Map(),
  cumulative: [],
  cumulativeExams: [],
  missing: [],
  atRisk: [],
  atRiskMargin: 10,
  progress: [],
  progressFrom: '',
  progressTo: '',
  classPerformance: [],
  teacherClass: [],
  teacherSubject: [],
  history: null,
  passMark: 40,
};

const markCell = (row: StudentResult, subject: ExamSubject): string => {
  const entry = row.subjects.find((item) => item.subject.id === subject.id);
  if (!entry || !entry.entered) return '';
  if (entry.gradeOnly) return entry.isAbsent ? 'Abs' : (entry.assignedGrade ?? '');
  return entry.isAbsent ? 'Abs' : String(entry.obtained ?? '');
};

export const safeName = (value: string) => value.replace(/[^\w-]+/g, '_') || 'report';

export function reportFileName(kind: ReportKind, data: ExamReportData): string {
  const exam = safeName(data.examName || 'exam');
  const scope = safeName(data.className || 'all-classes');
  return `${exam}-${scope}-${kind}.csv`;
}

// The rows behind every report, so the CSV is always the same figures the printed
// sheet shows.
export function reportCsvRows(kind: ReportKind, data: ExamReportData): (string | number | null)[][] {
  switch (kind) {
    case 'broadsheet':
    case 'marksheet-blank':
    case 'marksheet-filled': {
      const header = ['Roll No.', 'Admission No.', 'Student', ...data.subjects.map((subject) => subject.subject_name), 'Total', 'Percentage', 'Position', 'Result'];
      const rows = data.results.map((row) => [
        row.student.roll_number || '',
        row.student.admission_number,
        row.student.full_name,
        ...data.subjects.map((subject) => (kind === 'marksheet-blank' ? '' : markCell(row, subject))),
        `${row.totalObtained}/${row.totalMax}`,
        `${row.percentage}%`,
        row.position ? String(row.position) : '',
        resultStatusLabel(row.status),
      ]);
      return [header, ...rows];
    }

    case 'award': {
      const header = ['Roll No.', 'Admission No.', 'Student', 'Subject', 'Total Marks', 'Marks Awarded', 'Grade'];
      const rows: (string | number | null)[][] = [];
      for (const subject of data.subjects) {
        for (const row of data.results) {
          rows.push([
            row.student.roll_number || '',
            row.student.admission_number,
            row.student.full_name,
            subject.subject_name,
            subject.is_grade_only ? 'Grade' : subject.max_marks,
            markCell(row, subject),
            row.subjects.find((item) => item.subject.id === subject.id)?.grade ?? '',
          ]);
        }
      }
      return [header, ...rows];
    }

    case 'merit': {
      const header = ['Position', 'Roll No.', 'Student', 'Total', 'Percentage', 'Grade'];
      return [header, ...data.meritList.map((row, index) => [
        index + 1, row.student.roll_number || '', row.student.full_name,
        `${row.totalObtained}/${row.totalMax}`, `${row.percentage}%`, row.grade,
      ])];
    }

    case 'summary': {
      const header = ['Roll No.', 'Student', 'Status', 'Failed Subjects', 'Percentage'];
      return [header, ...data.results.map((row) => {
        const decision = data.decisionByStudent.get(row.student.id);
        return [
          row.student.roll_number || '',
          row.student.full_name,
          decision ? 'Conditionally Passed' : resultStatusLabel(row.status),
          decision ? decision.failed_subjects : row.subjects.filter((item) => item.failed).map((item) => item.subject.subject_name).join('; '),
          `${row.percentage}%`,
        ];
      })];
    }

    case 'character-blank':
    case 'character-filled': {
      // The ratings are written by hand on the printed sheet, so both the blank and the
      // filled export carry the class list with the four rating columns left open.
      const header = ['Roll No.', 'Admission No.', 'Student', 'Behaviour', 'Cleanliness', 'Character', 'Punctuality', 'Remarks'];
      const rows = data.roster.map((student) => [
        student.roll_number || '',
        student.admission_number,
        student.full_name,
        '', '', '', '', '',
      ]);
      return [header, ...rows];
    }

    case 'cumulative-broadsheet':
    case 'cumulative-dmc': {
      const header = ['Roll No.', 'Admission No.', 'Student', ...data.cumulativeExams, 'Grand Total', 'Percentage', 'Grade', 'Position'];
      const rows = data.cumulative.map((row) => [
        row.student.roll_number || '',
        row.student.admission_number,
        row.student.full_name,
        ...row.terms.map((term) => `${term.totalObtained}/${term.totalMax}`),
        `${row.totalObtained}/${row.totalMax}`,
        `${row.percentage}%`,
        row.grade,
        row.position ? String(row.position) : '',
      ]);
      return [header, ...rows];
    }

    case 'grade-only-a4':
    case 'grade-only-a5': {
      const header = ['Roll No.', 'Admission No.', 'Student', ...data.subjects.map((subject) => subject.subject_name), 'Overall Grade', 'Position'];
      const rows = data.results.map((row) => [
        row.student.roll_number || '',
        row.student.admission_number,
        row.student.full_name,
        ...data.subjects.map((subject) => {
          const entry = row.subjects.find((item) => item.subject.id === subject.id);
          if (!entry || !entry.entered) return '';
          return entry.isAbsent ? 'Abs' : entry.gradeOnly ? (entry.assignedGrade ?? '') : entry.grade;
        }),
        row.grade,
        row.position ? String(row.position) : '',
      ]);
      return [header, ...rows];
    }

    case 'history': {
      const header = ['Exam', 'Class', 'Period', 'Subject', 'Max Marks', 'Obtained', 'Grade', 'Total', 'Percentage', 'Overall Grade'];
      const rows: (string | number | null)[][] = [];
      const terms = data.history?.terms ?? [];
      for (const term of terms) {
        for (const subject of term.subjects) {
          rows.push([
            term.examName, term.className,
            [term.periodStart, term.periodEnd].filter(Boolean).join(' to '),
            subject.name, subject.gradeOnly ? 'Grade' : subject.max,
            subject.absent ? 'Absent' : subject.gradeOnly ? subject.grade : (subject.obtained ?? ''),
            subject.grade,
            `${term.totalObtained}/${term.totalMax}`, `${term.percentage}%`, term.grade,
          ]);
        }
      }
      return [header, ...rows];
    }

    case 'teacher-class': {
      const header = ['Teacher', 'Class', 'Section', 'Students', 'Complete', 'Passed', 'Pass %', 'Average %', 'Highest %'];
      return [header, ...data.teacherClass.map((row) => [
        row.teacher, row.className, row.sectionName, row.students, row.completed, row.passed,
        `${row.passPercentage}%`, `${row.average}%`, `${row.highest}%`,
      ])];
    }

    case 'teacher-subject': {
      const header = ['Class Teacher', 'Class', 'Subject', 'Appeared', 'Passed', 'Pass %', 'Average', 'Highest'];
      return [header, ...data.teacherSubject.map((row) => [
        row.teacher, row.className, row.subject, row.appeared, row.passed,
        `${row.passPercentage}%`, row.average, row.highest,
      ])];
    }

    case 'all-classes': {
      const header = ['Class', 'Students', 'Complete', 'Passed', 'Conditional', 'Failed', 'Pending', 'Pass %', 'Average %', 'Highest %'];
      return [header, ...data.classPerformance.map((row) => [
        row.className, row.students, row.completed, row.passed, row.conditional, row.failed, row.pending,
        `${row.passPercentage}%`, `${row.average}%`, `${row.highest}%`,
      ])];
    }

    case 'missing-marks': {
      const header = ['Class', 'Roll No.', 'Student', 'Subject', 'Issue'];
      return [header, ...data.missing.map((row) => [
        row.student.class_name, row.student.roll_number || '', row.student.full_name, row.subject.subject_name,
        row.kind === 'not_entered' ? 'No marks entered' : 'Marks incomplete',
      ])];
    }

    case 'at-risk': {
      const header = ['Roll No.', 'Student', 'Percentage', 'Grade', 'Gap to pass mark', 'Reason'];
      return [header, ...data.atRisk.map((row) => [
        row.result.student.roll_number || '', row.result.student.full_name, `${row.result.percentage}%`,
        row.result.grade, `${row.gap}%`, row.reasons.join(' | '),
      ])];
    }

    case 'progress': {
      const header = ['Roll No.', 'Student', `Grade in ${data.progressFrom}`, `% in ${data.progressFrom}`, `Grade in ${data.progressTo}`, `% in ${data.progressTo}`, 'Change', 'Direction'];
      return [header, ...data.progress.map((row) => [
        row.student.roll_number || '', row.student.full_name,
        row.fromGrade, `${row.fromPercentage}%`, row.toGrade, `${row.toPercentage}%`,
        `${row.delta > 0 ? '+' : ''}${row.delta}%`,
        row.status === 'improved' ? 'Improved' : row.status === 'dropped' ? 'Dropped' : 'Steady',
      ])];
    }

    case 'ptm': {
      const header = ['Roll No.', 'Admission No.', 'Student', 'Total', 'Percentage', 'Grade', 'Parent Signature'];
      return [header, ...data.results.map((row) => [
        row.student.roll_number || '', row.student.admission_number, row.student.full_name,
        `${row.totalObtained}/${row.totalMax}`, `${row.percentage}%`, row.grade, '',
      ])];
    }
  }
}

export const reportCsvText = (kind: ReportKind, data: ExamReportData) => toCsv(reportCsvRows(kind, data));
