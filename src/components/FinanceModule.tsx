import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, FileText, PieChart, Receipt, Scale, TrendingUp } from 'lucide-react';
import {
  fetchExpenses,
  fetchLedgerAccounts,
  fetchLedgerEntries,
  fetchOtherIncome,
  type ExpenseRecord,
  type IncomeRecord,
  type LedgerAccount,
  type LedgerEntry,
} from '@/lib/finance';
import { FinanceExpensesTab } from '@/components/FinanceExpensesTab';
import { FinanceIncomeTab } from '@/components/FinanceIncomeTab';
import { FinanceLedgerTab } from '@/components/FinanceLedgerTab';
import { FinanceTrialBalanceTab } from '@/components/FinanceTrialBalanceTab';
import { FinanceIncomeStatementTab } from '@/components/FinanceIncomeStatementTab';
import { FinanceReportsTab } from '@/components/FinanceReportsTab';
import { useFinanceRange } from '@/lib/financeRange';

type FinanceTab = 'expenses' | 'income' | 'ledger' | 'trial' | 'statement' | 'reports';

const TABS: { id: FinanceTab; label: string; hint: string; icon: typeof Receipt }[] = [
  { id: 'expenses', label: 'Expenses', hint: 'Record and filter school spending', icon: Receipt },
  { id: 'income', label: 'Other Income', hint: 'Non-fee and miscellaneous receipts', icon: TrendingUp },
  { id: 'ledger', label: 'General Ledger', hint: 'Every debit and credit in order', icon: BookOpen },
  { id: 'trial', label: 'Trial Balance', hint: 'Totals by head and the balance check', icon: Scale },
  { id: 'statement', label: 'Income Statement', hint: 'Income less expenses', icon: PieChart },
  { id: 'reports', label: 'Reports', hint: 'Filtered summary and printing', icon: FileText },
];

// The whole module shares one period and one reload, so the ledger, the trial
// balance, the statement and the report are always looking at the same figures.
export function FinanceModule({ onToast }: { onToast: (message: string) => void }) {
  const [tab, setTab] = useState<FinanceTab>('expenses');
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [income, setIncome] = useState<IncomeRecord[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [error, setError] = useState('');
  const range = useFinanceRange();
  const { from, to } = range;

  // The heads, expenses and income records are loaded once and filtered by period
  // inside the tabs, so switching tabs or dates never refetches them.
  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    const [accountResult, expenseResult, incomeResult] = await Promise.all([
      fetchLedgerAccounts(),
      fetchExpenses(null),
      fetchOtherIncome(null),
    ]);
    setAccounts(accountResult.accounts);
    setExpenses(expenseResult.expenses);
    setIncome(incomeResult.income);
    setError(accountResult.error ?? expenseResult.error ?? incomeResult.error ?? '');
    setLoadingRecords(false);
  }, []);

  // The ledger is assembled by the database for the chosen period, because it has
  // to read the fee receipts that the fee screens own.
  const loadLedger = useCallback(async () => {
    setLoadingLedger(true);
    const result = await fetchLedgerEntries({ from, to });
    setEntries(result.entries);
    if (result.error) setError(result.error);
    setLoadingLedger(false);
  }, [from, to]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => { void loadLedger(); }, [loadLedger]);

  const reload = useCallback(async () => {
    await Promise.all([loadRecords(), loadLedger()]);
  }, [loadRecords, loadLedger]);

  const activeTab = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);

  return (
    <div className="admin-panel finance-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Finance</span>
          <h2>School finance</h2>
          <p>Record what the school spends and earns outside fees, then see it alongside the fee money already collected. Pick a period once and every screen follows it.</p>
        </div>
      </div>

      <div className="att-tabs" role="tablist">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`att-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={15} />
              <span className="att-tab-label">
                {item.label}
                <small>{item.hint}</small>
              </span>
            </button>
          );
        })}
      </div>

      {error && <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>}

      {tab === 'expenses' ? (
        <FinanceExpensesTab expenses={expenses} accounts={accounts} loading={loadingRecords} range={range} onReload={reload} onToast={onToast} />
      ) : tab === 'income' ? (
        <FinanceIncomeTab income={income} accounts={accounts} loading={loadingRecords} range={range} onReload={reload} onToast={onToast} />
      ) : tab === 'ledger' ? (
        <FinanceLedgerTab entries={entries} loading={loadingLedger} range={range} onReload={reload} />
      ) : tab === 'trial' ? (
        <FinanceTrialBalanceTab entries={entries} loading={loadingLedger} range={range} />
      ) : tab === 'statement' ? (
        <FinanceIncomeStatementTab entries={entries} loading={loadingLedger} range={range} />
      ) : (
        <FinanceReportsTab entries={entries} accounts={accounts} loading={loadingLedger} range={range} onReload={reload} onToast={onToast} />
      )}

      <p className="fin-hint no-print">
        <strong>{activeTab.label}</strong> — {activeTab.hint}. Every figure on this screen is worked out from the records themselves, so nothing has to be recalculated by hand.
      </p>
    </div>
  );
}
