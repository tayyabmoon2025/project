import { useEffect, useRef, useState } from 'react';
import { Check, Camera, Loader as Loader2, RotateCcw, Trash2, Upload, UserRoundX } from 'lucide-react';
import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import type { AdmissionFormState, Student } from '@/lib/schoolTypes';
import { useClassOptions, withCurrent } from '@/lib/classSections';
import { formatPercentage } from '@/lib/attendance';
import type { ReportCardAttendance } from '@/lib/reportCardAttendance';
import {
  EMPTY_LEAVING_FIELDS,
  LEAVING_RATING_OPTIONS,
  certificateNumberFor,
  fetchLeavingAttendance,
  leavingStatusLabel,
  studentStatusForLeaving,
} from '@/lib/withdrawal';

type TabKey = 'leaving' | 'submitted' | 'issued';

// The leaving status list: the two the Withdraw Students screen writes, then the reasons a
// record may have been written by hand. Choosing Inactive or Pass Out also moves the
// student's own status, which is what keeps the roster and this record in step.
const leavingStatusOptions = ['Inactive', 'Pass Out', 'Transferred', 'Withdrawn', 'Expelled', 'Other'];
const ratingOptions = LEAVING_RATING_OPTIONS;

type FieldDef = { key: keyof AdmissionFormState; label: string; type: 'text' | 'date'; placeholder?: string };

const issuedFields: FieldDef[] = [
  { key: 'issued_tc_number', label: 'TC Number', type: 'text', placeholder: 'Transfer certificate number' },
  { key: 'issued_tc_date', label: 'TC Issue Date', type: 'date' },
  { key: 'issued_other_docs', label: 'Other Documents Issued', type: 'text', placeholder: 'List any other documents issued' },
];

type DocDef = { label: string; statusKey: keyof AdmissionFormState; fileKey: keyof AdmissionFormState; multiline?: boolean };

const issuedDocDefs: DocDef[] = [
  { label: 'Character Certificate', statusKey: 'issued_character_certificate', fileKey: 'issued_character_certificate_file' },
  { label: 'Migration Certificate', statusKey: 'issued_migration_certificate', fileKey: 'issued_migration_certificate_file' },
  { label: 'Birth Certificate', statusKey: 'issued_birth_certificate', fileKey: 'issued_birth_certificate_file' },
  { label: 'DMC', statusKey: 'issued_dmc', fileKey: 'issued_dmc_file' },
  { label: 'Provisional Certificate', statusKey: 'issued_provisional_certificate', fileKey: 'issued_provisional_certificate_file' },
  { label: 'Original Certificate', statusKey: 'issued_original_certificate', fileKey: 'issued_original_certificate_file' },
];

const submittedDocs: DocDef[] = [
  { label: 'B-Form', statusKey: 'submitted_b_form', fileKey: 'submitted_b_form_file' },
  { label: 'Father CNIC', statusKey: 'submitted_father_cnic', fileKey: 'submitted_father_cnic_file' },
  { label: 'Previous School TC', statusKey: 'submitted_previous_tc', fileKey: 'submitted_previous_tc_file' },
  { label: 'Birth Certificate', statusKey: 'submitted_birth_certificate', fileKey: 'submitted_birth_certificate_file' },
  { label: 'Photos', statusKey: 'submitted_photos', fileKey: 'submitted_photos_file' },
  { label: 'Other Documents', statusKey: 'submitted_other_docs', fileKey: 'submitted_other_docs_file', multiline: true },
];

const labelClass = 'block text-xs font-bold text-slate-600';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100';
const textareaClass = 'mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100';
const readOnlyClass = 'mt-1 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500';

