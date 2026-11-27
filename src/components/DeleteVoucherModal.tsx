import { useState, type FormEvent } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { deleteFeeVoucher, formatDay, formatMoney, type FeePayment } from '@/lib/fees';

// Deleting a voucher puts the student's dues back and leaves a reversal entry in the fee
// ledger, so it is never silent. A reason is required and is stored with that entry.
export function DeleteVoucherModal({ payment, onClose, onDone }: {
  payment: FeePayment;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) { setError('Give a short reason so the record explains itself.'); return; }
    setDeleting(true);
    setError('');
    const result = await deleteFeeVoucher(payment.id, reason.trim());
    setDeleting(false);
    if (result.error) { setError(result.error); return; }

    const restored = result.restored > 0
      ? `${formatMoney(result.restored)} was added back to ${payment.student_name}'s dues.`
      : 'The student owed nothing on this receipt, so no dues were added back.';
    await onDone(`Voucher ${payment.receipt_number} deleted. ${restored}`);
  };

  return (
    <div className="notice-overlay">
      <form className="notice-modal" onSubmit={submit}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Delete voucher</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{payment.receipt_number}</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="fee-void-summary">
          <AlertTriangle size={18} />
          <div>
            <strong>This removes the voucher permanently.</strong>
            <span>
              {payment.student_name} · {formatMoney(payment.amount)} · {formatDay(payment.payment_date)}.
              The student's dues go back to what they were, and the fee ledger keeps a reversal entry with your reason.
            </span>
          </div>
        </div>

        <label className="control-field mt-5">
          <span>Reason for deleting (required)</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example: recorded twice by mistake"
            rows={3}
            maxLength={500}
            required
          />
        </label>

        {error && <p className="fee-error">{error}</p>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Keep voucher</button>
          <button type="submit" className="danger-button" disabled={deleting}>
            <Trash2 size={16} /> {deleting ? 'Deleting…' : 'Delete voucher'}
          </button>
        </div>
      </form>
    </div>
  );
}
