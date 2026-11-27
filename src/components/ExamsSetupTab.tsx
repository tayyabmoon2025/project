import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle, CalendarRange, Check, GraduationCap, Info, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClassOptions } from '@/lib/classSections';
import {
  PASSING_RULES,
  deleteExamSubject,
  deleteExamType,
  fetchExamSubjects,
  fetchExamTypes,
  passingRuleLabel,
  saveExamSubject,
  saveExamType,
  type ExamSubject,
  type ExamType,
  type PassingRule,
} from '@/lib/exams';

const formatPeriod = (exam: ExamType) => {
  if (!exam.period_start && !exam.period_end) return 'Dates not set';
  if (exam.period_start && exam.period_end) return `${exam.period_start} → ${exam.period_end}`;
  return exam.period_start ?? exam.period_end ?? '';
};

type ExamFormState = {
  id: string | null;
  name: string;
  start: string;
  end: string;
  active: boolean;
  minPass: string;
  rule: PassingRule;
};

type SubjectFormState = {
  id: string | null;
  className: string;
  subject: string;
  max: string;
  pass: string;
  compulsory: boolean;
  gradeOnly: boolean;
  optional: boolean;
  order: string;
};

export function ExamsSetupTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const CLASS_OPTIONS = useClassOptions();
  const isAdmin = profile?.role === 'admin';

  const [exams, setExams] = useState<ExamType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('all');
  const [examForm, setExamForm] = useState<ExamFormState | null>(null);
  const [subjectForm, setSubjectForm] = useState<SubjectFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setLoading(true);
    const { exams: rows, error: loadFailure } = await fetchExamTypes();
    setExams(rows);
    setLoadError(loadFailure);
    setLoading(false);
    return rows;
  }, []);

  useEffect(() => {
    void (async () => {
      const rows = await loadExams();
      setSelectedId((current) => current || rows[0]?.id || '');
    })();
  }, [loadExams]);

  const loadSubjects = useCallback(async (examTypeId: string) => {
    if (!examTypeId) { setSubjects([]); return; }
    setSubjectsLoading(true);
    const { subjects: rows, error: loadFailure } = await fetchExamSubjects(examTypeId);
    setSubjects(rows);
    setSubjectsError(loadFailure);
    setSubjectsLoading(false);
  }, []);

  useEffect(() => { void loadSubjects(selectedId); }, [selectedId, loadSubjects]);

  const selectedExam = exams.find((exam) => exam.id === selectedId) ?? null;
  const visibleSubjects = classFilter === 'all' ? subjects : subjects.filter((subject) => subject.class_name === classFilter);
  const classesWithSubjects = Array.from(new Set(subjects.map((subject) => subject.class_name)));

  const openNewExam = () => {
    setError(null);
    setExamForm({ id: null, name: '', start: '', end: '', active: true, minPass: '40', rule: 'both' });
  };

  const openEditExam = (exam: ExamType) => {
    setError(null);
    setExamForm({
      id: exam.id,
      name: exam.name,
      start: exam.period_start ?? '',
      end: exam.period_end ?? '',
      active: exam.is_active,
      minPass: String(exam.min_pass_percentage),
      rule: exam.passing_rule,
    });
  };

  const submitExam = async (event: FormEvent) => {
    event.preventDefault();
    if (!examForm) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await saveExamType(examForm.id, {
      name: examForm.name,
      period_start: examForm.start,
      period_end: examForm.end,
      is_active: examForm.active,
      min_pass_percentage: examForm.minPass,
      passing_rule: examForm.rule,
    });
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    const rows = await loadExams();
    if (!examForm.id) setSelectedId(rows[rows.length - 1]?.id ?? '');
    setExamForm(null);
    onToast(examForm.id ? 'Exam updated.' : 'Exam added.');
  };

  const removeExam = async (exam: ExamType) => {
    const confirmed = window.confirm(
      `Remove "${exam.name}"? Its subjects and every mark recorded for it will be deleted. This cannot be undone.`,
    );
    if (!confirmed) return;
    const { error: removeError } = await deleteExamType(exam.id);
    if (removeError) { onToast(removeError); return; }
    const rows = await loadExams();
    setSelectedId((current) => (current === exam.id ? rows[0]?.id ?? '' : current));
    onToast(`${exam.name} was removed.`);
  };

  const openNewSubject = () => {
    setError(null);
    const sameClass = subjects.filter((subject) => subject.class_name === (classFilter === 'all' ? (CLASS_OPTIONS[0] ?? '') : classFilter));
    const nextOrder = sameClass.length ? Math.max(...sameClass.map((subject) => subject.sort_order)) + 1 : 1;
    setSubjectForm({
      id: null,
      className: classFilter === 'all' ? (CLASS_OPTIONS[0] ?? '') : classFilter,
      subject: '',
      max: '100',
      pass: '40',
      compulsory: true,
      gradeOnly: false,
      optional: false,
      order: String(nextOrder),
    });
  };

  const openEditSubject = (subject: ExamSubject) => {
    setError(null);
    setSubjectForm({
      id: subject.id,
      className: subject.class_name,
      subject: subject.subject_name,
      max: String(subject.max_marks),
      pass: String(subject.pass_marks),
      compulsory: subject.is_compulsory,
      gradeOnly: subject.is_grade_only,
      optional: subject.is_optional,
      order: String(subject.sort_order),
    });
  };

  const submitSubject = async (event: FormEvent) => {
    event.preventDefault();
    if (!subjectForm || !selectedId) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await saveExamSubject(subjectForm.id, {
      exam_type_id: selectedId,
      class_name: subjectForm.className,
      subject_name: subjectForm.subject,
      max_marks: subjectForm.max,
      pass_marks: subjectForm.pass,
      is_compulsory: subjectForm.compulsory,
      is_grade_only: subjectForm.gradeOnly,
      is_optional: subjectForm.optional,
      sort_order: subjectForm.order,
    });
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    await loadSubjects(selectedId);
    setSubjectForm(null);
    onToast(subjectForm.id ? 'Subject updated.' : 'Subject added to the exam.');
  };

  const removeSubject = async (subject: ExamSubject) => {
    const confirmed = window.confirm(`Remove ${subject.subject_name} from ${subject.class_name}? Marks recorded for it will be deleted.`);
    if (!confirmed) return;
    const { error: removeError } = await deleteExamSubject(subject.id);
    if (removeError) { onToast(removeError); return; }
    await loadSubjects(selectedId);
    onToast('Subject removed.');
  };

  return (
    <div className="exam-setup">
      <div className="exam-split">
        <section className="panel exam-list-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Step one</span>
              <h2>Exams</h2>
            </div>
            {isAdmin && (
              <button type="button" className="primary-button" onClick={openNewExam}>
                <Plus size={15} /> Add exam
              </button>
            )}
          </div>

          {loadError && <p className="dmc-warning">{loadError}</p>}

          <ul className="exam-list">
            {exams.map((exam) => (
              <li key={exam.id}>
                <button
                  type="button"
                  className={`exam-list-item ${selectedId === exam.id ? 'active' : ''}`}
                  onClick={() => { setSelectedId(exam.id); setClassFilter('all'); }}
                >
                  <span className="exam-list-mark"><GraduationCap size={16} /></span>
                  <span className="exam-list-copy">
                    <strong>{exam.name}</strong>
                    <small>{formatPeriod(exam)}</small>
                    <small className="exam-policy-line">{exam.min_pass_percentage}% · {passingRuleLabel(exam.passing_rule)}</small>
                  </span>
                  <span className={`exam-status ${exam.is_active ? 'active' : 'inactive'}`}>
                    {exam.is_active ? 'Active' : 'Closed'}
                  </span>
                </button>
                {isAdmin && (
                  <span className="exam-list-actions">
                    <button type="button" className="row-action-btn" onClick={() => openEditExam(exam)} title="Edit this exam">
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="row-action-btn row-action-danger" onClick={() => void removeExam(exam)} title="Remove this exam">
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!loading && exams.length === 0 && (
            <div className="empty-state large">No exams yet. Add the first examination to get started.</div>
          )}
          {loading && <div className="empty-state large">Loading exams…</div>}
        </section>

        <section className="panel exam-subject-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Step two</span>
              <h2>{selectedExam ? `Subjects — ${selectedExam.name}` : 'Subjects'}</h2>
            </div>
            {isAdmin && selectedExam && (
              <button type="button" className="primary-button" onClick={openNewSubject}>
                <Plus size={15} /> Add subject
              </button>
            )}
          </div>

          {!selectedExam ? (
            <div className="empty-state large">Choose an exam on the left to list its subjects.</div>
          ) : (
            <>
              <div className="exam-subject-filters">
                <label className="control-field">Class
                  <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                    <option value="all">All classes</option>
                    {(classesWithSubjects.length ? classesWithSubjects : CLASS_OPTIONS).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <span className="result-count">{visibleSubjects.length} subjects</span>
              </div>

              {subjectsError && <p className="dmc-warning">{subjectsError}</p>}

              <div className="table-wrap">
                <table className="exam-subject-table">
                  <thead>
                    <tr><th>Class</th><th>Subject</th><th>Total / Pass</th><th>Settings</th><th>Order</th><th /></tr>
                  </thead>
                  <tbody>
                    {visibleSubjects.map((subject) => (
                      <tr key={subject.id}>
                        <td className="muted-cell">{subject.class_name}</td>
                        <td><strong>{subject.subject_name}</strong></td>
                        <td>{subject.is_grade_only ? <span className="muted-cell">Grade only</span> : `${subject.max_marks} / ${subject.pass_marks}`}</td>
                        <td>
                          <div className="subject-tag-row">
                            {subject.is_compulsory ? <span className="subject-tag compulsory">Compulsory</span> : <span className="subject-tag">Optional pass</span>}
                            {subject.is_grade_only && <span className="subject-tag grade-only">Grade only</span>}
                            {subject.is_optional && <span className="subject-tag optional">Optional</span>}
                          </div>
                        </td>
                        <td className="muted-cell">{subject.sort_order}</td>
                        <td className="text-right">
                          {isAdmin && (
                            <div className="row-actions">
                              <button type="button" className="row-action-btn" title="Edit this subject" onClick={() => openEditSubject(subject)}>
                                <Pencil size={14} />
                              </button>
                              <button type="button" className="row-action-btn row-action-danger" title="Remove this subject" onClick={() => void removeSubject(subject)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!subjectsLoading && visibleSubjects.length === 0 && (
                  <div className="empty-state large">
                    {subjects.length === 0
                      ? 'No subjects listed for this exam yet. Add the papers this exam will cover.'
                      : 'No subjects listed for this class in this exam.'}
                  </div>
                )}
                {subjectsLoading && <div className="empty-state large">Loading subjects…</div>}
              </div>

              <p className="cal-hint">
                <Info size={14} />
                A Compulsory subject must be passed under the exam’s passing rule. A Grade-Only subject (for example Drawing or
                Nazra) is awarded a letter instead of marks and is left out of totals, percentage and position. Sort Order decides
                the order subjects appear on the report card.
              </p>
            </>
          )}
        </section>
      </div>

      {examForm && (
        <div className="notice-overlay" onClick={() => setExamForm(null)}>
          <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow"><CalendarRange size={14} /> {examForm.id ? 'Edit exam' : 'New exam'}</span>
              <button className="close-button" onClick={() => setExamForm(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-800">{examForm.id ? 'Edit this exam' : 'Add an examination'}</h2>
            <p className="mt-1 text-sm text-slate-500">The name is what staff and parents will see on marks sheets and report cards.</p>
            <form onSubmit={submitExam} className="mt-4 flex flex-col gap-4">
              <label className="control-field">Exam name
                <input
                  value={examForm.name}
                  onChange={(event) => setExamForm({ ...examForm, name: event.target.value })}
                  placeholder="e.g. First Term"
                  required
                />
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="control-field">Starts on
                  <input type="date" value={examForm.start} onChange={(event) => setExamForm({ ...examForm, start: event.target.value })} />
                </label>
                <label className="control-field">Ends on
                  <input type="date" value={examForm.end} onChange={(event) => setExamForm({ ...examForm, end: event.target.value })} />
                </label>
              </div>

              <fieldset className="passing-policy">
                <legend>Passing policy</legend>
                <label className="control-field compact">Minimum aggregate pass percentage
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={examForm.minPass}
                    onChange={(event) => setExamForm({ ...examForm, minPass: event.target.value })}
                    required
                  />
                </label>
                <div className="passing-rule-list">
                  {PASSING_RULES.map((rule) => (
                    <label key={rule.value} className={`passing-rule ${examForm.rule === rule.value ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="passing-rule"
                        className="h-4 w-4 accent-sky-600"
                        checked={examForm.rule === rule.value}
                        onChange={() => setExamForm({ ...examForm, rule: rule.value })}
                      />
                      <span>
                        <strong>{rule.label}</strong>
                        <small>{rule.hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="att-filter-check">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-600"
                  checked={examForm.active}
                  onChange={(event) => setExamForm({ ...examForm, active: event.target.checked })}
                />
                <span>Open for marks entry</span>
              </label>
              {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
              <div className="notice-preview-actions">
                <button type="button" className="secondary-button" onClick={() => setExamForm(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {examForm.id ? 'Save exam' : 'Add exam'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {subjectForm && (
        <div className="notice-overlay" onClick={() => setSubjectForm(null)}>
          <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow"><GraduationCap size={14} /> {subjectForm.id ? 'Edit subject' : 'New subject'}</span>
              <button className="close-button" onClick={() => setSubjectForm(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-800">{subjectForm.id ? 'Edit this subject' : 'Add a subject'}</h2>
            <p className="mt-1 text-sm text-slate-500">Set the paper total and pass mark, and how the subject counts towards the result.</p>
            <form onSubmit={submitSubject} className="mt-4 flex flex-col gap-4">
              <label className="control-field">Class
                <select value={subjectForm.className} onChange={(event) => setSubjectForm({ ...subjectForm, className: event.target.value })}>
                  {CLASS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="control-field">Subject name
                <input
                  value={subjectForm.subject}
                  onChange={(event) => setSubjectForm({ ...subjectForm, subject: event.target.value })}
                  placeholder="e.g. Mathematics"
                  required
                />
              </label>

              <div className="flex flex-wrap gap-4">
                <label className="control-field">Total marks
                  <input
                    type="number" min="1" step="0.5"
                    value={subjectForm.max}
                    onChange={(event) => setSubjectForm({ ...subjectForm, max: event.target.value })}
                    disabled={subjectForm.gradeOnly}
                    required={!subjectForm.gradeOnly}
                  />
                </label>
                <label className="control-field">Pass marks
                  <input
                    type="number" min="0" step="0.5"
                    value={subjectForm.pass}
                    onChange={(event) => setSubjectForm({ ...subjectForm, pass: event.target.value })}
                    disabled={subjectForm.gradeOnly}
                    required={!subjectForm.gradeOnly}
                  />
                </label>
                <label className="control-field">Sort order
                  <input
                    type="number" min="0" step="1"
                    value={subjectForm.order}
                    onChange={(event) => setSubjectForm({ ...subjectForm, order: event.target.value })}
                    required
                  />
                </label>
              </div>

              <div className="subject-toggle-grid">
                <label className={`subject-toggle ${subjectForm.compulsory ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-600"
                    checked={subjectForm.compulsory}
                    onChange={(event) => setSubjectForm({ ...subjectForm, compulsory: event.target.checked })}
                  />
                  <span><strong>Compulsory</strong><small>Passing this subject is mandatory</small></span>
                </label>
                <label className={`subject-toggle ${subjectForm.gradeOnly ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-600"
                    checked={subjectForm.gradeOnly}
                    onChange={(event) => setSubjectForm({ ...subjectForm, gradeOnly: event.target.checked })}
                  />
                  <span><strong>Grade-only subject</strong><small>Enter a grade, not marks — left out of totals</small></span>
                </label>
                <label className={`subject-toggle ${subjectForm.optional ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-600"
                    checked={subjectForm.optional}
                    onChange={(event) => setSubjectForm({ ...subjectForm, optional: event.target.checked })}
                  />
                  <span><strong>Optional subject</strong><small>An extra subject a student may take</small></span>
                </label>
              </div>

              {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
              <div className="notice-preview-actions">
                <button type="button" className="secondary-button" onClick={() => setSubjectForm(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {subjectForm.id ? 'Save subject' : 'Add subject'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
