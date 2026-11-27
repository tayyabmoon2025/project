import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import {
  AlertCircle,
  BookOpenCheck,
  CalendarDays,
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Loader2,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatDisplayDate } from '@/lib/classOffDays';
import { todayKey } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import { useClassOptions } from '@/lib/classSections';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { fetchAbsenteeSendMode } from '@/lib/absenteeAlerts';
import { fetchHomeworkAlerts } from '@/lib/homeworkAlerts';
import { ATTACHMENT_ACCEPT, uploadAbsenteeAttachment } from '@/lib/whatsapp';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { HomeworkSubmissionsPanel } from '@/components/HomeworkSubmissionsPanel';
import { HomeworkAlertsPanel } from '@/components/HomeworkAlertsPanel';
import { HomeworkSeenPanel } from '@/components/HomeworkSeenPanel';
import {
  COMPLETION_LABELS,
  HOMEWORK_STATUS_LABELS,
  createHomework,
  createHomeworkSheet,
  dailyDiaryText,
  deleteHomework,
  emptyHomeworkDraft,
  fetchCompletions,
  fetchHomework,
  fetchHomeworkViews,
  setHomeworkStatus,
  updateHomework,
  type HomeworkCompletion,
  type HomeworkDraft,
  type HomeworkEntry,
  type HomeworkStatus,
  type HomeworkView,
} from '@/lib/homework';
import type { Student } from '@/lib/schoolTypes';

type Toast = (message: string) => void;
type HomeworkTab = 'homework' | 'submissions' | 'alerts';

