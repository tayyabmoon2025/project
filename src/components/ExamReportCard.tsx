import { Printer } from 'lucide-react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatPercentage } from '@/lib/attendance';
import type { AttendanceSummary } from '@/lib/attendance';
import { resultStatusLabel, subjectResultLabel, passingRuleLabel, type ExamType, type StudentResult } from '@/lib/exams';
import type { ConditionalPass } from '@/lib/examExtras';
import type { Student } from '@/lib/schoolTypes';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { StudentPhoto } from '@/components/StudentPhoto';

const formatDay = (value: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—');

// The report card is portalled to <body> so printing produces the document only,
// never the surrounding app screens. It reuses the same print styles as the DMC.
export function ExamReportCard({ student, exam, result, summary, schoolDays, conditional, remark }: {
  student: Student;
  exam: ExamType;
  result: StudentResult;
  summary: AttendanceSummary;
  schoolDays: number;
  conditional: ConditionalPass | null;
  remark: string;
}) {
  const printSheet = usePrintSheet(true, (
    <section className="print-only print-dmc-sheet" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Report Card — {exam.name}</p>
        </div>
        <div className="print-header-admitted">
          <span>Issued on</span>
          <strong>{new Date().toLocaleDateString()}</strong>
        </div>
      </div>

      <div className="print-layout">
        <div className="print-photo">
          <StudentPhoto src={student.photo_url} name={student.full_name} className="print-photo-img" />
          <strong>{student.full_name}</strong>
        </div>
        <div className="print-columns">
          <div>
            <h2>Student Details</h2>
            <div className="print-row"><span className="print-row-label">Admission no.</span><span className="print-row-value">{student.admission_number}</span></div>
            <div className="print-row"><span className="print-row-label">Father / Guardian</span><span className="print-row-value">{student.fathers_name || student.guardian_name || '—'}</span></div>
            <div className="print-row"><span className="print-row-label">Class</span><span className="print-row-value">{student.class_name} · Section {student.section_name}</span></div>
            <div className="print-row"><span className="print-row-label">Roll number</span><span className="print-row-value">{student.roll_number || '—'}</span></div>
          </div>
          <div>
            <h2>Examination</h2>
            <div className="print-row"><span className="print-row-label">Exam</span><span className="print-row-value">{exam.name}</span></div>
            <div className="print-row"><span className="print-row-label">Period</span><span className="print-row-value">{formatDay(exam.period_start)} — {formatDay(exam.period_end)}</span></div>
            <div className="print-row"><span className="print-row-label">Class position</span><span className="print-row-value">{result.position ? `${result.position}` : '—'}</span></div>
            <div className="print-row"><span className="print-row-label">Result</span><span className="print-row-value">{resultStatusLabel(result.status)}</span></div>
            <div className="print-row"><span className="print-row-label">Passing policy</span><span className="print-row-value">{exam.min_pass_percentage}% · {passingRuleLabel(exam.passing_rule)}</span></div>
          </div>
        </div>
      </div>

      <div className="print-fee-section print-dmc-marks">
        <h2>Marks Obtained</h2>
        <table className="print-dmc-table">
          <thead>
            <tr><th>Subject</th><th>Total Marks</th><th>Marks Obtained</th><th>Percentage</th><th>Grade</th></tr>
          </thead>
          <tbody>
            {result.subjects.map((row) => (
              <tr key={row.subject.id}>
                <td>{subjectResultLabel(row)}</td>
                <td>{row.gradeOnly ? '—' : row.subject.max_marks}</td>
                <td>{row.gradeOnly ? '—' : !row.entered ? '—' : row.isAbsent ? 'Absent' : row.obtained}</td>
                <td>{row.gradeOnly ? '—' : row.entered ? formatPercentage(row.percentage) : '—'}</td>
                <td>{row.entered ? row.grade : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{result.totalMax}</td>
              <td>{result.totalObtained}</td>
              <td>{formatPercentage(result.percentage)}</td>
              <td>{result.grade}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print-fee-section print-dmc-attendance">
        <h2>Attendance Summary</h2>
        {conditional && (
          <div className="print-conditional-stamp">
            <strong>CONDITIONALLY PASSED</strong>
            <span>Failed in: {conditional.failed_subjects}</span>
            <span>Condition: {conditional.condition_note}</span>
          </div>
        )}
        <div className="print-dmc-attendance-grid">
          <div className="print-row print-dmc-school-days"><span className="print-row-label">Total school days</span><span className="print-row-value">{schoolDays}</span></div>
          <div className="print-row"><span className="print-row-label">Days counted for the student</span><span className="print-row-value">{summary.total}</span></div>
          <div className="print-row"><span className="print-row-label">Present days</span><span className="print-row-value">{summary.present}</span></div>
          <div className="print-row"><span className="print-row-label">Absent days</span><span className="print-row-value">{summary.absent}</span></div>
          <div className="print-row"><span className="print-row-label">Late arrivals</span><span className="print-row-value">{summary.late}</span></div>
          <div className="print-row print-dmc-percentage"><span className="print-row-label">Attendance percentage</span><span className="print-row-value">{formatPercentage(summary.percentage)}</span></div>
        </div>
        {result.failedSubjects > 0 ? (
          <p className="print-dmc-remarks">
            {result.failedSubjects} {result.failedSubjects === 1 ? 'subject is' : 'subjects are'} below the pass mark.
          </p>
        ) : null}
        {result.absentSubjects > 0 ? (
          <p className="print-dmc-remarks">
            Absent in {result.absentSubjects} {result.absentSubjects === 1 ? 'subject' : 'subjects'}.
          </p>
        ) : null}
      </div>

      <div className="print-fee-section print-dmc-remarks-section">
        <h2>Class Teacher's Remarks</h2>
        <p className="print-remark-line">{remark || '—'}</p>
      </div>

      <div className="print-signatures">
        <div className="print-signature"><span>Class Teacher</span></div>
        <div className="print-signature"><span>Principal</span></div>
      </div>
    </section>
  ));

  return (
    <>
      <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print report card</button>
      {printSheet}
    </>
  );
}
