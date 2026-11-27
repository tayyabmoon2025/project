import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import {
  PAYMENT_MODES,
  type ExpenseDraft,
  type IncomeDraft,
  type LedgerAccount,
} from '@/lib/finance';
import { todayKey } from '@/lib/attendance';

// One form for both tabs: the fields differ only in their wording, so the shared
// shape keeps the two screens consistent and the validation in one place.
export function FinanceRecordModal({ kind, accounts, initial, onClose, onSave, onToast }: {
  kind: 'expense' | 'income';
  accounts: LedgerAccount[];
  initial?: ExpenseDraft | IncomeDraft;
  onClose: () => void;
  onSave: (draft: ExpenseDraft | IncomeDraft) => Promise<string | null>;
  onToast: (message: string) => void;
}) {
  const isExpense = kind === 'expense';
  const existing = initial as ExpenseDraft | IncomeDraft | undefined;
  const [date, setDate] = useState(existing ? (isExpense ? (existing as ExpenseDraft).expenseDate : (existing as IncomeDraft).incomeDate) : todayKey());
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [paymentMode, setPaymentMode] = useState(existing?.paymentMode ?? 'cash');
  const [paidTo, setPaidTo] = useState(existing && isExpense ? (existing as ExpenseDraft).paidTo : '');
  const [reference, setReference] = useState(existing?.reference ?? '');
  const [note, setNote] = useState(existing ? (isExpense ? (existing as ExpenseDraft).description : (existing as IncomeDraft).notes) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const heads = accounts.filter((account) => account.account_type === kind && account.is_active);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!date) { setError('Choose a date.'); return; }
    setBusy(true);
    const draft = isExpense
      ? { expenseDate: date, categoryId, amount: parsed, paymentMode, paidTo, reference, description: note } satisfies ExpenseDraft
      : { incomeDate: date, categoryId, amount: parsed, paymentMode, reference, notes: note } satisfies IncomeDraft;
    const err = await onSave(draft);
    setBusy(false);
    if (err) { setError(err); return; }
    onToast(isExpense
      ? `${existing ? 'Expense updated' : 'Expense recorded'} — Rs ${Math.round(parsed).toLocaleString()}.`
      : `${existing ? 'Income updated' : 'Income recorded'} — Rs ${Math.round(parsed).toLocaleString()}.`);
    onClose();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal fin-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow">{isExpense ? 'Expense' : 'Other income'}</span>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">{existing ? 'Edit record' : isExpense ? 'Record an expense' : 'Record other income'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {isExpense
            ? 'Money the school has paid out. It appears in the general ledger, trial balance and income statement straight away.'
            : 'Money received that is not a fee. It is added to the income side of the ledger and the income statement.'}
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div className="fin-form-row">
            <label className="control-field"><span>Date</span>
              <input type="date" value={date} max={todayKey()} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="control-field"><span>Head / category</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Uncategorised</option>
                {heads.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
          </div>

          <div className="fin-form-row">
            <label className="control-field"><span>Amount (Rs)</span>
              <input type="number" min="0" step="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required />
            </label>
            <label className="control-field"><span>Payment mode</span>
              <select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}>
                {PAYMENT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            </label>
          </div>

          <div className="fin-form-row">
            {isExpense && (
              <label className="control-field"><span>Paid to</span>
                <input value={paidTo} onChange={(event) => setPaidTo(event.target.value)} placeholder="Vendor or person paid" maxLength={120} />
              </label>
            )}
            <label className="control-field"><span>Reference / bill no.</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" maxLength={60} />
            </label>
          </div>

          <label className="control-field full">
            <span>{isExpense ? 'Description' : 'Notes'}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={isExpense ? 'What was this spent on?' : 'Where did this money come from?'}
              rows={3}
              maxLength={400}
            />
          </label>

          {heads.length === 0 && (
            <p className="fin-hint">No {isExpense ? 'expense' : 'income'} heads have been set up yet. It will be saved as uncategorised — you can add heads on the Reports tab.</p>
          )}

          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}

          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {existing ? 'Save changes' : 'Save record'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
