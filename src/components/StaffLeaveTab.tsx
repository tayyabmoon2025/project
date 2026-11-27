import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleSlash,
  Clock,
  Loader as Loader2,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { StaffMemberRecord } from '@/lib/staffProfile';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StaffLeaveFormModal } from '@/components/StaffLeaveFormModal';
import {
  currentMonthStart,
  deleteStaffLeave,
  fetchStaffLeave,
  leaveDayCount,
  leaveRangeLabel,
  leaveSummary,
  setStaffLeaveStatus,
  STAFF_LEAVE_STATUSES,
  STAFF_LEAVE_STATUS_LABELS,
  STAFF_LEAVE_STATUS_TONES,
  STAFF_LEAVE_TYPE_LABELS,
  type StaffLeaveRequest,
  type StaffLeaveStatus,
} from '@/lib/staffLeave';

// Leave management: the application form, the approval workflow, and the place where an
// approval meets the daily attendance register. Approving a request is what puts "On leave"
// against those dates for the office, and approved unpaid leave is what the salary screen
// counts as a deduction — so nothing has to be entered twice.

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  support_staff: 'Support Staff',
  student: 'Student',
};

const STATUS_FILTERS: { value: StaffLeaveStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...STAFF_LEAVE_STATUSES.map((status) => ({ value: status, label: STAFF_LEAVE_STATUS_LABELS[status] })),
];

const todayKey = () => new Date().toISOString().slice(0, 10);

