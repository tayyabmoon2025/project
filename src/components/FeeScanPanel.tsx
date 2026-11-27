import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ScanLine, X } from 'lucide-react';
import {
  PAYMENT_METHODS, formatDay, formatMoney, lookupFeeChallan, monthLabel, recordFeePayment,
  type PaymentMethod, type ScannedChallan,
} from '@/lib/fees';

// A barcode scanner behaves like a keyboard that types the code and presses Enter, so a
// plain input is all that is needed. The field keeps focus so the next challan can be
// scanned straight away without touching the mouse.
export function FeeScanPanel({ today, onToast, onPaid }: {
  today: string;
  onToast: (message: string) => void;
  onPaid: () => void | Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [challan, setChallan] = useState<ScannedChallan | null>(null);
  const [error, setError] = useState('');
  const [looking, setLooking] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('online');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  const reset = () => {
    setCode('');
    setChallan(null);
    setError('');
    setAmount('');
    setRemarks('');
    setMethod('online');
    focusInput();
  };

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { setError('Scan or type a challan code first.'); return; }
    setLooking(true);
    setError('');
    const result = await lookupFeeChallan(trimmed);
    setLooking(false);
    if (result.error || !result.challan) {
      setChallan(null);
      setError(result.error ?? 'No fee challan matches that code.');
      return;
    }
    setChallan(result.challan);
    setAmount(result.challan.remaining > 0 ? String(Math.round(result.challan.remaining)) : '');
    focusInput();
  };

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    if (!challan) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Enter an amount greater than zero.'); return; }
    setSaving(true);
    setError('');
    const result = await recordFeePayment({
      studentId: challan.student_id,
      amount: parsed,
      method,
      paymentDate: today,
      remarks: remarks.trim(),
      receiptNumber: '',
      challanNumber: challan.challan_number ?? challan.admission_number ?? '',
      source: 'scan',
      dueFee: challan.remaining,
      fine: 0,
      concession: 0,
      discount: 0,
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onToast(`${formatMoney(parsed)} received for ${challan.student_name}. Receipt ${result.receiptNumber}.`);
    setChallan({ ...challan, paid: challan.paid + parsed, remaining: Math.max(0, challan.remaining - parsed), status: result.challanStatus === 'paid' ? 'paid' : 'partial' });
    await onPaid();
    reset();
  };

  return (
    <section className="fee-card fee-scan">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Scan to pay</span>
          <h2>Scan a challan barcode</h2>
          <p className="fee-sub">Point the barcode reader at the Student Copy and it will land here. You can also type the challan or admission number and press Enter.</p>
        </div>
        <span className="fee-hint">Challan no. · Admission no. · Admission no. + month</span>
      </div>

      <form className="fee-scan-bar" onSubmit={lookup}>
        <div className="fee-scan-field">
          <ScanLine size={18} />
          <input
            ref={inputRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Scan barcode or type code, then press Enter"
            autoComplete="off"
            spellCheck={false}
            aria-label="Challan barcode or code"
          />
        </div>
        <button type="submit" className="primary-button" disabled={looking}>{looking ? 'Looking up…' : 'Find challan'}</button>
        {(challan || error) && (
          <button type="button" className="secondary-button" onClick={reset}><X size={16} /> Clear</button>
        )}
      </form>

      {error && <p className="fee-error">{error}</p>}

      {challan && (
        <div className="fee-scan-result">
          <div className="fee-scan-student">
            <span className={`fee-status ${challan.status}`}>{challan.status}</span>
            <h3>{challan.student_name}</h3>
            <p>
              Admission no. <strong>{challan.admission_number || '—'}</strong> · {challan.class_name ?? '—'} · Section {challan.section_name ?? '—'}
            </p>
            <dl className="fee-scan-facts">
              <div><dt>Challan no.</dt><dd>{challan.challan_number || '—'}</dd></div>
              <div><dt>Fee month</dt><dd>{monthLabel(challan.month)}</dd></div>
              <div><dt>Due date</dt><dd>{formatDay(challan.due_date)}</dd></div>
              <div><dt>Challan total</dt><dd>{formatMoney(challan.total)}</dd></div>
              <div><dt>Already paid</dt><dd>{formatMoney(challan.paid)}</dd></div>
              <div className="strong"><dt>Remaining</dt><dd>{formatMoney(challan.remaining)}</dd></div>
            </dl>
          </div>

          <form className="fee-form fee-scan-form" onSubmit={pay}>
            <label className="control-field"><span>Amount received (Rs)</span>
              <input type="number" min="1" step="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" required />
            </label>
            <label className="control-field"><span>Payment method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label className="control-field"><span>Remarks</span>
              <input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional note for the receipt" />
            </label>
            <div className="fee-form-actions">
              <button type="button" className="secondary-button" onClick={() => setAmount(String(Math.round(challan.remaining)))} disabled={challan.remaining <= 0}>
                Collect remaining
              </button>
              <button type="submit" className="primary-button" disabled={saving || challan.remaining <= 0}>
                <Check size={16} /> {saving ? 'Saving…' : challan.remaining <= 0 ? 'Already paid' : 'Mark as paid'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
