import { useMemo, useState } from 'react';
import { Check, Clock, ShieldCheck, X, XCircle } from 'lucide-react';
import type { Student } from '@/lib/schoolTypes';
import { supabase } from '@/lib/supabase';
import { concessionCategoryLabel, concessionCategoryTheme, concessionNeedsApproval } from '@/lib/concessionCategories';

const formatRupees = (value: number) => `Rs ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

const STATUS_BADGE: Record<ApprovalStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'border-amber-300 bg-amber-100/80 text-amber-800' },
  approved: { label: 'Approved', className: 'border-emerald-300 bg-emerald-100/80 text-emerald-800' },
  rejected: { label: 'Rejected', className: 'border-rose-300 bg-rose-100/80 text-rose-800' },
};

// A student whose concession needs the principal's sign-off is shown in the
// approval queue. The status is normally set to 'pending' when the record is
// saved, but older records saved before the approval feature may have a NULL
// status — those are treated as pending so they are never hidden from the
// principal.
function approvalStatusFor(student: Student): ApprovalStatus | null {
  if (student.concession_approval_status) {
    return student.concession_approval_status as ApprovalStatus;
  }
  return concessionNeedsApproval(student.fee_concession_category) ? 'pending' : null;
}

export function ConcessionApprovalPanel({ students, approverName, onToast, onResolved }: {
  students: Student[];
  approverName: string;
  onToast: (message: string) => void;
  onResolved: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [busyId, setBusyId] = useState('');
  const [rejectingStudent, setRejectingStudent] = useState<Student | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const rows = useMemo(() => {
    return students
      .map((s) => ({ student: s, status: approvalStatusFor(s) }))
      .filter((row): row is { student: Student; status: ApprovalStatus } => row.status !== null)
      .filter((row) => filter === 'all' || row.status === filter)
      .sort((a, b) => {
        const aDate = a.student.concession_approved_at ?? '';
        const bDate = b.student.concession_approved_at ?? '';
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return bDate.localeCompare(aDate);
      });
  }, [students, filter]);

  const pendingCount = useMemo(
    () => students.filter((s) => approvalStatusFor(s) === 'pending').length,
    [students],
  );

  const approve = async (student: Student) => {
    setBusyId(student.id);
    try {
      const { error } = await supabase.rpc('set_concession_approval', {
        p_student_id: student.id,
        p_status: 'approved',
        p_approver_name: approverName,
      });
      if (error) { onToast(error.message); return; }
      onToast(`Approved concession for ${student.full_name}.`);
      await onResolved();
    } catch {
      onToast('Could not reach the school server. Try again.');
    } finally {
      setBusyId('');
    }
  };

  const confirmReject = async () => {
    if (!rejectingStudent) return;
    const reason = rejectReason.trim();
    if (!reason) { onToast('Please enter a reason for rejecting this concession.'); return; }
    setBusyId(rejectingStudent.id);
    try {
      const { error } = await supabase.rpc('set_concession_approval', {
        p_student_id: rejectingStudent.id,
        p_status: 'rejected',
        p_approver_name: approverName,
        p_rejection_reason: reason,
      });
      if (error) { onToast(error.message); return; }
      onToast(`Rejected concession for ${rejectingStudent.full_name}.`);
      setRejectingStudent(null);
      setRejectReason('');
      await onResolved();
    } catch {
      onToast('Could not reach the school server. Try again.');
    } finally {
      setBusyId('');
    }
  };

  const cancelReject = () => {
    setRejectingStudent(null);
    setRejectReason('');
  };

  const startReject = (student: Student) => {
    setRejectingStudent(student);
    setRejectReason('');
  };

  const FILTERS: { value: 'pending' | 'approved' | 'rejected' | 'all'; label: string }[] = [
    { value: 'pending', label: `Pending (${pendingCount})` },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Principal sign-off</span>
            <h2>Concession approvals</h2>
            <p className="fee-sub">
              Scholarships, orphan concessions and staff-child concessions need the principal&rsquo;s sign-off before they take effect. Approve or decline each request below.
            </p>
          </div>
        </div>

        <div className="fee-quick">
          <div className="segmented-control compact">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={filter === option.value ? 'selected' : ''}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="fee-card">
        {rows.length === 0 ? (
          <p className="fee-empty">
            {filter === 'pending'
              ? 'No concessions are waiting for approval.'
              : `No ${filter} concessions to show.`}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Category</th>
                  <th className="text-right">Concession</th>
                  <th>Status</th>
                  <th>Decided by</th>
                  <th>Reason</th>
                  <th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const student = row.student;
                  const theme = concessionCategoryTheme(student.fee_concession_category ?? '');
                  const status = row.status;
                  const badge = STATUS_BADGE[status];
                  const concessionAmount = Number(student.fee_concession_amount ?? 0);
                  return (
                    <tr key={student.id}>
                      <td>
                        <strong>{student.full_name}</strong>
                        <small className="fee-sub">{student.admission_number}</small>
                      </td>
                      <td>{student.class_name} · {student.section_name}</td>
                      <td>
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${theme.border} ${theme.bg} ${theme.title}`}>
                          {student.fee_concession_category ? concessionCategoryLabel(student.fee_concession_category) : '—'}
                        </span>
                      </td>
                      <td className="text-right font-semibold tabular-nums">
                        {concessionAmount > 0 ? formatRupees(concessionAmount) : '—'}
                      </td>
                      <td>
                        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {status === 'approved' ? <ShieldCheck size={12} /> : status === 'rejected' ? <XCircle size={12} /> : <Clock size={12} />}
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        {student.concession_approved_by ? (
                          <span className="text-sm text-slate-600">{student.concession_approved_by}</span>
                        ) : '—'}
                      </td>
                      <td>
                        {student.concession_rejection_reason ? (
                          <span className="text-sm text-rose-700">{student.concession_rejection_reason}</span>
                        ) : '—'}
                      </td>
                      <td className="text-right no-print">
                        {status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="primary-button"
                              disabled={busyId === student.id}
                              onClick={() => void approve(student)}
                            >
                              <Check size={14} /> {busyId === student.id ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyId === student.id}
                              onClick={() => startReject(student)}
                            >
                              <X size={14} /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejectingStudent && (
        <div className="notice-overlay" onClick={cancelReject}>
          <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">Reject concession</span>
              <button className="close-button" onClick={cancelReject} aria-label="Close">×</button>
            </div>
            <p className="fee-blocked-intro">
              Enter a reason for rejecting the {rejectingStudent.fee_concession_category ? concessionCategoryLabel(rejectingStudent.fee_concession_category).toLowerCase() : 'concession'} for <strong>{rejectingStudent.full_name}</strong>. The reason will be shown on the student&rsquo;s record.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="e.g. Income evidence does not qualify for this scholarship bracket."
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={cancelReject}>Cancel</button>
              <button
                className="primary-button"
                disabled={busyId === rejectingStudent.id || !rejectReason.trim()}
                onClick={() => void confirmReject()}
              >
                {busyId === rejectingStudent.id ? 'Saving…' : 'Confirm rejection'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