export function AdmissionDocTabs({ tab, form, update, patch, onToast, recordStudent = null }: {
  tab: TabKey;
  form: AdmissionFormState;
  update: (key: keyof AdmissionFormState, value: string) => void;
  patch: (changes: Partial<AdmissionFormState>) => void;
  onToast: (message: string) => void;
  // The student whose record is on screen. Absent for a brand-new admission, where there
  // is no saved row yet for the attendance register to be read against.
  recordStudent?: Student | null;
}) {
  const classNames = useClassOptions();
  const classOptions = withCurrent(classNames, form.leaving_class);
  const [attendance, setAttendance] = useState<ReportCardAttendance | null>(null);
  const [attendanceNote, setAttendanceNote] = useState<string | null>(null);
  const [readingAttendance, setReadingAttendance] = useState(false);
  const attendanceReadFor = useRef('');

  useEffect(() => {
    const number = certificateNumberFor(form.admission_number);
    if (number && !form.leaving_certificate_number) {
      patch({ leaving_certificate_number: number, leaving_certificate_date: form.leaving_date || '' });
    }
  }, [form.admission_number, form.leaving_date, form.leaving_certificate_number]);

  // The attendance picture for this student, read from the same register the report card
  // uses. It is written into the record so the leaving certificate and the profile agree.
  const readAttendance = async () => {
    if (!recordStudent) return;
    setReadingAttendance(true);
    const result = await fetchLeavingAttendance(recordStudent, form.leaving_date);
    setReadingAttendance(false);
    setAttendance(result.summary);
    setAttendanceNote(result.error ?? (result.summary.schoolDays === 0
      ? 'No attendance has been marked for this student yet, so there is nothing to summarise.'
      : null));
    if (result.text) update('attendance_summary', result.text);
  };

  // Read once per student, and only when the record does not already carry a summary, so a
  // figure saved by the Withdraw Students screen is never quietly replaced.
  useEffect(() => {
    if (!recordStudent || attendanceReadFor.current === recordStudent.id) return;
    attendanceReadFor.current = recordStudent.id;
    if (!form.attendance_summary) void readAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordStudent]);

  const readDocumentFile = (key: keyof AdmissionFormState, file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') { onToast('Please choose a JPG or PNG file'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') update(key, reader.result); };
    reader.readAsDataURL(file);
  };

  // Snapping a certificate or transcript with the camera lands the picture in the same
  // slot an upload would fill, so previews and saving need no special handling.
  const [captureKey, setCaptureKey] = useState<keyof AdmissionFormState | null>(null);

  if (tab === 'submitted') {
    return (
      <div className="admission-tab-panel">
        <div className="form-section-title">Submitted Doc</div>
        <div className="mt-4 space-y-4">
          {submittedDocs.map((doc) => (
            <div key={doc.statusKey} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <span className={labelClass}>{doc.label}</span>
                  {doc.multiline ? (
                    <textarea rows={2} value={String(form[doc.statusKey] ?? '')} onChange={(e) => update(doc.statusKey, e.target.value)} placeholder="Notes or status" className={textareaClass} />
                  ) : (
                    <input value={String(form[doc.statusKey] ?? '')} onChange={(e) => update(doc.statusKey, e.target.value)} placeholder="Submitted / Pending / N/A" className={inputClass} />
                  )}
                </div>
                <div className="doc-action-buttons">
                  <button type="button" className="secondary-button mt-1 whitespace-nowrap" onClick={() => setCaptureKey(doc.fileKey)}>
                    <Camera size={15} /> Take photo
                  </button>
                  <label className="secondary-button mt-1 cursor-pointer whitespace-nowrap">
                    <Upload size={15} /> Upload JPG/PNG
                    <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => readDocumentFile(doc.fileKey, e.target.files?.[0])} />
                  </label>
                </div>
              </div>
              {String(form[doc.fileKey] ?? '') ? (
                <div className="mt-3 flex items-center gap-3">
                  <img src={String(form[doc.fileKey])} alt={`${doc.label} preview`} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline" onClick={() => update(doc.fileKey, '')}><Trash2 size={13} /> Remove</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end">
          <button type="submit" className="primary-button"><Check size={16} /> Save</button>
        </div>
        {captureKey && <CameraCaptureModal onCapture={(dataUrl) => update(captureKey, dataUrl)} onClose={() => setCaptureKey(null)} onToast={onToast} />}
      </div>
    );
  }

  if (tab === 'issued') {
    return (
      <div className="admission-tab-panel">
        <div className="form-section-title">Issued Doc</div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {issuedFields.map((field) => (
            <label key={field.key} className={labelClass}>
              {field.label}
              <input type={field.type} value={String(form[field.key] ?? '')} onChange={(e) => update(field.key, e.target.value)} placeholder={field.placeholder} className={inputClass} />
            </label>
          ))}
        </div>
        <div className="form-section-title mt-6">Certificates and result documents</div>
        <div className="mt-4 space-y-4">
          {issuedDocDefs.map((doc) => (
            <div key={doc.statusKey} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <span className={labelClass}>{doc.label}</span>
                  <input value={String(form[doc.statusKey] ?? '')} onChange={(e) => update(doc.statusKey, e.target.value)} placeholder="Issued / Pending / N/A" className={inputClass} />
                </div>
                <div className="doc-action-buttons">
                  <button type="button" className="secondary-button mt-1 whitespace-nowrap" onClick={() => setCaptureKey(doc.fileKey)}>
                    <Camera size={15} /> Take photo
                  </button>
                  <label className="secondary-button mt-1 cursor-pointer whitespace-nowrap">
                    <Upload size={15} /> Upload JPG/PNG
                    <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => readDocumentFile(doc.fileKey, e.target.files?.[0])} />
                  </label>
                </div>
              </div>
              {String(form[doc.fileKey] ?? '') ? (
                <div className="mt-3 flex items-center gap-3">
                  <img src={String(form[doc.fileKey])} alt={`${doc.label} preview`} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline" onClick={() => update(doc.fileKey, '')}><Trash2 size={13} /> Remove</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {captureKey && <CameraCaptureModal onCapture={(dataUrl) => update(captureKey, dataUrl)} onClose={() => setCaptureKey(null)} onToast={onToast} />}
      </div>
    );
  }

  const clearLeaving = () => patch(EMPTY_LEAVING_FIELDS);

  // Bringing the student back onto the active roll clears the leaving record in the same
  // step, so the roster and this section can never disagree about whether they have left.
  const restoreToActive = () => patch({ ...EMPTY_LEAVING_FIELDS, status: 'active' });

  const leavingStatus = form.leaving_status || leavingStatusLabel(form.status);
  const hasLeft = form.status === 'withdrawn' || form.status === 'promoted';

  const changeLeavingStatus = (value: string) => {
    const studentStatus = studentStatusForLeaving(value);
    patch({ leaving_status: value, ...(studentStatus ? { status: studentStatus } : {}) });
  };

  return (
    <div className="admission-tab-panel">
      <div className="form-section-title">Leaving Info</div>
      <p className="mt-2 text-xs text-slate-500">
        This is the same record the <b>Withdraw Students</b> screen writes. Saving here updates the student's status and
        the withdrawal list, and saving there updates this section.
      </p>

      {hasLeft && (
        <div className="leaving-status-banner">
          <UserRoundX size={15} />
          <span>
            {form.full_name || 'This student'} is recorded as <b>{leavingStatus || 'left the school'}</b>
            {form.leaving_date ? ` from ${form.leaving_date}` : ''}.
          </span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>Leaving Status
          <select value={leavingStatus} onChange={(e) => changeLeavingStatus(e.target.value)} className={inputClass}>
            <option value="">Select status</option>
            {leavingStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className={labelClass}>SLC Serial No.
          <input value={form.slc_serial_number} onChange={(e) => update('slc_serial_number', e.target.value)} placeholder="Serial printed on the leaving certificate" className={inputClass} />
        </label>
        <label className={labelClass}>Withdrawal Date
          <input type="date" value={form.leaving_date} onChange={(e) => update('leaving_date', e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>Leaving Class
          <select value={form.leaving_class} onChange={(e) => update('leaving_class', e.target.value)} className={inputClass}>
            <option value="">Select class</option>
            {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className={labelClass}>Reason for Leaving
          <input value={form.leaving_reason} onChange={(e) => update('leaving_reason', e.target.value)} placeholder="Transfer, withdrawal, graduation, etc." className={inputClass} />
        </label>
        <label className={labelClass}>Fee Paid Upto
          <input value={form.fee_paid_upto} onChange={(e) => update('fee_paid_upto', e.target.value)} placeholder="e.g. March 2026" className={inputClass} />
        </label>
        <label className={labelClass}>Progress
          <select value={form.progress} onChange={(e) => update('progress', e.target.value)} className={inputClass}>
            <option value="">Select progress</option>
            {ratingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className={labelClass}>Conduct
          <select value={form.conduct} onChange={(e) => update('conduct', e.target.value)} className={inputClass}>
            <option value="">Select conduct</option>
            {ratingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="col-span-full text-xs font-bold text-slate-600">Withdrawal Remark
          <textarea rows={3} value={form.leaving_remarks} onChange={(e) => update('leaving_remarks', e.target.value)} placeholder="Additional notes about the departure" className={textareaClass} />
        </label>

        <div className="col-span-full">
          <div className="form-section-title">Attendance Summary</div>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <label className={`${labelClass} flex-1`}>Summary
              <textarea rows={2} value={form.attendance_summary} onChange={(e) => update('attendance_summary', e.target.value)} placeholder="Filled in from the attendance register" className={textareaClass} />
            </label>
            {recordStudent && (
              <button type="button" className="secondary-button" onClick={() => void readAttendance()} disabled={readingAttendance}>
                {readingAttendance ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Read from register
              </button>
            )}
          </div>
          {attendance && attendance.schoolDays > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {attendance.present} present · {attendance.absent} absent · {attendance.late} late · {attendance.leave} leave ·{' '}
              {formatPercentage(attendance.percentage)} over {attendance.schoolDays} school days.
            </p>
          )}
          {attendanceNote && <p className="mt-2 text-xs text-slate-500">{attendanceNote}</p>}
          {!recordStudent && <p className="mt-2 text-xs text-slate-500">Attendance figures are read once the student has been saved.</p>}
        </div>

        <div className="col-span-full">
          <div className="form-section-title">Certificate details</div>
          <div className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>Certificate Number
              <input readOnly value={form.leaving_certificate_number} placeholder="Auto-generated when leaving info is saved" className={readOnlyClass} />
            </label>
            <label className={labelClass}>Certificate Date
              <input type="date" readOnly value={form.leaving_certificate_date} className={readOnlyClass} />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Certificate details are generated automatically from the admission number and leaving date.</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {hasLeft && <button type="button" className="secondary-button" onClick={restoreToActive}><UserRoundX size={15} /> Restore to Active</button>}
        <button type="button" className="secondary-button" onClick={clearLeaving}><RotateCcw size={15} /> Clear</button>
        <button type="submit" className="primary-button"><Check size={16} /> Save</button>
      </div>
      {captureKey && <CameraCaptureModal onCapture={(dataUrl) => update(captureKey, dataUrl)} onClose={() => setCaptureKey(null)} onToast={onToast} />}
    </div>
  );
}
