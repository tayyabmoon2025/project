import { useState, type FormEvent } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { formatDay, formatMoney, voidFeePayment, type FeePayment } from '@/lib/fees';

// Reversing a payment never deletes it. The original receipt stays in the records and
// this dialog collects the reason that is stored alongside it, so the audit trail is
// complete. The database enforces the same rule, so a blank reason cannot slip through.
export function VoidPaymentModal({ payment, onClose, onDone }: {
  payment: FeePayment;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) { setError('Please give a short reason for the reversal.'); return; }
    setBusy(true);
    setError('');
    const result = await voidFeePayment(payment.id, reason.trim());
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    const restored = result.restored > 0
      ? `${formatMoney(result.restored)} was added back to the balance.`
      : 'The student\'s balance was already clear, so nothing was added back.';
    onDone(`Receipt ${payment.receipt_number} reversed. ${restored}`);
    onClose();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><RotateCcw size={14} /> Reverse a payment</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Reverse receipt {payment.receipt_number}?</h2>
        <p className="mt-1 text-sm text-slate-500">
          {payment.student_name} · {formatDay(payment.payment_date)} · {formatMoney(payment.amount)}
        </p>
        <div className="fee-void-warning">
          <AlertTriangle size={16} />
          <span>The receipt is kept in the records and marked as reversed. The amount goes back onto the student's balance. This cannot be undone from here.</span>
        </div>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="control-field">Reason for reversal
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: wrong amount entered, payment returned"
              maxLength={500}
              autoFocus
            />
          </label>
          {error && <p className="fee-error">{error}</p>}
          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              <RotateCcw size={16} /> {busy ? 'Reversing…' : 'Reverse payment'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
