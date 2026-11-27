import { useState, type FormEvent } from 'react';
import { Coins, Printer, RotateCcw, ScanLine, Wallet, X } from 'lucide-react';
import { FeeReceiptView } from '@/components/FeeDocuments';
import { FeeVoucherList } from '@/components/FeeVoucherList';
import { DeleteVoucherModal } from '@/components/DeleteVoucherModal';
import {
  PAYMENT_METHODS, autoRemarks, formatMoney, lookupFeeChallan, payableFee, recordFeePayment, updateFeeVoucher,
  type FeePayment, type PaymentMethod,
} from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

type VoucherForm = {
  dueFee: string;
  fine: string;
  concession: string;
  discount: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  receiptNumber: string;
  remarks: string;
};

const emptyVoucher = (today: string): VoucherForm => ({
  dueFee: '', fine: '', concession: '', discount: '', amount: '',
  method: 'cash', paymentDate: today, receiptNumber: '', remarks: '',
});

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// The accountant's day-to-day screen. A scanned or typed admission / challan number brings
// the student up with their due fee ready, the voucher total updates as it is filled in,
// and the month's submitted vouchers sit underneath to correct, print or reverse.
export function AccountantReceiveFee({ students, payments, loading, today, onToast, onSaved, preselect }: {
  students: Student[];
  payments: FeePayment[];
  loading: boolean;
  today: string;
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
  preselect: string | null;
}) {
  const [code, setCode] = useState('');
  const [studentId, setStudentId] = useState(preselect ?? '');
  const [challanNumber, setChallanNumber] = useState('');
  const [form, setForm] = useState<VoucherForm>(() => emptyVoucher(today));
  const [remarksTouched, setRemarksTouched] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<FeePayment | null>(null);
  const [reprinting, setReprinting] = useState<FeePayment | null>(null);
  const [deleting, setDeleting] = useState<FeePayment | null>(null);

  const student = students.find((row) => row.id === studentId) ?? null;

  const dueFee = toNumber(form.dueFee);
  const fine = toNumber(form.fine);
  const concession = toNumber(form.concession);
  const discount = toNumber(form.discount);
  const paid = toNumber(form.amount);
  const payable = payableFee(dueFee, fine, concession, discount);
  const remaining = Math.max(0, payable - paid);

  const studentDue = student ? Math.max(0, Number(student.fee_balance ?? 0)) : 0;

  // The remark follows the figures until the accountant edits it, after which their own
  // wording is kept.
  if (!remarksTouched && form.remarks !== autoRemarks(payable, paid, remaining)) {
    setForm((current) => ({ ...current, remarks: autoRemarks(payable, paid, remaining) }));
  }

  const set = (patch: Partial<VoucherForm>) => setForm((current) => ({ ...current, ...patch }));

  const loadStudent = (row: Student, due: number, challan: string) => {
    setStudentId(row.id);
    setChallanNumber(challan);
    setCode(row.admission_number);
    setForm({ ...emptyVoucher(today), dueFee: due > 0 ? String(Math.round(due)) : '' });
    setRemarksTouched(false);
    setEditingId('');
    setError('');
  };

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { setError('Enter or scan an admission number or challan number first.'); return; }

    setLooking(true);
    setError('');

    // Try the roster first: an exact admission number match is the fastest path and avoids
    // a round trip. Digits-only ("2401" for "SD-2401") is accepted too, so a counter who
    // skips the prefix still lands on the student.
    const lowerTrimmed = trimmed.toLowerCase();
    const digitsOnly = trimmed.replace(/\D/g, '');
    const byAdmission = students.find(
      (row) => (row.admission_number ?? '').toLowerCase() === lowerTrimmed
        || (digitsOnly && (row.admission_number ?? '').replace(/\D/g, '') === digitsOnly),
    );
    if (byAdmission) {
      setLooking(false);
      loadStudent(byAdmission, Math.max(0, Number(byAdmission.fee_balance ?? 0)), '');
      return;
    }

    const result = await lookupFeeChallan(trimmed);
    setLooking(false);
    if (result.error || !result.challan) {
      setStudentId('');
      setError(result.error ?? 'No student or challan matches that code.');
      return;
    }

    const found = students.find((row) => row.id === result.challan?.student_id);
    if (!found) { setError('That challan belongs to a student who is not on the active roll.'); return; }
    loadStudent(found, result.challan.remaining, result.challan.challan_number ?? '');
  };

  const startEdit = (payment: FeePayment) => {
    const row = students.find((item) => item.id === payment.student_id) ?? null;
    if (row) setStudentId(row.id);
    setCode(row?.admission_number ?? payment.admission_number ?? '');
    setChallanNumber(payment.challan_number ?? '');
    setEditingId(payment.id);
    setRemarksTouched(true);
    setError('');
    setForm({
      dueFee: payment.due_fee === null ? '' : String(Math.round(payment.due_fee)),
      fine: payment.fine_amount > 0 ? String(Math.round(payment.fine_amount)) : '',
      concession: payment.concession > 0 ? String(Math.round(payment.concession)) : '',
      discount: payment.discount > 0 ? String(Math.round(payment.discount)) : '',
      amount: String(Math.round(payment.amount)),
      method: payment.method,
      paymentDate: payment.payment_date,
      receiptNumber: payment.receipt_number,
      remarks: payment.remarks ?? '',
    });
    window.setTimeout(() => document.getElementById('acct-voucher-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const cancelEdit = () => {
    setEditingId('');
    setChallanNumber('');
    setForm(emptyVoucher(today));
    setRemarksTouched(false);
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!student) { setError('Look up a student first.'); return; }
    if (paid <= 0) { setError('Enter the amount received.'); return; }
    if (paid > 1000000) { setError('That amount is larger than this form accepts.'); return; }
    if (form.paymentDate > today) { setError('The payment date cannot be in the future.'); return; }

    setSaving(true);
    setError('');

    if (editingId) {
      const result = await updateFeeVoucher(editingId, {
        amount: paid,
        method: form.method,
        paymentDate: form.paymentDate,
        remarks: form.remarks.trim(),
        receiptNumber: form.receiptNumber,
        dueFee,
        fine,
        concession,
        discount,
      });
      setSaving(false);
      if (result.error) { setError(result.error); return; }
      onToast(`Voucher ${form.receiptNumber} updated for ${student.full_name}.`);
      cancelEdit();
      await onSaved();
      return;
    }

    const result = await recordFeePayment({
      studentId: student.id,
      amount: paid,
      method: form.method,
      paymentDate: form.paymentDate,
      remarks: form.remarks.trim(),
      receiptNumber: form.receiptNumber.trim(),
      challanNumber: challanNumber || undefined,
      dueFee,
      fine,
      concession,
      discount,
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }

    setReceipt({
      id: result.paymentId || `local-${result.receiptNumber}`,
      student_id: student.id,
      receipt_number: result.receiptNumber,
      amount: paid,
      method: form.method,
      payment_date: form.paymentDate,
      remarks: form.remarks.trim() || null,
      balance_after: result.balanceAfter,
      created_at: new Date().toISOString(),
      challan_id: null,
      challan_number: challanNumber || null,
      source: 'manual',
      voided: false,
      voided_at: null,
      void_reason: null,
      due_fee: dueFee,
      fine_amount: fine,
      concession,
      discount,
      payable_fee: payable,
      updated_at: null,
      edit_count: 0,
      student_name: student.full_name,
      fathers_name: student.fathers_name ?? null,
      class_name: student.class_name,
      section_name: student.section_name,
      admission_number: student.admission_number,
    });
    onToast(`Receipt ${result.receiptNumber} saved for ${student.full_name}.`);
    cancelEdit();
    await onSaved();
  };

  return (
    <div className="fee-section">
      <section className="fee-card fee-counter">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Step 1 · Quick lookup</span>
            <h2>Admission no. or challan no.</h2>
            <p className="fee-sub">Type it or scan the barcode and press Enter. The student, their class and their due fee fill in on their own.</p>
          </div>
          <span className="fee-hint">Barcode reader ready</span>
        </div>

        <form className="fee-scan-bar" onSubmit={lookup}>
          <div className="fee-scan-field">
            <ScanLine size={18} />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Admission no. / challan no., then Enter"
              autoComplete="off"
              spellCheck={false}
              aria-label="Admission number or challan number"
            />
          </div>
          <button type="submit" className="primary-button" disabled={looking}>{looking ? 'Looking up…' : 'Load student'}</button>
          {student && <button type="button" className="secondary-button" onClick={() => { setStudentId(''); setChallanNumber(''); setCode(''); setForm(emptyVoucher(today)); setRemarksTouched(false); setEditingId(''); }}><X size={16} /> Clear</button>}
        </form>

        {error && <p className="fee-error">{error}</p>}

        {student ? (
          <div className="fee-identity">
            <div><span>Student Name</span><strong>{student.full_name}</strong></div>
            <div><span>Father Name</span><strong>{student.fathers_name || student.guardian_name || '—'}</strong></div>
            <div><span>Class / Section</span><strong>{student.class_name} / {student.section_name}</strong></div>
            <div><span>Due Fee</span><strong className={studentDue > 0 ? 'due' : 'clear'}>{formatMoney(studentDue)}</strong></div>
          </div>
        ) : (
          !loading && <p className="fee-empty">No student loaded yet. Enter an admission number to begin.</p>
        )}
      </section>

      {student && (
        <section className="fee-card" id="acct-voucher-form">
          <div className="fee-card-head">
            <div>
              <span className="eyebrow">Step 2 · Fee voucher</span>
              <h2>{editingId ? 'Update this voucher' : 'Calculate and collect'}</h2>
              {editingId && <p className="fee-sub">Receipt {form.receiptNumber} keeps its number; only the figures below change.</p>}
            </div>
            {editingId && <button type="button" className="secondary-button" onClick={cancelEdit}>Cancel edit</button>}
          </div>

          <form className="fee-form" onSubmit={submit}>
            <div className="fee-voucher-grid">
              <label className="control-field"><span>Due Fee (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.dueFee} onChange={(event) => set({ dueFee: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Late Fee Fine (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.fine} onChange={(event) => set({ fine: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Fee Concession (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.concession} onChange={(event) => set({ concession: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Discount (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.discount} onChange={(event) => set({ discount: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Payable Fee (Rs)</span>
                <input value={Math.round(payable).toLocaleString()} readOnly className="fee-readonly" aria-label="Payable fee, worked out from due fee, fine, concession and discount" />
              </label>
              <label className="control-field"><span>Paid Fee (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.amount} onChange={(event) => set({ amount: event.target.value })} placeholder="Amount received" required />
              </label>
              <label className="control-field"><span>Remaining (Rs)</span>
                <input value={Math.round(remaining).toLocaleString()} readOnly className="fee-readonly" aria-label="Remaining balance" />
              </label>
              <label className="control-field"><span>Payment method</span>
                <select value={form.method} onChange={(event) => set({ method: event.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              <label className="control-field"><span>Payment date</span>
                <input type="date" max={today} value={form.paymentDate} onChange={(event) => set({ paymentDate: event.target.value })} required />
              </label>
              <label className="control-field"><span>Receipt no.</span>
                <input value={form.receiptNumber} onChange={(event) => set({ receiptNumber: event.target.value })} placeholder="Blank generates one" maxLength={40} readOnly={Boolean(editingId)} />
              </label>
              <label className="control-field full"><span>Remarks</span>
                <input
                  value={form.remarks}
                  onChange={(event) => { setRemarksTouched(true); set({ remarks: event.target.value }); }}
                  placeholder="Filled in automatically, edit it if you need to"
                />
              </label>
            </div>

            <div className="fee-form-actions">
              {payable > 0 && <button type="button" className="secondary-button" onClick={() => set({ amount: String(Math.round(payable)) })}>Pay full {formatMoney(payable)}</button>}
              {remaining > 0 && <button type="button" className="secondary-button" onClick={() => set({ amount: String(Math.round(payable / 2)) })}>Half</button>}
              {remarksTouched && <button type="button" className="secondary-button" onClick={() => setRemarksTouched(false)}>Reset remarks</button>}
              <button type="submit" className="primary-button" disabled={saving}>
                <Coins size={16} /> {saving ? 'Saving…' : editingId ? 'Update voucher' : 'Save voucher & print'}
              </button>
            </div>

            <div className="fee-tally">
              <span>Total fee payable <strong>{formatMoney(payable)}</strong></span>
              <span>Fee paid <strong>{formatMoney(paid)}</strong></span>
              <span>Balance <strong className={remaining > 0 ? 'due' : 'clear'}>{formatMoney(remaining)}</strong></span>
            </div>
          </form>
        </section>
      )}

      <FeeVoucherList
        payments={payments}
        loading={loading}
        onEdit={startEdit}
        onDelete={setDeleting}
        onPrint={setReprinting}
      />

      {receipt && <FeeReceiptView payment={receipt} student={student} summary={null} onClose={() => setReceipt(null)} />}
      {reprinting && (
        <FeeReceiptView
          payment={reprinting}
          student={students.find((row) => row.id === reprinting.student_id) ?? null}
          summary={null}
          onClose={() => setReprinting(null)}
        />
      )}
      {deleting && (
        <DeleteVoucherModal
          payment={deleting}
          onClose={() => setDeleting(null)}
          onDone={async (message) => { setDeleting(null); onToast(message); await onSaved(); }}
        />
      )}

      {!student && !loading && (
        <p className="fee-hint"><Wallet size={14} /> Load a student above to see their due fee and collect the payment.</p>
      )}
      {student && !loading && !receipt && (
        <p className="fee-hint"><Printer size={14} /> Saving a voucher opens its Acknowledgment receipt, ready to print on A5 or an 80mm roll.</p>
      )}
      {!loading && payments.some((payment) => !payment.voided) && (
        <p className="fee-hint"><RotateCcw size={14} /> A receipt that was recorded wrongly can be corrected or deleted from the voucher list above.</p>
      )}
    </div>
  );
}