const SUBJECT_SUGGESTIONS = [
  'English', 'Urdu', 'Mathematics', 'Science', 'Islamiat', 'Social Studies',
  'Computer', 'Physics', 'Chemistry', 'Biology', 'Pakistan Studies',
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function HomeworkModule({ students, onToast, onQueueChanged }: { students: Student[]; onToast: Toast; onQueueChanged?: () => void }) {
  const { profile } = useAuth();
  const canAssign = profile?.role === 'admin' || profile?.role === 'teacher';

  const [tab, setTab] = useState<HomeworkTab>('homework');
  const [entries, setEntries] = useState<HomeworkEntry[]>([]);
  const [completions, setCompletions] = useState<HomeworkCompletion[]>([]);
  const [views, setViews] = useState<HomeworkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const CLASS_OPTIONS = useClassOptions();
  const [draft, setDraft] = useState<HomeworkDraft>(() => emptyHomeworkDraft(CLASS_OPTIONS[0], '', todayKey()));
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<HomeworkStatus | ''>('');
  const [diaryDate, setDiaryDate] = useState(todayKey());
  const [search, setSearch] = useState('');

  // A sheet covering several subjects is one file and one title, saved as one entry
  // per subject so the diary, the submissions list and the alerts all still work.
  const [sheetMode, setSheetMode] = useState(true);
  const [sheetSubjects, setSheetSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [seenEntry, setSeenEntry] = useState<HomeworkEntry | null>(null);
  const [focusHomeworkId, setFocusHomeworkId] = useState('');

  // The class and section pairs come from the roster, so the form only ever
  // offers a class the school actually runs.
  const classSections = useMemo(() => {
    const pairs = new Map<string, { class_name: string; section_name: string }>();
    for (const student of students) {
      if (student.status !== 'active') continue;
      pairs.set(`${student.class_name}|||${student.section_name}`, {
        class_name: student.class_name,
        section_name: student.section_name,
      });
    }
    return Array.from(pairs.values()).sort(
      (a, b) => a.class_name.localeCompare(b.class_name) || a.section_name.localeCompare(b.section_name),
    );
  }, [students]);

  const formClasses = useMemo(() => {
    const list = Array.from(new Set(classSections.map((pair) => pair.class_name)));
    return list.length ? list : CLASS_OPTIONS;
  }, [classSections, CLASS_OPTIONS]);

  const formSections = useMemo(
    () => classSections.filter((pair) => pair.class_name === draft.class_name).map((pair) => pair.section_name),
    [classSections, draft.class_name],
  );

  // How many active students sit in each class, so a missing submission can be
  // measured against the real class size.
  const rosterSize = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const student of students) {
      if (student.status !== 'active') continue;
      const key = `${student.class_name}|||${student.section_name}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    return sizes;
  }, [students]);

  const load = useCallback(async () => {
    setLoading(true);
    const { entries: list, error: listError } = await fetchHomework();
    setEntries(list);
    const ids = list.map((entry) => entry.id);
    const { completions: rows } = await fetchCompletions(ids);
    setCompletions(rows);
    const { views: seenRows } = await fetchHomeworkViews(ids);
    setViews(seenRows);
    setError(listError);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keep the section in step with the class, so a stale section can never be saved.
  useEffect(() => {
    if (formSections.length === 0) return;
    if (!formSections.includes(draft.section_name)) setDraft((current) => ({ ...current, section_name: formSections[0] }));
  }, [formSections, draft.section_name]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (classFilter && entry.class_name !== classFilter) return false;
      if (sectionFilter && entry.section_name !== sectionFilter) return false;
      if (subjectFilter && entry.subject_name !== subjectFilter) return false;
      if (statusFilter && entry.status !== statusFilter) return false;
      if (!needle) return true;
      return [entry.title, entry.subject_name, entry.details ?? '', entry.assigned_by_name ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, classFilter, sectionFilter, subjectFilter, statusFilter, search]);

  // Only the subjects actually set are offered, so the filter can never lead to an
  // empty list on its own.
  const subjectOptions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.subject_name))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  // A published assignment still waiting on work from part of the class. Anything
  // not yet marked counts as waiting, so nothing slips through unnoticed.
  const awaiting = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status !== 'published') continue;
      const size = rosterSize.get(`${entry.class_name}|||${entry.section_name}`) ?? 0;
      const marked = completions.filter((row) => row.homework_id === entry.id && row.status !== 'pending').length;
      map.set(entry.id, Math.max(size - marked, 0));
    }
    return map;
  }, [entries, completions, rosterSize]);

  const awaitingTotal = useMemo(
    () => Array.from(awaiting.values()).reduce((total, count) => total + count, 0),
    [awaiting],
  );

  const worstWaiting = useMemo(
    () => entries
      .filter((entry) => (awaiting.get(entry.id) ?? 0) > 0)
      .sort((a, b) => (awaiting.get(b.id) ?? 0) - (awaiting.get(a.id) ?? 0))
      .slice(0, 6),
    [entries, awaiting],
  );

  const seenCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const view of views) map.set(view.homework_id, (map.get(view.homework_id) ?? 0) + 1);
    return map;
  }, [views]);

  const diaryEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'published' && entry.homework_date === diaryDate),
    [entries, diaryDate],
  );

  const diaryText = useMemo(
    () => (diaryEntries.length ? dailyDiaryText(diaryEntries, diaryDate) : ''),
    [diaryEntries, diaryDate],
  );

  usePrintSheet(diaryEntries.length > 0, (
    <div className="print-only print-diary">
      <header className="print-diary-head">
        <SchoolLogo alt="" />
        <div>
          <strong>{SCHOOL_NAME}</strong>
          <span>Homework diary — {formatDisplayDate(diaryDate)}</span>
        </div>
      </header>
      <table>
        <thead><tr><th>Class</th><th>Subject</th><th>Homework</th><th>Hand in by</th><th>Teacher</th></tr></thead>
        <tbody>
          {diaryEntries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.class_name}-{entry.section_name}</td>
              <td>{entry.subject_name}</td>
              <td>
                <strong>{entry.title}</strong>
                {entry.details ? <span className="print-diary-detail">{entry.details}</span> : null}
              </td>
              <td>{entry.due_date ? formatDisplayDate(entry.due_date) : '—'}</td>
              <td>{entry.assigned_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="print-diary-foot">Please make sure the work is completed and signed. Thank you.</p>
    </div>
  ));

  const openNew = () => {
    const first = classSections[0];
    setEditingId(null);
    setDraft(emptyHomeworkDraft(first?.class_name ?? CLASS_OPTIONS[0], first?.section_name ?? '', todayKey()));
    setSheetMode(true);
    setSheetSubjects([]);
    setNewSubject('');
    setFormOpen(true);
  };

  const openEdit = (entry: HomeworkEntry) => {
    setEditingId(entry.id);
    setDraft({
      class_name: entry.class_name,
      section_name: entry.section_name,
      subject_name: entry.subject_name,
      title: entry.title,
      details: entry.details ?? '',
      homework_date: entry.homework_date,
      due_date: entry.due_date ?? '',
      attachment_url: entry.attachment_url ?? '',
      status: entry.status,
    });
    setSheetMode(false);
    setSheetSubjects([entry.subject_name]);
    setFormOpen(true);
  };

  const toggleSheetSubject = (subject: string) =>
    setSheetSubjects((current) => (current.includes(subject)
      ? current.filter((item) => item !== subject)
      : [...current, subject]));

  const addSheetSubject = () => {
    const value = newSubject.trim();
    if (!value) return;
    setSheetSubjects((current) => (current.includes(value) ? current : [...current, value]));
    setNewSubject('');
  };

  const pickAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    const result = await uploadAbsenteeAttachment(file);
    setUploading(false);
    if (result.error) { onToast(result.error); return; }
    setDraft((current) => ({ ...current, attachment_url: result.url }));
    onToast(`${result.name} attached. It will be shared with the class as a link.`);
  };

  // One request covers every subject on the sheet, so the guardians are counted once.
  const alertSummaryFor = async (ids: string[]): Promise<string> => {
    if (ids.length === 0) return '';
    const { entries: rows, error: alertError } = await fetchHomeworkAlerts({ date: '', status: 'queued' });
    if (alertError) return '';
    const waiting = rows.filter((row) => ids.includes(row.homework_id));
    if (waiting.length === 0) return ' No guardian was notified — no active student in that class has a usable contact number, or the class has no students yet.';
    return ` ${waiting.length} guardian${waiting.length === 1 ? '' : 's'} notified in the portal and added to the WhatsApp alert list.`;
  };

  const validateSheet = (): string | null => {
    if (!draft.class_name.trim()) return 'Choose the class the work is for.';
    if (!draft.section_name.trim()) return 'Choose the section the work is for.';
    if (draft.title.trim().length < 2) return 'Enter a short title for the homework.';
    if (!draft.homework_date) return 'Choose the date the work is set.';
    if (draft.due_date && draft.due_date < draft.homework_date) return 'The hand-in date cannot be before the date the work is set.';
    if (sheetSubjects.length === 0) return 'Choose at least one subject this sheet covers.';
    return null;
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setSheetMode(true);
    setSheetSubjects([]);
    setNewSubject('');
  };

  const save = async (status: HomeworkStatus) => {
    // A new sheet is saved once per subject, all sharing the same file and title.
    if (sheetMode && !editingId) {
      const invalid = validateSheet();
      if (invalid) { onToast(invalid); return; }
      setSaving(true);
      const result = await createHomeworkSheet({ ...draft, subject_name: sheetSubjects[0], status }, sheetSubjects, profile);
      setSaving(false);
      if (result.error) { onToast(result.error); return; }
      const summary = status === 'published' ? await alertSummaryFor(result.ids) : '';
      const skipped = result.skipped > 0
        ? ` ${result.skipped} subject${result.skipped === 1 ? '' : 's'} already had work for this date and were left as they were.`
        : '';
      onToast(`${status === 'published' ? 'Sheet published to the class.' : 'Sheet saved as a draft.'} ${result.created} subject${result.created === 1 ? '' : 's'} saved.${skipped}${summary}`);
      closeForm();
      await load();
      if (status === 'published') onQueueChanged?.();
      return;
    }

    const next: HomeworkDraft = { ...draft, status };
    setSaving(true);
    const result = editingId ? await updateHomework(editingId, next) : await createHomework(next, profile);
    setSaving(false);
    if (result.error) { onToast(result.error); return; }
    const publishedNow = status === 'published' && result.entry;
    const summary = publishedNow ? await alertSummaryFor([result.entry!.id]) : '';
    onToast(status === 'published' ? `Homework published to the class.${summary}` : 'Homework saved as a draft');
    setDraft(next);
    closeForm();
    await load();
    if (publishedNow) onQueueChanged?.();
  };

  const toggleStatus = async (entry: HomeworkEntry) => {
    const next: HomeworkStatus = entry.status === 'published' ? 'draft' : 'published';
    const failure = await setHomeworkStatus(entry.id, next);
    if (failure) { onToast(failure); return; }
    const summary = next === 'published' ? await alertSummaryFor([entry.id]) : '';
    onToast(next === 'published' ? `Homework published to the class.${summary}` : 'Homework moved back to draft');
    await load();
    if (next === 'published') onQueueChanged?.();
  };

  const remove = async (entry: HomeworkEntry) => {
    const failure = await deleteHomework(entry.id);
    if (failure) { onToast(failure); return; }
    onToast('Homework removed');
    await load();
  };

  const openSubmissionsFor = (entry: HomeworkEntry) => {
    setFocusHomeworkId(entry.id);
    setTab('submissions');
  };

  const shareDiary = async () => {
    if (!diaryText) return;
    const mode = await fetchAbsenteeSendMode();
    const result = openWhatsAppChat(null, diaryText, mode);
    if (!result.ok) {
      const copied = await copyText(diaryText);
      onToast(copied ? 'WhatsApp could not open. The diary was copied instead.' : 'WhatsApp could not open.');
    }
  };

  const markedCount = (homeworkId: string) =>
    completions.filter((row) => row.homework_id === homeworkId && row.status !== 'pending').length;

  const sheetReady = !sheetMode || editingId || sheetSubjects.length > 0;

  return (
    <div className="admin-panel homework-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Homework</span>
          <h2>Homework &amp; Daily Diary</h2>
          <p>Set homework for a class, publish it when it is ready, and keep a diary that parents and students can read the same day.</p>
        </div>
        {canAssign && tab === 'homework' && !formOpen && (
          <button className="primary-button" type="button" onClick={openNew}><Plus size={17} /> Assign homework</button>
        )}
      </div>

      <div className="att-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'homework'}
          className={`att-tab ${tab === 'homework' ? 'active' : ''}`}
          onClick={() => setTab('homework')}
        >
          <BookOpenCheck size={15} />
          <span className="att-tab-label">Homework<small>Assign, publish and review</small></span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'submissions'}
          className={`att-tab ${tab === 'submissions' ? 'active' : ''}`}
          onClick={() => setTab('submissions')}
        >
          <ClipboardCopy size={15} />
          <span className="att-tab-label">Submissions<small>Mark who handed the work in</small></span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'alerts'}
          className={`att-tab ${tab === 'alerts' ? 'active' : ''}`}
          onClick={() => setTab('alerts')}
        >
          <Send size={15} />
          <span className="att-tab-label">WhatsApp alerts<small>Send homework notices to guardians</small></span>
        </button>
      </div>

      {error && <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>}

      {tab === 'alerts' ? (
        <HomeworkAlertsPanel homework={entries} onToast={onToast} onQueueChanged={onQueueChanged} />
      ) : tab === 'submissions' ? (
        <HomeworkSubmissionsPanel
          entries={entries}
          students={students}
          completions={completions}
          canMark={canAssign}
          focusId={focusHomeworkId}
          currentUserId={profile?.id ?? null}
          onReload={load}
          onToast={onToast}
        />
      ) : (
        <>
          {canAssign && awaitingTotal > 0 && (
            <div className="hw-alert-banner" role="status">
              <span className="hw-alert-icon"><AlertCircle size={18} /></span>
              <div className="hw-alert-body">
                <strong>{awaitingTotal} submission{awaitingTotal === 1 ? '' : 's'} still to come in</strong>
                <p>These published assignments are still waiting on work from part of the class.</p>
                <div className="hw-alert-chips">
                  {worstWaiting.map((entry) => (
                    <button key={entry.id} className="hw-alert-chip" type="button" onClick={() => openSubmissionsFor(entry)}>
                      {entry.class_name}-{entry.section_name} · {entry.subject_name}
                      <span>{awaiting.get(entry.id)} pending</span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="ghost-button" type="button" onClick={() => setTab('submissions')}>Mark submissions</button>
            </div>
          )}

          {formOpen && canAssign && (
            <div className="fee-card homework-form-card">
              <div className="fee-card-head">
                <div>
                  <span className="eyebrow">{editingId ? 'Edit homework' : sheetMode ? 'New homework sheet' : 'New homework'}</span>
                  <h2>{editingId ? draft.title || 'Untitled' : sheetMode ? 'One sheet, several subjects' : 'Set the work for a class'}</h2>
                </div>
                <button className="fee-link" type="button" onClick={closeForm}><X size={15} /> Close</button>
              </div>

              {!editingId && (
                <div className="hw-mode-toggle" role="group" aria-label="How much homework is being entered">
                  <button
                    type="button"
                    className={`hw-mode ${sheetMode ? 'active' : ''}`}
                    onClick={() => setSheetMode(true)}
                  >
                    <Layers size={15} />
                    <span><strong>Whole sheet</strong><small>One file, many subjects</small></span>
                  </button>
                  <button
                    type="button"
                    className={`hw-mode ${!sheetMode ? 'active' : ''}`}
                    onClick={() => setSheetMode(false)}
                  >
                    <FileText size={15} />
                    <span><strong>One subject</strong><small>Type a single assignment</small></span>
                  </button>
                </div>
              )}

              <div className="hw-form-grid">
                <label className="control-field">Class
                  <select value={draft.class_name} onChange={(event) => setDraft({ ...draft, class_name: event.target.value })}>
                    {formClasses.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="control-field">Section
                  <select value={draft.section_name} onChange={(event) => setDraft({ ...draft, section_name: event.target.value })}>
                    {formSections.length === 0 && <option value="">No section on record</option>}
                    {formSections.map((option) => <option key={option} value={option}>Section {option}</option>)}
                  </select>
                </label>
                {(!sheetMode || editingId) && (
                  <label className="control-field">Subject
                    <input
                      list="hw-subject-options"
                      value={draft.subject_name}
                      onChange={(event) => setDraft({ ...draft, subject_name: event.target.value })}
                      placeholder="Mathematics"
                    />
                    <datalist id="hw-subject-options">
                      {SUBJECT_SUGGESTIONS.map((subject) => <option key={subject} value={subject} />)}
                    </datalist>
                  </label>
                )}
                <label className="control-field">Date set
                  <input type="date" lang="en-GB" value={draft.homework_date} onChange={(event) => setDraft({ ...draft, homework_date: event.target.value })} />
                  <span className="hw-field-hint">dd/mm/yyyy</span>
                </label>
                <label className="control-field">Hand in by (optional)
                  <input
                    type="date"
                    lang="en-GB"
                    min={draft.homework_date}
                    value={draft.due_date}
                    onChange={(event) => setDraft({ ...draft, due_date: event.target.value })}
                  />
                  <span className="hw-field-hint">dd/mm/yyyy — leave blank if there is no hand-in date</span>
                </label>
                <label className="control-field hw-form-wide">{sheetMode && !editingId ? 'Homework title (used for every subject)' : 'Homework title'}
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    placeholder="Exercise 4.2, questions 1 to 10"
                  />
                </label>
                <label className="control-field hw-form-wide">Instructions (optional)
                  <textarea
                    dir="auto"
                    rows={3}
                    value={draft.details}
                    onChange={(event) => setDraft({ ...draft, details: event.target.value })}
                    placeholder="Write the questions in the notebook and bring the copy to class."
                  />
                </label>
                <div className="control-field hw-form-wide">
                  <span>Homework sheet (optional)</span>
                  <div className="hw-upload">
                    <input
                      ref={fileInput}
                      type="file"
                      accept={ATTACHMENT_ACCEPT}
                      className="hw-file-input"
                      onChange={(event) => void pickAttachment(event.target.files?.[0] ?? null)}
                    />
                    <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || saving}>
                      {uploading ? <Loader2 size={15} className="assistant-spin" /> : <Upload size={15} />}
                      {uploading ? 'Uploading…' : draft.attachment_url ? 'Replace file' : 'Upload PDF, JPEG, PNG or Word file'}
                    </button>
                    {draft.attachment_url && (
                      <>
                        <a className="hw-upload-link" href={draft.attachment_url} target="_blank" rel="noreferrer">
                          <Paperclip size={14} /> Open the uploaded file
                        </a>
                        <button className="fee-link danger" type="button" onClick={() => setDraft((current) => ({ ...current, attachment_url: '' }))}>
                          <X size={14} /> Remove
                        </button>
                      </>
                    )}
                  </div>
                  <span className="hw-field-hint">PDF, JPEG, PNG, Word or a link. Parents and students open the same file from the diary.</span>
                </div>
                <label className="control-field hw-form-wide">Attachment link (optional)
                  <input
                    value={draft.attachment_url}
                    onChange={(event) => setDraft({ ...draft, attachment_url: event.target.value })}
                    placeholder="https://… worksheet or photo link"
                  />
                </label>
              </div>

              {sheetMode && !editingId && (
                <div className="hw-sheet">
                  <div className="hw-sheet-head">
                    <div>
                      <span className="eyebrow">Subjects on this sheet</span>
                      <strong>
                        {sheetSubjects.length === 0
                          ? 'Pick the subjects this one sheet covers'
                          : `${sheetSubjects.length} subject${sheetSubjects.length === 1 ? '' : 's'} selected`}
                      </strong>
                    </div>
                    {sheetSubjects.length > 0 && (
                      <button className="fee-link" type="button" onClick={() => setSheetSubjects([])}><X size={14} /> Clear</button>
                    )}
                  </div>
                  <div className="hw-sheet-chips">
                    {SUBJECT_SUGGESTIONS.map((subject) => {
                      const active = sheetSubjects.includes(subject);
                      return (
                        <button
                          key={subject}
                          type="button"
                          className={`hw-chip ${active ? 'active' : ''}`}
                          onClick={() => toggleSheetSubject(subject)}
                        >
                          {active && <Check size={12} />} {subject}
                        </button>
                      );
                    })}
                  </div>
                  <div className="hw-sheet-add">
                    <input
                      value={newSubject}
                      onChange={(event) => setNewSubject(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        addSheetSubject();
                      }}
                      placeholder="Add another subject"
                    />
                    <button className="ghost-button" type="button" onClick={addSheetSubject} disabled={!newSubject.trim()}>
                      <Plus size={14} /> Add subject
                    </button>
                  </div>
                  <p className="hw-hint">
                    Each subject is saved as its own entry, all sharing this sheet and the same title. Subjects that already have work for this class on this date are left untouched.
                  </p>
                </div>
              )}

              <p className="hw-hint">
                A draft is visible only to staff. Publishing it adds the work to the parent and student diary straight away.
              </p>

              <div className="util-form-actions">
                <button className="secondary-button" type="button" onClick={() => void save('draft')} disabled={saving || !sheetReady}>
                  {saving ? <Loader2 size={15} className="assistant-spin" /> : <EyeOff size={15} />} Save as draft
                </button>
                <button className="primary-button" type="button" onClick={() => void save('published')} disabled={saving || !sheetReady}>
                  {saving ? <Loader2 size={15} className="assistant-spin" /> : <Eye size={15} />} Publish to class
                </button>
              </div>
            </div>
          )}

          <div className="fee-card homework-diary-card">
            <div className="fee-card-head">
              <div>
                <span className="eyebrow">Daily diary</span>
                <h2>{formatDisplayDate(diaryDate)}</h2>
              </div>
              <div className="hw-diary-actions">
                <button className="ghost-button" type="button" onClick={() => window.print()} disabled={diaryEntries.length === 0}>
                  <Printer size={15} /> Print view
                </button>
                <button className="ghost-button" type="button" onClick={() => void copyText(diaryText).then((ok) => onToast(ok ? 'Diary copied' : 'Could not copy the diary'))} disabled={diaryEntries.length === 0}>
                  <ClipboardCopy size={15} /> Copy
                </button>
                <button className="ghost-button" type="button" onClick={() => void shareDiary()} disabled={diaryEntries.length === 0}>
                  <MessageCircle size={15} /> WhatsApp
                </button>
              </div>
            </div>

            <div className="fee-filters">
              <label className="control-field">
                <span>Diary date</span>
                <input type="date" lang="en-GB" value={diaryDate} onChange={(event) => setDiaryDate(event.target.value)} />
                <span className="hw-field-hint">dd/mm/yyyy</span>
              </label>
              <div className="hw-diary-count">
                <CalendarDays size={15} />
                <span>{diaryEntries.length} published {diaryEntries.length === 1 ? 'entry' : 'entries'}</span>
              </div>
            </div>

            {diaryEntries.length === 0 ? (
              <p className="fee-empty">No homework has been published for this date yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Class</th><th>Subject</th><th>Homework</th><th>Hand in by</th><th>Teacher</th></tr></thead>
                  <tbody>
                    {diaryEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.class_name}-{entry.section_name}</td>
                        <td><span className="fee-status neutral">{entry.subject_name}</span></td>
                        <td>
                          <div className="table-student"><strong>{entry.title}</strong></div>
                          {entry.details && <small>{entry.details}</small>}
                        </td>
                        <td className="fee-mono">{entry.due_date ? formatDisplayDate(entry.due_date) : '—'}</td>
                        <td>{entry.assigned_by_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="fee-card">
            <div className="fee-card-head">
              <div>
                <span className="eyebrow">All homework</span>
                <h2>{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
            </div>

            <div className="fee-filters">
              <label className="control-field hw-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, subject or teacher" />
              </label>
              <label className="control-field">
                <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                  <option value="">All classes</option>
                  {Array.from(new Set(entries.map((entry) => entry.class_name))).sort().map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
                  <option value="">All sections</option>
                  {Array.from(new Set(entries.map((entry) => entry.section_name))).sort().map((option) => (
                    <option key={option} value={option}>Section {option}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
                  <option value="">All subjects</option>
                  {subjectOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as HomeworkStatus | '')}>
                  <option value="">Drafts and published</option>
                  <option value="published">Published only</option>
                  <option value="draft">Drafts only</option>
                </select>
              </label>
              <button
                className="ghost-button"
                type="button"
                onClick={() => { setSearch(''); setClassFilter(''); setSectionFilter(''); setSubjectFilter(''); setStatusFilter(''); }}
                disabled={!search.trim() && !classFilter && !sectionFilter && !subjectFilter && !statusFilter}
              >
                <RefreshCw size={15} /> Clear filters
              </button>
            </div>

            {loading ? (
              <p className="fee-empty">Loading homework…</p>
            ) : filtered.length === 0 ? (
              <p className="fee-empty">No homework {entries.length === 0 ? 'has been set yet' : 'matches these filters'}.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Class</th><th>Subject</th><th>Homework</th><th>Hand in</th>
                      <th>Status</th><th>Submissions</th><th>Seen by</th>{canAssign && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => {
                      const waiting = awaiting.get(entry.id) ?? 0;
                      const size = rosterSize.get(`${entry.class_name}|||${entry.section_name}`) ?? 0;
                      const seen = seenCounts.get(entry.id) ?? 0;
                      return (
                        <tr key={entry.id}>
                          <td className="fee-mono">{formatDisplayDate(entry.homework_date)}</td>
                          <td>{entry.class_name}-{entry.section_name}</td>
                          <td><span className="fee-status neutral">{entry.subject_name}</span></td>
                          <td>
                            <div className="table-student"><strong>{entry.title}</strong></div>
                            {entry.details && <small>{entry.details}</small>}
                            {entry.attachment_url && (
                              <a className="hw-attach-link" href={entry.attachment_url} target="_blank" rel="noreferrer">
                                <Paperclip size={12} /> Sheet attached
                              </a>
                            )}
                          </td>
                          <td className="fee-mono">{entry.due_date ? formatDisplayDate(entry.due_date) : '—'}</td>
                          <td>
                            <span className={`fee-status ${entry.status === 'published' ? 'paid' : 'partial'}`}>
                              {HOMEWORK_STATUS_LABELS[entry.status]}
                            </span>
                          </td>
                          <td>
                            {entry.status !== 'published' ? (
                              <span className="hw-cell-note">Not published</span>
                            ) : (
                              <div className="hw-cell-stack">
                                <span className="hw-cell-note">{markedCount(entry.id)} of {size} handed in</span>
                                {waiting > 0 ? (
                                  <span className="fee-status unpaid hw-pending">{waiting} pending</span>
                                ) : (
                                  <span className="fee-status paid">{COMPLETION_LABELS.submitted}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            <button className={`hw-seen-button ${seen === 0 ? 'empty' : ''}`} type="button" onClick={() => setSeenEntry(entry)}>
                              <Eye size={14} />
                              {seen === 0 ? 'No one yet' : `${seen} staff`}
                            </button>
                          </td>
                          {canAssign && (
                            <td>
                              <div className="fee-row-actions">
                                <button className="fee-link" type="button" title={entry.status === 'published' ? 'Move back to draft' : 'Publish'} onClick={() => void toggleStatus(entry)}>
                                  {entry.status === 'published' ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                <button className="fee-link" type="button" title="Edit" onClick={() => openEdit(entry)}><Pencil size={14} /></button>
                                <button className="fee-link danger" type="button" title="Remove" onClick={() => void remove(entry)}><Trash2 size={14} /></button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {seenEntry && (
        <div className="hw-modal-backdrop" role="presentation" onClick={() => setSeenEntry(null)}>
          <div className="hw-modal" role="dialog" aria-modal="true" aria-label="Who has seen this homework" onClick={(event) => event.stopPropagation()}>
            <div className="hw-modal-head">
              <div>
                <span className="eyebrow">Seen tracking</span>
                <h2>{seenEntry.subject_name} · {seenEntry.class_name}-{seenEntry.section_name}</h2>
                <p>{seenEntry.title} · set {formatDisplayDate(seenEntry.homework_date)}</p>
              </div>
              <button className="fee-link" type="button" onClick={() => setSeenEntry(null)}><X size={15} /> Close</button>
            </div>
            <HomeworkSeenPanel
              homeworkId={seenEntry.id}
              currentUserId={profile?.id ?? null}
              onToast={onToast}
            />
          </div>
        </div>
      )}
    </div>
  );
}
