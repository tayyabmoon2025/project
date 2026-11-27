import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Info, Search, TrendingDown, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import { formatPercentage, type AttendanceRecord } from '@/lib/attendance';
import { DEFAULT_CALENDAR_POLICY, type CalendarDay, type CalendarPolicy } from '@/lib/attendance';
import { loadSchoolCalendar } from '@/lib/schoolCalendar';
import { EMPTY_REPORT_CARD_ATTENDANCE, reportCardAttendanceFor, type ReportCardAttendance } from '@/lib/reportCardAttendance';
import {
  buildClassResults,
  fetchExamMarks,
  fetchExamSubjects,
  fetchExamTypes,
  passingPolicyFor,
  passingRuleLabel,
  resultStatusLabel,
  type ExamMark,
  type ExamSubject,
  type ExamType,
  type StudentResult,
} from '@/lib/exams';
import { fetchConditionalPasses, type ConditionalPass, type GradeRemark } from '@/lib/examExtras';
import { useGradeRemarks } from '@/lib/gradeRemarksStore';
import {
  clearReportCardRemark,
  fetchReportCardRemarks,
  remarkSourceLabel,
  resolveReportCardRemark,
  saveReportCardRemark,
  type ReportCardRemark,
} from '@/lib/reportCardRemarks';
import { ExamReportCard } from '@/components/ExamReportCard';
import { ReportCardRemarkEditor } from '@/components/ReportCardRemarkEditor';

