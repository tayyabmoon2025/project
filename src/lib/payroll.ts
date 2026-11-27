import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/auth';

export type PayPackage = {
  id: string;
  staff_user_id: string;
  basic_salary: number;
  house_rent_allowance: number;
  conveyance_allowance: number;
  medical_allowance: number;
  other_allowance: number;
  pf_percentage: number;
  absent_deduction_rate: number;
  late_deduction_rate: number;
  effective_from: string | null;
  notes: string | null;
};

export type StaffAdvance = {
  id: string;
  staff_user_id: string;
  advance_date: string;
  amount: number;
  monthly_installment: number;
  purpose: string | null;
  status: 'active' | 'closed';
  closed_on: string | null;
  created_at: string;
};

export type PfContribution = {
  id: string;
  staff_user_id: string;
  period_month: string;
  basic_salary: number;
  employee_contribution: number;
  school_contribution: number;
  payment_id: string | null;
};

export type SalaryPayment = {
  id: string;
  staff_user_id: string;
  period_month: string;
  staff_name: string;
  staff_role: string;
  basic_salary: number;
  house_rent_allowance: number;
  conveyance_allowance: number;
  medical_allowance: number;
  other_allowance: number;
  gross_salary: number;
  absent_days: number;
  late_days: number;
  absent_deduction: number;
  late_deduction: number;
  advance_deduction: number;
  pf_deduction: number;
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  advance_id: string | null;
  payment_method: string;
  paid_on: string;
  note: string | null;
  created_at: string;
};

export type PayrollStaff = {
  id: string;
  full_name: string;
  role: UserRole;
  status: string;
  username: string;
  photo_url: string | null;
};

