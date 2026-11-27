import { useEffect, useMemo, useState } from 'react';
import { Download, Info, Printer, Search } from 'lucide-react';
import {
  fetchConditionalPasses, fetchExamArchive, type ConditionalPass,
} from '@/lib/examExtras';
import {
  buildClassResults, passingPolicyFor, type ExamMark, type ExamSubject, type ExamType, type StudentResult,
} from '@/lib/exams';
import {
  activeClassNames, atRiskRows, buildCumulativeRows, classPerformanceRows, classRoster,
  missingMarksAudit, progressRows, studentAcademicHistory, subjectsForClass, teacherPerformanceRows,
  type CumulativeRow, type ExamPart, type MissingMarkRow, type ProgressRow, type SectionTeacher,
} from '@/lib/examAnalytics';
import {
  emptyReportData, reportCsvText, reportFileName, type ExamReportData, type ReportKind,
} from '@/lib/examReportCsv';
import { CLASS_SCOPED, REPORT_CARDS, REPORT_GROUPS, printLabel, type ReportGroupId } from '@/lib/examReportCatalog';
import { ExamReportSheet } from '@/components/ExamReportSheets';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { useClassOptions } from '@/lib/classSections';
import { downloadCsv } from '@/lib/fees';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

const AT_RISK_MARGIN = 10;

// The class teacher named on each section, so the teacher performance report has
// something real to group by.
async function fetchSectionTeachers(): Promise<SectionTeacher[]> {
  const { data, error } = await supabase
    .from('school_sections')
    .select('class_name, section_name, class_teacher')
    .order('class_name')
    .order('section_name');
  if (error || !data) return [];
  return (data as { class_name: string; section_name: string | null; class_teacher: string | null }[]).map((row) => ({
    class_name: String(row.class_name ?? ''),
    section_name: row.section_name === null ? null : String(row.section_name),
    class_teacher: row.class_teacher === null ? null : String(row.class_teacher),
  }));
}

const defaultPair = (exams: ExamType[]): [string, string] => {
  if (exams.length === 0) return ['', ''];
  if (exams.length === 1) return [exams[0].id, exams[0].id];
  return [exams[0].id, exams[exams.length - 1].id];
};

