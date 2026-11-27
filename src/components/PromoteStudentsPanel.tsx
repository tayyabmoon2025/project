import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, CheckCheck, GraduationCap, History,
  Loader2, Save, Search, Users, X,
} from 'lucide-react';
import type { Student } from '@/lib/schoolTypes';
import { useClassOptions, useSectionOptions } from '@/lib/classSections';
import {
  FINAL_CLASS, OUTCOME_LABELS, RESULT_LABELS,
  currentSession, fetchFinalResults, fetchPromotionRecords, isFinalClass, nextClassFor,
  promoteStudents, saveFinalResult,
  type FinalResultStatus, type PromotionEntry, type PromotionOutcome, type PromotionRecord,
} from '@/lib/promotions';

type Draft = {
  selected: boolean;
  outcome: PromotionOutcome;
  toClass: string;
  toSection: string;
  condition: string;
};

const formatStamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The starting decision for one student: where they move to, and whether a failing
// result needs an explicit choice before they can be sent up.
function initialDraft(student: Student, result: FinalResultStatus | null, classNames: string[], finalClass: string): Draft {
  const target = nextClassFor(student.class_name, classNames);
  const lastClass = isFinalClass(student.class_name, finalClass);
  const needsDecision = lastClass || result === 'failed';
  return {
    selected: !needsDecision,
    outcome: lastClass ? 'passed_out' : 'promoted',
    toClass: target ?? '',
    toSection: student.section_name ?? '',
    condition: '',
  };
}

