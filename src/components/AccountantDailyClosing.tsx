import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, Coins, Printer, RefreshCw, Save, Wallet } from 'lucide-react';
import { closingSummaryFor, fetchDailyClosing, saveDailyClosing } from '@/lib/accountant';
import { formatDay, formatMoney, type FeePayment } from '@/lib/fees';

// End-of-day cash closing. The office enters the opening balance it counted and any
// notes; every other figure is read from the day's real receipts, so the report cannot
// disagree with the ledger.
export function AccountantDailyClosing({ payments, today, onToast }: {
  payments: FeePayment[];
  today: string;
  onToast: (message: string) => void;
}) {
  const [day, setDay] = useState(today);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const summary = useMemo(() => closingSummaryFor(payments, day), [payments, day]);
  const expectedClosing = Number(openingBalance || 0) + summary.cash;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchDailyClosing(day).then(({ closing, error: fetchError }) => {
      if (cancelled) return;
      setLoading(false);
      if (fetchError) { setError(fetchError); return; }
      setOpeningBalance(String(closing?.opening_balance ?? 0));
      setNotes(closing?.notes ?? '');
    });
    return () => { cancelled = true; };
  }, [day, reloadToken]);

  const save = async () => {
    const parsed = Number(openingBalance);
    if (!Number.isFinite(parsed) || parsed < 0) { setError('The opening balance must be zero or more.'); return; }
    setSaving(true);
    setError('');
    const saveError = await saveDailyClosing({ day, openingBalance: parsed, notes });
    setSaving(false);
    if (saveError) { setError(saveError); return; }
    onToast(`Daily closing saved for ${formatDay(day)}.`);
    setReloadToken((token) => token + 1);
  };

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Daily cash closing</span><h2>{formatDay(day)}</h2></div>
          <div className="fee-quick">
            <button className="secondary-button" onClick={() => setReloadToken((token) => token + 1)} disabled={loading}><RefreshCw size={15} /> Reload</button>
            <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print report</button>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Closing date</span>
            <input type="date" max={today} value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          <label className="control-field"><span>Opening balance (Rs)</span>
            <input type="number" min="0" step="1" inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} />
          </label>
          <label className="control-field full"><span>Closing notes</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything to record about today's cash" maxLength={500} />
          </label>
        </div>
        {error && <p className="fee-error">{error}</p>}
        <div className="fee-quick">
          <button className="primary-button" onClick={() => void save()} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save closing'}</button>
        </div>
      </section>

      <div className="fee-kpi-grid fee-kpi-grid-4">
        <div className="fee-kpi mint"><div className="fee-kpi-icon"><Coins size={20} /></div><div><span>Cash collected</span><strong>{formatMoney(summary.cash)}</strong><small>Received in cash</small></div></div>
        <div className="fee-kpi sky"><div className="fee-kpi-icon"><Building2 size={20} /></div><div><span>Bank / online</span><strong>{formatMoney(summary.bank + summary.online)}</strong><small>Bank and online receipts</small></div></div>
        <div className="fee-kpi sun"><div className="fee-kpi-icon"><Wallet size={20} /></div><div><span>Total collection</span><strong>{formatMoney(summary.total)}</strong><small>{summary.transactions} transaction{summary.transactions === 1 ? '' : 's'}</small></div></div>
        <div className="fee-kpi coral"><div className="fee-kpi-icon"><BadgeCheck size={20} /></div><div><span>Expected closing</span><strong>{formatMoney(expectedClosing)}</strong><small>Opening + cash collected</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head"><div><span className="eyebrow">Summary</span><h2>Closing statement</h2></div></div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>Opening balance</td><td className="text-right font-semibold tabular-nums">{formatMoney(Number(openingBalance || 0))}</td></tr>
              <tr><td>Cash collected today</td><td className="text-right font-semibold tabular-nums">{formatMoney(summary.cash)}</td></tr>
              <tr><td>Bank collected today</td><td className="text-right font-semibold tabular-nums">{formatMoney(summary.bank)}</td></tr>
              <tr><td>Online / Easypaisa collected today</td><td className="text-right font-semibold tabular-nums">{formatMoney(summary.online)}</td></tr>
              <tr><td>Total transactions</td><td className="text-right font-semibold tabular-nums">{summary.transactions}</td></tr>
              <tr className="acct-total-row"><td>Total collection</td><td className="text-right font-bold tabular-nums">{formatMoney(summary.total)}</td></tr>
              <tr><td>Reversed receipts today</td><td className="text-right tabular-nums">{summary.voidedToday} · {formatMoney(summary.voidedAmountToday)}</td></tr>
              <tr className="acct-total-row"><td>Expected closing balance (cash)</td><td className="text-right font-bold tabular-nums">{formatMoney(expectedClosing)}</td></tr>
            </tbody>
          </table>
        </div>
        {notes.trim() && <p className="fee-hint">Notes: {notes.trim()}</p>}
      </section>
    </div>
  );
}
