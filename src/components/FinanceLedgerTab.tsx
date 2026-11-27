import { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Printer, RefreshCw } from 'lucide-react';
import { formatDay, formatMoney } from '@/lib/fees';
import {
  ENTRY_KIND_LABELS,
  ledgerTotals,
  paymentModeLabel,
  type LedgerEntry,
  type LedgerEntryKind,
} from '@/lib/finance';
import { RangePicker } from '@/components/FinanceRange';
import type { FinanceRangeValue } from '@/lib/financeRange';

const KIND_TONES: Record<LedgerEntryKind, string> = {
  fee_collection: 'mint',
  other_income: 'sky',
  expense: 'coral',
};

const ALL_KINDS: LedgerEntryKind[] = ['fee_collection', 'other_income', 'expense'];

export function FinanceLedgerTab({ entries, loading, range, onReload }: {
  entries: LedgerEntry[];
  loading: boolean;
  range: FinanceRangeValue;
  onReload: () => Promise<void>;
}) {
  const [kinds, setKinds] = useState<LedgerEntryKind[]>([]);
  const [search, setSearch] = useState('');
  const [hideReversed, setHideReversed] = useState(false);

  // An empty selection means every type. Unticking one box therefore has to start
  // from the full list, otherwise unticking "Expense" would show expenses only.
  const kindOn = (kind: LedgerEntryKind) => kinds.length === 0 || kinds.includes(kind);
  const toggleKind = (kind: LedgerEntryKind) => {
    setKinds((current) => {
      const active = current.length === 0 ? ALL_KINDS : current;
      const next = active.includes(kind) ? active.filter((item) => item !== kind) : [...active, kind];
      return next.length === ALL_KINDS.length ? [] : next;
    });
  };

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kinds.length > 0 && !kinds.includes(entry.entry_kind)) return false;
      if (hideReversed && entry.is_voided) return false;
      if (!needle) return true;
      return [entry.description, entry.reference, entry.account_name, entry.payment_mode]
        .some((value) => (value ?? '').toLowerCase().includes(needle));
    });
  }, [entries, kinds, search, hideReversed]);

  const totals = ledgerTotals(rows);
  const feeTotal = entries.filter((entry) => entry.entry_kind === 'fee_collection').reduce((sum, entry) => sum + entry.debit, 0);
  const otherTotal = entries.filter((entry) => entry.entry_kind === 'other_income').reduce((sum, entry) => sum + entry.debit, 0);
  const expenseTotal = entries.filter((entry) => entry.entry_kind === 'expense').reduce((sum, entry) => sum + entry.credit, 0);

  return (
    <div className="finance-tab">
      <div className="fin-toolbar">
        <RangePicker range={range} />
        <div className="fin-toolbar-actions">
          <button className="secondary-button" onClick={() => void onReload()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print ledger</button>
        </div>
      </div>

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Fee money collected</span><strong>{formatMoney(feeTotal)}</strong><small>Receipts recorded in the period</small></div></div>
        <div className="fee-kpi sky"><div><span>Other income</span><strong>{formatMoney(otherTotal)}</strong><small>Rent, donations and the like</small></div></div>
        <div className="fee-kpi coral"><div><span>Expenses paid out</span><strong>{formatMoney(expenseTotal)}</strong><small>Bills recorded in the period</small></div></div>
        <div className={`fee-kpi ${totals.balance >= 0 ? 'mint' : 'coral'}`}><div><span>Net for the period</span><strong>{formatMoney(totals.balance)}</strong><small>Money in less money out</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">General ledger</span>
            <h2>{formatDay(range.from)} — {formatDay(range.to)}</h2>
            <p className="fee-hint mt-1">Fee receipts are pulled in live from the fee counter, so this ledger always agrees with the collection screens.</p>
          </div>
          <span className="fee-hint">{rows.length} entries</span>
        </div>

        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, reference or head" />
          </label>
          <div className="fin-kind-filter">
            <span>Show</span>
            {(Object.keys(ENTRY_KIND_LABELS) as LedgerEntryKind[]).map((kind) => (
              <label key={kind} className="att-filter-check">
                <input type="checkbox" checked={kindOn(kind)} onChange={() => toggleKind(kind)} />
                <span>{ENTRY_KIND_LABELS[kind]}</span>
              </label>
            ))}
            <label className="att-filter-check">
              <input type="checkbox" checked={hideReversed} onChange={() => setHideReversed(!hideReversed)} />
              <span>Hide reversed</span>
            </label>
          </div>
        </div>

        {loading ? <p className="fee-empty">Building the ledger…</p> : rows.length === 0 ? (
          <p className="fee-empty">No entries in this period. Fee receipts, other income and expenses will all appear here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Head</th><th>Description</th>
                  <th>Reference</th><th>Mode</th>
                  <th className="text-right">Debit (in)</th><th className="text-right">Credit (out)</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.entry_id} className={entry.is_voided ? 'acct-void-row' : ''}>
                    <td>{formatDay(entry.entry_date)}</td>
                    <td><span className={`fin-kind ${KIND_TONES[entry.entry_kind]}`}>{ENTRY_KIND_LABELS[entry.entry_kind]}</span></td>
                    <td>{entry.account_name}</td>
                    <td>{entry.description}</td>
                    <td className="fee-mono">{entry.reference || '—'}</td>
                    <td>{entry.payment_mode ? paymentModeLabel(entry.payment_mode) : '—'}</td>
                    <td className="text-right tabular-nums text-emerald-700">{entry.debit > 0 ? formatMoney(entry.debit) : '—'}</td>
                    <td className="text-right tabular-nums text-rose-600">{entry.credit > 0 ? formatMoney(entry.credit) : '—'}</td>
                    <td className={`text-right font-semibold tabular-nums ${entry.balance < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{formatMoney(entry.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fee-total-row">
                  <td colSpan={6}>Totals for the period</td>
                  <td className="text-right">{formatMoney(totals.debit)}</td>
                  <td className="text-right">{formatMoney(totals.credit)}</td>
                  <td className="text-right">{formatMoney(totals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="fin-hint no-print">
        <ArrowDownCircle size={14} /> A debit is money coming in and a credit is money going out. The balance column is the running total,
        so the last figure is what the school has left for the period. Reversed receipts stay in the list for the record but are left out of the running balance.
        <ArrowUpCircle size={14} />
      </p>
    </div>
  );
}
