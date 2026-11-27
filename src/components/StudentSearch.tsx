import { useEffect, useState, type FormEvent } from 'react';
import { Bell, CreditCard, Download, FileText, ListOrdered, MessageCircle, Plus, Printer, RotateCcw, Search, Send, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SCHOOL_NAME } from '@/lib/noticeText';
import type { Student } from '@/lib/schoolTypes';
import type { NoticeContext } from '@/lib/sentNotices';
import { FeeModal } from '@/components/FeeModal';
import { FeeDetailsModal } from '@/components/FeeDetailsModal';
import { StudentRecordModal } from '@/components/StudentRecordModal';
import { StudentResultsTable, type RowAction } from '@/components/StudentResultsTable';
import { StudentAdmissionEditor } from '@/components/StudentAdmissionEditor';
import { BlankAdmissionSheet } from '@/components/BlankAdmissionSheet';
import { BulkRollNumberModal } from '@/components/BulkRollNumberModal';
import { StudentIdCardGenerator } from '@/components/StudentIdCardGenerator';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { StudentLoginModal } from '@/components/StudentLoginModal';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { pickWhatsAppContact } from '@/lib/whatsapp';
import { DOCUMENT_GAP_LABELS, documentReminderMessage, studentDocumentGaps, type DocumentGap } from '@/lib/documentGaps';
import type { PortalCredentials } from '@/lib/portalAccounts';

type SearchFilters = {
  admission_number: string;
  full_name: string;
  fathers_name: string;
  class_name: string;
  section_name: string;
  fathers_cnic: string;
  roll_number: string;
  mother_number: string;
  guardian_name: string;
  religion: string;
  area: string;
  nationality: string;
  source: 'current' | 'archive' | 'all';
  status: 'active' | 'inactive' | 'pass_out' | 'all';
  clearance: 'cleared' | 'not_clear' | 'all';
  unassignedSection: boolean;
  admissionDateRange: boolean;
  admissionDateFrom: string;
  admissionDateTo: string;
  pending: 'any' | DocumentGap;
};

type TextFilterKey = Exclude<keyof SearchFilters, 'source' | 'status' | 'clearance' | 'unassignedSection' | 'admissionDateRange' | 'admissionDateFrom' | 'admissionDateTo' | 'pending'>;

const emptySearchFilters: SearchFilters = {
  admission_number: '', full_name: '', fathers_name: '', class_name: '', section_name: '', fathers_cnic: '', roll_number: '', mother_number: '', guardian_name: '', religion: '', area: '', nationality: '', source: 'current', status: 'active', clearance: 'all', unassignedSection: false, admissionDateRange: false, admissionDateFrom: '', admissionDateTo: '', pending: 'any',
};

// The quick filters the office uses to chase missing paperwork. Each one is paired with
// the badge wording shown against the student, so the tab and the row read the same way.
const pendingTabs: { value: 'any' | DocumentGap; label: string }[] = [
  { value: 'any', label: 'All students' },
  { value: 'tc', label: DOCUMENT_GAP_LABELS.tc },
  { value: 'b_form', label: DOCUMENT_GAP_LABELS.b_form },
  { value: 'whatsapp', label: DOCUMENT_GAP_LABELS.whatsapp },
];

const topFields: { key: TextFilterKey; label: string }[] = [
  { key: 'admission_number', label: 'Admission No.' },
  { key: 'full_name', label: 'Student Name' },
  { key: 'fathers_name', label: 'Father Name' },
  { key: 'class_name', label: 'Class' },
  { key: 'section_name', label: 'Section' },
];

const advancedFields: { key: TextFilterKey; label: string }[] = [
  { key: 'fathers_cnic', label: 'Fathers CNIC' }, { key: 'roll_number', label: 'Roll Number' }, { key: 'mother_number', label: 'Mother Number' }, { key: 'guardian_name', label: 'Guardian Name' }, { key: 'religion', label: 'Religion' }, { key: 'area', label: 'Area' }, { key: 'nationality', label: 'Nationality' },
];

