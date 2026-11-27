import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

type FeeMode = 'payment' | 'charge';

export function FeeModal({ student, initialMode, onClose, onSaved }: { student: Student; initialMode: FeeMode; onClose: () => void; onSaved: (message: string) => void }) {
  const [mode, setMode] = useState<FeeMode>(initialMode);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const balance = Number(student.fee_balance);
  const parsedAmount = Number(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setError('Enter an amount greater than zero.'); return; }
    const nextBalance = mode === 'payment' ? Math.max(0, balance - parsedAmount) : balance + parsedAmount;
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase.from('school_students').update({ fee_balance: nextBalance }).eq('id', student.id);
    if (updateError) { setSaving(false); setError('The fee balance could not be saved. Please try again.'); return; }
    const { error: historyError } = await supabase.from('school_fee_transactions').insert({
      student_id: student.id,
      kind: mode,
      amount: parsedAmount,
      balance_after: nextBalance,
    });
    setSaving(false);
    if (historyError) { setError('The balance was saved, but the history entry could not be recorded.'); return; }
    onSaved(mode === 'payment' ? `Payment recorded for ${student.full_name}` : `Charge added for ${student.full_name}`);
    onClose();
  };

  return (
    <div className="notice-overlay">
      <form className="notice-modal" onSubmit={submit}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Fee account</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{student.full_name}</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close fee account"><X size={18} /></button>
        </div>
        <div className="mt-5 rounded-xl bg-sky-50 px-5 py-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current balance</span>
          <p className="mt-1 text-2xl font-bold text-slate-800">Rs {balance.toLocaleString()}</p>
        </div>
        <div className="segmented-control mt-5">
          {([['payment', 'Collect payment'], ['charge', 'Add charge']] as const).map(([value, label]) => (
            <button key={value} type="button" className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>
        <label className="control-field mt-5">
          <span>{mode === 'payment' ? 'Amount received (Rs)' : 'Amount to add (Rs)'}</span>
          <input type="number" min="1" step="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 2500" required />
        </label>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}><Check size={16} /> {saving ? 'Saving…' : mode === 'payment' ? 'Record payment' : 'Add charge'}</button>
        </div>
      </form>
    </div>
  );
}
