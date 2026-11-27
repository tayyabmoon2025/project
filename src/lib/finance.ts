import { supabase } from '@/lib/supabase';
import { monthRange } from '@/lib/attendance';

export type AccountType = 'income' | 'expense';

export type LedgerAccount = {
  id: string;
  name: string;
  account_type: AccountType;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online / Easypaisa' },
  { value: 'other', label: 'Other' },
];

export const paymentModeLabel = (value: string | null) =>
  PAYMENT_MODES.find((mode) => mode.value === value)?.label ?? (value ? value : '—');

export type ExpenseRecord = {
  id: string;
  expense_date: string;
  category_id: string | null;
  amount: number;
  payment_mode: string;
  paid_to: string | null;
  reference: string | null;
  description: string | null;
  created_at: string;
};

export type IncomeRecord = {
  id: string;
  income_date: string;
  category_id: string | null;
  amount: number;
  payment_mode: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export type LedgerEntryKind = 'fee_collection' | 'other_income' | 'expense';

export type LedgerEntry = {
  entry_id: number;
  entry_date: string;
  entry_kind: LedgerEntryKind;
  account_id: string | null;
  account_name: string;
  reference: string | null;
  description: string;
  payment_mode: string | null;
  debit: number;
  credit: number;
  balance: number;
  is_voided: boolean;
};

export const ENTRY_KIND_LABELS: Record<LedgerEntryKind, string> = {
  fee_collection: 'Fee collection',
  other_income: 'Other income',
  expense: 'Expense',
};

export type ExpenseDraft = {
  expenseDate: string;
  categoryId: string;
  amount: number;
  paymentMode: string;
  paidTo: string;
  reference: string;
  description: string;
};

export type IncomeDraft = {
  incomeDate: string;
  categoryId: string;
  amount: number;
  paymentMode: string;
  reference: string;
  notes: string;
};

const numberOr = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Postgres numeric columns can arrive as text through the API, so every money
// value is normalised on the way in rather than trusted as a number.
type RawMoney<T, K extends string> = Omit<T, K> & Record<K, unknown>;

const ACCOUNT_COLUMNS = 'id, name, account_type, is_active, sort_order, created_at';

export async function fetchLedgerAccounts(): Promise<{ accounts: LedgerAccount[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_ledger_accounts')
      .select(ACCOUNT_COLUMNS)
      .order('account_type')
      .order('sort_order')
      .order('name');
    if (error) return { accounts: [], error: 'The account heads could not be loaded.' };
    return { accounts: (data ?? []) as LedgerAccount[], error: null };
  } catch {
    return { accounts: [], error: 'The account heads could not be loaded. Check your connection and try again.' };
  }
}

export async function saveLedgerAccount(input: { id?: string; name: string; accountType: AccountType }): Promise<string | null> {
  const name = input.name.trim();
  if (name.length < 2) return 'Enter a name for this head.';
  try {
    if (input.id) {
      const { error } = await supabase.from('school_ledger_accounts').update({ name }).eq('id', input.id);
      return error ? 'This head could not be saved. Please try again.' : null;
    }
    const { error } = await supabase.from('school_ledger_accounts').insert({ name, account_type: input.accountType });
    if (error) {
      return error.code === '23505' ? 'A head with this name already exists.' : 'This head could not be saved. Please try again.';
    }
    return null;
  } catch {
    return 'This head could not be saved. Check your connection and try again.';
  }
}

export async function setLedgerAccountActive(id: string, isActive: boolean): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_ledger_accounts').update({ is_active: isActive }).eq('id', id);
    return error ? 'The head could not be updated. Please try again.' : null;
  } catch {
    return 'The head could not be updated. Check your connection and try again.';
  }
}

// Records that used a head keep it even after the head is removed, so a deleted
// head shows as "Uncategorised" rather than taking an old bill down with it.
export async function deleteLedgerAccount(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_ledger_accounts').delete().eq('id', id);
    return error ? 'This head could not be removed. Please try again.' : null;
  } catch {
    return 'This head could not be removed. Check your connection and try again.';
  }
}

const EXPENSE_COLUMNS = 'id, expense_date, category_id, amount, payment_mode, paid_to, reference, description, created_at';

export async function fetchExpenses(range: { from: string; to: string } | null): Promise<{ expenses: ExpenseRecord[]; error: string | null }> {
  try {
    let query = supabase.from('school_expenses').select(EXPENSE_COLUMNS).order('expense_date', { ascending: false }).order('created_at', { ascending: false });
    if (range) query = query.gte('expense_date', range.from).lte('expense_date', range.to);
    const { data, error } = await query;
    if (error) return { expenses: [], error: 'The expenses could not be loaded.' };
    return {
      expenses: ((data ?? []) as unknown as RawMoney<ExpenseRecord, 'amount'>[]).map((row) => ({ ...row, amount: numberOr(row.amount) })),
      error: null,
    };
  } catch {
    return { expenses: [], error: 'The expenses could not be loaded. Check your connection and try again.' };
  }
}

