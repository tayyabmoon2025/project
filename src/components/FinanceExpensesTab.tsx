import { useMemo, useState } from 'react';
import { Pencil, Plus, Printer, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { formatDay, formatMoney } from '@/lib/fees';
import {
  deleteExpense,
  paymentModeLabel,
  saveExpense,
  updateExpense,
  type ExpenseDraft,
  type ExpenseRecord,
  type LedgerAccount,
} from '@/lib/finance';
import { useAuth } from '@/lib/auth';
import { FinanceRecordModal } from '@/components/FinanceRecordModal';
import { RangePicker } from '@/components/FinanceRange';
import type { FinanceRangeValue } from '@/lib/financeRange';

export function FinanceExpensesTab({ expenses, accounts, loading, range, onReload, onToast }: {
  expenses: ExpenseRecord[];
  accounts: LedgerAccount[];
  loading: boolean;
  range: FinanceRangeValue;
  onReload: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canRecord = isAdmin || ['accountant', 'office_assistant'].includes(profile?.role ?? '');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [modal, setModal] = useState<{ record?: ExpenseRecord } | null>(null);
  const [removingId, setRemovingId] = useState('');

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const headNames = useMemo(() => accounts.filter((account) => account.account_type === 'expense').map((account) => account.name), [accounts]);

  const inRange = useMemo(
    () => expenses.filter((row) => row.expense_date >= range.from && row.expense_date <= range.to),
    [expenses, range.from, range.to],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((row) => {
      if (categoryFilter && (accountById.get(row.category_id ?? '')?.name ?? 'Uncategorised') !== categoryFilter) return false;
      if (modeFilter && row.payment_mode !== modeFilter) return false;
      if (!needle) return true;
      return [row.description, row.paid_to, row.reference, accountById.get(row.category_id ?? '')?.name]
        .some((value) => (value ?? '').toLowerCase().includes(needle));
    });
  }, [inRange, search, categoryFilter, modeFilter, accountById]);

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const largest = rows.reduce((max, row) => Math.max(max, row.amount), 0);
  const headTotals = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const name = accountById.get(row.category_id ?? '')?.name ?? 'Uncategorised';
      map.set(name, (map.get(name) ?? 0) + row.amount);
    });
    return Array.from(map.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 4);
  }, [rows, accountById]);

  const draftOf = (record: ExpenseRecord): ExpenseDraft => ({
    expenseDate: record.expense_date,
    categoryId: record.category_id ?? '',
    amount: record.amount,
    paymentMode: record.payment_mode,
    paidTo: record.paid_to ?? '',
    reference: record.reference ?? '',
    description: record.description ?? '',
  });

  const remove = async (record: ExpenseRecord) => {
    setRemovingId(record.id);
    const err = await deleteExpense(record.id);
    setRemovingId('');
    if (err) { onToast(err); return; }
    onToast('Expense removed from the ledger.');
    await onReload();
  };

  return (
    <div className="finance-tab">
      <div className="fin-toolbar">
        <RangePicker range={range} />
        <div className="fin-toolbar-actions">
          <button className="secondary-button" onClick={() => void onReload()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print</button>
          {canRecord && (
            <button className="primary-button" onClick={() => setModal({})}><Plus size={16} /> Record expense</button>
          )}
        </div>
      </div>

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi coral"><div><span>Expenses in this period</span><strong>{formatMoney(total)}</strong><small>{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</small></div></div>
        <div className="fee-kpi sun"><div><span>Largest single expense</span><strong>{formatMoney(largest)}</strong><small>Biggest bill in the period</small></div></div>
        <div className="fee-kpi sky"><div><span>Top head</span><strong>{headTotals[0]?.name ?? '—'}</strong><small>{headTotals[0] ? formatMoney(headTotals[0].amount) : 'No expenses yet'}</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Expenses</span><h2>{formatDay(range.from)} — {formatDay(range.to)}</h2></div>
          <span className="fee-hint">{formatMoney(total)} across {rows.length} entries</span>
        </div>

        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, vendor, bill no. or head" />
          </label>
          <label className="control-field"><span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {headNames.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="Uncategorised">Uncategorised</option>
            </select>
          </label>
          <label className="control-field"><span>Payment mode</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              <option value="">All modes</option>
              {Array.from(new Set(expenses.map((row) => row.payment_mode))).map((mode) => (
                <option key={mode} value={mode}>{paymentModeLabel(mode)}</option>
              ))}
            </select>
          </label>
        </div>

        {headTotals.length > 0 && (
          <div className="fin-head-chips">
            {headTotals.map((row) => (
              <span key={row.name} className="fin-head-chip"><b>{row.name}</b>{formatMoney(row.amount)}</span>
            ))}
          </div>
        )}

        {loading ? <p className="fee-empty">Loading expenses…</p> : rows.length === 0 ? (
          <p className="fee-empty">No expenses recorded for this period. Use “Record expense” to add the first one.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Head</th><th>Description</th><th>Paid to</th>
                  <th>Mode</th><th>Reference</th><th className="text-right">Amount</th><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDay(row.expense_date)}</td>
                    <td><span className="fee-status neutral">{accountById.get(row.category_id ?? '')?.name ?? 'Uncategorised'}</span></td>
                    <td>{row.description || '—'}</td>
                    <td>{row.paid_to || '—'}</td>
                    <td>{paymentModeLabel(row.payment_mode)}</td>
                    <td className="fee-mono">{row.reference || '—'}</td>
                    <td className="text-right font-semibold tabular-nums text-rose-600">{formatMoney(row.amount)}</td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        {canRecord && (
                          <button type="button" className="fee-link" onClick={() => setModal({ record: row })}><Pencil size={14} /> Edit</button>
                        )}
                        {isAdmin && (
                          <button type="button" className="fee-link danger" onClick={() => void remove(row)} disabled={removingId === row.id}>
                            <Trash2 size={14} /> {removingId === row.id ? 'Removing…' : 'Remove'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fee-total-row">
                  <td colSpan={6}>Total expenses</td>
                  <td className="text-right">{formatMoney(total)}</td>
                  <td className="no-print" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <section className="fee-card no-print">
          <div className="fee-card-head">
            <div><span className="eyebrow">Breakdown</span><h2>Spending by head</h2></div>
            <Wallet size={18} />
          </div>
          <div className="fin-bar-list">
            {headTotals.map((row) => (
              <div className="fin-bar" key={row.name}>
                <span>{row.name}</span>
                <i><em style={{ width: `${total > 0 ? (row.amount / total) * 100 : 0}%` }} /></i>
                <strong>{formatMoney(row.amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {modal && (
        <FinanceRecordModal
          kind="expense"
          accounts={accounts}
          initial={modal.record ? draftOf(modal.record) : undefined}
          onClose={() => setModal(null)}
          onSave={async (draft) => {
            const err = modal.record ? await updateExpense(modal.record.id, draft as ExpenseDraft) : await saveExpense(draft as ExpenseDraft);
            if (!err) await onReload();
            return err;
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