type ActiveModal =
  | { kind: 'feeDetails'; student: Student }
  | { kind: 'fee'; student: Student; mode: 'payment' | 'charge' }
  | { kind: 'record'; student: Student; autoPrint: boolean }
  | { kind: 'login'; student: Student }
  | { kind: 'delete'; student: Student }
  | null;

export function StudentSearch({ students, loading = false, loadError = null, onToast, onRefresh, onCreatedLogin, onSendNotice }: { students: Student[]; loading?: boolean; loadError?: string | null; onToast: (message: string) => void; onRefresh: () => Promise<void>; onCreatedLogin: (items: PortalCredentials[]) => void; onSendNotice?: (student: Student, context: NoticeContext) => void }) {
  const [draft, setDraft] = useState<SearchFilters>(emptySearchFilters);
  const [applied, setApplied] = useState<SearchFilters>(emptySearchFilters);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logins, setLogins] = useState<Record<string, string>>({});
  const [blankOpen, setBlankOpen] = useState(false);
  const [rollToolOpen, setRollToolOpen] = useState(false);
  const [idCardOpen, setIdCardOpen] = useState(false);
  const [blankInstitution, setBlankInstitution] = useState<InstitutionProfile | null>(null);

  // The blank copy carries the school header, so the profile is fetched the first time
  // the preview is opened rather than on every visit to the student records screen.
  useEffect(() => {
    if (!blankOpen || blankInstitution) return;
    void fetchInstitutionProfile().then(({ profile }) => setBlankInstitution(profile));
  }, [blankOpen, blankInstitution]);

  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('id, username, student_id')
      .not('student_id', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        for (const row of data as { student_id: string; username: string }[]) map[row.student_id] = row.username;
        setLogins(map);
      });
  }, []);

  const results = students.filter((student) => {
    const textMatches = [...topFields, ...advancedFields].every(({ key }) => {
      const query = applied[key].trim().toLowerCase();
      if (!query) return true;
      const values = key === 'fathers_name' ? [student.fathers_name, student.guardian_name] : [student[key as keyof Student]];
      return values.some((value) => String(value ?? '').toLowerCase().includes(query));
    });
    const sourceMatches = applied.source === 'all' || (applied.source === 'current' ? student.data_source !== 'archive' : student.data_source === 'archive');
    const statusMatches = applied.status === 'all' || (applied.status === 'active' ? student.status === 'active' : applied.status === 'inactive' ? student.status === 'withdrawn' : student.status === 'promoted');
    const clearanceMatches = applied.clearance === 'all' || (applied.clearance === 'cleared' ? student.clearance_status !== 'not_clear' : student.clearance_status === 'not_clear');
    const unassignedSectionMatches = !applied.unassignedSection || (student.status === 'active' && !student.section_name.trim());
    const admissionDateMatches = !applied.admissionDateRange || ((!applied.admissionDateFrom || student.admission_date >= applied.admissionDateFrom) && (!applied.admissionDateTo || student.admission_date <= applied.admissionDateTo));
    const pendingMatches = applied.pending === 'any' || studentDocumentGaps(student).includes(applied.pending);
    return textMatches && sourceMatches && statusMatches && clearanceMatches && unassignedSectionMatches && admissionDateMatches && pendingMatches;
  }).sort((a, b) => (Number(a.admission_number.match(/(\d+)$/)?.[1] ?? 0) - Number(b.admission_number.match(/(\d+)$/)?.[1] ?? 0)));

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
    onToast('Student search updated');
  };

  const clearSearch = () => { setDraft(emptySearchFilters); setApplied(emptySearchFilters); onToast('Search filters cleared'); };

  const handleRowAction = (action: RowAction, student: Student) => {
    if (action === 'fee') setActiveModal({ kind: 'feeDetails', student });
    if (action === 'add') setActiveModal({ kind: 'fee', student, mode: 'charge' });
    if (action === 'view') setEditingStudent(student);
    if (action === 'print') setActiveModal({ kind: 'record', student, autoPrint: true });
    if (action === 'login') setActiveModal({ kind: 'login', student });
    if (action === 'notice') onSendNotice?.(student, student.clearance_status === 'not_clear' ? 'fee' : 'general');
    if (action === 'delete') setActiveModal({ kind: 'delete', student });
  };

  const deleteStudent = async (student: Student) => {
    setDeleting(true);
    const { error } = await supabase.from('school_students').delete().eq('id', student.id);
    setDeleting(false);
    setActiveModal(null);
    if (error) { onToast(`${student.full_name} could not be deleted. Please try again.`); return; }
    onToast(`${student.full_name} was removed from the records`);
    await onRefresh();
  };

  const notClearStudents = results.filter((student) => student.clearance_status === 'not_clear');

  // One student at a time, so the wording can be read and edited before it goes out.
  const sendClearanceNotice = (student: Student, context: NoticeContext) => {
    onSendNotice?.(student, context);
  };

  const exportData = () => {
    const headers = ['Admission No.', 'Admission Date', 'Student Name', 'Father Name', 'Class', 'Section', 'Contact No.', 'Fee Balance'];
    const rows = results.map((student) => [student.admission_number, student.admission_date, student.full_name, student.fathers_name ?? '', student.class_name, student.section_name, student.guardian_phone, student.fee_balance]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'schooldesk-student-list.csv'; link.click(); URL.revokeObjectURL(url);
    onToast(`${results.length} student records exported`);
  };

  const updateDraft = (key: keyof SearchFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  // The quick tabs filter the list the moment they are clicked, because chasing paperwork
  // is a browsing task rather than a search. The count on each tab is taken from the
  // results already on screen, so it always agrees with what is listed below.
  const setPendingFilter = (value: 'any' | DocumentGap) => { setDraft((current) => ({ ...current, pending: value })); setApplied((current) => ({ ...current, pending: value })); };
  const pendingCount = (value: 'any' | DocumentGap) => (value === 'any' ? results.length : results.filter((student) => studentDocumentGaps(student).includes(value)).length);

  // Opens a WhatsApp chat with the reminder written out. When the record has no usable
  // number the message is copied instead, so the office can still paste it into whatever
  // channel the family uses.
  const sendDocumentReminder = async (student: Student, gaps: DocumentGap[]) => {
    const message = documentReminderMessage(student, gaps);
    const contact = pickWhatsAppContact(student);
    if (!contact.number) {
      try {
        await navigator.clipboard.writeText(message);
        onToast(`No WhatsApp number saved for ${student.full_name} — the reminder message has been copied`);
      } catch {
        onToast(`No WhatsApp number saved for ${student.full_name}. Add one to send a reminder.`);
      }
      return;
    }
    const { ok, link } = openWhatsAppChat(contact.number, message, 'web');
    if (ok) { onToast(`WhatsApp reminder ready for ${student.full_name}`); return; }
    try {
      await navigator.clipboard.writeText(link);
      onToast(`WhatsApp could not be opened — the reminder link for ${student.full_name} has been copied`);
    } catch {
      onToast(`WhatsApp could not be opened for ${student.full_name}. Please try again.`);
    }
  };

  const reminderStudents = results.filter((student) => studentDocumentGaps(student).length > 0);

  const sendAllDocumentReminders = () => {
    if (!reminderStudents.length) { onToast('No student in these results is missing a document'); return; }
    const reachable = reminderStudents.filter((student) => pickWhatsAppContact(student).number);
    const lines = reminderStudents.map((student) => `${student.full_name} (${[student.class_name, student.section_name].filter(Boolean).join(' ')}) — ${studentDocumentGaps(student).map((gap) => DOCUMENT_GAP_LABELS[gap]).join(', ')}`);
    void navigator.clipboard.writeText(lines.join('\n')).then(
      () => onToast(`${reminderStudents.length} students pending documents. ${reachable.length} can be messaged on WhatsApp; the list has been copied.`),
      () => onToast(`${reminderStudents.length} students are missing documents. ${reachable.length} can be messaged on WhatsApp.`),
    );
  };

  return (
    <div className="student-search-workspace">
      <form className="panel search-panel" onSubmit={runSearch}>
        <div className="search-panel-heading">
          <div>
            <span className="eyebrow">Student records</span>
            <h2>Find exactly who you need</h2>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {topFields.map(({ key, label }) => (
            <label key={key} className="control-field">{label}
              <input value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
            </label>
          ))}
          <div className="flex items-end gap-2">
            <button type="submit" className="primary-button w-full justify-center"><Search size={17} /> Search</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="button" className="secondary-button" onClick={clearSearch}><RotateCcw size={16} /> Clear</button>
          <button type="button" className="filter-toggle" onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced}><SlidersHorizontal size={16} /> {showAdvanced ? 'Hide more filters' : 'More filters'}</button>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={draft.unassignedSection}
              onChange={(event) => setDraft((current) => ({ ...current, unassignedSection: event.target.checked }))}
              className="h-4 w-4 accent-sky-600"
            />
            Filter active students whose section is not assigned
          </label>
        </div>
        {showAdvanced && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {advancedFields.map(({ key, label }) => (
                <label key={key} className="control-field">{label}
                  <input value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-5">
              <div>
                <span className="mb-2 block text-xs font-bold text-slate-600">Session</span>
                <div className="segmented-control">{[['current', 'Current'], ['archive', 'Archive'], ['all', 'All Data']].map(([value, label]) => <button type="button" key={value} className={draft.source === value ? 'selected' : ''} onClick={() => updateDraft('source', value)}>{label}</button>)}</div>
              </div>
              <div>
                <span className="mb-2 block text-xs font-bold text-slate-600">Student status</span>
                <div className="segmented-control">{[['active', 'Active'], ['inactive', 'InActive'], ['pass_out', 'Pass Out']].map(([value, label]) => <button type="button" key={value} className={draft.status === value ? 'selected' : ''} onClick={() => updateDraft('status', value)}>{label}</button>)}</div>
              </div>
              <div>
                <span className="mb-2 block text-xs font-bold text-slate-600">Fee clearance</span>
                <div className="segmented-control compact">{[['all', 'All'], ['not_clear', 'Not Cleared'], ['cleared', 'Clear']].map(([value, label]) => <button type="button" key={value} className={draft.clearance === value ? 'selected' : ''} onClick={() => updateDraft('clearance', value)}>{label}</button>)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.admissionDateRange}
                  onChange={(event) => setDraft((current) => ({ ...current, admissionDateRange: event.target.checked }))}
                  className="h-4 w-4 accent-sky-600"
                />
                Filter by admission date range
              </label>
              {draft.admissionDateRange && (
                <>
                  <label className="control-field min-w-44">Admission date from
                    <input type="date" value={draft.admissionDateFrom} onChange={(event) => updateDraft('admissionDateFrom', event.target.value)} />
                  </label>
                  <label className="control-field min-w-44">Admission date to
                    <input type="date" value={draft.admissionDateTo} onChange={(event) => updateDraft('admissionDateTo', event.target.value)} />
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </form>

      <div className="search-results-heading">
        <div><span className="eyebrow">Search results</span><h2>{loading ? 'Loading students…' : loadError ? 'Students unavailable' : `${results.length} students found`}</h2></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="secondary-button" onClick={() => setRollToolOpen(true)}><ListOrdered size={16} /> Roll Numbers</button>
          <button type="button" className="secondary-button" onClick={() => setIdCardOpen(true)}><CreditCard size={16} /> ID Cards</button>
          <button type="button" className="secondary-button" onClick={() => setBlankOpen(true)}><Plus size={16} /> Print Blank Form</button>
          <button type="button" className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Print List</button>
          <button type="button" className="secondary-button" onClick={exportData}><Download size={16} /> Export Data</button>
          <button type="button" className="secondary-button" onClick={() => (notClearStudents[0] ? sendClearanceNotice(notClearStudents[0], 'fee') : onToast('No student marked Not Clear in these results'))}><FileText size={16} /> Send Notice / Warning</button>
        </div>
      </div>

      <div className="quick-notice-bar">
        <div><span className="eyebrow">Not clear students</span><strong>{notClearStudents.length} eligible {notClearStudents.length === 1 ? 'student' : 'students'}</strong><small>Quick actions use the current search results</small></div>
        <div className="quick-notice-buttons">
          <button className="reminder-button" onClick={() => (notClearStudents[0] ? sendClearanceNotice(notClearStudents[0], 'fee') : onToast('No student marked Not Clear in these results'))}><Send size={15} /> Send fee reminder</button>
          <button className="warning-button" onClick={() => (results[0] ? sendClearanceNotice(results[0], 'warning') : onToast('Search for a student first'))}><Bell size={15} /> Send warning notice</button>
        </div>
      </div>

      <div className="pending-bar">
        <div className="pending-tabs" role="group" aria-label="Filter students by missing documents">
          {pendingTabs.map(({ value, label }) => (
            <button key={value} type="button" className={`pending-tab${applied.pending === value ? ' active' : ''}`} aria-pressed={applied.pending === value} onClick={() => setPendingFilter(value)}>
              {label}<span className="pending-tab-count">{pendingCount(value)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={sendAllDocumentReminders}><MessageCircle size={15} /> Send reminders</button>
      </div>

      <div className="panel roster-panel">{loading ? <div className="empty-state large">Loading students…</div> : loadError ? <div className="empty-state large">{loadError}</div> : <StudentResultsTable students={results} onAction={handleRowAction} onRemind={sendDocumentReminder} />}</div>

      {editingStudent && <StudentAdmissionEditor key={editingStudent.id} student={editingStudent} students={students} onClose={() => setEditingStudent(null)} onSaved={onRefresh} onToast={onToast} />}
      {blankOpen && <BlankAdmissionSheet institution={blankInstitution} onClose={() => setBlankOpen(false)} />}
      {rollToolOpen && <BulkRollNumberModal students={students} onClose={() => setRollToolOpen(false)} onToast={onToast} onSaved={onRefresh} />}
      {idCardOpen && <StudentIdCardGenerator students={students} onClose={() => setIdCardOpen(false)} onToast={onToast} />}
      {activeModal?.kind === 'feeDetails' && <FeeDetailsModal student={activeModal.student} onClose={() => setActiveModal(null)} onRecord={(mode) => setActiveModal({ kind: 'fee', student: activeModal.student, mode })} />}
      {activeModal?.kind === 'fee' && <FeeModal student={activeModal.student} initialMode={activeModal.mode} onClose={() => setActiveModal(null)} onSaved={async (message) => { onToast(message); await onRefresh(); }} />}
      {activeModal?.kind === 'record' && <StudentRecordModal student={activeModal.student} autoPrint={activeModal.autoPrint} onClose={() => setActiveModal(null)} />}
      {activeModal?.kind === 'login' && (
        <StudentLoginModal
          student={activeModal.student}
          existingUsername={logins[activeModal.student.id] ?? null}
          onClose={() => setActiveModal(null)}
          onCreated={(username) => setLogins((current) => ({ ...current, [activeModal.student.id]: username }))}
          onCreatedLogin={onCreatedLogin}
          onToast={onToast}
        />
      )}
      {activeModal?.kind === 'delete' && (
        <div className="notice-overlay">
          <section className="notice-preview">
            <div className="notice-preview-top">
              <span className="eyebrow">Delete student</span>
              <button className="close-button" onClick={() => setActiveModal(null)} aria-label="Cancel delete"><X size={18} /></button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-800">Remove {activeModal.student.full_name}?</h2>
            <p className="mt-2 text-sm text-slate-600">This permanently deletes the student from {SCHOOL_NAME}, along with their attendance and notice history. This cannot be undone.</p>
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={() => setActiveModal(null)}>Cancel</button>
              <button className="primary-button bg-rose-600 hover:bg-rose-700" onClick={() => void deleteStudent(activeModal.student)} disabled={deleting}><Trash2 size={16} /> {deleting ? 'Deleting…' : 'Delete student'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