export const PAYMENT_METHODS = ['cash', 'bank transfer', 'cheque', 'online'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  'bank transfer': 'Bank transfer',
  cheque: 'Cheque',
  online: 'Online transfer',
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Every payroll month is stored as the first day of that month, which is what makes the
// unique key on (staff member, month) work and keeps filtering by month exact.
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function parseMonthKey(value: string): { year: number; month: number } {
  const [year, month] = value.slice(0, 10).split('-').map(Number);
  return { year, month };
}

export function monthLabel(value: string): string {
  const { year, month } = parseMonthKey(value);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function monthOptions(count = 24): { value: string; label: string }[] {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    options.push({ value: monthKey(date.getFullYear(), date.getMonth() + 1), label: monthLabel(monthKey(date.getFullYear(), date.getMonth() + 1)) });
  }
  return options;
}

export function currentMonthKey(): string {
  const now = new Date();
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

export function allowanceTotal(row: Pick<PayPackage, 'house_rent_allowance' | 'conveyance_allowance' | 'medical_allowance' | 'other_allowance'>): number {
  return num(row.house_rent_allowance) + num(row.conveyance_allowance) + num(row.medical_allowance) + num(row.other_allowance);
}

export function packageGross(row: PayPackage): number {
  return num(row.basic_salary) + allowanceTotal(row);
}

export function packagePf(row: PayPackage): number {
  return round2(num(row.basic_salary) * num(row.pf_percentage) / 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PayrollDraft = {
  basicSalary: number;
  houseRent: number;
  conveyance: number;
  medical: number;
  otherAllowance: number;
  pfPercentage: number;
  absentRate: number;
  lateRate: number;
};

export type SalaryPreview = {
  allowances: number;
  gross: number;
  absentDeduction: number;
  lateDeduction: number;
  pfDeduction: number;
  advanceDeduction: number;
  otherDeduction: number;
  totalDeductions: number;
  net: number;
};

// Shown live while the administrator fills the Pay Salary form; the database repeats the
// same arithmetic when the salary is actually saved, so the slip always matches the record.
export function previewSalary(params: {
  pkg: PayrollDraft;
  absentDays: number;
  lateDays: number;
  advanceDeduction: number;
  otherDeduction: number;
}): SalaryPreview {
  const allowances = num(params.pkg.houseRent) + num(params.pkg.conveyance) + num(params.pkg.medical) + num(params.pkg.otherAllowance);
  const gross = num(params.pkg.basicSalary) + allowances;
  const absentDeduction = round2(num(params.absentDays) * num(params.pkg.absentRate));
  const lateDeduction = round2(num(params.lateDays) * num(params.pkg.lateRate));
  const pfDeduction = round2(num(params.pkg.basicSalary) * num(params.pkg.pfPercentage) / 100);
  const advanceDeduction = Math.max(num(params.advanceDeduction), 0);
  const otherDeduction = Math.max(num(params.otherDeduction), 0);
  const totalDeductions = round2(absentDeduction + lateDeduction + pfDeduction + advanceDeduction + otherDeduction);
  return {
    allowances,
    gross,
    absentDeduction,
    lateDeduction,
    pfDeduction,
    advanceDeduction,
    otherDeduction,
    totalDeductions,
    net: Math.max(round2(gross - totalDeductions), 0),
  };
}

export async function fetchPayPackages(): Promise<PayPackage[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_pay_packages')
      .select('id, staff_user_id, basic_salary, house_rent_allowance, conveyance_allowance, medical_allowance, other_allowance, pf_percentage, absent_deduction_rate, late_deduction_rate, effective_from, notes');
    if (error) return [];
    return (data ?? []) as PayPackage[];
  } catch {
    return [];
  }
}

export async function fetchStaffAdvances(): Promise<StaffAdvance[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_advances')
      .select('id, staff_user_id, advance_date, amount, monthly_installment, purpose, status, closed_on, created_at')
      .order('advance_date', { ascending: false });
    if (error) return [];
    return (data ?? []) as StaffAdvance[];
  } catch {
    return [];
  }
}

export async function fetchPfContributions(): Promise<PfContribution[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_pf_contributions')
      .select('id, staff_user_id, period_month, basic_salary, employee_contribution, school_contribution, payment_id')
      .order('period_month', { ascending: false });
    if (error) return [];
    return (data ?? []) as PfContribution[];
  } catch {
    return [];
  }
}

export async function fetchSalaryPayments(): Promise<SalaryPayment[]> {
  try {
    const { data, error } = await supabase
      .from('school_staff_salary_payments')
      .select('id, staff_user_id, period_month, staff_name, staff_role, basic_salary, house_rent_allowance, conveyance_allowance, medical_allowance, other_allowance, gross_salary, absent_days, late_days, absent_deduction, late_deduction, advance_deduction, pf_deduction, other_deduction, total_deductions, net_salary, advance_id, payment_method, paid_on, note, created_at')
      .order('period_month', { ascending: false })
      .order('staff_name');
    if (error) return [];
    return (data ?? []) as SalaryPayment[];
  } catch {
    return [];
  }
}

// How much of a staff member's active advances is still owed. Each instalment is matched
// to the advance it was recovered against, so several loans stay accurate side by side.
export function advanceOutstanding(advances: StaffAdvance[], payments: SalaryPayment[], staffUserId: string): number {
  let outstanding = 0;
  for (const advance of advances) {
    if (advance.staff_user_id !== staffUserId || advance.status !== 'active') continue;
    const recovered = payments
      .filter((payment) => payment.advance_id === advance.id)
      .reduce((sum, payment) => sum + num(payment.advance_deduction), 0);
    outstanding += Math.max(num(advance.amount) - recovered, 0);
  }
  return round2(outstanding);
}

// The instalment to suggest: the first active advance's agreed monthly amount, never more
// than what is actually left to repay.
export function suggestedAdvanceInstallment(advances: StaffAdvance[], staffUserId: string, outstanding: number): number {
  const active = advances
    .filter((row) => row.staff_user_id === staffUserId && row.status === 'active')
    .sort((a, b) => a.advance_date.localeCompare(b.advance_date));
  if (active.length === 0 || outstanding <= 0) return 0;
  return round2(Math.min(num(active[0].monthly_installment), outstanding));
}

export function pfTotals(contributions: PfContribution[], staffUserId: string): { employee: number; school: number; balance: number; months: number } {
  const rows = contributions.filter((row) => row.staff_user_id === staffUserId);
  const employee = round2(rows.reduce((sum, row) => sum + num(row.employee_contribution), 0));
  const school = round2(rows.reduce((sum, row) => sum + num(row.school_contribution), 0));
  return { employee, school, balance: round2(employee + school), months: rows.length };
}

function friendly(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const map: Record<string, string> = {
    'Only administrators can change pay packages': 'Only administrators can change pay packages.',
    'Only administrators can record salary advances': 'Only administrators can record salary advances.',
    'Only administrators can settle salary advances': 'Only administrators can settle salary advances.',
    'Only administrators can remove salary advances': 'Only administrators can remove salary advances.',
    'Only administrators can pay salaries': 'Only administrators can pay salaries.',
    'Only administrators can undo a salary payment': 'Only administrators can undo a salary payment.',
    'That staff member could not be found': 'That staff member could not be found.',
    'Amounts cannot be negative': 'Amounts cannot be negative.',
    'The monthly instalment cannot be negative': 'The monthly instalment cannot be negative.',
    'Enter the advance amount': 'Enter the advance amount.',
    'That advance could not be found': 'That advance could not be found.',
    'This advance already has salary deductions against it. Mark it settled instead.':
      'This advance already has salary deductions against it. Mark it settled instead.',
    'Set up a pay package for this staff member first': 'Set up a pay package for this staff member first.',
    'Salary for this month has already been paid': 'Salary for this month has already been paid.',
    'That salary payment could not be found': 'That salary payment could not be found.',
  };
  return map[message] ?? message;
}

const GENERIC = 'Could not reach the school server. Check your connection and try again.';

export async function saveStaffPayPackage(staffUserId: string, draft: PayrollDraft, effectiveFrom: string, notes: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_save_staff_pay_package', {
      p_staff_user_id: staffUserId,
      p_basic_salary: draft.basicSalary,
      p_house_rent_allowance: draft.houseRent,
      p_conveyance_allowance: draft.conveyance,
      p_medical_allowance: draft.medical,
      p_other_allowance: draft.otherAllowance,
      p_pf_percentage: draft.pfPercentage,
      p_absent_deduction_rate: draft.absentRate,
      p_late_deduction_rate: draft.lateRate,
      p_effective_from: effectiveFrom || null,
      p_notes: notes.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'The pay package could not be saved.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

export async function saveStaffAdvance(params: {
  staffUserId: string;
  advanceDate: string;
  amount: number;
  monthlyInstallment: number;
  purpose: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_save_staff_advance', {
      p_staff_user_id: params.staffUserId,
      p_advance_date: params.advanceDate,
      p_amount: params.amount,
      p_monthly_installment: params.monthlyInstallment,
      p_purpose: params.purpose.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'The advance could not be saved.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

export async function closeStaffAdvance(advanceId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_close_staff_advance', { p_advance_id: advanceId });
    if (error) return { error: friendly(error.message, 'The advance could not be settled.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

export async function deleteStaffAdvance(advanceId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_staff_advance', { p_advance_id: advanceId });
    if (error) return { error: friendly(error.message, 'The advance could not be removed.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

export async function deleteSalaryPayment(paymentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_staff_salary_payment', { p_payment_id: paymentId });
    if (error) return { error: friendly(error.message, 'The salary payment could not be undone.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

export type PaySalaryResult = { error: string | null; slip: SalaryPayment | null };

// The database does the whole calculation and writes the payment, the provident fund entry
// and any advance settlement in one go, then hands back the finished slip.
export async function payStaffSalary(params: {
  staffUserId: string;
  periodMonth: string;
  absentDays: number;
  lateDays: number;
  advanceDeduction: number;
  otherDeduction: number;
  paymentMethod: string;
  note: string;
}): Promise<PaySalaryResult> {
  try {
    const { data, error } = await supabase.rpc('admin_pay_staff_salary', {
      p_staff_user_id: params.staffUserId,
      p_period_month: params.periodMonth,
      p_absent_days: params.absentDays,
      p_late_days: params.lateDays,
      p_advance_deduction: params.advanceDeduction,
      p_other_deduction: params.otherDeduction,
      p_payment_method: params.paymentMethod,
      p_note: params.note.trim() || null,
    });
    if (error) return { error: friendly(error.message, 'The salary could not be paid.'), slip: null };
    return { error: null, slip: (data ?? null) as SalaryPayment | null };
  } catch {
    return { error: GENERIC, slip: null };
  }
}

// The slip sent over WhatsApp, in the same plain wording the office would write by hand.
export function salarySlipMessage(slip: SalaryPayment, schoolName: string): string {
  const money = (value: number) => `Rs ${Math.round(num(value)).toLocaleString()}`;
  const lines = [
    `${schoolName} — Salary Slip`,
    `Month: ${monthLabel(slip.period_month)}`,
    `Name: ${slip.staff_name}`,
    `Basic salary: ${money(slip.basic_salary)}`,
    `Allowances: ${money(allowanceTotal(slip))}`,
    `Gross salary: ${money(slip.gross_salary)}`,
    `Absent deduction (${slip.absent_days} day${slip.absent_days === 1 ? '' : 's'}): ${money(slip.absent_deduction)}`,
    `Late deduction (${slip.late_days} day${slip.late_days === 1 ? '' : 's'}): ${money(slip.late_deduction)}`,
    `Advance instalment: ${money(slip.advance_deduction)}`,
    `Provident fund: ${money(slip.pf_deduction)}`,
  ];
  if (num(slip.other_deduction) > 0) lines.push(`Other deduction: ${money(slip.other_deduction)}`);
  lines.push(`Total deductions: ${money(slip.total_deductions)}`);
  lines.push(`Net salary paid: ${money(slip.net_salary)}`);
  lines.push(`Paid on: ${new Date(`${slip.paid_on.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`);
  return lines.join('\n');
}