export function PromoteStudentsPanel({
  students,
  onToast,
  onRefresh,
}: {
  students: Student[];
  onToast: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [session, setSession] = useState(currentSession);
  const classNames = useClassOptions();
  const sectionNames = useSectionOptions();
  // The school's own list decides which class is the last one, so renaming or adding a
  // class is picked up here without any change to this screen.
  const finalClass = classNames[classNames.length - 1] ?? FINAL_CLASS;
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Record<string, FinalResultStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [history, setHistory] = useState<PromotionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingResultId, setSavingResultId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Sections actually in use, so a school with three sections is not offered a fourth.
  const knownSections = useMemo(() => {
    const used = new Set(students.map((student) => (student.section_name ?? '').trim()).filter(Boolean));
    const merged = [...sectionNames, ...Array.from(used)].filter((value, index, all) => all.indexOf(value) === index);
    return merged.sort();
  }, [students, sectionNames]);

  // Rebuilding the drafts whenever the session or the student list changes keeps the
  // starting choice correct without carrying a stale one across.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [resultData, historyData] = await Promise.all([
        fetchFinalResults(session),
        fetchPromotionRecords(),
      ]);
      if (cancelled) return;
      const byStudent = resultData.results.reduce<Record<string, FinalResultStatus>>((accumulator, row) => {
        accumulator[row.student_id] = row.status;
        return accumulator;
      }, {});
      setResults(byStudent);
      setDrafts(Object.fromEntries(students.map((student) => [student.id, initialDraft(student, byStudent[student.id] ?? null, classNames, finalClass)])));
      if (!historyData.error) setHistory(historyData.records);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session, students, classNames, finalClass]);

  const promotable = useMemo(
    () => students.filter((student) => student.status === 'active'),
    [students],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return promotable.filter((student) => {
      if (classFilter && student.class_name !== classFilter) return false;
      if (!term) return true;
      return `${student.full_name} ${student.admission_number} ${student.section_name}`.toLowerCase().includes(term);
    });
  }, [promotable, classFilter, search]);

  const classesPresent = useMemo(() => {
    const present = new Set(promotable.map((student) => student.class_name));
    return classNames.filter((option) => present.has(option));
  }, [promotable, classNames]);

  const draftFor = (student: Student): Draft => drafts[student.id] ?? initialDraft(student, results[student.id] ?? null, classNames, finalClass);

  const patchDraft = (id: string, patch: Partial<Draft>) => setDrafts((current) => {
    const student = students.find((item) => item.id === id);
    if (!student) return current;
    const base = current[id] ?? initialDraft(student, results[id] ?? null, classNames, finalClass);
    return { ...current, [id]: { ...base, ...patch } };
  });

  const selectable = visible.filter((student) => !isFinalClass(student.class_name, finalClass));
  const allSelected = selectable.length > 0 && selectable.every((student) => draftFor(student).selected);

  const selectAll = (checked: boolean) => setDrafts((current) => {
    const next = { ...current };
    for (const student of selectable) {
      const base = next[student.id] ?? initialDraft(student, results[student.id] ?? null, classNames, finalClass);
      next[student.id] = { ...base, selected: checked };
    }
    return next;
  });

  const toggleOne = (student: Student) => patchDraft(student.id, { selected: !draftFor(student).selected });

  const setResult = async (student: Student, status: FinalResultStatus) => {
    setSavingResultId(student.id);
    const error = await saveFinalResult(student.id, session, status);
    setSavingResultId('');
    if (error) { onToast(error); return; }
    setResults((current) => ({ ...current, [student.id]: status }));
    // A student whose final result is recorded as failed is never promoted by default:
    // the admin has to choose between conditional promotion and holding them back.
    if (status === 'failed') patchDraft(student.id, { selected: false });
    onToast(`Final term result for ${student.full_name} saved as ${RESULT_LABELS[status]}.`);
  };

  const chosen = visible.filter((student) => draftFor(student).selected);

  const blockers = chosen.flatMap((student) => {
    const draft = draftFor(student);
    if (draft.outcome === 'conditional') {
      return draft.condition.trim() ? [] : [`${student.full_name}: add the condition for a conditional promotion`];
    }
    if (draft.outcome === 'passed_out') return [];
    if (!draft.toClass) return [`${student.full_name}: choose the next class`];
    if (!draft.toSection) return [`${student.full_name}: choose the next section`];
    return [];
  });

  const failedSelected = chosen.filter((student) => results[student.id] === 'failed').length;
  const passingOut = chosen.filter((student) => draftFor(student).outcome === 'passed_out').length;
  const conditionalCount = chosen.filter((student) => draftFor(student).outcome === 'conditional').length;

  const promote = async () => {
    if (chosen.length === 0) { onToast('Tick the students you want to promote first.'); return; }
    if (blockers.length > 0) { onToast(`${blockers.length} student${blockers.length === 1 ? ' still needs' : 's still need'} a next class, section or condition.`); return; }
    setConfirming(false);
    setBusy(true);
    const entries: PromotionEntry[] = chosen.map((student) => {
      const draft = draftFor(student);
      return {
        student_id: student.id,
        outcome: draft.outcome,
        to_class: draft.outcome === 'passed_out' ? null : draft.toClass,
        to_section: draft.outcome === 'passed_out' ? null : draft.toSection,
        condition_note: draft.outcome === 'conditional' ? draft.condition.trim() : null,
      };
    });
    const result = await promoteStudents(entries, session);
    setBusy(false);
    if (result.error) { onToast(result.error); return; }

    await onRefresh();
    const historyData = await fetchPromotionRecords();
    if (!historyData.error) setHistory(historyData.records);
    onToast(`${result.promoted} student${result.promoted === 1 ? '' : 's'} updated for ${session}. The promotion history has been saved.`);
  };

  const finalClassCount = promotable.filter((student) => isFinalClass(student.class_name, finalClass)).length;

  return (
    <div className="promote-panel">
      <div className="panel promote-toolbar">
        <div className="promote-toolbar-head">
          <div>
            <span className="eyebrow">Promote students</span>
            <h2>{promotable.length} active student{promotable.length === 1 ? '' : 's'} ready to review</h2>
            <p className="panel-subtitle">
              Each student's next class is worked out from their own current class, so Class 1 moves to Class 2 and Class 10 passes out.
              Record the final term result first, then promote. Every decision is stored in the promotion history.
            </p>
          </div>
          <span className="promote-session-badge"><GraduationCap size={15} /> Session {session}</span>
        </div>
        <div className="promote-toolbar-controls">
          <label className="control-field">Session
            <input value={session} onChange={(event) => setSession(event.target.value)} placeholder="2026-2027" />
          </label>
          <label className="control-field">Class
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classesPresent.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student or admission number" />
          </label>
          <button type="button" className="secondary-button" onClick={() => { setClassFilter(''); setSearch(''); }}>
            <Search size={15} /> Clear
          </button>
        </div>
      </div>

      {finalClassCount > 0 && (
        <p className="promote-note">
          {finalClassCount} student{finalClassCount === 1 ? ' is' : 's are'} in {finalClass}. Choose Pass out to mark them as
          Passed Out / Inactive — they leave the active class lists and their full record stays in the school history.
        </p>
      )}

      {loading ? (
        <div className="panel roster-panel"><div className="empty-state large"><Loader2 size={20} className="spin" /> Loading the promotion list…</div></div>
      ) : promotable.length === 0 ? (
        <div className="panel roster-panel"><div className="empty-state large"><Users size={20} /> No active students to promote.</div></div>
      ) : (
        <>
          <div className="panel promote-list-panel">
            <div className="promote-list-head">
              <div className="promote-list-stats">
                <span className="promote-chip total"><Users size={14} /> {visible.length} shown</span>
                <span className="promote-chip chosen"><CheckCheck size={14} /> {chosen.length} selected</span>
                {failedSelected > 0 && <span className="promote-chip failed"><AlertTriangle size={14} /> {failedSelected} failed selected</span>}
                {passingOut > 0 && <span className="promote-chip out"><GraduationCap size={14} /> {passingOut} passing out</span>}
              </div>
              <div className="promote-list-actions">
                <button type="button" className="secondary-button" onClick={() => selectAll(true)} disabled={allSelected}>Select all</button>
                <button type="button" className="secondary-button" onClick={() => selectAll(false)} disabled={chosen.length === 0}>Unselect all</button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="min-w-[1080px]">
                <thead>
                  <tr>
                    <th className="promote-check" />
                    <th>Student</th>
                    <th>Current class</th>
                    <th>Final term result</th>
                    <th>Promotion</th>
                    <th>Next class</th>
                    <th>Next section</th>
                    <th>Condition / reason</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((student) => {
                    const draft = draftFor(student);
                    const result = results[student.id] ?? null;
                    const lastClass = isFinalClass(student.class_name, finalClass);
                    const saving = savingResultId === student.id;
                    return (
                      <tr key={student.id} className={draft.selected ? 'promote-row chosen' : 'promote-row'}>
                        <td className="promote-check">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-sky-600"
                            checked={draft.selected}
                            onChange={() => toggleOne(student)}
                            aria-label={`Select ${student.full_name}`}
                          />
                        </td>
                        <td>
                          <strong>{student.full_name}</strong>
                          <small className="promote-sub">{student.admission_number}</small>
                        </td>
                        <td>{student.class_name} · {student.section_name ?? '—'}</td>
                        <td>
                          <div className="promote-result">
                            <span className={`result-badge ${result ?? 'pending'}`}>
                              {result === 'passed' ? <Check size={13} /> : result === 'failed' ? <AlertTriangle size={13} /> : null}
                              {RESULT_LABELS[result ?? 'pending']}
                            </span>
                            <div className="result-actions">
                              {(['passed', 'failed'] as const).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className={`result-button ${option} ${result === option ? 'on' : ''}`}
                                  disabled={saving}
                                  onClick={() => void setResult(student, option)}
                                >
                                  {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} {RESULT_LABELS[option]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            className="promote-select"
                            value={draft.outcome}
                            disabled={!draft.selected}
                            onChange={(event) => patchDraft(student.id, { outcome: event.target.value as PromotionOutcome })}
                          >
                            {!lastClass && <option value="promoted">Promote to next class</option>}
                            {!lastClass && <option value="conditional">Conditional promotion</option>}
                            {lastClass && <option value="passed_out">Pass out (Passed Out / Inactive)</option>}
                            {!lastClass && result === 'failed' && <option value="passed_out">Do not promote (keep in class)</option>}
                          </select>
                          {lastClass && <small className="promote-hint">Last class — students pass out here.</small>}
                          {!lastClass && result === 'failed' && <small className="promote-hint warn">Final result is Failed — review before promoting.</small>}
                        </td>
                        <td>
                          {draft.outcome === 'passed_out' ? (
                            <span className="promote-static">{lastClass ? '— Passed out —' : 'Stays in ' + student.class_name}</span>
                          ) : (
                            <select
                              className="promote-select"
                              value={draft.toClass}
                              disabled={!draft.selected}
                              onChange={(event) => patchDraft(student.id, { toClass: event.target.value })}
                            >
                              <option value="">Choose class</option>
                              {classNames.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          {draft.outcome === 'passed_out' ? (
                            <span className="promote-static">—</span>
                          ) : (
                            <select
                              className="promote-select"
                              value={draft.toSection}
                              disabled={!draft.selected}
                              onChange={(event) => patchDraft(student.id, { toSection: event.target.value })}
                            >
                              <option value="">Choose section</option>
                              {knownSections.map((option) => <option key={option} value={option}>Section {option}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          <input
                            className="promote-condition"
                            value={draft.condition}
                            disabled={!draft.selected || draft.outcome !== 'conditional'}
                            placeholder={draft.outcome === 'conditional' ? 'e.g. Promoted on condition of clearing fee dues' : 'Only for conditional promotion'}
                            onChange={(event) => patchDraft(student.id, { condition: event.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 && (
                <div className="empty-state large">
                  <Search size={20} />
                  No active student matches these filters. Try clearing the class or the search.
                </div>
              )}
            </div>
          </div>

          <div className="panel promote-action-bar">
            <div className="promote-action-copy">
              {chosen.length === 0
                ? 'Tick the students you want to move up, or use Select all.'
                : blockers.length > 0
                  ? `${chosen.length} selected · ${blockers.length} still need a next class, section or condition`
                  : `${chosen.length} student${chosen.length === 1 ? '' : 's'} ready · ${passingOut} passing out, ${failedSelected} with a failed result`}
            </div>
            <div className="promote-action-buttons">
              <button type="button" className="ghost-button" onClick={() => setHistoryOpen(true)}><History size={15} /> Promotion history</button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || chosen.length === 0 || blockers.length > 0}
                onClick={() => setConfirming(true)}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <GraduationCap size={16} />}
                {busy ? 'Promoting…' : `Promote ${chosen.length || ''} selected`}
              </button>
            </div>
          </div>
        </>
      )}

      {confirming && (
        <div className="promote-overlay" role="dialog" aria-modal="true">
          <div className="promote-confirm">
            <div className="promote-confirm-head">
              <span className="promote-confirm-icon"><GraduationCap size={20} /></span>
              <div>
                <h3>Promote {chosen.length} student{chosen.length === 1 ? '' : 's'}?</h3>
                <p>Session {session}. This moves each student to the class and section chosen, and saves the decision to the promotion history.</p>
              </div>
            </div>
            <ul className="promote-confirm-list">
              <li><strong>{chosen.length - passingOut - conditionalCount}</strong> promoted to the next class</li>
              <li><strong>{conditionalCount}</strong> promoted with a condition</li>
              <li><strong>{passingOut}</strong> passing out (Passed Out / Inactive)</li>
              {failedSelected > 0 && <li className="warn"><strong>{failedSelected}</strong> have a failed final result</li>}
            </ul>
            <div className="promote-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}><X size={15} /> Cancel</button>
              <button type="button" className="primary-button" onClick={() => void promote()}><CheckCheck size={16} /> Confirm promotion</button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="promote-overlay" role="dialog" aria-modal="true" onClick={() => setHistoryOpen(false)}>
          <div className="promote-history" onClick={(event) => event.stopPropagation()}>
            <div className="promote-history-head">
              <div>
                <span className="eyebrow">Saved record</span>
                <h3>Promotion history</h3>
                <p>Every promotion, including the condition attached to a conditional promotion, kept for later reference.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setHistoryOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            {history.length === 0 ? (
              <p className="empty-state">No promotions have been recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="min-w-[760px]">
                  <thead>
                    <tr><th>Student</th><th>From</th><th>To</th><th>Outcome</th><th>Condition</th><th>Session</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {history.map((record) => (
                      <tr key={record.id}>
                        <td><strong>{record.student_name}</strong></td>
                        <td className="muted-cell">{record.from_class ? `${record.from_class} · ${record.from_section ?? '—'}` : '—'}</td>
                        <td className="muted-cell">{record.to_class ? `${record.to_class} · ${record.to_section ?? '—'}` : 'Passed out'}</td>
                        <td><span className={`outcome-badge ${record.outcome}`}>{OUTCOME_LABELS[record.outcome]}</span></td>
                        <td className="promote-condition-cell">{record.condition_note || <span className="muted-cell">—</span>}</td>
                        <td className="muted-cell">{record.session}</td>
                        <td className="muted-cell">{formatStamp(record.promoted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