const shortDay = (value: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—');

export function ResultsTab({ students, onToast }: { students: Student[]; onToast: (message: string) => void }) {
  const [exams, setExams] = useState<ExamType[]>([]);
  const [examId, setExamId] = useState('');
  const [className, setClassName] = useState('');
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [marks, setMarks] = useState<ExamMark[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [policy, setPolicy] = useState<CalendarPolicy>(DEFAULT_CALENDAR_POLICY);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [query, setQuery] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<StudentResult | null>(null);
  const [decisions, setDecisions] = useState<ConditionalPass[]>([]);
  const [overrides, setOverrides] = useState<ReportCardRemark[]>([]);
  const [remarkEdits, setRemarkEdits] = useState<Record<string, string>>({});
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [remarkError, setRemarkError] = useState<string | null>(null);

  // The bank lives in a shared copy, so an edit made on the Remarks & Conditional Pass
  // screen is picked up here without reopening the report card.
  const { remarks } = useGradeRemarks();

  useEffect(() => {
    void (async () => {
      const { exams: rows, error: loadError } = await fetchExamTypes();
      if (loadError) { setError(loadError); return; }
      setExams(rows);
      setExamId((current) => current || rows[0]?.id || '');
    })();
  }, []);

  // The saved working week and school calendar, so the school-day count and the
  // attendance percentage printed on the card are measured against the days the
  // school actually opened.
  useEffect(() => {
    void (async () => {
      const { policy: savedPolicy, days } = await loadSchoolCalendar();
      setPolicy(savedPolicy);
      setCalendarDays(days);
    })();
  }, []);

  const classes = useMemo(
    () => Array.from(new Set(students.filter((student) => student.status === 'active').map((student) => student.class_name))).sort(),
    [students],
  );

  useEffect(() => {
    setClassName((current) => (current && classes.includes(current) ? current : classes[0] ?? ''));
  }, [classes]);

  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;

  const loadExamData = useCallback(async (id: string) => {
    if (!id) { setSubjects([]); setMarks([]); return; }
    setLoading(true);
    const [subjectResult, markResult, decisionResult, remarkResult] = await Promise.all([
      fetchExamSubjects(id),
      fetchExamMarks(id),
      fetchConditionalPasses(id),
      fetchReportCardRemarks(id),
    ]);
    setSubjects(subjectResult.subjects);
    setMarks(markResult.marks);
    setDecisions(decisionResult.decisions);
    setOverrides(remarkResult.overrides);
    setRemarkEdits({});
    setError(subjectResult.error ?? markResult.error ?? decisionResult.error ?? remarkResult.error);
    setLoading(false);
  }, []);

  useEffect(() => { void loadExamData(examId); }, [examId, loadExamData]);

  // Attendance for the report card is taken from the exam's own dates when they are
  // set, so the printed figure matches the term that was examined.
  const attendanceRange = useMemo(() => {
    if (!selectedExam?.period_start || !selectedExam?.period_end) return null;
    return { start: selectedExam.period_start, end: selectedExam.period_end };
  }, [selectedExam]);

  useEffect(() => {
    if (!attendanceRange) { setRecords([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from('school_attendance')
          .select('student_id, attendance_date, status')
          .gte('attendance_date', attendanceRange.start)
          .lte('attendance_date', attendanceRange.end);
        if (cancelled) return;
        setRecords(loadError ? [] : ((data ?? []) as AttendanceRecord[]));
      } catch {
        if (!cancelled) setRecords([]);
      }
    })();
    return () => { cancelled = true; };
  }, [attendanceRange]);

  const classSubjects = useMemo(
    () => subjects.filter((subject) => subject.class_name === className),
    [subjects, className],
  );

  const roster = useMemo(
    () => students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [students, className],
  );

  const results = useMemo(
    () => buildClassResults(roster, classSubjects, marks, passingPolicyFor(selectedExam)),
    [roster, classSubjects, marks, selectedExam],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = results.filter((row) => !term || `${row.student.full_name} ${row.student.admission_number} ${row.student.roll_number ?? ''}`.toLowerCase().includes(term));
    return failedOnly ? filtered.filter((row) => row.status === 'fail') : filtered;
  }, [results, query, failedOnly]);

  const completed = results.filter((row) => row.complete);
  const passed = completed.filter((row) => row.status === 'pass').length;
  const classAverage = completed.length === 0
    ? 0
    : Math.round((completed.reduce((sum, row) => sum + row.percentage, 0) / completed.length) * 10) / 10;

  const summaryFor = (studentId: string): ReportCardAttendance => {
    if (!attendanceRange) return EMPTY_REPORT_CARD_ATTENDANCE;
    return reportCardAttendanceFor({
      records: records.filter((record) => record.student_id === studentId),
      start: attendanceRange.start,
      end: attendanceRange.end,
      policy,
      calendarDays,
    });
  };

  const detailSummary = detailFor ? summaryFor(detailFor.student.id) : EMPTY_REPORT_CARD_ATTENDANCE;

  const decisionFor = (studentId: string) => decisions.find((decision) => decision.student_id === studentId) ?? null;

  const overrideFor = (studentId: string) => overrides.find((override) => override.student_id === studentId) ?? null;

  // The remark that will print: the teacher's saved tweak first, then the bank wording
  // for the student's overall grade. Re-computed whenever the bank changes, so editing
  // a bank entry updates every card that has no tweak of its own.
  const resolvedRemarkFor = (row: StudentResult, bank: GradeRemark[], overrideList: ReportCardRemark[]) =>
    resolveReportCardRemark({
      grade: row.grade,
      status: row.status,
      bank,
      override: overrideList.find((entry) => entry.student_id === row.student.id) ?? null,
    });

  const detailRemark = detailFor
    ? resolvedRemarkFor(detailFor, remarks, overrides)
    : { remark: '', source: 'fallback' as const };

  const remarkDraftFor = (row: StudentResult) =>
    remarkEdits[row.student.id] ?? resolvedRemarkFor(row, remarks, overrides).remark;

  const saveRemarkFor = async (row: StudentResult) => {
    if (!selectedExam) return;
    setRemarkSaving(true);
    setRemarkError(null);
    const { error: saveError } = await saveReportCardRemark({
      examTypeId: selectedExam.id,
      studentId: row.student.id,
      grade: row.grade,
      remark: remarkDraftFor(row),
    });
    if (saveError) { setRemarkError(saveError); setRemarkSaving(false); return; }
    const { overrides: refreshed } = await fetchReportCardRemarks(selectedExam.id);
    setOverrides(refreshed);
    setRemarkEdits((current) => { const next = { ...current }; delete next[row.student.id]; return next; });
    setRemarkSaving(false);
    onToast(`Teacher's remark saved for ${row.student.full_name}.`);
  };

  const resetRemarkFor = async (row: StudentResult) => {
    if (!selectedExam) return;
    setRemarkSaving(true);
    setRemarkError(null);
    if (overrideFor(row.student.id)) {
      const { error: clearError } = await clearReportCardRemark(selectedExam.id, row.student.id);
      if (clearError) { setRemarkError(clearError); setRemarkSaving(false); return; }
      const { overrides: refreshed } = await fetchReportCardRemarks(selectedExam.id);
      setOverrides(refreshed);
    }
    setRemarkEdits((current) => { const next = { ...current }; delete next[row.student.id]; return next; });
    setRemarkSaving(false);
    onToast(`The bank remark for grade ${row.grade} is back on ${row.student.full_name}'s report card.`);
  };

  return (
    <div className="exam-results">
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
              <option value="">Select a class</option>
              {classes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="att-filter-check">
            <input type="checkbox" className="h-4 w-4 accent-rose-500" checked={failedOnly} onChange={(event) => setFailedOnly(event.target.checked)} />
            <TrendingDown size={15} />
            <span>Show students needing improvement only</span>
          </label>
        </div>
      </div>

      {!selectedExam || classSubjects.length === 0 ? (
        <div className="panel roster-panel">
          <div className="empty-state large">
            {!selectedExam
              ? 'Choose an exam to see its results.'
              : `This exam has no subjects for ${className || 'this class'}. Add them in Exams Setup first.`}
          </div>
        </div>
      ) : (
        <>
          <div className="panel exam-results-summary">
            <div className="exam-results-copy">
              <span className="eyebrow">{selectedExam.name} · {className}</span>
              <h2>Class result</h2>
              <p>
                {classSubjects.length} subjects · {completed.length} of {roster.length} students have complete results
                {attendanceRange ? ` · attendance taken ${shortDay(attendanceRange.start)} to ${shortDay(attendanceRange.end)}` : ''}
              </p>
              <p className="exam-policy-note">
                Passing policy: {selectedExam.min_pass_percentage}% aggregate · {passingRuleLabel(selectedExam.passing_rule)}
              </p>
            </div>
            <div className="att-monthly-totals">
              <span><b>{completed.length ? formatPercentage(classAverage) : '—'}</b> class average</span>
              <span><b>{passed}</b> passed</span>
              <span className={completed.length - passed > 0 ? 'warn' : ''}><b>{completed.length - passed}</b> needing improvement</span>
            </div>
          </div>

          <div className="panel roster-panel">
            <div className="table-toolbar">
              <div className="search-field">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, roll number or admission number" />
              </div>
              <span className="result-count">{visible.length} students</span>
            </div>

            {error && <p className="dmc-warning">{error}</p>}

            <div className="table-wrap">
              <table className="exam-results-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Student</th>
                    <th>Total obtained</th>
                    <th>Percentage</th>
                    <th>Grade</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const low = row.status === 'fail';
                    return (
                      <tr
                        key={row.student.id}
                        className={`clickable-row ${low ? 'absent-row' : ''}`}
                        onClick={() => setDetailFor(row)}
                        title={`Open ${row.student.full_name}'s report card`}
                      >
                        <td><strong>{row.position ? row.position : '—'}</strong></td>
                        <td>
                          <div className="table-student">
                            <div className="student-avatar">{row.student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                            <span>
                              <strong>{row.student.full_name}</strong>
                              <small>Roll {row.student.roll_number || '—'}</small>
                            </span>
                          </div>
                        </td>
                        <td><strong>{row.totalObtained}</strong> <small className="text-slate-400">/ {row.totalMax}</small></td>
                        <td>
                          <span className={`att-percentage ${low ? 'low' : 'ok'}`}>
                            {formatPercentage(row.percentage)}
                            {low && <small><TrendingDown size={12} /> Low</small>}
                          </span>
                        </td>
                        <td><span className={`exam-grade ${row.gradeTone}`}>{row.grade}</span></td>
                        <td>
                          <span className={`exam-status-pill ${row.status}`}>{resultStatusLabel(row.status)}</span>
                          {row.enteredCount < classSubjects.length && (
                            <small className="block text-[10px] text-slate-400">{classSubjects.length - row.enteredCount} subjects pending</small>
                          )}
                        </td>
                        <td className="text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && visible.length === 0 && (
                <div className="empty-state large">
                  {roster.length === 0 ? `No active students are enrolled in ${className}.` : 'No student matches these filters.'}
                </div>
              )}
              {loading && <div className="empty-state large">Working out the results…</div>}
            </div>
          </div>

          <p className="cal-hint">
            <Info size={14} />
            Results are worked out from the marks as they stand, so a corrected mark changes the result straight away. Students with
            papers still to be entered are not given a position or a pass mark until their sheet is complete. Click a student to open
            their report card and print it.
          </p>
        </>
      )}

      {detailFor && selectedExam && (
        <div className="notice-overlay" onClick={() => setDetailFor(null)}>
          <section className="notice-modal exam-report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">Report card</span>
              <button className="close-button" onClick={() => setDetailFor(null)} aria-label="Close"><X size={18} /></button>
            </div>

            <div className="exam-report-head">
              <div className="student-avatar">{detailFor.student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
              <div>
                <h2>{detailFor.student.full_name}</h2>
                <p>
                  {detailFor.student.admission_number} · {detailFor.student.class_name} · Section {detailFor.student.section_name}
                  {detailFor.student.roll_number ? ` · Roll ${detailFor.student.roll_number}` : ''}
                </p>
              </div>
            </div>

            <div className="exam-report-stats">
              <div><span>Total</span><strong>{detailFor.totalObtained}<small>/{detailFor.totalMax}</small></strong></div>
              <div><span>Percentage</span><strong>{formatPercentage(detailFor.percentage)}</strong></div>
              <div><span>Grade</span><strong className={`exam-grade ${detailFor.gradeTone}`}>{detailFor.grade}</strong></div>
              <div><span>Position</span><strong>{detailFor.position ?? '—'}</strong></div>
            </div>

            <div className="table-wrap exam-report-table">
              <table>
                <thead>
                  <tr><th>Subject</th><th>Total</th><th>Obtained</th><th>Grade</th></tr>
                </thead>
                <tbody>
                  {detailFor.subjects.map((row) => (
                    <tr key={row.subject.id}>
                      <td>
                        <strong>{row.subject.subject_name}</strong>
                        {row.subject.paper_split && (
                          <small>
                            Paper A {row.paperA === null ? '—' : row.paperA} + Paper B {row.paperB === null ? '—' : row.paperB}
                            {' · '}
                          </small>
                        )}
                        {row.gradeOnly ? <small>Grade only</small> : <small>Pass mark {row.subject.pass_marks}</small>}
                      </td>
                      <td className="muted-cell">{row.gradeOnly ? '—' : row.subject.max_marks}</td>
                      <td>
                        {row.gradeOnly
                          ? <span className="muted-cell">—</span>
                          : !row.entered ? <span className="muted-cell">Not entered</span> : row.isAbsent ? <span className="exam-status-pill fail">Absent</span> : row.obtained}
                      </td>
                      <td>
                        {row.entered
                          ? <span className={`exam-grade ${row.failed ? 'fail' : 'pass'}`}>{row.grade}</span>
                          : <span className="muted-cell">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="exam-report-foot">
              <span className={`exam-status-pill ${detailFor.status}`}>{resultStatusLabel(detailFor.status)}</span>
              {decisionFor(detailFor.student.id) && (
                <span className="exam-status-pill pass">Conditionally passed</span>
              )}
              {detailFor.failedSubjects > 0 && (
                <span className="exam-report-note">{detailFor.failedSubjects} below the pass mark</span>
              )}
              {detailFor.absentSubjects > 0 && (
                <span className="exam-report-note">{detailFor.absentSubjects} absent</span>
              )}
            </div>

            <ReportCardRemarkEditor
              value={remarkDraftFor(detailFor)}
              sourceLabel={remarkSourceLabel(detailRemark.source, detailFor.grade)}
              modified={remarkDraftFor(detailFor).trim() !== detailRemark.remark.trim()}
              hasOverride={Boolean(overrideFor(detailFor.student.id))}
              saving={remarkSaving}
              error={remarkError}
              onChange={(next) => setRemarkEdits((current) => ({ ...current, [detailFor.student.id]: next }))}
              onSave={() => void saveRemarkFor(detailFor)}
              onReset={() => void resetRemarkFor(detailFor)}
            />

            <div className="notice-preview-actions">
              <button type="button" className="secondary-button" onClick={() => setDetailFor(null)}>Close</button>
              <ExamReportCard
                student={detailFor.student}
                exam={selectedExam}
                result={detailFor}
                summary={detailSummary}
                schoolDays={detailSummary.schoolDays}
                conditional={decisionFor(detailFor.student.id)}
                remark={remarkDraftFor(detailFor)}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