export function ExamReportsTab({ students, onToast }: { students: Student[]; onToast: (message: string) => void }) {
  const schoolClasses = useClassOptions();
  const [exams, setExams] = useState<ExamType[]>([]);
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [marks, setMarks] = useState<ExamMark[]>([]);
  const [decisions, setDecisions] = useState<ConditionalPass[]>([]);
  const [sections, setSections] = useState<SectionTeacher[]>([]);
  const [examId, setExamId] = useState('');
  const [className, setClassName] = useState('');
  const [pairFrom, setPairFrom] = useState('');
  const [pairTo, setPairTo] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<ReportKind | null>(null);

  useEffect(() => {
    void (async () => {
      const [archive, sectionRows] = await Promise.all([fetchExamArchive(), fetchSectionTeachers()]);
      setExams(archive.exams);
      setSubjects(archive.subjects);
      setMarks(archive.marks);
      setSections(sectionRows);
      if (archive.error) setError(archive.error);
      setExamId((current) => current || archive.exams[0]?.id || '');
      const [from, to] = defaultPair(archive.exams);
      setPairFrom((current) => current || from);
      setPairTo((current) => current || to);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!examId) { setDecisions([]); return; }
    void (async () => {
      const result = await fetchConditionalPasses(examId);
      setDecisions(result.decisions);
      if (result.error) setError(result.error);
    })();
  }, [examId]);

  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;
  const policy = passingPolicyFor(selectedExam);
  const allClasses = className === '';
  const activeStudents = useMemo(() => students.filter((student) => student.status === 'active'), [students]);
  const classOptions = useMemo(() => (schoolClasses.length ? schoolClasses : activeClassNames(students)), [schoolClasses, students]);

  // The classes a report is worked out for: the chosen one, or every class that has
  // students when "All Classes" is selected.
  const classesInScope = useMemo(
    () => (allClasses ? activeClassNames(students) : [className]),
    [allClasses, students, className],
  );

  const examParts = useMemo<ExamPart[]>(
    () => exams.map((exam) => ({
      exam,
      subjects: subjects.filter((subject) => subject.exam_type_id === exam.id),
      marks: marks.filter((mark) => mark.exam_type_id === exam.id),
    })),
    [exams, subjects, marks],
  );

  // One exam's papers and marks narrowed to a single class. Marks carry the class they
  // were entered under, so a promoted student's earlier years stay put.
  const partForClass = (part: ExamPart, name: string): ExamPart => ({
    exam: part.exam,
    subjects: subjectsForClass(part.subjects, name),
    marks: part.marks.filter((mark) => mark.class_name === name),
  });

  // Every student's result in the classes in scope, one class at a time so each class is
  // judged on its own papers and ranked among its own students.
  const scopedResults = useMemo<StudentResult[]>(() => {
    const out: StudentResult[] = [];
    for (const name of classesInScope) {
      const papers = subjectsForClass(subjects, name);
      if (papers.length === 0) continue;
      out.push(...buildClassResults(
        classRoster(students, name),
        papers,
        marks.filter((mark) => mark.class_name === name),
        policy,
      ));
    }
    return out;
  }, [classesInScope, students, subjects, marks, policy]);

  const classSubjects = useMemo(
    () => (allClasses ? [] : subjectsForClass(subjects, className)),
    [subjects, className, allClasses],
  );
  const roster = useMemo(
    () => (allClasses ? [] : classRoster(students, className)),
    [students, className, allClasses],
  );
  const results = useMemo(
    () => (allClasses ? [] : scopedResults),
    [allClasses, scopedResults],
  );

  const decisionByStudent = useMemo(
    () => new Map(decisions.map((decision) => [decision.student_id, decision])),
    [decisions],
  );

  const cumulative = useMemo<CumulativeRow[]>(() => {
    const out: CumulativeRow[] = [];
    for (const name of classesInScope) {
      const parts = examParts.map((part) => partForClass(part, name)).filter((part) => part.subjects.length > 0);
      if (parts.length === 0) continue;
      out.push(...buildCumulativeRows({ students: classRoster(students, name), parts, policy }));
    }
    return out;
  }, [classesInScope, examParts, students, policy]);

  // Under "All Classes" the audit walks every class, because that is the whole point
  // of the report: find what is still missing anywhere before the DMCs are printed.
  const missing = useMemo<MissingMarkRow[]>(() => {
    if (!allClasses) return missingMarksAudit({ students: roster, subjects: classSubjects, marks });
    const out: MissingMarkRow[] = [];
    for (const name of classesInScope) {
      out.push(...missingMarksAudit({
        students: classRoster(students, name),
        subjects: subjectsForClass(subjects, name),
        marks: marks.filter((mark) => mark.class_name === name),
      }));
    }
    return out;
  }, [allClasses, roster, classSubjects, marks, classesInScope, students, subjects]);

  const atRisk = useMemo(
    () => atRiskRows({ results: scopedResults, policy, margin: AT_RISK_MARGIN }),
    [scopedResults, policy],
  );

  const pairReady = Boolean(pairFrom) && Boolean(pairTo) && pairFrom !== pairTo;
  const fromExam = exams.find((exam) => exam.id === pairFrom) ?? null;
  const toExam = exams.find((exam) => exam.id === pairTo) ?? null;

  const progress = useMemo<ProgressRow[]>(() => {
    if (!pairReady || !fromExam || !toExam) return [];
    const from = examParts.find((part) => part.exam.id === fromExam.id);
    const to = examParts.find((part) => part.exam.id === toExam.id);
    if (!from || !to) return [];
    const out: ProgressRow[] = [];
    for (const name of classesInScope) {
      const before = partForClass(from, name);
      const after = partForClass(to, name);
      if (before.subjects.length === 0 || after.subjects.length === 0) continue;
      const classRosterForExam = classRoster(students, name);
      out.push(...progressRows({
        from: buildClassResults(classRosterForExam, before.subjects, before.marks, passingPolicyFor(fromExam)),
        to: buildClassResults(classRosterForExam, after.subjects, after.marks, passingPolicyFor(toExam)),
      }));
    }
    return out.sort((a, b) => b.delta - a.delta);
  }, [pairReady, fromExam, toExam, examParts, classesInScope, students]);

  const classPerformance = useMemo(
    () => classPerformanceRows({
      students, subjects, marks, policy,
      conditionalStudentIds: new Set(decisions.map((decision) => decision.student_id)),
    }),
    [students, subjects, marks, policy, decisions],
  );

  const teacherRows = useMemo(
    () => teacherPerformanceRows({ students, subjects, marks, policy, sections }),
    [students, subjects, marks, policy, sections],
  );

  const historyStudent = useMemo(
    () => students.find((student) => student.id === historyId) ?? null,
    [students, historyId],
  );

  const historyTerms = useMemo(
    () => (historyStudent ? studentAcademicHistory({ student: historyStudent, exams, subjects, marks }) : []),
    [historyStudent, exams, subjects, marks],
  );

  const historyMatches = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    if (needle.length < 2) return [];
    return students
      .filter((student) => student.full_name.toLowerCase().includes(needle)
        || student.admission_number.toLowerCase().includes(needle)
        || (student.roll_number ?? '').toLowerCase().includes(needle))
      .slice(0, 8);
  }, [students, historyQuery]);

  const data: ExamReportData = useMemo(() => ({
    ...emptyReportData,
    examName: allClasses ? 'All examinations' : selectedExam?.name ?? '',
    className: allClasses ? 'All Classes' : className,
    subjects: classSubjects,
    students: activeStudents,
    roster,
    results,
    meritList: [...results].filter((row) => row.complete).sort((a, b) => b.percentage - a.percentage),
    decisions,
    decisionByStudent,
    cumulative,
    cumulativeExams: exams
      .filter((exam) => cumulative.some((row) => row.terms.some((term) => term.examId === exam.id)))
      .map((exam) => exam.name),
    missing,
    atRisk,
    atRiskMargin: AT_RISK_MARGIN,
    progress,
    progressFrom: fromExam?.name ?? '',
    progressTo: toExam?.name ?? '',
    classPerformance,
    teacherClass: teacherRows.classRows,
    teacherSubject: teacherRows.subjectRows,
    history: historyStudent ? { student: historyStudent, terms: historyTerms } : null,
    passMark: policy.minPassPercentage,
  }), [
    allClasses, selectedExam, className, classSubjects, activeStudents, roster, results, decisions,
    decisionByStudent, cumulative, exams, missing, atRisk, progress, fromExam, toExam,
    classPerformance, teacherRows, historyStudent, historyTerms, policy,
  ]);

  const printSheet = usePrintSheet(printing !== null, printing ? <ExamReportSheet kind={printing} data={data} /> : null);

  const doPrint = (kind: ReportKind) => {
    setPrinting(kind);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => setPrinting(null), 300);
    }, 60);
  };

  const doExport = (kind: ReportKind) => {
    downloadCsv(reportFileName(kind, data), reportCsvText(kind, data));
    onToast('Report exported as CSV.');
  };

  const groupIds: ReportGroupId[] = ['academic', 'cumulative', 'performance', 'diagnostic'];

  return (
    <div className="exam-reports">
      <div className="panel attendance-filters-panel">
        <div className="att-filters">
          <label className="control-field">Exam
            <select value={examId} onChange={(event) => setExamId(event.target.value)}>
              <option value="">Select an exam</option>
              {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
          <label className="control-field">Class
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">All Classes</option>
              {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Progress from
            <select value={pairFrom} onChange={(event) => setPairFrom(event.target.value)}>
              <option value="">Select an exam</option>
              {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
          <label className="control-field">Progress to
            <select value={pairTo} onChange={(event) => setPairTo(event.target.value)}>
              <option value="">Select an exam</option>
              {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
        </div>
        <p className="report-filter-hint">
          Choose a class for the class sheets, or leave it on All Classes for the annual, teacher and school-wide reports.
        </p>
      </div>

      <div className="panel attendance-filters-panel">
        <div className="report-history-picker">
          <label className="control-field">Student record
            <span className="history-search">
              <Search size={14} />
              <input
                value={historyQuery}
                placeholder="Type a name, admission no. or roll no."
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
            </span>
          </label>
          {historyQuery.trim().length >= 2 && historyMatches.length === 0 && (
            <p className="cal-hint">No student matches that search.</p>
          )}
          {historyMatches.length > 0 && (
            <div className="history-matches">
              {historyMatches.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  className="history-match"
                  onClick={() => { setHistoryId(student.id); setHistoryQuery(''); }}
                >
                  <strong>{student.full_name}</strong>
                  <span>{student.class_name} · {student.admission_number}</span>
                </button>
              ))}
            </div>
          )}
          {historyStudent && (
            <p className="history-selected">
              <span>
                {historyTerms.length === 0
                  ? `${historyStudent.full_name} has no recorded exam results yet.`
                  : `${historyStudent.full_name} has ${historyTerms.length} recorded exam${historyTerms.length === 1 ? '' : 's'} across their school record.`}
              </span>
              <button type="button" className="text-button" onClick={() => setHistoryId('')}>Clear</button>
            </p>
          )}
        </div>
      </div>

      {error && <p className="dmc-warning">{error}</p>}
      {loading && <div className="empty-state large">Loading exam data…</div>}

      {groupIds.map((groupId) => {
        const group = REPORT_GROUPS.find((item) => item.id === groupId);
        const cards = REPORT_CARDS.filter((card) => card.group === groupId);
        if (!group || cards.length === 0) return null;
        return (
          <section key={groupId} className="exam-report-group">
            <header className="report-category-head">
              <h3>{group.label}</h3>
              <p>{group.hint}</p>
            </header>
            <div className="report-grid">
              {cards.map((card) => {
                const Icon = card.icon;
                const needsClass = CLASS_SCOPED.includes(card.id) && allClasses;
                const noPapers = !allClasses && classSubjects.length === 0;
                const disabled = loading
                  || needsClass
                  || noPapers
                  || (card.needsStudent && !historyStudent)
                  || (card.needsSecondExam && !pairReady);
                return (
                  <div key={card.id} className="panel report-card report-card-action exam-report-card">
                    <div className="report-card-icon"><Icon size={20} /></div>
                    <div className="report-card-copy">
                      <strong>{card.title}</strong>
                      <p>{card.hint}</p>
                      <span className="exam-report-paper">{card.paper}</span>
                      <div className="exam-marks-actions">
                        <button type="button" className="secondary-button" onClick={() => doPrint(card.id)} disabled={disabled}>
                          <Printer size={14} /> {printLabel(card)}
                        </button>
                        <button type="button" className="text-button" onClick={() => doExport(card.id)} disabled={disabled}>
                          <Download size={14} /> Export CSV
                        </button>
                      </div>
                      {needsClass && <span className="report-card-note">Choose a class at the top to print this sheet.</span>}
                      {noPapers && <span className="report-card-note">This class has no subjects set up for the chosen exam.</span>}
                      {card.needsStudent && !historyStudent && <span className="report-card-note">Search for a student above first.</span>}
                      {card.needsSecondExam && !pairReady && <span className="report-card-note">Pick two different exams above first.</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="cal-hint">
        <Info size={14} />
        Every figure here is worked out from the marks already entered, so nothing has to be recalculated by hand. Positions and the
        merit list only include students whose sheets are complete, and conditionally passed students are counted separately from
        plain passes so the reports match the report card stamps. The progress report compares the two exams chosen at the top. A
        teacher is credited to a class and section from the section record, because the app does not store a separate teacher against
        each individual paper.
      </p>

      {printSheet}
    </div>
  );
}
