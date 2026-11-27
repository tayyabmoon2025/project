import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Info, Loader as Loader2, MessageSquareQuote, Plus, Save, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import {
  decideConditionalPass,
  deleteGradeRemark,
  fetchConditionalPasses,
  fetchGradeRemarks,
  removeConditionalPass,
  saveGradeRemark,
  addGradeRemark,
  type ConditionalPass,
  type GradeRemark,
} from '@/lib/examExtras';
import { refreshGradeRemarks } from '@/lib/gradeRemarksStore';
import { buildClassResults, fetchExamMarks, fetchExamSubjects, passingPolicyFor, type ExamMark, type ExamSubject, type ExamType, type StudentResult } from '@/lib/exams';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

// Only students who failed at most this many subjects can be given a conditional pass.
const MAX_FAILED_SUBJECTS = 2;

export function RemarksConditionalTab({ students, onToast }: { students: Student[]; onToast: (message: string) => void }) {
  const [section, setSection] = useState<'remarks' | 'conditional'>('remarks');

  // Remarks bank ---------------------------------------------------------------
  const [remarks, setRemarks] = useState<GradeRemark[]>([]);
  const [remarkEdits, setRemarkEdits] = useState<Record<string, string>>({});
  const [newGrade, setNewGrade] = useState('');
  const [newRemark, setNewRemark] = useState('');
  const [remarksBusy, setRemarksBusy] = useState(false);
  const [remarksError, setRemarksError] = useState<string | null>(null);

  // Conditional pass -----------------------------------------------------------
  const [exams, setExams] = useState<ExamType[]>([]);
  const [examId, setExamId] = useState('');
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [marks, setMarks] = useState<ExamMark[]>([]);
  const [className, setClassName] = useState('');
  const [decisions, setDecisions] = useState<ConditionalPass[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conditionalBusy, setConditionalBusy] = useState(false);
  const [conditionalError, setConditionalError] = useState<string | null>(null);

  const loadRemarks = useCallback(async () => {
    setRemarksBusy(true);
    const { remarks: rows, error: loadError } = await fetchGradeRemarks();
    setRemarks(rows);
    setRemarksError(loadError);
    setRemarksBusy(false);
    // Report cards read the bank from the shared copy, so an edited remark reaches
    // every card that is already open.
    await refreshGradeRemarks();
  }, []);

  useEffect(() => { void loadRemarks(); }, [loadRemarks]);

  useEffect(() => {
    void (async () => {
      const { data, error: loadError } = await supabase
        .from('school_exam_types')
        .select('id, name, period_start, period_end, sort_order, is_active, min_pass_percentage, passing_rule')
        .order('sort_order')
        .order('name');
      if (loadError) { setConditionalError('The exam list could not be loaded.'); return; }
      const rows = (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        period_start: row.period_start ?? null,
        period_end: row.period_end ?? null,
        sort_order: Number(row.sort_order) || 0,
        is_active: row.is_active !== false,
        min_pass_percentage: Number(row.min_pass_percentage) || 40,
        passing_rule: row.passing_rule === 'aggregate' || row.passing_rule === 'compulsory' || row.passing_rule === 'both' ? row.passing_rule : 'both',
      }));
      setExams(rows);
      setExamId((current) => current || rows[0]?.id || '');
    })();
  }, []);

  const classes = useMemo(
    () => Array.from(new Set(students.filter((student) => student.status === 'active').map((student) => student.class_name))).sort(),
    [students],
  );

  useEffect(() => {
    setClassName((current) => (current && classes.includes(current) ? current : classes[0] ?? ''));
  }, [classes]);

  const loadExamData = useCallback(async (id: string) => {
    if (!id) { setSubjects([]); setMarks([]); setDecisions([]); return; }
    setConditionalBusy(true);
    const [subjectResult, markResult, decisionResult] = await Promise.all([
      fetchExamSubjects(id),
      fetchExamMarks(id),
      fetchConditionalPasses(id),
    ]);
    setSubjects(subjectResult.subjects);
    setMarks(markResult.marks);
    setDecisions(decisionResult.decisions);
    setConditionalError(subjectResult.error ?? markResult.error ?? decisionResult.error);
    setConditionalBusy(false);
  }, []);

  useEffect(() => { void loadExamData(examId); }, [examId, loadExamData]);

  const classSubjects = useMemo(() => subjects.filter((subject) => subject.class_name === className), [subjects, className]);

  const roster = useMemo(
    () => students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .sort((a, b) => (a.roll_number || a.full_name).localeCompare(b.roll_number || b.full_name, undefined, { numeric: true })),
    [students, className],
  );

  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;
  const results = useMemo(
    () => buildClassResults(roster, classSubjects, marks, passingPolicyFor(selectedExam)),
    [roster, classSubjects, marks, selectedExam],
  );

  // Failing in one or two subjects only — the window a conditional pass covers.
  const conditionalCandidates = useMemo(
    () => results.filter((row) => {
      if (row.status !== 'fail') return false;
      return row.failedSubjects >= 1 && row.failedSubjects <= MAX_FAILED_SUBJECTS;
    }),
    [results],
  );

  const decisionByStudent = useMemo(() => {
    const map = new Map<string, ConditionalPass>();
    for (const decision of decisions) map.set(decision.student_id, decision);
    return map;
  }, [decisions]);

  const saveRemarkEdit = async (remark: GradeRemark) => {
    const next = remarkEdits[remark.id];
    if (next === undefined || next === remark.remark) return;
    setRemarksBusy(true);
    setRemarksError(null);
    const { error: saveError } = await saveGradeRemark(remark.id, next);
    if (saveError) { setRemarksError(saveError); setRemarksBusy(false); return; }
    await loadRemarks();
    setRemarksBusy(false);
    onToast(`Remark for grade ${remark.grade} saved.`);
  };

  const addRemark = async () => {
    setRemarksBusy(true);
    setRemarksError(null);
    const { error: addError } = await addGradeRemark(newGrade, newRemark);
    if (addError) { setRemarksError(addError); setRemarksBusy(false); return; }
    setNewGrade('');
    setNewRemark('');
    await loadRemarks();
    setRemarksBusy(false);
    onToast('Custom remark added to the bank.');
  };

  const removeRemark = async (remark: GradeRemark) => {
    const confirmed = window.confirm(`Remove the ${remark.grade} remark from the bank?`);
    if (!confirmed) return;
    setRemarksBusy(true);
    setRemarksError(null);
    const { error: removeError } = await deleteGradeRemark(remark.id);
    if (removeError) { setRemarksError(removeError); setRemarksBusy(false); return; }
    await loadRemarks();
    setRemarksBusy(false);
    onToast('Remark removed.');
  };

  const decide = async (row: StudentResult) => {
    const failed = row.subjects.filter((subject) => subject.failed).map((subject) => subject.subject.subject_name).join(', ');
    setConditionalBusy(true);
    setConditionalError(null);
    const { error: decideError } = await decideConditionalPass({
      examTypeId: examId,
      studentId: row.student.id,
      failedSubjects: failed,
      conditionNote: notes[row.student.id] ?? '',
    });
    if (decideError) { setConditionalError(decideError); setConditionalBusy(false); return; }
    await loadExamData(examId);
    setConditionalBusy(false);
    onToast(`${row.student.full_name} marked conditionally passed.`);
  };

  const revoke = async (row: StudentResult) => {
    const decision = decisionByStudent.get(row.student.id);
    if (!decision) return;
    const confirmed = window.confirm(`Take back the conditional pass for ${row.student.full_name}? Their result will show as failed again.`);
    if (!confirmed) return;
    setConditionalBusy(true);
    setConditionalError(null);
    const { error: removeError } = await removeConditionalPass(decision.id);
    if (removeError) { setConditionalError(removeError); setConditionalBusy(false); return; }
    await loadExamData(examId);
    setConditionalBusy(false);
    onToast('Conditional pass taken back.');
  };

  return (
    <div className="exam-remarks">
      <div className="att-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={section === 'remarks'} className={`att-tab ${section === 'remarks' ? 'active' : ''}`} onClick={() => setSection('remarks')}>
          <MessageSquareQuote size={15} />
          <span className="att-tab-label">Grade Remarks Bank<small>Auto remarks for each grade</small></span>
        </button>
        <button type="button" role="tab" aria-selected={section === 'conditional'} className={`att-tab ${section === 'conditional' ? 'active' : ''}`} onClick={() => setSection('conditional')}>
          <ShieldCheck size={15} />
          <span className="att-tab-label">Conditionally Passed<small>Principal's decisions</small></span>
        </button>
      </div>

      {section === 'remarks' ? (
        <div className="panel roster-panel">
          <div className="table-toolbar">
            <span className="result-count">{remarks.length} remarks in the bank</span>
          </div>
          {remarksError && <p className="dmc-warning">{remarksError}</p>}
          <div className="remarks-bank-grid">
            {remarks.map((remark) => (
              <div key={remark.id} className="remarks-bank-card">
                <div className="remarks-bank-head">
                  <span className={`exam-grade ${remark.grade.startsWith('A') ? 'distinction' : remark.grade === 'F' ? 'fail' : 'good'}`}>{remark.grade}</span>
                  <div className="exam-marks-actions">
                    <button type="button" className="row-action-btn" title="Save this remark" onClick={() => void saveRemarkEdit(remark)} disabled={remarksBusy}><Save size={14} /></button>
                    <button type="button" className="row-action-btn" title="Remove from bank" onClick={() => void removeRemark(remark)} disabled={remarksBusy}><Trash2 size={14} /></button>
                  </div>
                </div>
                <textarea
                  value={remarkEdits[remark.id] ?? remark.remark}
                  onChange={(event) => setRemarkEdits((current) => ({ ...current, [remark.id]: event.target.value }))}
                  rows={3}
                  maxLength={300}
                />
              </div>
            ))}
          </div>
          <div className="remarks-add-row">
            <input
              type="text"
              className="exam-mark-input remarks-grade-input"
              value={newGrade}
              placeholder="Grade, e.g. A+"
              onChange={(event) => setNewGrade(event.target.value)}
            />
            <input
              type="text"
              className="exam-mark-input remarks-text-input"
              value={newRemark}
              placeholder="Quick-pick remark for report cards"
              onChange={(event) => setNewRemark(event.target.value)}
            />
            <button type="button" className="secondary-button" onClick={() => void addRemark()} disabled={remarksBusy}>
              {remarksBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add remark
            </button>
          </div>
          <p className="cal-hint">
            <Info size={14} />
            The six default grades are filled in for you — edit the wording to match your school's voice and press the save icon. Add
            extra quick-pick remarks for any grade; the report card picks the remark for the student's final grade from this bank.
          </p>
        </div>
      ) : (
        <>
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
            </div>
          </div>

          <div className="panel exam-marks-head">
            <div className="exam-marks-copy">
              <span className="eyebrow">Conditionally passed</span>
              <h2>{className || 'Class'} — students failing {MAX_FAILED_SUBJECTS} or fewer subjects</h2>
              <p>
                {conditionalCandidates.length} {conditionalCandidates.length === 1 ? 'student is' : 'students are'} in the conditional
                window · {decisionByStudent.size} {decisionByStudent.size === 1 ? 'decision' : 'decisions'} recorded for this exam.
              </p>
            </div>
            {conditionalBusy && <Loader2 size={18} className="animate-spin" />}
          </div>

          {conditionalError && <p className="dmc-warning">{conditionalError}</p>}

          <div className="panel roster-panel">
            <div className="table-wrap">
              <table className="exam-marks-table">
                <thead>
                  <tr><th>Roll no.</th><th>Student</th><th>Failed subjects</th><th>Result</th><th>Condition note & decision</th></tr>
                </thead>
                <tbody>
                  {conditionalCandidates.map((row) => {
                    const failed = row.subjects.filter((subject) => subject.failed).map((subject) => subject.subject.subject_name);
                    const decision = decisionByStudent.get(row.student.id);
                    const note = notes[row.student.id] ?? decision?.condition_note ?? '';
                    return (
                      <tr key={row.student.id} className={decision ? 'exam-row-active' : ''}>
                        <td className="muted-cell">{row.student.roll_number || '—'}</td>
                        <td>
                          <div className="table-student">
                            <div className="student-avatar">{row.student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                            <span>
                              <strong>{row.student.full_name}</strong>
                              <small>{row.student.admission_number}</small>
                            </span>
                          </div>
                        </td>
                        <td className="muted-cell">{failed.join(', ')}</td>
                        <td><span className="exam-result fail">{row.percentage}% · {row.grade}</span></td>
                        <td>
                          {decision ? (
                            <div className="conditional-decided">
                              <span className="exam-result pass"><Award size={13} /> Conditionally passed</span>
                              <small>{decision.condition_note}</small>
                              <button type="button" className="text-button" onClick={() => void revoke(row)} disabled={conditionalBusy}>
                                <Undo2 size={13} /> Take back
                              </button>
                            </div>
                          ) : (
                            <div className="conditional-form">
                              <input
                                type="text"
                                className="exam-mark-input"
                                value={note}
                                placeholder="Condition, e.g. repeat the paper in September"
                                onChange={(event) => setNotes((current) => ({ ...current, [row.student.id]: event.target.value }))}
                              />
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void decide(row)}
                                disabled={conditionalBusy || note.trim().length < 3}
                              >
                                <ShieldCheck size={14} /> Mark conditionally passed
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {conditionalCandidates.length === 0 && (
                <div className="empty-state large">
                  {classSubjects.length === 0
                    ? 'This exam has no subjects for the selected class yet.'
                    : results.length === 0
                      ? `No active students are enrolled in ${className}.`
                      : `No student is failing just one or two subjects in ${className} — nothing needs the principal's decision.`}
                </div>
              )}
            </div>
          </div>

          <p className="cal-hint">
            <Info size={14} />
            Only students who failed one or two subjects appear here — a wider gap is not covered by a conditional pass. The decision
            and its condition are printed as a stamp on the student's final report card, and taking the decision back restores the
            plain failed result.
          </p>
        </>
      )}
    </div>
  );
}
