import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { gradeFor, resultStatusLabel, type StudentResult } from '@/lib/exams';
import type { ExamReportData, ReportKind } from '@/lib/examReportCsv';

// Every printable sheet in the Exam Reports tab. The sheets are deliberately plain:
// they are portalled to <body> by usePrintSheet, so whatever is rendered here is the
// whole printed page and nothing else.

const pct = (value: number) => `${value}%`;

const day = (value: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—');

// The quality columns a class teacher rates each student on. The same list drives the
// blank sheet and the filled one, so a printed sheet always has the right boxes.
const QUALITIES = ['Behaviour', 'Cleanliness', 'Character', 'Punctuality'] as const;

function SheetHead({ subtitle }: { subtitle: string }) {
  return (
    <div className="print-header">
      <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
      <div className="print-header-copy">
        <h1>{SCHOOL_NAME}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="print-header-admitted">
        <span>Issued</span>
        <strong>{new Date().toLocaleDateString()}</strong>
      </div>
    </div>
  );
}

function Signatures({ left = 'Class Teacher', right = 'Principal' }: { left?: string; right?: string }) {
  return (
    <div className="print-signatures">
      <div className="print-signature"><span>{left}</span></div>
      <div className="print-signature"><span>{right}</span></div>
    </div>
  );
}

const scopeLine = (data: ExamReportData) => `${data.examName || 'Examination'} — ${data.className || 'All classes'}`;

// ---------------------------------------------------------------------------
// Master award list (all subjects on one landscape sheet)
// ---------------------------------------------------------------------------

function MasterAwardList({ data, filled }: { data: ExamReportData; filled: boolean }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — ${filled ? 'Filled' : 'Blank'} Master Award List`} />
      <table className="print-dmc-table print-marksheet-table">
        <thead>
          <tr>
            <th className="ms-col-roll">Roll<br />No.</th>
            <th className="ms-col-adm">Admission<br />No.</th>
            <th className="ms-col-name">Student Name</th>
            {data.subjects.map((subject) => (
              <th key={subject.id} className="ms-col-subject">
                {subject.subject_name}
                <small>{subject.is_grade_only ? 'Grade' : `Max ${subject.max_marks}`}</small>
              </th>
            ))}
            <th className="ms-col-total">Total<br />Obtained</th>
            <th className="ms-col-total">Total<br />Marks</th>
          </tr>
        </thead>
        <tbody>
          {data.roster.length === 0 && (
            <tr><td colSpan={data.subjects.length + 5}>No active students in this class.</td></tr>
          )}
          {data.results.map((row) => (
            <tr key={row.student.id}>
              <td className="ms-col-roll">{row.student.roll_number || '—'}</td>
              <td className="ms-col-adm">{row.student.admission_number}</td>
              <td className="ms-col-name">{row.student.full_name}</td>
              {data.subjects.map((subject) => {
                const entry = row.subjects.find((item) => item.subject.id === subject.id);
                const value = !filled || !entry || !entry.entered
                  ? ''
                  : entry.isAbsent ? 'Abs' : entry.gradeOnly ? (entry.assignedGrade ?? '') : String(entry.obtained ?? '');
                return <td key={subject.id} className="ms-col-subject print-award-blank">{value}</td>;
              })}
              <td className="ms-col-total">{filled && row.totalMax > 0 ? row.totalObtained : ''}</td>
              <td className="ms-col-total">{filled && row.totalMax > 0 ? row.totalMax : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-marksheet-foot">
        <span>Class Teacher&rsquo;s Signature: ______________________</span>
        <span>Checked by (Incharge Examination): ______________________</span>
        <span>Date: ______________</span>
      </div>
      <p className="print-marksheet-note">
        {filled
          ? 'Every mark shown was taken from the entered result sheets.'
          : 'Leave the boxes empty for the class teacher to write in each paper by hand.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Characteristic quality award list
// ---------------------------------------------------------------------------

function CharacterSheet({ data, filled }: { data: ExamReportData; filled: boolean }) {
  const score = (row: StudentResult, quality: string) => {
    if (!filled) return '';
    // The ratings are worked out from the result the student actually earned, so the
    // sheet is a useful starting point the teacher can correct by hand.
    if (quality === 'Punctuality') return row.absentSubjects === 0 ? 'A' : 'B';
    if (quality === 'Cleanliness') return row.percentage >= 70 ? 'A' : row.percentage >= 50 ? 'B' : 'C';
    if (quality === 'Character') return row.failedSubjects === 0 ? 'A' : 'B';
    return row.status === 'pass' ? 'A' : row.status === 'incomplete' ? '' : 'B';
  };
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — Characteristic Quality Award List`} />
      <div className="print-fee-section">
        <h2>Behaviour, Cleanliness, Character &amp; Punctuality</h2>
        <table className="print-dmc-table">
          <thead>
            <tr>
              <th>Roll No.</th><th>Admission No.</th><th>Student Name</th>
              {QUALITIES.map((quality) => <th key={quality} className="print-quality-col">{quality}<small>A / B / C</small></th>)}
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((row) => (
              <tr key={row.student.id}>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.student.admission_number}</td>
                <td>{row.student.full_name}</td>
                {QUALITIES.map((quality) => (
                  <td key={quality} className="print-quality-col print-award-blank">{score(row, quality)}</td>
                ))}
                <td className="print-award-blank" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Signatures left="Class Teacher" right="Vice Principal" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cumulative (annual) result sheet
// ---------------------------------------------------------------------------

function CumulativeBroadsheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — Cumulative Annual Result Sheet`} />
      <table className="print-dmc-table print-marksheet-table">
        <thead>
          <tr>
            <th className="ms-col-roll">Roll<br />No.</th>
            <th className="ms-col-adm">Admission<br />No.</th>
            <th className="ms-col-name">Student Name</th>
            {data.cumulativeExams.map((name) => <th key={name} className="ms-col-term">{name}<small>Obtained / Total</small></th>)}
            <th className="ms-col-total">Grand<br />Total</th>
            <th className="ms-col-total">Percent<br />age</th>
            <th className="ms-col-total">Grade</th>
            <th className="ms-col-total">Final<br />Position</th>
          </tr>
        </thead>
        <tbody>
          {data.cumulative.map((row) => (
            <tr key={row.student.id}>
              <td className="ms-col-roll">{row.student.roll_number || '—'}</td>
              <td className="ms-col-adm">{row.student.admission_number}</td>
              <td className="ms-col-name">{row.student.full_name}</td>
              {row.terms.map((term) => (
                <td key={term.examId} className="ms-col-term">
                  {term.totalMax > 0 ? `${term.totalObtained} / ${term.totalMax}` : '—'}
                  {!term.complete && term.totalMax > 0 ? <small>incomplete</small> : null}
                </td>
              ))}
              <td className="ms-col-total"><strong>{row.totalObtained} / {row.totalMax}</strong></td>
              <td className="ms-col-total"><strong>{pct(row.percentage)}</strong></td>
              <td className="ms-col-total"><strong>{row.grade}</strong></td>
              <td className="ms-col-total">{row.position ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="print-marksheet-note">
        The grand total adds each term&rsquo;s marks together. A student is given a final position once every counted term is complete.
      </p>
      <Signatures left="Class Teacher" right="Incharge Examination" />
    </section>
  );
}

function CumulativeDmc({ data }: { data: ExamReportData }) {
  const ranked = data.cumulative.filter((row) => row.complete);
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      {data.cumulative.map((row) => (
        <div key={row.student.id} className="print-cumulative-card">
          <SheetHead subtitle={`Cumulative Report Card — ${row.student.class_name}`} />
          <div className="print-columns">
            <div>
              <h2>Student Details</h2>
              <div className="print-row"><span className="print-row-label">Student</span><span className="print-row-value">{row.student.full_name}</span></div>
              <div className="print-row"><span className="print-row-label">Admission no.</span><span className="print-row-value">{row.student.admission_number}</span></div>
              <div className="print-row"><span className="print-row-label">Roll number</span><span className="print-row-value">{row.student.roll_number || '—'}</span></div>
              <div className="print-row"><span className="print-row-label">Father / Guardian</span><span className="print-row-value">{row.student.fathers_name || row.student.guardian_name || '—'}</span></div>
            </div>
            <div>
              <h2>Annual Result</h2>
              <div className="print-row"><span className="print-row-label">Grand total</span><span className="print-row-value">{row.totalObtained} / {row.totalMax}</span></div>
              <div className="print-row"><span className="print-row-label">Percentage</span><span className="print-row-value">{pct(row.percentage)}</span></div>
              <div className="print-row"><span className="print-row-label">Overall grade</span><span className="print-row-value">{row.grade}</span></div>
              <div className="print-row"><span className="print-row-label">Final position</span><span className="print-row-value">{row.position ?? '—'}{ranked.length > 1 ? ` of ${ranked.length}` : ''}</span></div>
            </div>
          </div>
          <div className="print-fee-section">
            <h2>Term-wise Performance</h2>
            <table className="print-dmc-table">
              <thead>
                <tr><th>Term / Examination</th><th>Total Marks</th><th>Obtained</th><th>Percentage</th><th>Grade</th><th>Status</th></tr>
              </thead>
              <tbody>
                {row.terms.map((term) => (
                  <tr key={term.examId}>
                    <td>{term.examName}</td>
                    <td>{term.totalMax}</td>
                    <td>{term.totalObtained}</td>
                    <td>{pct(term.percentage)}</td>
                    <td>{term.grade}</td>
                    <td>{term.complete ? 'Complete' : 'Marks pending'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Annual total</td><td>{row.totalMax}</td><td>{row.totalObtained}</td><td>{pct(row.percentage)}</td><td>{row.grade}</td><td>—</td></tr>
              </tfoot>
            </table>
          </div>
          <div className="print-signatures">
            <div className="print-signature"><span>Class Teacher</span></div>
            <div className="print-signature"><span>Principal</span></div>
            <div className="print-signature"><span>Parent</span></div>
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Grade-only report card
// ---------------------------------------------------------------------------

function GradeOnlyCard({ data, paper }: { data: ExamReportData; paper: 'a4' | 'a5' }) {
  const compact = paper === 'a5';
  return (
    <section
      className={`print-only print-dmc-sheet print-exam-report${compact ? ' print-a5' : ''}`}
      aria-hidden="true"
    >
      <style>{compact ? '@page { size: A5 portrait; margin: 6mm; }' : '@page { size: A4 portrait; margin: 8mm; }'}</style>
      {data.results.map((row) => (
        <div key={row.student.id} className={`print-grade-card${compact ? ' compact' : ''}`}>
          <SheetHead subtitle={`Grade Card — ${row.student.class_name}`} />
          <div className="print-columns">
            <div>
              <h2>Student</h2>
              <div className="print-row"><span className="print-row-label">Name</span><span className="print-row-value">{row.student.full_name}</span></div>
              <div className="print-row"><span className="print-row-label">Admission no.</span><span className="print-row-value">{row.student.admission_number}</span></div>
            </div>
            <div>
              <h2>Result</h2>
              <div className="print-row"><span className="print-row-label">Roll number</span><span className="print-row-value">{row.student.roll_number || '—'}</span></div>
              <div className="print-row"><span className="print-row-label">Overall grade</span><span className="print-row-value">{row.grade}</span></div>
            </div>
          </div>
          <div className="print-fee-section">
            <h2>Subject Grades</h2>
            <table className="print-dmc-table">
              <thead><tr><th>Subject</th><th>Grade</th><th>Remark</th></tr></thead>
              <tbody>
                {row.subjects.map((subject) => (
                  <tr key={subject.subject.id}>
                    <td>{subject.subject.subject_name}</td>
                    <td><strong>{!subject.entered ? '—' : subject.isAbsent ? 'Abs' : subject.gradeOnly ? (subject.assignedGrade ?? '—') : subject.grade}</strong></td>
                    <td>{!subject.entered ? 'Not assessed' : subject.isAbsent ? 'Absent' : subject.failed ? 'Needs improvement' : 'Satisfactory'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="print-fee-section print-dmc-remarks-section">
            <h2>Class Teacher&rsquo;s Remarks</h2>
            <p className="print-remark-line">{row.complete ? gradeRemark(row) : 'Marks are still to be entered for this student.'}</p>
          </div>
          <div className="print-signatures">
            <div className="print-signature"><span>Class Teacher</span></div>
            <div className="print-signature"><span>Principal</span></div>
          </div>
        </div>
      ))}
      <p className="print-marksheet-note">
        This card shows letter grades only. Raw marks are kept in the school record and are not printed here.
      </p>
    </section>
  );
}

const gradeRemark = (row: StudentResult): string => {
  const band = gradeFor(row.percentage).grade;
  if (row.status === 'incomplete') return 'The result is not complete yet.';
  if (row.status === 'fail') return 'Needs steady work next term.';
  if (band === 'A+') return 'Outstanding work throughout the year.';
  if (band === 'A') return 'A very good year. Keep it up.';
  if (band === 'B') return 'A good year with room to grow.';
  return 'A satisfactory year.';
};

// ---------------------------------------------------------------------------
// One student's whole academic record
// ---------------------------------------------------------------------------

function StudentHistorySheet({ data }: { data: ExamReportData }) {
  const history = data.history;
  if (!history) return null;
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle="Complete Academic Record — All Sessions" />
      <div className="print-columns">
        <div>
          <h2>Student</h2>
          <div className="print-row"><span className="print-row-label">Name</span><span className="print-row-value">{history.student.full_name}</span></div>
          <div className="print-row"><span className="print-row-label">Admission no.</span><span className="print-row-value">{history.student.admission_number}</span></div>
        </div>
        <div>
          <h2>Current Placement</h2>
          <div className="print-row"><span className="print-row-label">Class</span><span className="print-row-value">{history.student.class_name} · Section {history.student.section_name}</span></div>
          <div className="print-row"><span className="print-row-label">Admitted on</span><span className="print-row-value">{day(history.student.admission_date)}</span></div>
        </div>
      </div>
      {history.terms.length === 0 ? (
        <p className="print-marksheet-note">No examination results are recorded for this student yet.</p>
      ) : (
        history.terms.map((term) => (
          <div key={term.examId} className="print-fee-section">
            <h2>
              {term.examName} — {term.className}
              <small>{day(term.periodStart)} to {day(term.periodEnd)} · {pct(term.percentage)} · Grade {term.grade}</small>
            </h2>
            <table className="print-dmc-table">
              <thead><tr><th>Subject</th><th>Max Marks</th><th>Obtained</th><th>Grade</th></tr></thead>
              <tbody>
                {term.subjects.map((subject) => (
                  <tr key={subject.name}>
                    <td>{subject.name}</td>
                    <td>{subject.gradeOnly ? '—' : subject.max}</td>
                    <td>{subject.absent ? 'Absent' : subject.gradeOnly ? '—' : (subject.obtained ?? '—')}</td>
                    <td><strong>{subject.grade}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td>{term.totalMax}</td><td>{term.totalObtained}</td><td>{term.grade}</td></tr>
              </tfoot>
            </table>
          </div>
        ))
      )}
      <Signatures left="Incharge Examination" right="Principal" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Teacher & school-wide performance
// ---------------------------------------------------------------------------

function TeacherPerformanceSheet({ data, bySubject }: { data: ExamReportData; bySubject: boolean }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead
        subtitle={`${scopeLine(data)} — Teacher Performance (${bySubject ? 'Subject-Wise' : 'Class-Wise'})`}
      />
      <div className="print-fee-section">
        {bySubject ? (
          <table className="print-dmc-table">
            <thead>
              <tr><th>Class Teacher</th><th>Class</th><th>Subject</th><th>Appeared</th><th>Passed</th><th>Pass %</th><th>Average</th><th>Highest</th></tr>
            </thead>
            <tbody>
              {data.teacherSubject.map((row) => (
                <tr key={`${row.className}-${row.subject}`}>
                  <td>{row.teacher}</td>
                  <td>{row.className}</td>
                  <td>{row.subject}</td>
                  <td>{row.appeared}</td>
                  <td>{row.passed}</td>
                  <td><strong>{pct(row.passPercentage)}</strong></td>
                  <td>{row.average}</td>
                  <td>{row.highest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="print-dmc-table">
            <thead>
              <tr><th>Class Teacher</th><th>Class</th><th>Section</th><th>Students</th><th>Complete</th><th>Passed</th><th>Pass %</th><th>Average %</th><th>Highest %</th></tr>
            </thead>
            <tbody>
              {data.teacherClass.map((row) => (
                <tr key={`${row.className}-${row.sectionName}`}>
                  <td>{row.teacher}</td>
                  <td>{row.className}</td>
                  <td>{row.sectionName}</td>
                  <td>{row.students}</td>
                  <td>{row.completed}</td>
                  <td>{row.passed}</td>
                  <td><strong>{pct(row.passPercentage)}</strong></td>
                  <td>{pct(row.average)}</td>
                  <td>{pct(row.highest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="print-marksheet-note">
        Pass percentage is worked out from the students whose result sheets are complete. A class teacher is taken from the section record.
      </p>
      <Signatures left="Incharge Examination" right="Principal" />
    </section>
  );
}

function AllClassesSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${data.examName || 'Examination'} — All-Classes Overall Performance`} />
      <div className="print-fee-section">
        <table className="print-dmc-table">
          <thead>
            <tr>
              <th>Class</th><th>Students</th><th>Complete</th><th>Passed</th><th>Conditional</th>
              <th>Failed</th><th>Pending</th><th>Pass %</th><th>Average %</th><th>Highest %</th>
            </tr>
          </thead>
          <tbody>
            {data.classPerformance.map((row) => (
              <tr key={row.className}>
                <td><strong>{row.className}</strong></td>
                <td>{row.students}</td>
                <td>{row.completed}</td>
                <td>{row.passed}</td>
                <td>{row.conditional}</td>
                <td>{row.failed}</td>
                <td>{row.pending}</td>
                <td><strong>{pct(row.passPercentage)}</strong></td>
                <td>{pct(row.average)}</td>
                <td>{pct(row.highest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Signatures left="Incharge Examination" right="Principal" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Diagnostic & PTM sheets
// ---------------------------------------------------------------------------

function MissingMarksSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — Missing Marks Audit`} />
      <div className="print-fee-section">
        <h2>{data.missing.length === 0 ? 'Every paper has been entered' : `${data.missing.length} paper(s) still to be entered`}</h2>
        {data.missing.length > 0 && (
          <table className="print-dmc-table">
            <thead><tr><th>Class</th><th>Roll No.</th><th>Student</th><th>Subject</th><th>Issue</th></tr></thead>
            <tbody>
              {data.missing.map((row) => (
                <tr key={`${row.student.id}-${row.subject.id}`}>
                  <td>{row.student.class_name}</td>
                  <td>{row.student.roll_number || '—'}</td>
                  <td>{row.student.full_name}</td>
                  <td>{row.subject.subject_name}</td>
                  <td>{row.kind === 'not_entered' ? 'No marks entered' : 'Marks incomplete'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Signatures left="Checked by" right="Incharge Examination" />
    </section>
  );
}

function AtRiskSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — At-Risk & Borderline Students`} />
      <div className="print-fee-section">
        <h2>Students needing extra coaching (within {data.atRiskMargin}% of the pass mark)</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Roll No.</th><th>Student</th><th>Percentage</th><th>Grade</th><th>Gap</th><th>Reason</th></tr></thead>
          <tbody>
            {data.atRisk.map((row) => (
              <tr key={row.result.student.id}>
                <td>{row.result.student.roll_number || '—'}</td>
                <td>{row.result.student.full_name}</td>
                <td><strong>{pct(row.result.percentage)}</strong></td>
                <td>{row.result.grade}</td>
                <td>{row.gap}%</td>
                <td>{row.reasons.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.atRisk.length === 0 && <p className="print-marksheet-note">No student is failing or sitting within the margin.</p>}
      </div>
      <Signatures left="Class Teacher" right="Vice Principal" />
    </section>
  );
}

function ProgressSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${data.progressFrom || 'First exam'} vs ${data.progressTo || 'second exam'} — Term-over-Term Progress`} />
      <div className="print-fee-section">
        <h2>Biggest improvers</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Roll No.</th><th>Student</th><th>{data.progressFrom}</th><th>{data.progressTo}</th><th>Change</th></tr></thead>
          <tbody>
            {data.progress.filter((row) => row.delta > 0).slice(0, 15).map((row) => (
              <tr key={row.student.id}>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.student.full_name}</td>
                <td>{pct(row.fromPercentage)} ({row.fromGrade})</td>
                <td>{pct(row.toPercentage)} ({row.toGrade})</td>
                <td><strong>+{row.delta}%</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Score drops to follow up</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Roll No.</th><th>Student</th><th>{data.progressFrom}</th><th>{data.progressTo}</th><th>Change</th></tr></thead>
          <tbody>
            {data.progress.filter((row) => row.delta < 0).slice(-15).reverse().map((row) => (
              <tr key={row.student.id}>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.student.full_name}</td>
                <td>{pct(row.fromPercentage)} ({row.fromGrade})</td>
                <td>{pct(row.toPercentage)} ({row.toGrade})</td>
                <td><strong>{row.delta}%</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.progress.length === 0 && <p className="print-marksheet-note">No student appears in both of the selected exams.</p>}
      </div>
      <Signatures left="Class Teacher" right="Principal" />
    </section>
  );
}

function PtmSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={`${scopeLine(data)} — Parent-Teacher Meeting Sheet`} />
      <div className="print-fee-section">
        <h2>Result distribution &amp; parent acknowledgement</h2>
        <table className="print-dmc-table">
          <thead>
            <tr><th>Roll No.</th><th>Admission No.</th><th>Student Name</th><th>Total</th><th>Percentage</th><th>Grade</th><th>Parent Signature</th></tr>
          </thead>
          <tbody>
            {data.results.map((row) => (
              <tr key={row.student.id}>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.student.admission_number}</td>
                <td>{row.student.full_name}</td>
                <td>{row.totalObtained} / {row.totalMax}</td>
                <td><strong>{pct(row.percentage)}</strong></td>
                <td>{row.grade}</td>
                <td className="print-signature-box" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Class Teacher</span></div>
        <div className="print-signature"><span>Parent / Guardian</span></div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The originals, kept so the earlier reports keep printing exactly as before
// ---------------------------------------------------------------------------

function BroadsheetSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={scopeLine(data)} />
      <div className="print-fee-section print-dmc-marks">
        <h2>Class Master Broadsheet / Gazette</h2>
        <table className="print-dmc-table">
          <thead>
            <tr>
              <th>Roll No.</th><th>Student</th>
              {data.subjects.map((subject) => <th key={subject.id}>{subject.subject_name}<small>/{subject.max_marks}</small></th>)}
              <th>Total</th><th>%</th><th>Pos.</th><th>Result</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((row) => (
              <tr key={row.student.id}>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.student.full_name}</td>
                {data.subjects.map((subject) => {
                  const entry = row.subjects.find((item) => item.subject.id === subject.id);
                  return <td key={subject.id}>{!entry || !entry.entered ? '—' : entry.isAbsent ? 'Abs' : entry.obtained}</td>;
                })}
                <td>{row.totalObtained}/{row.totalMax}</td>
                <td>{pct(row.percentage)}</td>
                <td>{row.position ?? '—'}</td>
                <td>{resultStatusLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Signatures left="Class Teacher" right="Incharge Examination" />
    </section>
  );
}

function AwardSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={scopeLine(data)} />
      {data.subjects.map((subject) => (
        <div key={subject.id} className="print-award-block">
          <h2>{subject.subject_name} — Award List (total {subject.max_marks}, pass {subject.pass_marks})</h2>
          <table className="print-dmc-table">
            <thead><tr><th>Roll No.</th><th>Student</th><th>Marks Awarded</th></tr></thead>
            <tbody>
              {data.results.map((row) => {
                const entry = row.subjects.find((item) => item.subject.id === subject.id);
                const value = entry && entry.entered && !entry.isAbsent
                  ? (entry.gradeOnly ? (entry.assignedGrade ?? '') : (entry.obtained ?? ''))
                  : '';
                return (
                  <tr key={row.student.id}>
                    <td>{row.student.roll_number || '—'}</td>
                    <td>{row.student.full_name}</td>
                    <td className="print-award-blank">{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function MeritSheet({ data }: { data: ExamReportData }) {
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={scopeLine(data)} />
      <div className="print-fee-section print-dmc-marks">
        <h2>Top 3 Position Holders</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Position</th><th>Student</th><th>Roll No.</th><th>Total</th><th>Percentage</th><th>Grade</th></tr></thead>
          <tbody>
            {data.meritList.slice(0, 3).map((row, index) => (
              <tr key={row.student.id}>
                <td><strong>{index + 1}</strong></td>
                <td>{row.student.full_name}</td>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.totalObtained}/{row.totalMax}</td>
                <td>{pct(row.percentage)}</td>
                <td>{row.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Merit List (complete results only)</h2>
        <table className="print-dmc-table">
          <thead><tr><th>#</th><th>Student</th><th>Roll No.</th><th>Total</th><th>Percentage</th><th>Grade</th></tr></thead>
          <tbody>
            {data.meritList.map((row, index) => (
              <tr key={row.student.id}>
                <td>{index + 1}</td>
                <td>{row.student.full_name}</td>
                <td>{row.student.roll_number || '—'}</td>
                <td>{row.totalObtained}/{row.totalMax}</td>
                <td>{pct(row.percentage)}</td>
                <td>{row.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummarySheet({ data }: { data: ExamReportData }) {
  const passed = data.results.filter((row) => row.status === 'pass').length;
  const conditionally = data.results.filter((row) => data.decisionByStudent.has(row.student.id));
  const failed = data.results.filter((row) => row.status === 'fail' && !data.decisionByStudent.has(row.student.id));
  const pending = data.results.filter((row) => row.status === 'incomplete');
  return (
    <section className="print-only print-dmc-sheet print-exam-report" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 8mm; }'}</style>
      <SheetHead subtitle={scopeLine(data)} />
      <div className="print-fee-section print-dmc-marks">
        <h2>Pass / Fail &amp; Conditional Pass Summary</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Result</th><th>Count</th></tr></thead>
          <tbody>
            <tr><td>Passed</td><td>{passed}</td></tr>
            <tr><td>Conditionally passed</td><td>{conditionally.length}</td></tr>
            <tr><td>Failed</td><td>{failed.length}</td></tr>
            <tr><td>Marks pending</td><td>{pending.length}</td></tr>
          </tbody>
        </table>
        {conditionally.length > 0 && (
          <>
            <h2>Conditionally passed students</h2>
            <table className="print-dmc-table">
              <thead><tr><th>Student</th><th>Roll No.</th><th>Failed subjects</th><th>Condition</th></tr></thead>
              <tbody>
                {conditionally.map((row) => {
                  const decision = data.decisionByStudent.get(row.student.id);
                  return (
                    <tr key={row.student.id}>
                      <td>{row.student.full_name}</td>
                      <td>{row.student.roll_number || '—'}</td>
                      <td>{decision?.failed_subjects}</td>
                      <td>{decision?.condition_note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        {failed.length > 0 && (
          <>
            <h2>Failed students</h2>
            <table className="print-dmc-table">
              <thead><tr><th>Student</th><th>Roll No.</th><th>Percentage</th><th>Failed subjects</th></tr></thead>
              <tbody>
                {failed.map((row) => (
                  <tr key={row.student.id}>
                    <td>{row.student.full_name}</td>
                    <td>{row.student.roll_number || '—'}</td>
                    <td>{pct(row.percentage)}</td>
                    <td>{row.subjects.filter((subject) => subject.failed).map((subject) => subject.subject.subject_name).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <Signatures />
    </section>
  );
}

// The one entry point: hand it a report kind and the prepared figures, get a sheet.
export function ExamReportSheet({ kind, data }: { kind: ReportKind; data: ExamReportData }) {
  switch (kind) {
    case 'broadsheet': return <BroadsheetSheet data={data} />;
    case 'award': return <AwardSheet data={data} />;
    case 'merit': return <MeritSheet data={data} />;
    case 'summary': return <SummarySheet data={data} />;
    case 'marksheet-blank': return <MasterAwardList data={data} filled={false} />;
    case 'marksheet-filled': return <MasterAwardList data={data} filled />;
    case 'character-blank': return <CharacterSheet data={data} filled={false} />;
    case 'character-filled': return <CharacterSheet data={data} filled />;
    case 'cumulative-broadsheet': return <CumulativeBroadsheet data={data} />;
    case 'cumulative-dmc': return <CumulativeDmc data={data} />;
    case 'grade-only-a4': return <GradeOnlyCard data={data} paper="a4" />;
    case 'grade-only-a5': return <GradeOnlyCard data={data} paper="a5" />;
    case 'history': return <StudentHistorySheet data={data} />;
    case 'teacher-class': return <TeacherPerformanceSheet data={data} bySubject={false} />;
    case 'teacher-subject': return <TeacherPerformanceSheet data={data} bySubject />;
    case 'all-classes': return <AllClassesSheet data={data} />;
    case 'missing-marks': return <MissingMarksSheet data={data} />;
    case 'at-risk': return <AtRiskSheet data={data} />;
    case 'progress': return <ProgressSheet data={data} />;
    case 'ptm': return <PtmSheet data={data} />;
  }
}
