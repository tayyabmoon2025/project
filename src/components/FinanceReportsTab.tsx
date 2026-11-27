import { useMemo, useState, type FormEvent } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Plus, Printer, Tag, Trash2, X } from 'lucide-react';
import { formatDay, formatMoney } from '@/lib/fees';
import { SCHOOL_NAME } from '@/lib/noticeText';
import {
  buildIncomeStatement,
  deleteLedgerAccount,
  ENTRY_KIND_LABELS,
  ledgerTotals,
  monthlyTrend,
  paymentModeLabel,
  saveLedgerAccount,
  setLedgerAccountActive,
  trialBalance,
  type AccountType,
  type LedgerAccount,
  type LedgerEntry,
} from '@/lib/finance';
import { useAuth } from '@/lib/auth';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { RangePicker } from '@/components/FinanceRange';
import type { FinanceRangeValue } from '@/lib/financeRange';

export function FinanceReportsTab({ entries, accounts, loading, range, onReload, onToast }: {
  entries: LedgerEntry[];
  accounts: LedgerAccount[];
  loading: boolean;
  range: FinanceRangeValue;
  onReload: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canManageHeads = isAdmin || ['accountant', 'office_assistant'].includes(profile?.role ?? '');
  const [kinds, setKinds] = useState<string[]>([]);
  const [headFilter, setHeadFilter] = useState('');
  const [search, setSearch] = useState('');
  const [printing, setPrinting] = useState(false);

  const statement = buildIncomeStatement(entries);
  const totals = ledgerTotals(entries);
  const balance = trialBalance(entries);
  const trend = monthlyTrend(entries);
  const periodLabel = `${formatDay(range.from)} — ${formatDay(range.to)}`;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kinds.length > 0 && !kinds.includes(entry.entry_kind)) return false;
      if (headFilter && entry.account_name !== headFilter) return false;
      if (!needle) return true;
      return [entry.description, entry.reference, entry.account_name].some((value) => (value ?? '').toLowerCase().includes(needle));
    });
  }, [entries, kinds, headFilter, search]);

  const headNames = useMemo(() => Array.from(new Set(entries.map((entry) => entry.account_name))).sort(), [entries]);

  const printSheet = usePrintSheet(printing, (
    <section className="print-only print-dmc-sheet print-fin-report" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Financial report</p>
        </div>
        <div className="print-header-admitted">
          <span>Period</span>
          <strong>{periodLabel}</strong>
        </div>
      </div>

      <div className="print-fee-section">
        <h2>Summary</h2>
        <table className="print-dmc-table">
          <tbody>
            <tr><td>Fees collected</td><td>{formatMoney(statement.feeCollected)}</td></tr>
            <tr><td>Other income</td><td>{formatMoney(statement.otherIncomeTotal)}</td></tr>
            <tr><td>Total income</td><td>{formatMoney(statement.totalIncome)}</td></tr>
            <tr><td>Total expenses</td><td>{formatMoney(statement.expenseTotal)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{statement.net >= 0 ? 'Net surplus for the period' : 'Net deficit for the period'}</td>
              <td>{formatMoney(Math.abs(statement.net))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print-fee-section">
        <h2>Income by head</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Head</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Fees collected</td><td>{formatMoney(statement.feeCollected)}</td></tr>
            {statement.otherIncome.map((row) => <tr key={row.name}><td>{row.name}</td><td>{formatMoney(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td>Total income</td><td>{formatMoney(statement.totalIncome)}</td></tr></tfoot>
        </table>
      </div>

      <div className="print-fee-section">
        <h2>Expenses by head</h2>
        <table className="print-dmc-table">
          <thead><tr><th>Head</th><th>Amount</th></tr></thead>
          <tbody>
            {statement.expenseHeads.length === 0
              ? <tr><td>No expenses recorded</td><td>{formatMoney(0)}</td></tr>
              : statement.expenseHeads.map((row) => <tr key={row.name}><td>{row.name}</td><td>{formatMoney(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td>Total expenses</td><td>{formatMoney(statement.expenseTotal)}</td></tr></tfoot>
        </table>
      </div>

      <div className="print-fee-section">
        <h2>Ledger entries</h2>
        <table className="print-dmc-table">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Head</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
          </thead>
          <tbody>
            {entries.length === 0
              ? <tr><td colSpan={7}>No entries in this period.</td></tr>
              : entries.map((entry) => (
                <tr key={entry.entry_id}>
                  <td>{formatDay(entry.entry_date)}</td>
                  <td>{ENTRY_KIND_LABELS[entry.entry_kind]}</td>
                  <td>{entry.account_name}</td>
                  <td>{entry.description}</td>
                  <td>{entry.debit > 0 ? formatMoney(entry.debit) : '—'}</td>
                  <td>{entry.credit > 0 ? formatMoney(entry.credit) : '—'}</td>
                  <td>{formatMoney(entry.balance)}</td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Totals</td>
              <td>{formatMoney(totals.debit)}</td>
              <td>{formatMoney(totals.credit)}</td>
              <td>{formatMoney(totals.balance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print-signatures">
        <div className="print-signature"><span>Prepared by</span></div>
        <div className="print-signature"><span>Accounts Officer</span></div>
        <div className="print-signature"><span>Principal</span></div>
      </div>
    </section>
  ));

  const print = () => {
    // The sheet is portalled on the next paint, so the print dialog waits a beat
    // to be sure the document is on the page before it opens.
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  return (
    <div className="finance-tab">
      {printSheet}

      <div className="fin-toolbar">
        <RangePicker range={range} />
        <div className="fin-toolbar-actions">
          <button className="secondary-button" onClick={print}><Printer size={15} /> Print financial report</button>
        </div>
      </div>

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Income</span><strong>{formatMoney(statement.totalIncome)}</strong><small>Fees plus other income</small></div></div>
        <div className="fee-kpi coral"><div><span>Expenses</span><strong>{formatMoney(statement.expenseTotal)}</strong><small>Paid out in the period</small></div></div>
        <div className={`fee-kpi ${statement.net >= 0 ? 'mint' : 'sun'}`}><div><span>{statement.net >= 0 ? 'Surplus' : 'Deficit'}</span><strong>{formatMoney(Math.abs(statement.net))}</strong><small>{periodLabel}</small></div></div>
        <div className={`fee-kpi ${Math.abs(balance.difference) < 1 ? 'sky' : 'sun'}`}><div><span>Trial balance</span><strong>{formatMoney(Math.abs(balance.difference))}</strong><small>{Math.abs(balance.difference) < 1 ? 'Books balance' : 'Difference to review'}</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Month by month</span><h2>Income and spending trend</h2></div>
        </div>
        {trend.length === 0 ? <p className="fee-empty">Nothing recorded in this period.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Month</th><th className="text-right">Income</th><th className="text-right">Expenses</th><th className="text-right">Net</th><th className="no-print">Share</th></tr></thead>
              <tbody>
                {trend.map((row) => {
                  const max = Math.max(...trend.map((item) => Math.max(item.income, item.expense)), 1);
                  return (
                    <tr key={row.month}>
                      <td><strong>{row.month}</strong></td>
                      <td className="text-right tabular-nums text-emerald-700">{formatMoney(row.income)}</td>
                      <td className="text-right tabular-nums text-rose-600">{formatMoney(row.expense)}</td>
                      <td className={`text-right font-semibold tabular-nums ${row.net < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(row.net)}</td>
                      <td className="no-print">
                        <div className="fin-mini-bars">
                          <i className="in" style={{ width: `${(row.income / max) * 100}%` }} />
                          <i className="out" style={{ width: `${(row.expense / max) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Detail</span><h2>Every entry in the period</h2></div>
          <span className="fee-hint">{rows.length} of {entries.length} entries</span>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, reference or head" />
          </label>
          <label className="control-field"><span>Head</span>
            <select value={headFilter} onChange={(event) => setHeadFilter(event.target.value)}>
              <option value="">All heads</option>
              {headNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Type</span>
            <select value={kinds[0] ?? ''} onChange={(event) => setKinds(event.target.value ? [event.target.value] : [])}>
              <option value="">All types</option>
              {(Object.keys(ENTRY_KIND_LABELS) as (keyof typeof ENTRY_KIND_LABELS)[]).map((kind) => (
                <option key={kind} value={kind}>{ENTRY_KIND_LABELS[kind]}</option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p className="fee-empty">Loading the report…</p> : rows.length === 0 ? (
          <p className="fee-empty">No entries match these filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Head</th><th>Description</th>
                  <th>Mode</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.entry_id}>
                    <td>{formatDay(entry.entry_date)}</td>
                    <td>{ENTRY_KIND_LABELS[entry.entry_kind]}</td>
                    <td>{entry.account_name}</td>
                    <td>{entry.description}</td>
                    <td>{entry.payment_mode ? paymentModeLabel(entry.payment_mode) : '—'}</td>
                    <td className="text-right tabular-nums text-emerald-700">{entry.debit > 0 ? formatMoney(entry.debit) : '—'}</td>
                    <td className="text-right tabular-nums text-rose-600">{entry.credit > 0 ? formatMoney(entry.credit) : '—'}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(entry.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <HeadManager accounts={accounts} canManage={canManageHeads} isAdmin={isAdmin} onReload={onReload} onToast={onToast} />
    </div>
  );
}

// The chart of heads behind every picker in the module. Heads can be added, renamed
// and retired; retiring keeps old records intact while taking the head out of the
// pickers so it cannot be chosen for new work.
function HeadManager({ accounts, canManage, isAdmin, onReload, onToast }: {
  accounts: LedgerAccount[];
  canManage: boolean;
  isAdmin: boolean;
  onReload: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('expense');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const incomeHeads = accounts.filter((account) => account.account_type === 'income');
  const expenseHeads = accounts.filter((account) => account.account_type === 'expense');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const err = await saveLedgerAccount({ name, accountType: type });
    setBusy(false);
    if (err) { setError(err); return; }
    onToast(`“${name.trim()}” was added to the ${type === 'income' ? 'income' : 'expense'} heads.`);
    setName('');
    await onReload();
  };

  const toggle = async (account: LedgerAccount) => {
    const err = await setLedgerAccountActive(account.id, !account.is_active);
    if (err) { onToast(err); return; }
    await onReload();
  };

  const remove = async (account: LedgerAccount) => {
    const err = await deleteLedgerAccount(account.id);
    if (err) { onToast(err); return; }
    onToast(`“${account.name}” was removed. Records that used it now show as uncategorised.`);
    await onReload();
  };

  return (
    <section className="fee-card no-print">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Heads</span>
          <h2>Income and expense categories</h2>
          <p className="fee-hint mt-1">These are the categories offered on the expense and income forms.</p>
        </div>
        <Tag size={18} />
      </div>

      {canManage && (
        <form className="fin-head-form" onSubmit={submit}>
          <label className="control-field"><span>New head name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Library books" maxLength={60} required />
          </label>
          <label className="control-field"><span>Type</span>
            <select value={type} onChange={(event) => setType(event.target.value as AccountType)}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <button type="submit" className="primary-button" disabled={busy}><Plus size={16} /> Add head</button>
        </form>
      )}
      {error && <p className="fee-error">{error}</p>}

      <div className="fin-head-grid">
        <div>
          <h3>Income heads</h3>
          {incomeHeads.map((account) => (
            <HeadRow key={account.id} account={account} canManage={canManage} isAdmin={isAdmin} onToggle={toggle} onRemove={remove} />
          ))}
        </div>
        <div>
          <h3>Expense heads</h3>
          {expenseHeads.map((account) => (
            <HeadRow key={account.id} account={account} canManage={canManage} isAdmin={isAdmin} onToggle={toggle} onRemove={remove} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeadRow({ account, canManage, isAdmin, onToggle, onRemove }: {
  account: LedgerAccount;
  canManage: boolean;
  isAdmin: boolean;
  onToggle: (account: LedgerAccount) => Promise<void>;
  onRemove: (account: LedgerAccount) => Promise<void>;
}) {
  return (
    <div className={`fin-head-row ${account.is_active ? '' : 'off'}`}>
      <span>{account.name}</span>
      {canManage && (
        <button type="button" className="fee-link" onClick={() => void onToggle(account)}>
          {account.is_active ? <X size={13} /> : <Plus size={13} />} {account.is_active ? 'Retire' : 'Restore'}
        </button>
      )}
      {isAdmin && (
        <button type="button" className="fee-link danger" onClick={() => void onRemove(account)} aria-label={`Remove ${account.name}`}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