export async function saveExpense(draft: ExpenseDraft): Promise<string | null> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return 'Enter an amount greater than zero.';
  try {
    const { error } = await supabase.from('school_expenses').insert({
      expense_date: draft.expenseDate,
      category_id: draft.categoryId || null,
      amount: draft.amount,
      payment_mode: draft.paymentMode,
      paid_to: draft.paidTo.trim() || null,
      reference: draft.reference.trim() || null,
      description: draft.description.trim() || null,
    });
    return error ? 'This expense could not be saved. Please try again.' : null;
  } catch {
    return 'This expense could not be saved. Check your connection and try again.';
  }
}

export async function updateExpense(id: string, draft: ExpenseDraft): Promise<string | null> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return 'Enter an amount greater than zero.';
  try {
    const { error } = await supabase.from('school_expenses').update({
      expense_date: draft.expenseDate,
      category_id: draft.categoryId || null,
      amount: draft.amount,
      payment_mode: draft.paymentMode,
      paid_to: draft.paidTo.trim() || null,
      reference: draft.reference.trim() || null,
      description: draft.description.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    return error ? 'This expense could not be saved. Please try again.' : null;
  } catch {
    return 'This expense could not be saved. Check your connection and try again.';
  }
}

export async function deleteExpense(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_expenses').delete().eq('id', id);
    return error ? 'This expense could not be removed. Please try again.' : null;
  } catch {
    return 'This expense could not be removed. Check your connection and try again.';
  }
}

const INCOME_COLUMNS = 'id, income_date, category_id, amount, payment_mode, reference, notes, created_at';

export async function fetchOtherIncome(range: { from: string; to: string } | null): Promise<{ income: IncomeRecord[]; error: string | null }> {
  try {
    let query = supabase.from('school_other_income').select(INCOME_COLUMNS).order('income_date', { ascending: false }).order('created_at', { ascending: false });
    if (range) query = query.gte('income_date', range.from).lte('income_date', range.to);
    const { data, error } = await query;
    if (error) return { income: [], error: 'The other income records could not be loaded.' };
    return {
      income: ((data ?? []) as unknown as RawMoney<IncomeRecord, 'amount'>[]).map((row) => ({ ...row, amount: numberOr(row.amount) })),
      error: null,
    };
  } catch {
    return { income: [], error: 'The other income records could not be loaded. Check your connection and try again.' };
  }
}

export async function saveOtherIncome(draft: IncomeDraft): Promise<string | null> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return 'Enter an amount greater than zero.';
  try {
    const { error } = await supabase.from('school_other_income').insert({
      income_date: draft.incomeDate,
      category_id: draft.categoryId || null,
      amount: draft.amount,
      payment_mode: draft.paymentMode,
      reference: draft.reference.trim() || null,
      notes: draft.notes.trim() || null,
    });
    return error ? 'This income could not be saved. Please try again.' : null;
  } catch {
    return 'This income could not be saved. Check your connection and try again.';
  }
}

export async function updateOtherIncome(id: string, draft: IncomeDraft): Promise<string | null> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return 'Enter an amount greater than zero.';
  try {
    const { error } = await supabase.from('school_other_income').update({
      income_date: draft.incomeDate,
      category_id: draft.categoryId || null,
      amount: draft.amount,
      payment_mode: draft.paymentMode,
      reference: draft.reference.trim() || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    return error ? 'This income could not be saved. Please try again.' : null;
  } catch {
    return 'This income could not be saved. Check your connection and try again.';
  }
}

export async function deleteOtherIncome(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_other_income').delete().eq('id', id);
    return error ? 'This income could not be removed. Please try again.' : null;
  } catch {
    return 'This income could not be removed. Check your connection and try again.';
  }
}

// The ledger is assembled by the database from live fee receipts, other income and
// expenses, so it can never disagree with the fee collection screens.
export async function fetchLedgerEntries(range: { from: string; to: string }): Promise<{ entries: LedgerEntry[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('finance_ledger_entries', { p_from: range.from, p_to: range.to });
    if (error) return { entries: [], error: 'The general ledger could not be loaded.' };
    const rows = (data ?? []) as unknown as RawMoney<LedgerEntry, 'debit' | 'credit' | 'balance'>[];
    return {
      entries: rows.map((row) => ({
        ...row,
        debit: numberOr(row.debit),
        credit: numberOr(row.credit),
        balance: numberOr(row.balance),
      })),
      error: null,
    };
  } catch {
    return { entries: [], error: 'The general ledger could not be loaded. Check your connection and try again.' };
  }
}

