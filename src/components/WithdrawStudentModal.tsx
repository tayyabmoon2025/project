import { useEffect, useMemo, useState } from 'react';
import { CircleAlert as AlertCircle, CalendarCheck2, Check, Loader as Loader2, RotateCcw, X } from 'lucide-react';
import { useClassOptions, withCurrent } from '@/lib/classSections';
import type { Student } from '@/lib/schoolTypes';
import { formatPercentage } from '@/lib/attendance';
import type { ReportCardAttendance } from '@/lib/reportCardAttendance';
import {
  LEAVING_RATING_OPTIONS,
  WITHDRAWAL_STATUS_OPTIONS,
  attendanceSummaryText,
  certificateNumberFor,
  fetchLeavingAttendance,
  leavingRecordFromStudent,
  restoreStudentToActive,
  saveLeavingRecord,
  studentStatusForLeaving,
  type LeavingRecord,
} from '@/lib/withdrawal';

const labelClass = 'control-field';
const fieldClass = 'withdraw-field';

// The one place the leaving record is filled in. It writes to the student's own row, which
// is the same record the "Leaving Info" tab of the admission form edits, so the two screens
// always show the same thing.
export function WithdrawStudentModal({
  student,
  onClose,
  onToast,
  onSaved,
}: {
  student: Student;
  onClose: () => void;
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const classNames = useClassOptions();
  const classOptions = useMemo(() => withCurrent(classNames, student.leaving_class ?? ''), [classNames, student.leaving_class]);

  const [record, setRecord] = useState<LeavingRecord>(() => {
    const existing = leavingRecordFromStudent(student);
    return {
      ...existing,
      status: existing.status || 'Inactive',
      leavingDate: existing.leavingDate || new Date().toISOString().slice(0, 10),
      leavingClass: existing.leavingClass || student.class_name,
      certificateNumber: existing.certificateNumber || certificateNumberFor(student.admission_number),
    };
  });
  const [summary, setSummary] = useState<ReportCardAttendance | null>(null);
  const [attendanceNote, setAttendanceNote] = useState<string | null>(null);
  const [readingAttendance, setReadingAttendance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyLeft = student.status === 'withdrawn' || student.status === 'promoted';

  const patch = (changes: Partial<LeavingRecord>) => setRecord((current) => ({ ...current, ...changes }));

  const refreshAttendance = async (fill: boolean) => {
    setReadingAttendance(true);
    const result = await fetchLeavingAttendance(student, record.leavingDate);
    setReadingAttendance(false);
    setSummary(result.summary);
    setAttendanceNote(result.error ?? (result.summary.schoolDays === 0
      ? 'No attendance has been marked for this student yet, so the summary is empty.'
      : null));
    if (fill && result.text) patch({ attendanceSummary: result.text });
  };

  // The figures are read from the register as soon as the sheet opens, and the box is filled
  // in only when the record does not already carry a summary, so a saved figure is never
  // overwritten without the office asking for it. The date box and the refresh button drive
  // every later read.
  useEffect(() => {
    if (!record.attendanceSummary) void refreshAttendance(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const save = async () => {
    if (!studentStatusForLeaving(record.status)) { setError('Choose Inactive or Pass Out as the leaving status.'); return; }
    setBusy(true);
    setError(null);

    let payload = record;
    if (!payload.attendanceSummary.trim() && summary && summary.schoolDays > 0) {
      payload = { ...payload, attendanceSummary: attendanceSummaryText(summary) };
    }
    const result = await saveLeavingRecord(student, payload);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    await onSaved();
    onToast(result.message);
    onClose();
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    const result = await restoreStudentToActive(student);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    await onSaved();
    onToast(result.message);
    onClose();
  };

  return (
    <div className="notice-overlay">
      <section className="notice-modal withdraw-modal">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Withdraw students · Leaving record</span>
            <h2 className="payroll-modal-title">{student.full_name}</h2>
            <p className="payroll-modal-sub">
              {student.admission_number} · {student.class_name} {student.section_name}
              {alreadyLeft ? ` · currently ${student.status === 'promoted' ? 'Pass Out' : 'Inactive'}` : ''}
            </p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close leaving record"><X size={18} /></button>
        </div>

        <p className="withdraw-intro">
          Everything saved here is written into the student's own profile, in the <b>Leaving Info</b> section of their
          admission form. Editing that section, or bringing the student back to <b>Active</b>, changes this record too.
        </p>

        <div className="withdraw-grid">
          <label className={labelClass}>Status
            <select className={fieldClass} value={record.status} onChange={(event) => patch({ status: event.target.value })}>
              {WITHDRAWAL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.value}</option>
              ))}
            </select>
            <small className="withdraw-hint">
              {WITHDRAWAL_STATUS_OPTIONS.find((option) => option.value === record.status)?.hint}
            </small>
          </label>
          <label className={labelClass}>Withdrawal date
            <input type="date" className={fieldClass} value={record.leavingDate} onChange={(event) => patch({ leavingDate: event.target.value })} />
          </label>
          <label className={labelClass}>SLC serial no.
            <input className={fieldClass} value={record.slcSerialNumber} onChange={(event) => patch({ slcSerialNumber: event.target.value })} placeholder="Serial printed on the certificate" />
          </label>
          <label className={labelClass}>Leaving class
            <select className={fieldClass} value={record.leavingClass} onChange={(event) => patch({ leavingClass: event.target.value })}>
              <option value="">Select class</option>
              {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className={labelClass}>Reason for leaving
            <input className={fieldClass} value={record.reason} onChange={(event) => patch({ reason: event.target.value })} placeholder="Transfer, family moved, completed school…" />
          </label>
          <label className={labelClass}>Fee paid upto
            <input className={fieldClass} value={record.feePaidUpto} onChange={(event) => patch({ feePaidUpto: event.target.value })} placeholder="e.g. March 2026" />
          </label>
          <label className={labelClass}>Conduct
            <select className={fieldClass} value={record.conduct} onChange={(event) => patch({ conduct: event.target.value })}>
              <option value="">Select conduct</option>
              {LEAVING_RATING_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className={labelClass}>Progress
            <select className={fieldClass} value={record.progress} onChange={(event) => patch({ progress: event.target.value })}>
              <option value="">Select progress</option>
              {LEAVING_RATING_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className={`${labelClass} full`}>Withdrawal remark
            <textarea rows={2} className={fieldClass} value={record.remarks} onChange={(event) => patch({ remarks: event.target.value })} placeholder="Anything the office should remember about this departure" />
          </label>
        </div>

        <div className="withdraw-attendance">
          <div className="withdraw-attendance-head">
            <div>
              <span className="eyebrow">Attendance summary</span>
              <p>Read from the attendance register, up to the withdrawal date.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => void refreshAttendance(true)} disabled={readingAttendance}>
              {readingAttendance ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Refresh from register
            </button>
          </div>

          {summary && summary.schoolDays > 0 ? (
            <div className="withdraw-attendance-figures">
              <span><b>{summary.present}</b> present</span>
              <span><b>{summary.absent}</b> absent</span>
              <span><b>{summary.late}</b> late</span>
              <span><b>{summary.leave}</b> leave</span>
              <span><b>{formatPercentage(summary.percentage)}</b> attendance</span>
              <span><b>{summary.schoolDays}</b> school days</span>
            </div>
          ) : null}

          {attendanceNote ? <p className="withdraw-note"><AlertCircle size={13} /> {attendanceNote}</p> : null}

          <label className={labelClass}>Summary saved on the profile
            <textarea
              rows={2}
              className={fieldClass}
              value={record.attendanceSummary}
              onChange={(event) => patch({ attendanceSummary: event.target.value })}
              placeholder="Filled in from the register when the record is saved"
            />
          </label>
        </div>

        <div className="withdraw-certificate">
          <CalendarCheck2 size={15} />
          <span>Leaving certificate <b>{record.certificateNumber || certificateNumberFor(student.admission_number) || '—'}</b>, issued {record.leavingDate || '—'}.</span>
        </div>

        {error ? <p className="dmc-warning"><AlertCircle size={13} /> {error}</p> : null}

        <div className="notice-preview-actions withdraw-actions">
          {alreadyLeft && !confirmRestore ? (
            <button type="button" className="secondary-button" onClick={() => setConfirmRestore(true)} disabled={busy}>
              <RotateCcw size={15} /> Restore to Active
            </button>
          ) : null}
          {alreadyLeft && confirmRestore ? (
            <div className="withdraw-confirm">
              <span>Bring {student.full_name} back onto the active roll and clear their leaving record?</span>
              <button type="button" className="secondary-button" onClick={() => setConfirmRestore(false)} disabled={busy}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void restore()} disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Yes, restore
              </button>
            </div>
          ) : null}
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save leaving record
          </button>
        </div>
      </section>
    </div>
  );
}
