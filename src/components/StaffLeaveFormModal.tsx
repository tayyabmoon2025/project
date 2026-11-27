import { useState } from 'react';
import { CalendarRange, Loader as Loader2, Send, X } from 'lucide-react';
import type { StaffMemberRecord } from '@/lib/staffProfile';
import { isStaffActive, staffId } from '@/lib/staffDirectory';
import {
  applyForStaffLeave,
  leaveDayCount,
  leaveRangeLabel,
  saveStaffLeave,
  STAFF_LEAVE_TYPES,
  STAFF_LEAVE_TYPE_HINTS,
  STAFF_LEAVE_TYPE_LABELS,
  type StaffLeaveRequest,
  type StaffLeaveType,
} from '@/lib/staffLeave';

// Applying for leave and recording leave on somebody's behalf are the same form. The only
// difference is whether the staff member is chosen or is the person filling it in — the
// server decides which of those is allowed, so the form cannot be talked into recording
// leave for the wrong person.

type Draft = {
  staffUserId: string;
  leaveType: StaffLeaveType;
  startDate: string;
  endDate: string;
  reason: string;
};

const draftFrom = (row: StaffLeaveRequest | null): Draft => ({
  staffUserId: row?.staff_user_id ?? '',
  leaveType: row?.leave_type ?? 'casual',
  startDate: row?.start_date?.slice(0, 10) ?? '',
  endDate: row?.end_date?.slice(0, 10) ?? '',
  reason: row?.reason ?? '',
});

export function StaffLeaveFormModal({ staff, isAdmin, selfId, editing, onClose, onSaved, onToast }: {
  staff: StaffMemberRecord[];
  isAdmin: boolean;
  selfId: string;
  editing: StaffLeaveRequest | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(editing));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only staff who are working now can take leave; former staff stay in the directory but
  // do not appear here.
  const choices = staff.filter((member) => isStaffActive(member.status));
  const me = staff.find((member) => member.id === selfId) ?? null;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  // The to date follows the from date until the office changes it, so a one-day request is
  // two taps rather than three.
  const setStart = (value: string) => {
    setDraft((current) => ({
      ...current,
      startDate: value,
      endDate: current.endDate && current.endDate >= value ? current.endDate : value,
    }));
    setError(null);
  };

  const days = leaveDayCount(draft.startDate, draft.endDate);

  const submit = async () => {
    const staffUserId = isAdmin ? draft.staffUserId : selfId;
    if (!staffUserId) { setError('Choose the staff member this leave is for.'); return; }
    if (!draft.startDate || !draft.endDate) { setError('Choose both the from and to dates.'); return; }
    if (draft.endDate < draft.startDate) { setError('The to date cannot be before the from date.'); return; }

    setBusy(true);
    const result = isAdmin
      ? await saveStaffLeave({
          id: editing?.id ?? null,
          staffUserId,
          leaveType: draft.leaveType,
          startDate: draft.startDate,
          endDate: draft.endDate,
          reason: draft.reason,
        })
      : await applyForStaffLeave({
          leaveType: draft.leaveType,
          startDate: draft.startDate,
          endDate: draft.endDate,
          reason: draft.reason,
        });
    setBusy(false);

    if (result.error) { setError(result.error); return; }

    const who = staff.find((member) => member.id === staffUserId)?.full_name ?? 'The staff member';
    if (editing) {
      onToast(`${who}'s leave request was updated and is waiting for a decision.`);
    } else if (isAdmin) {
      onToast(`${who}'s leave was recorded for ${days} day${days === 1 ? '' : 's'}.`);
    } else {
      onToast(`Your leave request for ${days} day${days === 1 ? '' : 's'} was sent for approval.`);
    }
    onSaved();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal payroll-modal leave-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><CalendarRange size={14} /> {editing ? 'Edit leave request' : 'Apply for leave'}</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{editing ? 'Change this leave request' : 'Log a leave request'}</h2>
        <p className="payroll-modal-sub">
          {isAdmin
            ? 'Record leave for any staff member. A new request waits for your approval before it reaches the attendance register.'
            : 'Your request goes to the office for approval. Once it is approved the days are marked on the attendance register.'}
        </p>

        <div className="payroll-form-grid">
          {isAdmin ? (
            <label className="control-field full">Staff member
              <select value={draft.staffUserId} onChange={(event) => update('staffUserId', event.target.value)}>
                <option value="">Choose a staff member</option>
                {choices.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name} · {staffId(member.id)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="control-field full">
              Staff member
              <div className="leave-self-readout">
                <strong>{me?.full_name ?? 'You'}</strong>
                <small>Leave is always recorded against your own account.</small>
              </div>
            </div>
          )}

          <label className="control-field full">Leave type
            <select value={draft.leaveType} onChange={(event) => update('leaveType', event.target.value as StaffLeaveType)}>
              {STAFF_LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>{STAFF_LEAVE_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <span className="leave-field-hint">{STAFF_LEAVE_TYPE_HINTS[draft.leaveType]}</span>
          </label>

          <label className="control-field">From date
            <input type="date" value={draft.startDate} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="control-field">To date
            <input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => update('endDate', event.target.value)} />
          </label>

          <label className="control-field full">Reason
            <textarea
              rows={3}
              value={draft.reason}
              onChange={(event) => update('reason', event.target.value)}
              placeholder="Why is this leave being taken? e.g. family wedding out of city"
              maxLength={500}
            />
          </label>
        </div>

        <div className="payroll-summary leave-total-summary">
          <div><span>Total days</span><strong>{days} day{days === 1 ? '' : 's'}</strong></div>
          <div><span>Dates</span><strong>{draft.startDate && draft.endDate ? leaveRangeLabel(draft.startDate, draft.endDate) : 'Not chosen yet'}</strong></div>
          <div><span>Pay effect</span><strong>{draft.leaveType === 'unpaid' ? 'Unpaid — deducted on salary' : 'Paid leave'}</strong></div>
        </div>

        {error && <div className="auth-error"><span>{error}</span></div>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={16} className="auth-spinner" /> : <Send size={16} />}
            {editing ? 'Save changes' : isAdmin ? 'Record leave' : 'Send for approval'}
          </button>
        </div>
      </section>
    </div>
  );
}