export type LedgerTotals = { debit: number; credit: number; balance: number };

export function ledgerTotals(entries: LedgerEntry[]): LedgerTotals {
  return entries.reduce<LedgerTotals>(
    (totals, entry) => ({
      debit: totals.debit + entry.debit,
      credit: totals.credit + entry.credit,
      balance: totals.balance + entry.debit - entry.credit,
    }),
    { debit: 0, credit: 0, balance: 0 },
  );
}

export function filterLedgerEntries(entries: LedgerEntry[], kinds: LedgerEntryKind[], categoryName: string) {
  return entries.filter((entry) => {
    if (kinds.length > 0 && !kinds.includes(entry.entry_kind)) return false;
    if (categoryName && entry.account_name !== categoryName) return false;
    return true;
  });
}

export type AccountBalanceRow = {
  key: string;
  accountId: string | null;
  name: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  balance: number;
};

// Each head is grouped by its name so a fee receipt filed under the tuition head
// lands on the same line as any other income recorded against that head.
export function trialBalance(entries: LedgerEntry[]): { rows: AccountBalanceRow[]; totalDebit: number; totalCredit: number; difference: number } {
  const map = new Map<string, AccountBalanceRow>();
  entries.forEach((entry) => {
    const key = entry.account_name;
    const existing = map.get(key) ?? {
      key,
      accountId: entry.account_id,
      name: entry.account_name,
      accountType: 'income' as AccountType,
      debit: 0,
      credit: 0,
      balance: 0,
    };
    existing.debit += entry.debit;
    existing.credit += entry.credit;
    existing.balance = existing.debit - existing.credit;
    existing.accountType = existing.balance >= 0 ? 'income' : 'expense';
    if (!existing.accountId && entry.account_id) existing.accountId = entry.account_id;
    map.set(key, existing);
  });

  const rows = Array.from(map.values()).sort((a, b) =>
    a.accountType === b.accountType ? Math.abs(b.balance) - Math.abs(a.balance) : a.accountType === 'income' ? -1 : 1);

  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  return { rows, totalDebit, totalCredit, difference: totalDebit - totalCredit };
}

export type HeadTotal = { name: string; amount: number };

export type IncomeStatement = {
  feeCollected: number;
  otherIncome: HeadTotal[];
  otherIncomeTotal: number;
  totalIncome: number;
  expenseHeads: HeadTotal[];
  expenseTotal: number;
  net: number;
};

const groupByHead = (entries: LedgerEntry[], amountOf: (entry: LedgerEntry) => number): HeadTotal[] => {
  const map = new Map<string, number>();
  entries.forEach((entry) => map.set(entry.account_name, (map.get(entry.account_name) ?? 0) + amountOf(entry)));
  return Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .filter((row) => row.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
};

// Fee money collected in the period counts as income alongside everything recorded
// in the other income tab; expenses come off the two together.
export function buildIncomeStatement(entries: LedgerEntry[]): IncomeStatement {
  const feeCollected = entries.filter((entry) => entry.entry_kind === 'fee_collection').reduce((sum, entry) => sum + entry.debit, 0);
  const otherIncome = groupByHead(entries.filter((entry) => entry.entry_kind === 'other_income'), (entry) => entry.debit);
  const otherIncomeTotal = otherIncome.reduce((sum, row) => sum + row.amount, 0);
  const expenseHeads = groupByHead(entries.filter((entry) => entry.entry_kind === 'expense'), (entry) => entry.credit);
  const expenseTotal = expenseHeads.reduce((sum, row) => sum + row.amount, 0);
  const totalIncome = feeCollected + otherIncomeTotal;
  return { feeCollected, otherIncome, otherIncomeTotal, totalIncome, expenseHeads, expenseTotal, net: totalIncome - expenseTotal };
}

export type MonthTrend = { month: string; income: number; expense: number; net: number };

export function monthlyTrend(entries: LedgerEntry[]): MonthTrend[] {
  const map = new Map<string, MonthTrend>();
  entries.forEach((entry) => {
    const month = entry.entry_date.slice(0, 7);
    const row = map.get(month) ?? { month, income: 0, expense: 0, net: 0 };
    row.income += entry.debit;
    row.expense += entry.credit;
    row.net = row.income - row.expense;
    map.set(month, row);
  });
  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}

export const thisMonthRange = () => {
  const today = new Date();
  return monthRange(today.getFullYear(), today.getMonth());
};

export const monthLabelOf = (key: string) => {
  const parsed = new Date(`${key.slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? key : parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
