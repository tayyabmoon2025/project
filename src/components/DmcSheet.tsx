import { Printer } from 'lucide-react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatPercentage } from '@/lib/attendance';
import type { AttendanceSummary } from '@/lib/attendance';
import type { DmcDraft, DmcMarksRow } from '@/lib/dmc';
import type { Student } from '@/lib/schoolTypes';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { StudentPhoto } from '@/components/StudentPhoto';

const formatDay = (value: string) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—');

export function DmcSheet({ student, draft, summary, schoolDays, marks }: {
  student: Student;
  draft: DmcDraft;
  summary: AttendanceSummary;
  schoolDays: number;
  marks: DmcMarksRow[];
}) {
  const filledMarks = marks.filter((row) => row.subject.trim() || row.total_marks.trim() || row.obtained_marks.trim());
  const totalPossible = filledMarks.reduce((sum, row) => sum + (Number(row.total_marks) || 0), 0);
  const totalObtained = filledMarks.reduce((sum, row) => sum + (Number(row.obtained_marks) || 0), 0);

  // The certificate is portalled to <body> so the printed page contains the
  // document only, never the surrounding app screens.
  const printSheet = usePrintSheet(true, (
    <section className="print-only print-dmc-sheet" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Detailed Marks Certificate</p>
        </div>
        <div className="print-header-admitted">
          <span>Session</span>
          <strong>{draft.session || '—'}</strong>
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
            <div className="print-row"><span className="print-row-label">Term</span><span className="print-row-value">{draft.term || '—'}</span></div>
            <div className="print-row"><span className="print-row-label">Period</span><span className="print-row-value">{formatDay(draft.period_start)} — {formatDay(draft.period_end)}</span></div>
            <div className="print-row"><span className="print-row-label">Issued on</span><span className="print-row-value">{new Date().toLocaleDateString()}</span></div>
          </div>
        </div>
      </div>

      <div className="print-fee-section print-dmc-marks">
        <h2>Marks Obtained</h2>
        <table className="print-dmc-table">
          <thead>
            <tr><th>Subject</th><th>Total Marks</th><th>Marks Obtained</th></tr>
          </thead>
          <tbody>
            {filledMarks.length ? filledMarks.map((row, index) => (
              <tr key={`${row.subject}-${index}`}>
                <td>{row.subject || '—'}</td>
                <td>{row.total_marks || '—'}</td>
                <td>{row.obtained_marks || '—'}</td>
              </tr>
            )) : <tr><td>—</td><td>—</td><td>—</td></tr>}
          </tbody>
          {filledMarks.length ? (
            <tfoot>
              <tr><td>Total</td><td>{totalPossible}</td><td>{totalObtained}</td></tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="print-fee-section print-dmc-attendance">
        <h2>Attendance Summary</h2>
        <div className="print-dmc-attendance-grid">
          <div className="print-row print-dmc-school-days"><span className="print-row-label">Total school days</span><span className="print-row-value">{schoolDays}</span></div>
          <div className="print-row"><span className="print-row-label">Days counted for the student</span><span className="print-row-value">{summary.total}</span></div>
          <div className="print-row"><span className="print-row-label">Present days</span><span className="print-row-value">{summary.present}</span></div>
          <div className="print-row"><span className="print-row-label">Absent days</span><span className="print-row-value">{summary.absent}</span></div>
          <div className="print-row"><span className="print-row-label">Late arrivals</span><span className="print-row-value">{summary.late}</span></div>
          <div className="print-row print-dmc-percentage"><span className="print-row-label">Attendance percentage</span><span className="print-row-value">{formatPercentage(summary.percentage)}</span></div>
        </div>
        {draft.remarks ? <p className="print-dmc-remarks">{draft.remarks}</p> : null}
      </div>

      <div className="print-signatures">
        <div className="print-signature"><span>Class Teacher</span></div>
        <div className="print-signature"><span>Principal</span></div>
      </div>
    </section>
  ));

  return (
    <>
      <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print DMC</button>
      {printSheet}
    </>
  );
}
