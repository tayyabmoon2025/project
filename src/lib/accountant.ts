import { supabase } from '@/lib/supabase';
import { fetchFeePayments, type FeePayment } from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

// How one day's money is split by the way it was received.
export type ClosingSummary = {
  cash: number;
  bank: number;
  online: number;
  total: number;
  transactions: number;
  voidedToday: number;
  voidedAmountToday: number;
};

export type DailyClosing = {
  closing_date: string;
  opening_balance: number;
  notes: string | null;
  closed_by: string | null;
  updated_at: string;
};

export type AccountantOverview = {
  students: Student[];
  payments: FeePayment[];
  error: string | null;
};

// Everything the accountant dashboard and its panels read in one pass: the live
// student list (for balances and dues) and the recent payments (for collection
// figures). Both come from the database; nothing here is invented.
export async function fetchAccountantOverview(paymentLimit = 500): Promise<AccountantOverview> {
  try {
    const [studentResult, paymentResult] = await Promise.all([
      supabase
        .from('school_students')
        .select('id, admission_number, full_name, fathers_name, guardian_name, guardian_phone, class_name, section_name, roll_number, status, fee_balance, fee_opening_balance, fee_opening_balance_date, photo_url')
        .order('full_name'),
      fetchFeePayments(paymentLimit),
    ]);
    if (studentResult.error) {
      return { students: [], payments: [], error: 'The student list could not be loaded.' };
    }
    return {
      students: (studentResult.data ?? []) as Student[],
      payments: paymentResult.payments,
      error: paymentResult.error,
    };
  } catch {
    return { students: [], payments: [], error: 'The fee workspace could not be loaded. Check your connection and try again.' };
  }
}

// Splits one day's real transactions into cash, bank and online. Reversed receipts
// are counted separately and never added to the day's takings.
export function closingSummaryFor(payments: FeePayment[], day: string): ClosingSummary {
  const active = payments.filter((payment) => payment.payment_date === day && !payment.voided);
  const voided = payments.filter((payment) => payment.payment_date === day && payment.voided);
  const sumOf = (method: string) => active
    .filter((payment) => payment.method === method)
    .reduce((total, payment) => total + Number(payment.amount), 0);
  return {
    cash: sumOf('cash'),
    bank: sumOf('bank'),
    online: sumOf('online'),
    total: active.reduce((total, payment) => total + Number(payment.amount), 0),
    transactions: active.length,
    voidedToday: voided.length,
    voidedAmountToday: voided.reduce((total, payment) => total + Number(payment.amount), 0),
  };
}

export async function fetchDailyClosing(day: string): Promise<{ closing: DailyClosing | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_daily_closings')
      .select('closing_date, opening_balance, notes, closed_by, updated_at')
      .eq('closing_date', day)
      .maybeSingle();
    if (error) return { closing: null, error: 'The closing record could not be loaded.' };
    return { closing: (data as DailyClosing | null) ?? null, error: null };
  } catch {
    return { closing: null, error: 'The closing record could not be loaded. Check your connection and try again.' };
  }
}

export async function saveDailyClosing(input: {
  day: string;
  openingBalance: number;
  notes: string;
}): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_daily_closings')
      .upsert({
        closing_date: input.day,
        opening_balance: input.openingBalance,
        notes: input.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'closing_date' });
    return error ? 'The daily closing could not be saved. Please try again.' : null;
  } catch {
    return 'The daily closing could not be saved. Check your connection and try again.';
  }
}

// One line per class for the class-wise collection report.
export function classCollection(payments: FeePayment[], month: string) {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const payment of payments) {
    if (payment.voided) continue;
    if ((payment.payment_date ?? '').slice(0, 7) !== month) continue;
    const className = payment.class_name ?? 'Unassigned';
    const current = totals.get(className) ?? { amount: 0, count: 0 };
    totals.set(className, { amount: current.amount + Number(payment.amount), count: current.count + 1 });
  }
  return Array.from(totals.entries())
    .map(([className, value]) => ({ className, ...value }))
    .sort((a, b) => a.className.localeCompare(b.className));
}
