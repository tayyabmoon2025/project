import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ClipboardCheck, Loader2, Save } from 'lucide-react';
import { formatDisplayDate } from '@/lib/classOffDays';
import {
  COMPLETION_LABELS,
  COMPLETION_TONES,
  markHomeworkSeen,
  saveCompletions,
  type HomeworkCompletion,
  type HomeworkCompletionStatus,
  type HomeworkEntry,
} from '@/lib/homework';
import { HomeworkSeenPanel } from '@/components/HomeworkSeenPanel';
import type { Student } from '@/lib/schoolTypes';

type Toast = (message: string) => void;

const STATUS_OPTIONS: HomeworkCompletionStatus[] = ['pending', 'submitted', 'late', 'missing'];

export function HomeworkSubmissionsPanel({
  entries,
  students,
  completions,
  canMark,
  focusId,
  currentUserId,
  onReload,
  onToast,
}: {
  entries: HomeworkEntry[];
  students: Student[];
  completions: HomeworkCompletion[];
  canMark: boolean;
  focusId: string;
  currentUserId: string | null;
  onReload: () => void | Promise<void>;
  onToast: Toast;
}) {
  // Only published work is worth marking: a draft has not reached the class yet.
  const published = useMemo(
    () => entries.filter((entry) => entry.status === 'published'),
    [entries],
  );

  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Record<string, { status: HomeworkCompletionStatus; remarks: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenRefresh, setSeenRefresh] = useState(0);
  const markedSeen = useRef('');

  useEffect(() => {
    if (published.length === 0) { setSelectedId(''); return; }
    if (!published.some((entry) => entry.id === selectedId)) setSelectedId(published[0].id);
  }, [published, selectedId]);

  // Opening the marking screen from the homework list jumps straight to that entry.
  useEffect(() => {
    if (!focusId) return;
    if (published.some((entry) => entry.id === focusId)) setSelectedId(focusId);
  }, [focusId, published]);

  const selected = useMemo(
    () => published.find((entry) => entry.id === selectedId) ?? null,
    [published, selectedId],
  );

  // Simply opening an assignment records that this staff member has seen it. It is
  // recorded once per assignment, and only ever for the signed-in account.
  useEffect(() => {
    if (!selected || !currentUserId) return;
    if (markedSeen.current === selected.id) return;
    markedSeen.current = selected.id;
    void markHomeworkSeen(selected.id).then(() => setSeenRefresh((count) => count + 1));
  }, [selected, currentUserId]);

  const roster = useMemo(
    () => (selected
      ? students
        .filter((student) => student.status === 'active'
          && student.class_name === selected.class_name
          && student.section_name === selected.section_name)
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
      : []),
    [students, selected],
  );

  // The saved rows become the starting point every time a different assignment
  // is opened, so switching between them never carries marks across.
  useEffect(() => {
    if (!selected) { setDraft({}); return; }
    const next: Record<string, { status: HomeworkCompletionStatus; remarks: string }> = {};
    for (const student of roster) {
      const saved = completions.find((row) => row.homework_id === selected.id && row.student_id === student.id);
      next[student.id] = { status: saved?.status ?? 'pending', remarks: saved?.remarks ?? '' };
    }
    setDraft(next);
  }, [selected, roster, completions]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const failure = await saveCompletions(
      selected.id,
      roster.map((student) => ({
        student_id: student.id,
        status: draft[student.id]?.status ?? 'pending',
        remarks: draft[student.id]?.remarks ?? '',
      })),
    );
    setSaving(false);
    if (failure) { setError(failure); onToast(failure); return; }
    onToast(`Submissions saved for ${selected.class_name}-${selected.section_name} ${selected.subject_name}`);
    await onReload();
  };

  const markAll = (status: HomeworkCompletionStatus) =>
    setDraft((current) => {
      const next = { ...current };
      for (const student of roster) next[student.id] = { status, remarks: next[student.id]?.remarks ?? '' };
      return next;
    });

  const counts = useMemo(() => {
    const tally: Record<HomeworkCompletionStatus, number> = { pending: 0, submitted: 0, late: 0, missing: 0 };
    for (const student of roster) tally[draft[student.id]?.status ?? 'pending'] += 1;
    return tally;
  }, [draft, roster]);

  // Everyone still outstanding: nobody has recorded a submission for them yet.
  const outstanding = useMemo(
    () => roster.filter((student) => {
      const status = draft[student.id]?.status ?? 'pending';
      return status === 'pending' || status === 'missing';
    }),
    [roster, draft],
  );

  if (published.length === 0) {
    return (
      <div className="fee-card">
        <p className="fee-empty">Publish some homework first. Only published work can be marked.</p>
      </div>
    );
  }

  return (
    <>
      <div className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Submissions</span>
            <h2>{selected ? `${selected.class_name}-${selected.section_name} · ${selected.subject_name}` : 'Choose homework'}</h2>
          </div>
          {canMark && selected && (
            <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || roster.length === 0}>
              {saving ? <Loader2 size={16} className="assistant-spin" /> : <Save size={16} />} Save submissions
            </button>
          )}
        </div>

        <div className="fee-filters">
          <label className="control-field hw-submission-picker">
            <span>Homework</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {published.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {formatDisplayDate(entry.homework_date)} · {entry.class_name}-{entry.section_name} · {entry.subject_name} · {entry.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>}

        {selected && (
          <>
            {outstanding.length > 0 && (
              <div className="hw-alert-banner inline" role="status">
                <span className="hw-alert-icon"><AlertTriangle size={18} /></span>
                <div className="hw-alert-body">
                  <strong>
                    {outstanding.length} of {roster.length} student{roster.length === 1 ? '' : 's'} still to hand this in
                  </strong>
                  <p>
                    {counts.missing > 0
                      ? `${counts.missing} marked as not submitted, ${counts.pending} not marked yet.`
                      : 'Nobody has recorded a submission for them yet.'}
                  </p>
                  <div className="hw-alert-chips">
                    {outstanding.slice(0, 8).map((student) => (
                      <span key={student.id} className="hw-alert-chip static">
                        {student.full_name}
                        <span>{student.admission_number}</span>
                      </span>
                    ))}
                    {outstanding.length > 8 && <span className="hw-alert-more">+{outstanding.length - 8} more</span>}
                  </div>
                </div>
              </div>
            )}

            <div className="hw-summary-row">
              <div className="hw-summary"><span>Students</span><strong>{roster.length}</strong></div>
              <div className="hw-summary"><span>Submitted</span><strong>{counts.submitted + counts.late}</strong></div>
              <div className={`hw-summary ${counts.missing > 0 ? 'warn' : ''}`}><span>Not submitted</span><strong>{counts.missing}</strong></div>
              <div className={`hw-summary ${counts.pending > 0 ? 'warn' : ''}`}><span>Not marked</span><strong>{counts.pending}</strong></div>
            </div>

            {canMark && roster.length > 0 && (
              <div className="hw-bulk-actions">
                <span>Mark everyone as</span>
                {STATUS_OPTIONS.filter((status) => status !== 'pending').map((status) => (
                  <button key={status} className="ghost-button" type="button" onClick={() => markAll(status)}>
                    {COMPLETION_LABELS[status]}
                  </button>
                ))}
                <button className="ghost-button" type="button" onClick={() => markAll('pending')}>Clear all</button>
              </div>
            )}

            {roster.length === 0 ? (
              <p className="fee-empty">No active student is on record for {selected.class_name}-{selected.section_name}.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Student</th><th>Admission no.</th><th>Status</th><th>Remarks</th></tr></thead>
                  <tbody>
                    {roster.map((student) => {
                      const row = draft[student.id] ?? { status: 'pending' as HomeworkCompletionStatus, remarks: '' };
                      const outstandingRow = row.status === 'pending' || row.status === 'missing';
                      return (
                        <tr key={student.id} className={outstandingRow ? 'hw-row-pending' : ''}>
                          <td>
                            <div className="table-student">
                              {outstandingRow ? <AlertTriangle size={14} /> : <ClipboardCheck size={14} />}
                              <strong>{student.full_name}</strong>
                            </div>
                          </td>
                          <td className="fee-mono">{student.admission_number}</td>
                          <td>
                            {canMark ? (
                              <select
                                className="util-status-select"
                                value={row.status}
                                onChange={(event) => setDraft((current) => ({
                                  ...current,
                                  [student.id]: { status: event.target.value as HomeworkCompletionStatus, remarks: current[student.id]?.remarks ?? '' },
                                }))}
                              >
                                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{COMPLETION_LABELS[status]}</option>)}
                              </select>
                            ) : (
                              <span className={`fee-status ${COMPLETION_TONES[row.status]}`}>{COMPLETION_LABELS[row.status]}</span>
                            )}
                          </td>
                          <td>
                            {canMark ? (
                              <input
                                className="hw-remarks-input"
                                value={row.remarks}
                                placeholder="Optional note"
                                onChange={(event) => setDraft((current) => ({
                                  ...current,
                                  [student.id]: { status: current[student.id]?.status ?? 'pending', remarks: event.target.value },
                                }))}
                              />
                            ) : (
                              <span>{row.remarks || '—'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <div className="fee-card">
          <HomeworkSeenPanel
            homeworkId={selected.id}
            currentUserId={currentUserId}
            refreshKey={seenRefresh}
            onToast={onToast}
          />
        </div>
      )}
    </>
  );
}