const decisionDate = (value: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export function StaffLeaveTab({ onToast, staff }: {
  onToast: (message: string) => void;
  staff: StaffMemberRecord[];
}) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<StaffLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StaffLeaveStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StaffLeaveRequest | null>(null);
  const [decision, setDecision] = useState<{ row: StaffLeaveRequest; status: 'approved' | 'rejected' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, StaffMemberRecord>();
    for (const member of staff) map.set(member.id, member);
    return map;
  }, [staff]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchStaffLeave();
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isAdmin = profile?.role === 'admin';
  const selfId = profile?.id ?? '';
  const canApply = isAdmin || (profile?.role === 'teacher' || profile?.role === 'office_assistant'
    || profile?.role === 'accountant' || profile?.role === 'support_staff');

  const monthStart = currentMonthStart();
  const summary = useMemo(() => leaveSummary(rows, monthStart, todayKey()), [rows, monthStart]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!needle) return true;
      const member = byId.get(row.staff_user_id);
      const text = [
        member?.full_name ?? '',
        member?.username ?? '',
        member?.role ? ROLE_LABELS[member.role] ?? member.role : '',
        STAFF_LEAVE_TYPE_LABELS[row.leave_type],
        row.reason ?? '',
      ].join(' ').toLowerCase();
      return text.includes(needle);
    });
  }, [rows, statusFilter, search, byId]);

  const openApply = () => { setEditing(null); setShowForm(true); };
  const openEdit = (row: StaffLeaveRequest) => { setEditing(row); setShowForm(true); };

  const decide = async (row: StaffLeaveRequest, status: 'approved' | 'rejected', note: string) => {
    // The dialog closes first so a second click cannot send the decision twice.
    setDecision(null);
    setBusyId(row.id);
    const result = await setStaffLeaveStatus(row.id, status, note);
    setBusyId(null);
    if (result.error) { onToast(result.error); return; }

    const who = byId.get(row.staff_user_id)?.full_name ?? 'The staff member';
    const days = leaveDayCount(row.start_date, row.end_date);

    if (status === 'approved') {
      const marked = result.markedDays;
      onToast(
        marked > 0
          ? `${who}'s leave was approved and ${marked} day${marked === 1 ? '' : 's'} marked "On leave" on the attendance register.`
          : `${who}'s leave was approved. The attendance register already had those days recorded, so it was left as it is.`,
      );
    } else {
      onToast(`${who}'s leave request for ${days} day${days === 1 ? '' : 's'} was rejected.`);
    }
    void load();
  };

  const remove = async (row: StaffLeaveRequest) => {
    const who = byId.get(row.staff_user_id)?.full_name ?? 'this staff member';
    if (!window.confirm(`Remove the leave request for ${who} (${leaveRangeLabel(row.start_date, row.end_date)})?`)) return;
    setBusyId(row.id);
    const { error } = await deleteStaffLeave(row.id);
    setBusyId(null);
    if (error) { onToast(error); return; }
    onToast('The leave request was removed.');
    void load();
  };

  return (
    <div className="payroll-tab">
      <div className="leave-header">
        <div>
          <span className="eyebrow"><CalendarDays size={14} /> Leave management</span>
          <h3>Staff leave requests and approvals</h3>
          <p>
            {isAdmin
              ? 'Record leave, approve or reject what comes in, and let the attendance register and the salary screen follow along.'
              : 'Apply for your own leave here and follow what the office decides.'}
          </p>
        </div>
        {canApply ? (
          <button type="button" className="primary-button" onClick={openApply}>
            <CalendarPlus size={17} /> {isAdmin ? 'Record leave' : 'Apply for leave'}
          </button>
        ) : null}
      </div>

      <div className="leave-cards">
        <div className="leave-card pending">
          <span className="leave-card-icon"><Clock size={18} /></span>
          <strong>{summary.pending}</strong>
          <span>Pending requests</span>
          <small>Waiting for a decision</small>
        </div>
        <div className="leave-card approved">
          <span className="leave-card-icon"><BadgeCheck size={18} /></span>
          <strong>{summary.approvedThisMonth}</strong>
          <span>Approved this month</span>
          <small>{summary.approvedDaysThisMonth} leave day{summary.approvedDaysThisMonth === 1 ? '' : 's'} in the month</small>
        </div>
        <div className="leave-card rejected">
          <span className="leave-card-icon"><CircleSlash size={18} /></span>
          <strong>{summary.rejected}</strong>
          <span>Rejected</span>
          <small>Turned down on record</small>
        </div>
        <div className="leave-card today">
          <span className="leave-card-icon"><UserCheck size={18} /></span>
          <strong>{summary.onLeaveToday}</strong>
          <span>On leave today</span>
          <small>Staff away right now</small>
        </div>
      </div>

      <div className="panel roster-panel leave-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by staff name, role, leave type or reason"
            />
          </div>
          <div className="leave-filters">
            <div className="segmented-control compact" role="group" aria-label="Filter leave requests by status">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={statusFilter === option.value ? 'selected' : ''}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="result-count">{filtered.length} request{filtered.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {loading ? (
          <div className="empty-state large"><Loader2 size={22} className="auth-spinner" /> Loading leave requests…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state large">
            <CalendarCheck size={26} />
            <strong>{rows.length === 0 ? 'No leave has been recorded yet' : 'No leave requests match this filter'}</strong>
            <span>
              {rows.length === 0
                ? 'Use the button above to record the first leave request. Approving it will mark those days "On leave" on the attendance register.'
                : 'Try a different status, or clear the search box.'}
            </span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Leave type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const member = byId.get(row.staff_user_id);
                  const days = leaveDayCount(row.start_date, row.end_date);
                  const busy = busyId === row.id;
                  const canDecide = isAdmin && row.status === 'pending';
                  return (
                    <tr key={row.id} className={row.status === 'approved' ? 'leave-row-approved' : ''}>
                      <td>
                        <div className="table-student">
                          <PersonAvatar photoUrl={member?.photo_url ?? null} name={member?.full_name ?? 'Unknown'} />
                          <div className="leave-staff-cell">
                            <strong>{member?.full_name ?? 'Unknown staff member'}</strong>
                            <small>{member ? ROLE_LABELS[member.role] ?? member.role : 'No longer on the staff list'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`leave-type-chip ${row.leave_type === 'unpaid' ? 'unpaid' : ''}`}>
                          {STAFF_LEAVE_TYPE_LABELS[row.leave_type]}
                        </span>
                      </td>
                      <td className="muted-cell">{leaveRangeLabel(row.start_date, row.end_date)}</td>
                      <td className="leave-days-cell">{days}</td>
                      <td className="leave-reason-cell">{row.reason || '—'}</td>
                      <td>
                        <span className={`leave-pill ${STAFF_LEAVE_STATUS_TONES[row.status]}`}>
                          {STAFF_LEAVE_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="leave-decision-cell">
                        {row.status === 'pending' ? (
                          <span className="muted-cell">Applied {decisionDate(row.applied_at)}</span>
                        ) : (
                          <>
                            <span>{decisionDate(row.decided_at)}</span>
                            {row.decision_note ? <small>{row.decision_note}</small> : null}
                          </>
                        )}
                      </td>
                      <td>
                        <div className="leave-row-actions">
                          {canDecide ? (
                            <>
                              <button
                                type="button"
                                className="leave-action approve"
                                disabled={busy}
                                onClick={() => setDecision({ row, status: 'approved' })}
                              >
                                {busy ? <Loader2 size={14} className="auth-spinner" /> : <Check size={14} />} Approve
                              </button>
                              <button
                                type="button"
                                className="leave-action reject"
                                disabled={busy}
                                onClick={() => setDecision({ row, status: 'rejected' })}
                              >
                                <X size={14} /> Reject
                              </button>
                            </>
                          ) : null}
                          {isAdmin ? (
                            <>
                              <button type="button" className="icon-button" title="Edit this request" disabled={busy} onClick={() => openEdit(row)}>
                                <Pencil size={14} />
                              </button>
                              <button type="button" className="icon-button danger" title="Remove this request" disabled={busy} onClick={() => void remove(row)}>
                                <Trash2 size={14} />
                              </button>
                            </>
                          ) : null}
                          {!isAdmin && row.status !== 'pending' ? <span className="muted-cell">—</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="leave-footnote">
        Approving a request writes <strong>On leave</strong> against each of those days on the Daily attendance tab.
        Days the office has already recorded are left untouched, and an approved <strong>Unpaid Leave</strong> is
        added to the absent days counted when that month's salary is paid.
      </p>

      {showForm ? (
        <StaffLeaveFormModal
          staff={staff}
          isAdmin={isAdmin}
          selfId={selfId}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void load(); }}
          onToast={onToast}
        />
      ) : null}

      {decision ? (
        <LeaveDecisionModal
          row={decision.row}
          status={decision.status}
          staffName={byId.get(decision.row.staff_user_id)?.full_name ?? 'this staff member'}
          onClose={() => setDecision(null)}
          onConfirm={(note) => void decide(decision.row, decision.status, note)}
        />
      ) : null}
    </div>
  );
}

// The short note that goes with an approval or a rejection. It is optional, but it is what
// makes the register explain itself months later.
function LeaveDecisionModal({ row, status, staffName, onClose, onConfirm }: {
  row: StaffLeaveRequest;
  status: 'approved' | 'rejected';
  staffName: string;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const days = leaveDayCount(row.start_date, row.end_date);
  const approved = status === 'approved';
  const unpaid = approved && row.leave_type === 'unpaid';

  const confirm = () => {
    if (sent) return;
    setSent(true);
    onConfirm(note);
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal payroll-modal leave-decision-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow">
            {approved ? <Check size={14} /> : <X size={14} />} {approved ? 'Approve leave' : 'Reject leave'}
          </span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{approved ? 'Approve this leave?' : 'Reject this leave?'}</h2>
        <p className="payroll-modal-sub">
          {staffName} · {STAFF_LEAVE_TYPE_LABELS[row.leave_type]} · {leaveRangeLabel(row.start_date, row.end_date)}
        </p>

        <div className="payroll-summary leave-total-summary">
          <div><span>Total days</span><strong>{days} day{days === 1 ? '' : 's'}</strong></div>
          <div>
            <span>Attendance</span>
            <strong>
              {!approved
                ? 'Not changed'
                : row.leave_type === 'half_day'
                  ? 'Half day — marked by the office'
                  : `Marked "On leave" for ${days} day${days === 1 ? '' : 's'}`}
            </strong>
          </div>
          <div><span>Pay effect</span><strong>{unpaid ? 'Deducted on this month\'s salary' : 'No deduction'}</strong></div>
        </div>

        <label className="control-field full">Note for the record (optional)
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={approved ? 'e.g. approved by the principal' : 'e.g. no cover available that week'} maxLength={200} />
        </label>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={approved ? 'primary-button' : 'primary-button danger-button'}
            disabled={sent}
            onClick={confirm}
          >
            {approved ? <Check size={16} /> : <X size={16} />} {approved ? 'Approve leave' : 'Reject leave'}
          </button>
        </div>
      </section>
    </div>
  );
}
