import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import {
  recordedConcessionFor, fetchChallansInRange, fetchFeePaymentsInRange, fetchFeeStructures, formatMoney, monthLabel,
  tuitionFor,
  type FeeChallan, type FeePayment, type FeeStructure,
} from '@/lib/fees';
import { adjustmentLabel, fetchAdjustmentsInRange, findSiblingGroups, type FeeAdjustment } from '@/lib/feeAdjustments';
import { fetchSiblingDiscountRules, siblingContextFor, type SiblingDiscountRule } from '@/lib/feeDiscountRules';
import { FEE_CONCESSION_CATEGORIES, concessionCategoriesFor, concessionCategoryLabel } from '@/lib/concessionCategories';
import { formatWhatsAppNumber, pickWhatsAppContact } from '@/lib/whatsapp';

export type FeeReportFormat = 'text' | 'money' | 'number' | 'percent';

export type FeeReportColumn = { key: string; label: string; format?: FeeReportFormat; action?: 'remind' | 'approve' };

// A row may carry two things that are not columns, so they never reach the export or the
// printout: a marker, a short note the table styles specially to call out a part payment,
// and classEnd, carried on the last row of a class so the table knows where to print that
// class's subtotal.
export type FeeReportRow = Record<string, string | number> & { marker?: string; classEnd?: string; categoryKey?: string };

export type FeeReportId =
  | 'registered-class' | 'registered-summary'
  | 'received-class' | 'received-summary'
  | 'receivable-class' | 'receivable-summary'
  | 'adjustment-detail' | 'ledger-detail' | 'trail'
  | 'nil-paid' | 'defaulters' | 'cleared' | 'class-collection-pending' | 'student-collection-balance' | 'inactive-dues'
  | 'concession-detail';

export const FEE_REPORT_GROUPS = ['Core reports', 'Daily accounting reports'] as const;
export type FeeReportGroup = (typeof FEE_REPORT_GROUPS)[number];

export type FeeReportMeta = {
  id: FeeReportId;
  title: string;
  group: FeeReportGroup;
  hint: string;
  note: string;
  usesMinDue?: boolean;
  // The reports that can be narrowed to one kind of reduction show the category dropdown.
  usesConcessionCategory?: boolean;
  // The concessions report carries a short line telling staff where a reduction is assigned,
  // so the person reading it can act on what they see.
  usesConcessionGuidance?: boolean;
};

export const FEE_REPORTS: FeeReportMeta[] = [
  {
    id: 'registered-class', title: 'Fee Registered (Class-Wise)', group: 'Core reports',
    hint: 'Billed fees grouped by class', note: 'Challans generated in the selected period, grouped by class.',
  },
  {
    id: 'registered-summary', title: 'Fee Registered (Summary)', group: 'Core reports',
    hint: 'Billed fees by fee month', note: 'Challans generated in the selected period, summarised by fee month.',
  },
  {
    id: 'received-class', title: 'Fee Received (Class-Wise)', group: 'Core reports',
    hint: 'Collections grouped by class', note: 'Receipts taken in the selected period, grouped by class. Reversed receipts are left out.',
  },
  {
    id: 'received-summary', title: 'Fee Received (Summary)', group: 'Core reports',
    hint: 'Collections by payment method', note: 'Receipts taken in the selected period, summarised by how the money was received.',
  },
  {
    id: 'receivable-class', title: 'Fee Receivable (Class-Wise)', group: 'Core reports',
    hint: 'Outstanding dues by class', note: 'Dues still owed by enrolled students as at the end date, grouped by class.',
  },
  {
    id: 'receivable-summary', title: 'Fee Receivable (Summary)', group: 'Core reports',
    hint: 'Outstanding dues by amount band', note: 'Dues still owed by enrolled students, grouped by how large the pending amount is.',
  },
  {
    id: 'adjustment-detail', title: 'Fee Adjustment (Detail)', group: 'Core reports',
    hint: 'Datewise adjustments with remarks', note: 'Every adjustment posted in the selected period, in date order, with the reason recorded against it.',
  },
  {
    id: 'ledger-detail', title: 'Fee Ledger (Detail)', group: 'Core reports',
    hint: 'Student-wise debit, credit and balance', note: 'One line per student: billed in the period, adjustments posted, received in the period, and the balance left.',
  },
  {
    id: 'trail', title: 'Fee Trail', group: 'Core reports',
    hint: 'Audit log of every fee event', note: 'Chronological log of challans generated, receipts taken, adjustments posted, corrections and reversals. Each amount is the effect on the fee account, and arrears carried forward from an earlier month are not billed a second time here.',
  },
  {
    id: 'concession-detail', title: 'Fee Concessions & Discounts', group: 'Core reports',
    hint: 'Sibling, orphan, scholarship and staff reductions',
    note: 'Every reduction recorded in the period, one line each: the concession taken off a generated challan, and each concession, discount, scholarship or write-off posted as an adjustment. Original fee is the bill before the reduction, so original less concession is the net fee after it. A reduction agreed on the student\'s record but not yet carried by any challan is shown as agreed rather than billed, so no reduction is ever counted twice, and it appears under the category it was given. A sibling discount stays separate: it is worked out from the family groups and the sibling discount rules, never from a category.',
    usesConcessionCategory: true,
    usesConcessionGuidance: true,
  },
  {
    id: 'nil-paid', title: 'Nil / Zero Fee Paid in Period', group: 'Daily accounting reports',
    hint: 'Dues with no payment in the period', note: 'Students who owe a balance but paid nothing between the From and To dates.',
  },
  {
    id: 'defaulters', title: 'Fee Defaulters / Pending Dues', group: 'Daily accounting reports',
    hint: 'Pending dues with contact details', note: 'Students still owing money as at the end date, with their activity in the period.',
    usesMinDue: true,
  },
  {
    id: 'cleared', title: 'Paid / Cleared Fee', group: 'Daily accounting reports',
    hint: 'Students fully cleared in the period', note: 'Students who paid during the period and now owe nothing.',
  },
  {
    id: 'class-collection-pending', title: 'Class-wise Collection vs Pending', group: 'Daily accounting reports',
    hint: 'Billed, collected and pending per class', note: 'For each class: what was billed in the period, what was collected, and what is still pending.',
  },
  {
    id: 'student-collection-balance', title: 'Student & Class-wise Cumulative & Period Collection Balance', group: 'Daily accounting reports',
    hint: 'Fee billed to date, received in period, balance and aging',
    note: 'Every student grouped by class. Total fee till period end is everything billed to that student up to the end date, less any concession or correction posted. Received in period is what was collected between the From and To dates, less any receipt reversed in it. Balance is what is still owed on the end date, so a student billed Rs 4,000 who paid Rs 1,500 in the period shows Rs 2,500. That balance is then split by age against the end date: money owed is matched to the charges it came from, oldest first, so the 0–30, 31–60, 61–90 and 90+ day columns add up to the balance. A part payment is marked, and each class has its own subtotal.',
  },
  {
    id: 'inactive-dues', title: 'Inactive / Withdrawn / Pass-out Dues', group: 'Daily accounting reports',
    hint: 'Pending dues of former students', note: 'Balances still owed by students who left, withdrew, or have been promoted out of the current roll.',
  },
];

export const feeReportMeta = (id: FeeReportId): FeeReportMeta =>
  FEE_REPORTS.find((entry) => entry.id === id) ?? FEE_REPORTS[0];

export type FeeReportFilters = {
  from: string;
  to: string;
  className: string;
  section: string;
  minDue: number;
  // Only the Fee Concessions & Discounts report reads this, so it stays empty on every
  // other report and their scope label and totals are unchanged by it.
  concessionCategory: string;
};

export const emptyReportFilters = (today: string): FeeReportFilters => ({
  from: `${today.slice(0, 7)}-01`,
  to: today,
  className: '',
  section: '',
  minDue: 1,
  concessionCategory: '',
});

// The category list lives in one module so the student record, the Fee Adjustment screen
// and this report all offer exactly the same names. It is re-exported from here because the
// report workspace is what renders the dropdown.
export { FEE_CONCESSION_CATEGORIES, concessionCategoryLabel, concessionCategoriesFor };

export type AdjustmentHistoryEntry = {
  id: string;
  adjustment_id: string;
  student_id: string;
  action: string;
  previous_amount: number | null;
  new_amount: number | null;
  previous_reason: string | null;
  new_reason: string | null;
  previous_entry_date: string | null;
  new_entry_date: string | null;
  changed_at: string;
  student_name?: string;
  class_name?: string | null;
  section_name?: string | null;
  admission_number?: string | null;
};

export type FeeReportData = {
  payments: FeePayment[];
  challans: FeeChallan[];
  adjustments: FeeAdjustment[];
  history: AdjustmentHistoryEntry[];
  // Everything billed and received up to the end date, rather than inside the period. Only
  // the reports that show a cumulative figure ask for it, and an empty list means the
  // report was built without a cumulative view rather than that nothing was billed.
  cumulativeChallans: FeeChallan[];
  cumulativePayments: FeePayment[];
  // The class fee structures and the standing sibling discount rules. Only the concessions
  // report reads them, because it has to work out what a child is agreed to pay even before
  // any challan has been raised for them.
  structures: FeeStructure[];
  siblingRules: SiblingDiscountRule[];
};

// One student's share of a footer total, plus the events that built it. A total that a
// user can click opens these, so the figure on the report can always be traced to the
// students and the rows behind it.
export type FeeReportBreakdown = {
  key: string;
  label: string;
  note: string;
  total: number;
  lines: { admission: string; student: string; events: number; amount: number }[];
};

export type FeeReport = {
  id: FeeReportId;
  title: string;
  note: string;
  columns: FeeReportColumn[];
  rows: FeeReportRow[];
  totals: FeeReportRow | null;
  empty: string;
  // Present only on the reports that can act on a student, aligned with `rows`, so a
  // row can be traced back to the student it belongs to. Defaulters and Nil Paid carry
  // it, because a WhatsApp fee reminder is sent from those two lists.
  reminderTargets?: Student[];
  // Present only on the concessions report, aligned with `rows`. Each entry is the
  // student whose concession the row describes, so an admin can approve or reject it
  // straight from the report. Rows that are not a standing concession (challan or
  // adjustment rows) carry null so the action cell stays blank for them.
  approvalTargets?: (Student | null)[];
  breakdowns?: FeeReportBreakdown[];
  // Class subtotals, keyed by the class name the rows carry. The table prints one under
  // each class so a class can be read on its own as well as in the grand total.
  classTotals?: { className: string; totals: FeeReportRow }[];
};

const HISTORY_COLUMNS =
  'id, adjustment_id, student_id, action, previous_amount, new_amount, previous_reason, new_reason, '
  + 'previous_entry_date, new_entry_date, changed_at, student:school_students(full_name, class_name, section_name, admission_number)';

type HistoryRow = Omit<AdjustmentHistoryEntry, 'student_name' | 'class_name' | 'section_name' | 'admission_number'> & {
  student: { full_name: string; class_name: string | null; section_name: string | null; admission_number: string | null } | null;
};

export async function loadFeeReportData(from: string, to: string, withCumulative = false, withConcessions = false): Promise<{ data: FeeReportData; error: string | null }> {
  const [paymentsResult, challansResult, adjustmentsResult, history, cumulative, concessions] = await Promise.all([
    fetchFeePaymentsInRange(from, to),
    fetchChallansInRange(from, to),
    fetchAdjustmentsInRange(from, to),
    fetchAdjustmentHistoryInRange(from, to),
    // A blank start date reads everything up to the end date, which is the cumulative view.
    // It is only read for the reports that show one, so the other reports pay nothing for it.
    withCumulative
      ? Promise.all([fetchChallansInRange('', to), fetchFeePaymentsInRange('', to)])
      : Promise.resolve(null),
    // The structures and the sibling rules are only read for the report that has to work out
    // what a family is agreed to pay, so no other report pays for them.
    withConcessions
      ? Promise.all([fetchFeeStructures(), fetchSiblingDiscountRules()])
      : Promise.resolve(null),
  ]);

  // Only the three core reads can raise an error, and even then the report builder turns
  // whatever came back into a readable report. The history is enrichment and never does.
  return {
    data: {
      payments: asArray<FeePayment>(paymentsResult.payments),
      challans: asArray<FeeChallan>(challansResult.challans),
      adjustments: asArray<FeeAdjustment>(adjustmentsResult.adjustments),
      history: asArray<AdjustmentHistoryEntry>(history),
      cumulativeChallans: cumulative ? asArray<FeeChallan>(cumulative[0].challans) : [],
      cumulativePayments: cumulative ? asArray<FeePayment>(cumulative[1].payments) : [],
      structures: concessions ? asArray<FeeStructure>(concessions[0].structures) : [],
      siblingRules: concessions ? asArray<SiblingDiscountRule>(concessions[1].rules) : [],
    },
    error: paymentsResult.error ?? challansResult.error ?? adjustmentsResult.error ?? null,
  };
}

// The adjustment history records who edited or removed an adjustment. It enriches the
// trail, so it is read on a best-effort basis: if it cannot be reached the trail still
// shows every challan, receipt and adjustment, and no report is ever blocked by it.
async function fetchAdjustmentHistoryInRange(from: string, to: string): Promise<AdjustmentHistoryEntry[]> {
  try {
    let query = supabase.from('school_fee_adjustment_history').select(HISTORY_COLUMNS);
    if (from) query = query.gte('changed_at', `${from}T00:00:00`);
    if (to) query = query.lte('changed_at', `${to}T23:59:59.999`);
    const { data, error } = await query.order('changed_at', { ascending: true });
    if (error) return [];
    return asArray<HistoryRow>(data).map((row) => ({
      ...row,
      student_name: row.student?.full_name ?? 'Unknown student',
      class_name: row.student?.class_name ?? null,
      section_name: row.student?.section_name ?? null,
      admission_number: row.student?.admission_number ?? null,
    }));
  } catch {
    return [];
  }
}

// Reports are built from whatever the last read produced, so every source is coerced to
// an array. A missing or malformed list becomes empty instead of throwing, which keeps a
// report readable rather than replacing it with an error.
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dayOf = (value: string | null | undefined) => (value ?? '').slice(0, 10);

// Stored timestamps are read defensively. A row whose date is missing or unparseable is
// shown as it stands rather than throwing while the trail is being assembled.
const safeDate = (value: string | null | undefined): Date | null => {
  try {
    const parsed = new Date(value ?? '');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

const stampOf = (value: string | null | undefined) => {
  const parsed = safeDate(value);
  return parsed ? parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : (value || '—');
};

const dateLabel = (value: string | null | undefined) => {
  const day = dayOf(value);
  if (!day) return '—';
  const parsed = safeDate(`${day}T00:00:00`);
  return parsed ? parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : day;
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', pending: 'Pending', withdrawn: 'Withdrawn', promoted: 'Promoted / Passed out',
};

const classSection = (className: string | null | undefined, sectionName: string | null | undefined) =>
  [className || '—', sectionName ? `(${sectionName})` : ''].filter(Boolean).join(' ');

// A report that cannot be prepared for any reason still renders as a clean, empty sheet
// with its own title and columns, so the workspace never turns into an error page.
export function emptyFeeReport(id: FeeReportId, message: string): FeeReport {
  const meta = feeReportMeta(id);
  // The headings match the ones the trail itself uses, so a sheet that could not be built
  // looks like the report the reader asked for rather than a different table.
  const columns: FeeReportColumn[] = [
    { key: 'at', label: 'When' },
    { key: 'type', label: 'Event' },
    { key: 'admission', label: 'Admission no.' },
    { key: 'student', label: 'Student' },
    { key: 'reference', label: 'Reference' },
    { key: 'details', label: 'Details' },
    { key: 'amount', label: 'Effect on dues', format: 'money' },
  ];
  return {
    id,
    title: meta.title,
    note: meta.note,
    columns,
    rows: [],
    totals: null,
    empty: message,
  };
}

const sectionFilterLabel = (filters: FeeReportFilters) => [
  filters.className || 'All classes',
  filters.section ? `Section ${filters.section}` : 'All sections',
  // The category is only ever set on the concessions report, so the scope line of every
  // other report reads exactly as it did before.
  ...(filters.concessionCategory ? [concessionCategoryLabel(filters.concessionCategory)] : []),
].join(' · ');

export const reportPeriodLabel = (filters: FeeReportFilters) =>
  `${dateLabel(filters.from)} — ${dateLabel(filters.to)}`;

export const reportScopeLabel = sectionFilterLabel;

const byClassThenName = (a: Student, b: Student) =>
  (a.class_name ?? '').localeCompare(b.class_name ?? '')
  || (a.section_name ?? '').localeCompare(b.section_name ?? '')
  || a.full_name.localeCompare(b.full_name);

const matchesScope = (className: string | null | undefined, sectionName: string | null | undefined, filters: FeeReportFilters) =>
  (!filters.className || className === filters.className)
  && (!filters.section || sectionName === filters.section);

// How long a pending balance has been owed, in the usual 30 / 60 / 90+ brackets. Money paid
// is taken as settling the oldest charge first, which is how a fee counter works and what a
// family expects, so what is left owing is the most recent charges. The balance is therefore
// matched against those newest first, and each part ages from the charge it belongs to. A
// charge that is not yet due counts as current.
export type FeeAgeBuckets = { age30: number; age60: number; age90: number; age90plus: number };

export const ageBuckets = (balance: number, charges: { due: string; amount: number }[], endDate: string): FeeAgeBuckets => {
  const buckets: FeeAgeBuckets = { age30: 0, age60: 0, age90: 0, age90plus: 0 };
  if (!(balance > 0)) return buckets;
  const end = safeDate(`${dayOf(endDate)}T00:00:00`);
  let left = balance;
  const newestFirst = charges
    .filter((charge) => charge.amount > 0 && charge.due)
    .sort((a, b) => b.due.localeCompare(a.due));
  for (const charge of newestFirst) {
    if (left <= 0) break;
    const taken = Math.min(left, charge.amount);
    left -= taken;
    const due = safeDate(`${dayOf(charge.due)}T00:00:00`);
    const days = end && due ? Math.floor((end.getTime() - due.getTime()) / 86400000) : 0;
    if (days <= 30) buckets.age30 += taken;
    else if (days <= 60) buckets.age60 += taken;
    else if (days <= 90) buckets.age90 += taken;
    else buckets.age90plus += taken;
  }
  // A balance left over once every dated charge is covered has no date to age against. It
  // is treated as the oldest debt rather than quietly dropped, which is both the cautious
  // reading for chasing money and what keeps the brackets adding up to the balance.
  if (left > 0) buckets.age90plus += left;
  return buckets;
};

export function buildFeeReport(id: FeeReportId, roster: Student[], data: FeeReportData, filters: FeeReportFilters): FeeReport {
  const meta = feeReportMeta(id);

  const scopedStudents = roster.filter((student) => matchesScope(student.class_name, student.section_name, filters)).sort(byClassThenName);
  const activeStudents = scopedStudents.filter((student) => student.status === 'active');

  // Every list is coerced to an array first, so the report is built from whatever the last
  // read produced rather than throwing on a missing or malformed payload.
  const studentById = new Map(roster.map((student) => [student.id, student]));
  // An adjustment row names only the student it belongs to, so its class and section are read
  // from that student's record. Without this a class filter would drop every adjustment
  // instead of narrowing the report to the class that was asked for.
  const adjustmentInScope = (adjustment: FeeAdjustment) => {
    const student = studentById.get(adjustment.student_id);
    return matchesScope(
      adjustment.class_name ?? student?.class_name,
      adjustment.section_name ?? student?.section_name,
      filters,
    );
  };
  const paymentsInScope = asArray<FeePayment>(data?.payments).filter((row) => matchesScope(row.class_name, row.section_name, filters));
  const payments = paymentsInScope.filter((payment) => !payment.voided);
  const challans = asArray<FeeChallan>(data?.challans).filter((challan) => matchesScope(challan.class_name, challan.section_name, filters));
  const adjustments = asArray<FeeAdjustment>(data?.adjustments).filter(adjustmentInScope);

  const paidByStudent = new Map<string, number>();
  const paidCountByStudent = new Map<string, number>();
  const lastPaidByStudent = new Map<string, string>();
  for (const payment of payments) {
    paidByStudent.set(payment.student_id, (paidByStudent.get(payment.student_id) ?? 0) + num(payment.amount));
    paidCountByStudent.set(payment.student_id, (paidCountByStudent.get(payment.student_id) ?? 0) + 1);
    const day = dayOf(payment.payment_date);
    const current = lastPaidByStudent.get(payment.student_id) ?? '';
    if (day > current) lastPaidByStudent.set(payment.student_id, day);
  }

  const billedByStudent = new Map<string, number>();
  const billedCountByStudent = new Map<string, number>();
  for (const challan of challans) {
    billedByStudent.set(challan.student_id, (billedByStudent.get(challan.student_id) ?? 0) + num(challan.total));
    billedCountByStudent.set(challan.student_id, (billedCountByStudent.get(challan.student_id) ?? 0) + 1);
  }

  const adjustedByStudent = new Map<string, number>();
  for (const adjustment of adjustments) {
    adjustedByStudent.set(adjustment.student_id, (adjustedByStudent.get(adjustment.student_id) ?? 0) + num(adjustment.amount));
  }

  // The reports print the number saved on the student's own record. Borrowing a
  // sibling's number would put a different child's contact against this student's dues,
  // which is misleading on a printed report, so it is deliberately not done here.
  const contactFor = (student: Student) => {
    const contact = pickWhatsAppContact(student);
    return contact.number ? formatWhatsAppNumber(contact.raw ?? contact.number) : '—';
  };
  const base = (columns: FeeReportColumn[], rows: FeeReportRow[], totals: FeeReportRow | null, empty: string, reminderTargets?: Student[], breakdowns?: FeeReportBreakdown[], classTotals?: { className: string; totals: FeeReportRow }[], approvalTargets?: (Student | null)[]): FeeReport => ({
    id, title: meta.title, note: meta.note, columns, rows, totals, empty, reminderTargets, breakdowns, classTotals, approvalTargets,
  });

  switch (id) {
    case 'registered-class': {
      const classes = new Map<string, { challans: number; students: Set<string>; billed: number; months: Set<string> }>();
      for (const challan of challans) {
        const key = challan.class_name || 'Unassigned';
        const entry = classes.get(key) ?? { challans: 0, students: new Set<string>(), billed: 0, months: new Set<string>() };
        entry.challans += 1;
        entry.students.add(challan.student_id);
        entry.billed += num(challan.total);
        if (challan.month) entry.months.add(challan.month);
        classes.set(key, entry);
      }
      const rows = Array.from(classes.entries()).map(([className, entry]) => ({
        className,
        challans: entry.challans,
        students: entry.students.size,
        months: Array.from(entry.months).sort().map((month) => monthLabel(month)).join(', ') || '—',
        billed: entry.billed,
      })).sort((a, b) => b.billed - a.billed);
      return base(
        [
          { key: 'className', label: 'Class' },
          { key: 'challans', label: 'Challans', format: 'number' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'months', label: 'Fee months' },
          { key: 'billed', label: 'Billed', format: 'money' },
        ],
        rows,
        {
          className: 'Total',
          challans: rows.reduce((sum, row) => sum + row.challans, 0),
          students: new Set(challans.map((challan) => challan.student_id)).size,
          months: '',
          billed: rows.reduce((sum, row) => sum + row.billed, 0),
        },
        'No challan was generated in this period.',
      );
    }

    case 'registered-summary': {
      const months = new Map<string, { challans: number; students: Set<string>; billed: number }>();
      for (const challan of challans) {
        const key = challan.month || 'Undated';
        const entry = months.get(key) ?? { challans: 0, students: new Set<string>(), billed: 0 };
        entry.challans += 1;
        entry.students.add(challan.student_id);
        entry.billed += num(challan.total);
        months.set(key, entry);
      }
      const rows = Array.from(months.entries()).map(([month, entry]) => ({
        month: month === 'Undated' ? month : monthLabel(month),
        challans: entry.challans,
        students: entry.students.size,
        billed: entry.billed,
      })).sort((a, b) => b.billed - a.billed);
      const billed = rows.reduce((sum, row) => sum + row.billed, 0);
      const issued = rows.reduce((sum, row) => sum + row.challans, 0);
      return base(
        [
          { key: 'month', label: 'Fee month' },
          { key: 'challans', label: 'Challans', format: 'number' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'billed', label: 'Billed', format: 'money' },
        ],
        rows,
        {
          month: 'Total',
          challans: issued,
          students: new Set(challans.map((challan) => challan.student_id)).size,
          billed,
        },
        'No challan was generated in this period.',
      );
    }

    case 'received-class': {
      const classes = new Map<string, { receipts: number; students: Set<string>; collected: number }>();
      for (const payment of payments) {
        const key = payment.class_name || 'Unassigned';
        const entry = classes.get(key) ?? { receipts: 0, students: new Set<string>(), collected: 0 };
        entry.receipts += 1;
        entry.students.add(payment.student_id);
        entry.collected += num(payment.amount);
        classes.set(key, entry);
      }
      const rows = Array.from(classes.entries()).map(([className, entry]) => ({
        className,
        receipts: entry.receipts,
        students: entry.students.size,
        collected: entry.collected,
      })).sort((a, b) => b.collected - a.collected);
      return base(
        [
          { key: 'className', label: 'Class' },
          { key: 'receipts', label: 'Receipts', format: 'number' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'collected', label: 'Collected', format: 'money' },
        ],
        rows,
        {
          className: 'Total',
          receipts: rows.reduce((sum, row) => sum + row.receipts, 0),
          students: new Set(payments.map((payment) => payment.student_id)).size,
          collected: rows.reduce((sum, row) => sum + row.collected, 0),
        },
        'No fee was received in this period.',
      );
    }

    case 'received-summary': {
      const methods = new Map<string, { receipts: number; collected: number }>();
      for (const payment of payments) {
        const key = payment.method || 'other';
        const entry = methods.get(key) ?? { receipts: 0, collected: 0 };
        entry.receipts += 1;
        entry.collected += num(payment.amount);
        methods.set(key, entry);
      }
      const labels: Record<string, string> = { cash: 'Cash', bank: 'Bank', online: 'Online / Easypaisa' };
      const rows = Array.from(methods.entries()).map(([method, entry]) => ({
        method: labels[method] ?? method,
        receipts: entry.receipts,
        collected: entry.collected,
        share: 0,
      })).sort((a, b) => b.collected - a.collected);
      const collected = rows.reduce((sum, row) => sum + row.collected, 0);
      for (const row of rows) row.share = collected > 0 ? Math.round((row.collected / collected) * 1000) / 10 : 0;
      return base(
        [
          { key: 'method', label: 'Payment method' },
          { key: 'receipts', label: 'Receipts', format: 'number' },
          { key: 'collected', label: 'Collected', format: 'money' },
          { key: 'share', label: 'Share', format: 'percent' },
        ],
        rows,
        {
          method: 'Total',
          receipts: rows.reduce((sum, row) => sum + row.receipts, 0),
          collected,
          share: collected > 0 ? 100 : 0,
        },
        'No fee was received in this period.',
      );
    }

    case 'receivable-class': {
      const classes = new Map<string, { students: number; defaulters: number; pending: number }>();
      for (const student of activeStudents) {
        const key = student.class_name || 'Unassigned';
        const entry = classes.get(key) ?? { students: 0, defaulters: 0, pending: 0 };
        const due = Math.max(0, num(student.fee_balance));
        entry.students += 1;
        if (due > 0) { entry.defaulters += 1; entry.pending += due; }
        classes.set(key, entry);
      }
      const rows = Array.from(classes.entries()).map(([className, entry]) => ({ className, ...entry }))
        .sort((a, b) => b.pending - a.pending);
      return base(
        [
          { key: 'className', label: 'Class' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'defaulters', label: 'With dues', format: 'number' },
          { key: 'pending', label: 'Pending', format: 'money' },
        ],
        rows,
        {
          className: 'Total',
          students: rows.reduce((sum, row) => sum + row.students, 0),
          defaulters: rows.reduce((sum, row) => sum + row.defaulters, 0),
          pending: rows.reduce((sum, row) => sum + row.pending, 0),
        },
        'No enrolled student is in this scope.',
      );
    }

    case 'receivable-summary': {
      const bands = [
        { label: 'Rs 1 – 2,000', test: (due: number) => due <= 2000 },
        { label: 'Rs 2,001 – 5,000', test: (due: number) => due > 2000 && due <= 5000 },
        { label: 'Rs 5,001 – 10,000', test: (due: number) => due > 5000 && due <= 10000 },
        { label: 'Above Rs 10,000', test: (due: number) => due > 10000 },
      ];
      const rows = bands.map((band) => {
        const inBand = activeStudents.filter((student) => {
          const due = Math.max(0, num(student.fee_balance));
          return due > 0 && band.test(due);
        });
        return {
          band: band.label,
          students: inBand.length,
          pending: inBand.reduce((sum, student) => sum + Math.max(0, num(student.fee_balance)), 0),
        };
      });
      return base(
        [
          { key: 'band', label: 'Pending amount' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'pending', label: 'Pending', format: 'money' },
        ],
        rows,
        {
          band: 'Total',
          students: rows.reduce((sum, row) => sum + row.students, 0),
          pending: rows.reduce((sum, row) => sum + row.pending, 0),
        },
        'No pending dues in this scope.',
      );
    }

    case 'adjustment-detail': {
      const rows = [...adjustments]
        .sort((a, b) => (a.entry_date ?? '').localeCompare(b.entry_date ?? '') || a.created_at.localeCompare(b.created_at))
        .map((adjustment) => {
          const student = studentById.get(adjustment.student_id);
          return {
            date: dateLabel(adjustment.entry_date || adjustment.effective_date),
            admission: adjustment.admission_number ?? student?.admission_number ?? '—',
            student: adjustment.student_name ?? student?.full_name ?? 'Unknown student',
            classSection: classSection(adjustment.class_name ?? student?.class_name, adjustment.section_name ?? student?.section_name),
            type: adjustmentLabel(adjustment.adjustment_type),
            remarks: adjustment.reason || adjustment.remarks || '—',
            amount: num(adjustment.amount),
          };
        });
      const reduced = rows.filter((row) => num(row.amount) < 0).reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);
      const added = rows.filter((row) => num(row.amount) > 0).reduce((sum, row) => sum + num(row.amount), 0);
      return base(
        [
          { key: 'date', label: 'Date' },
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'type', label: 'Type' },
          { key: 'remarks', label: 'Remarks' },
          { key: 'amount', label: 'Amount', format: 'money' },
        ],
        rows,
        { date: 'Total', admission: '', student: `${rows.length} adjustments`, classSection: '', type: '', remarks: `Reduced ${formatMoney(reduced)} · Added ${formatMoney(added)}`, amount: added - reduced },
        'No adjustment was posted in this period.',
      );
    }

    case 'ledger-detail': {
      const rows = scopedStudents
        .filter((student) => (billedByStudent.get(student.id) ?? 0) > 0
          || (paidByStudent.get(student.id) ?? 0) > 0
          || (adjustedByStudent.get(student.id) ?? 0) !== 0
          || num(student.fee_balance) > 0)
        .map((student) => ({
          admission: student.admission_number ?? '—',
          student: student.full_name,
          classSection: classSection(student.class_name, student.section_name),
          billed: billedByStudent.get(student.id) ?? 0,
          adjustments: adjustedByStudent.get(student.id) ?? 0,
          received: paidByStudent.get(student.id) ?? 0,
          balance: Math.max(0, num(student.fee_balance)),
        }));
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'billed', label: 'Billed (debit)', format: 'money' },
          { key: 'adjustments', label: 'Adjustments', format: 'money' },
          { key: 'received', label: 'Received (credit)', format: 'money' },
          { key: 'balance', label: 'Balance', format: 'money' },
        ],
        rows,
        {
          admission: 'Total', student: `${rows.length} students`, classSection: '',
          billed: rows.reduce((sum, row) => sum + row.billed, 0),
          adjustments: rows.reduce((sum, row) => sum + row.adjustments, 0),
          received: rows.reduce((sum, row) => sum + row.received, 0),
          balance: rows.reduce((sum, row) => sum + row.balance, 0),
        },
        'No fee activity in this period.',
      );
    }

    case 'concession-detail': {
      // A reduction can be recorded in two places, and the report shows both rather than
      // adding them together, so nothing is ever counted twice. The concession head on a
      // generated challan is the reduction the family was actually billed with, and it holds
      // the student's own concession together with any sibling discount. A reduction posted as
      // an adjustment is a separate act, recorded on its own.
      const rows: FeeReportRow[] = [];
      // Aligned with `rows`: the student whose pending concession the row describes, so an
      // admin can approve or reject it straight from the report. Rows that are not a
      // pending standing concession carry null so the action cell stays blank for them.
      const approvalRowTargets: (Student | null)[] = [];
      const pushRow = (row: FeeReportRow, student: Student | undefined) => {
        rows.push(row);
        approvalRowTargets.push(student && student.concession_approval_status === 'pending' ? student : null);
      };

      // What each student is agreed to pay, worked out from the school's own fee structures and
      // sibling discount rules exactly as the Family fee ledger works them out, so the report and
      // the ledger never disagree. A child's place in their family is decided by their brothers
      // and sisters, so the whole roster is grouped rather than only the students in scope.
      const structures = asArray<FeeStructure>(data?.structures);
      const siblingRules = asArray<SiblingDiscountRule>(data?.siblingRules);
      type AgreedReduction = { tuition: number; standing: number; sibling: number; percentage: number; ruleLabel: string | null };
      const agreedByStudent = new Map<string, AgreedReduction>();
      if (structures.length > 0 || siblingRules.length > 0) {
        const groups = findSiblingGroups(roster);
        for (const student of roster) {
          const structure = structures.find((entry) => entry.class_name === student.class_name);
          const tuition = tuitionFor(student, structure);
          if (tuition <= 0) continue;
          const standing = recordedConcessionFor(student, tuition);
          // The sibling discount is taken from the family's place in the Fee Structure
          // "Brothers and sisters" rules and nowhere else, so a record that still carries an
          // old hand-typed percentage cannot add a second reduction on top of the rule.
          const context = siblingContextFor({ candidate: student, groups, rules: siblingRules });
          const sibling = Math.min(Math.max(0, tuition - standing), (tuition * Math.max(0, context.discountPercentage)) / 100);
          agreedByStudent.set(student.id, {
            tuition,
            standing,
            sibling,
            percentage: context.discountPercentage,
            ruleLabel: context.ruleLabel,
          });
        }
      }

      // How much of each kind of reduction a challan has already billed against a student, so the
      // agreed figures below can be trimmed by it and nothing is counted twice.
      const billedAgainst = new Map<string, { standing: number; sibling: number }>();

      // The category a student's own reduction was given, if the office picked one. Sibling is
      // deliberately refused here: the family discount is worked out from the family groups and
      // the sibling rules, so a record marked "sibling" must never raise a second sibling line.
      // A record with no category keeps the generic standing-concession name it always had.
      const standingCategoryFor = (student: Student | undefined): string => {
        const chosen = (student?.fee_concession_category ?? '').trim();
        return chosen && chosen !== 'sibling' ? chosen : 'concession';
      };

      // The parts of a challan's concession head. The agreed figures are the first reading, so a
      // sibling discount the office applied by rule is named as a sibling discount even though the
      // student's own record carries no percentage. Where the agreed figures cannot account for
      // the whole head, the remainder is reported as an unrecorded reduction rather than guessed
      // at, and a student with no agreed figures falls back to what their own record says.
      const splitConcession = (student: Student | undefined, head: number) => {
        const agreed = student ? agreedByStudent.get(student.id) : undefined;
        if (!agreed) {
          if (!student) return { sibling: 0, standing: head, unrecorded: 0 };
          const tuition = num(student.tuition_fee);
          const standing = Math.min(head, recordedConcessionFor(student, tuition));
          // With no agreed figures to work from there is no rule-driven percentage to hand,
          // so the remainder of the head is reported as an unrecorded reduction rather than
          // guessed at as a sibling discount.
          return { sibling: 0, standing, unrecorded: Math.max(0, head - standing) };
        }
        const standing = Math.min(head, agreed.standing);
        const remaining = Math.max(0, head - standing);
        const sibling = Math.min(remaining, agreed.sibling);
        return { sibling, standing, unrecorded: Math.max(0, remaining - sibling) };
      };

      // The label shown on the report for a student's approval state. A non-special
      // concession has no status and reads as a dash, so the column stays quiet for them.
      const approvalLabelFor = (student: Student | undefined): string => {
        const status = student?.concession_approval_status;
        if (!status) return '—';
        if (status === 'approved') return 'Approved';
        if (status === 'rejected') return 'Rejected';
        return 'Pending approval';
      };

      for (const challan of challans) {
        const head = Math.max(0, num(challan.concession));
        if (head <= 0) continue;
        const student = studentById.get(challan.student_id);
        const arrears = Math.max(0, num(challan.arrears));
        // A challan's total is already net of its concession and carries any arrears brought
        // forward inside it. Adding the concession back and setting the arrears aside leaves
        // this month's own bill before the reduction was taken off it.
        const original = Math.max(0, num(challan.total) - arrears) + head;
        const parts = splitConcession(student, head);
        const billed = billedAgainst.get(challan.student_id) ?? { standing: 0, sibling: 0 };
        billed.standing += parts.standing;
        billed.sibling += parts.sibling;
        billedAgainst.set(challan.student_id, billed);
        const category = [
          `${monthLabel(challan.month)} challan`,
          parts.sibling > 0 ? 'Sibling' : '',
          parts.standing > 0 ? (student ? concessionCategoryLabel(standingCategoryFor(student)) : 'Concession') : '',
          parts.unrecorded > 0 ? 'Other reduction' : '',
        ].filter(Boolean).join(' · ');
        const kinds = [
          parts.sibling > 0 ? 'sibling' : '',
          parts.standing > 0 ? standingCategoryFor(student) : '',
          parts.unrecorded > 0 ? 'other' : '',
        ].filter(Boolean);
        pushRow({
          admission: student?.admission_number ?? '—',
          student: challan.student_name || student?.full_name || 'Unknown student',
          father: student?.fathers_name || student?.guardian_name || '—',
          classSection: classSection(challan.class_name ?? student?.class_name, challan.section_name ?? student?.section_name),
          category,
          categoryKey: kinds.join('|'),
          original,
          concession: head,
          net: Math.max(0, original - head),
          approval: approvalLabelFor(student),
        }, student);
      }

      for (const adjustment of adjustments) {
        // Only a reduction is a concession. A correction posted upwards adds to what is owed
        // and belongs to the Fee Adjustment (Detail) report instead.
        if (num(adjustment.amount) >= 0) continue;
        const student = studentById.get(adjustment.student_id);
        const concession = Math.abs(num(adjustment.amount));
        const reason = adjustment.reason || adjustment.remarks || 'No reason recorded';
        // The category the office picked when posting is what names the reduction, so it is
        // reported under exactly the choice that was made. A reduction posted before a category
        // could be picked, or where none was chosen, falls back to the wording of the remark and
        // then to the kind of adjustment, so nothing is left uncategorised.
        const chosen = (adjustment.category ?? '').trim();
        const chosenLabel = chosen ? concessionCategoryLabel(chosen) : '';
        const named = chosen ? [chosen] : concessionCategoriesFor(reason);
        pushRow({
          admission: adjustment.admission_number ?? student?.admission_number ?? '—',
          student: adjustment.student_name ?? student?.full_name ?? 'Unknown student',
          father: student?.fathers_name || student?.guardian_name || '—',
          classSection: classSection(adjustment.class_name ?? student?.class_name, adjustment.section_name ?? student?.section_name),
          category: chosenLabel
            ? [chosenLabel, adjustment.reason || adjustment.remarks ? reason : ''].filter(Boolean).join(' · ')
            : `${adjustmentLabel(adjustment.adjustment_type)} · ${reason}`,
          categoryKey: (named.length > 0 ? named : [adjustment.adjustment_type]).join('|'),
          original: concession,
          concession,
          net: 0,
          approval: approvalLabelFor(student),
        }, student);
      }

      // A family can be agreed a sibling discount before any challan has been raised, and a
      // student can be agreed a concession on their own record that no challan has carried yet.
      // Both are worked out from the agreed figures above, and what a challan has already billed is
      // taken off, so an agreed reduction is only ever shown for the part that no bill covers.
      //
      // A standing concession carried by a challan in this period is fully represented by that
      // challan row — the agreed line is suppressed for it so the same reduction is never shown
      // and counted twice (once as "Agreed scholarship" and once as the challan's concession head).
      // A sibling discount is still shown when the challan did not carry the full agreed sibling
      // share, because sibling and standing can split across different challans.
      const adjustedFor = new Set(adjustments.map((adjustment) => adjustment.student_id));
      const standingCarriedByChallan = new Set<string>();
      for (const [sid, billed] of billedAgainst) {
        const agreed = agreedByStudent.get(sid);
        if (agreed && agreed.standing > 0 && billed.standing >= agreed.standing - 0.01) {
          standingCarriedByChallan.add(sid);
        }
      }
      for (const student of scopedStudents) {
        // A reduction already posted as an adjustment is reported by that line, not repeated here.
        if (adjustedFor.has(student.id)) continue;
        const agreed = agreedByStudent.get(student.id);
        if (!agreed) continue;
        const billed = billedAgainst.get(student.id) ?? { standing: 0, sibling: 0 };
        const standingKind = standingCategoryFor(student);
        const dues = [
          {
            kind: standingKind,
            agreed: agreed.standing,
            billed: billed.standing,
            // The category the record was given, so a standing orphan place or staff concession
            // is listed as itself and answers to that same filter in the dropdown above.
            category: standingKind === 'concession'
              ? 'Agreed concession on record'
              : `Agreed ${concessionCategoryLabel(standingKind).toLowerCase()}`,
          },
          {
            kind: 'sibling',
            agreed: agreed.sibling,
            billed: billed.sibling,
            category: agreed.percentage > 0
              ? `Agreed sibling discount · ${agreed.percentage}%${agreed.ruleLabel ? ` · ${agreed.ruleLabel}` : ''}`
              : 'Agreed sibling discount',
          },
        ];
        for (const due of dues) {
          // Only the part no challan has billed yet, and only when there is one. Once the challan
          // is raised the row above takes over and this line disappears.
          const outstanding = Math.round((due.agreed - due.billed) * 100) / 100;
          if (outstanding <= 0) continue;
          // A standing concession already carried by a challan in this period is reported by
          // that challan row — skip the agreed line so it is not duplicated.
          if (due.kind !== 'sibling' && standingCarriedByChallan.has(student.id)) continue;
          pushRow({
            admission: student.admission_number ?? '—',
            student: student.full_name,
            father: student.fathers_name || student.guardian_name || '—',
            classSection: classSection(student.class_name, student.section_name),
            category: due.category,
            categoryKey: due.kind,
            original: agreed.tuition,
            concession: outstanding,
            net: Math.max(0, agreed.tuition - outstanding),
            approval: approvalLabelFor(student),
          }, student);
        }
      }

      const kindsOf = (row: FeeReportRow) => String(row.categoryKey ?? '').split('|').filter(Boolean);
      const chosenCategory = filters.concessionCategory;
      // When a category filter narrows the report, the approval targets are filtered the
      // same way so they stay aligned with the rows that are shown.
      const shownIndices = chosenCategory
        ? rows.map((row, index) => kindsOf(row).includes(chosenCategory) ? index : -1).filter((index) => index >= 0)
        : rows.map((_, index) => index);
      const shownPairs = shownIndices.map((index) => ({ row: rows[index], target: approvalRowTargets[index] }));
      shownPairs.sort((a, b) =>
        String(a.row.classSection).localeCompare(String(b.row.classSection))
        || String(a.row.student).localeCompare(String(b.row.student))
        || String(a.row.category).localeCompare(String(b.row.category)));
      const shown = shownPairs.map((pair) => pair.row);
      const shownApprovalTargets = shownPairs.map((pair) => pair.target);

      const sum = (key: string) => shown.reduce((total, row) => total + num(row[key]), 0);
      const originalTotal = sum('original');
      const concessionTotal = sum('concession');
      // The kinds are counted per kind rather than per row, so a challan that holds two kinds
      // is reported under both. The line therefore reads as how many reductions of each kind
      // the report covers, which is what the dropdown below it is narrowing.
      const mix = new Map<string, number>();
      for (const row of shown) {
        for (const kind of kindsOf(row)) mix.set(kind, (mix.get(kind) ?? 0) + 1);
      }
      const categoryMix = Array.from(mix.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => `${count} ${concessionCategoryLabel(key).toLowerCase()}`)
        .join(' · ');
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'father', label: 'Father' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'category', label: 'Concession category' },
          { key: 'approval', label: 'Approval' },
          { key: 'original', label: 'Original fee', format: 'money' },
          { key: 'concession', label: 'Concession', format: 'money' },
          { key: 'net', label: 'Net fee after concession', format: 'money' },
          { key: 'action', label: '', action: 'approve' },
        ],
        shown,
        {
          admission: 'Total',
          student: `${shown.length} reduction${shown.length === 1 ? '' : 's'}`,
          father: '',
          classSection: '',
          // The footer says both what was given away and which kinds of reduction it went on,
          // so a narrowed report still reads as a whole rather than as a bare figure.
          category: [
            originalTotal > 0 ? `${Math.round((concessionTotal / originalTotal) * 1000) / 10}% off the original fee` : '',
            categoryMix,
          ].filter(Boolean).join(' · '),
          approval: '',
          original: originalTotal,
          concession: concessionTotal,
          net: sum('net'),
        },
        chosenCategory
          ? `No matching reduction in this period — nothing was recorded as ${concessionCategoryLabel(chosenCategory)}.`
          : 'No concession or discount was recorded in this period. Assign one on a student\'s record under Fees and concessions, or post it from Fee Adjustment.',
        undefined,
        undefined,
        undefined,
        shownApprovalTargets,
      );
    }

    case 'trail': {
      // Each event keeps the student it belongs to, so the footer totals can be opened
      // back up into the students that make them up.
      const events: { at: string; sid: string; type: string; admission: string; student: string; reference: string; details: string; amount: number }[] = [];

      for (const challan of challans) {
        const student = studentById.get(challan.student_id);
        // A challan's total already carries the arrears brought forward from an earlier
        // month, and those were billed in that month. Only this month's own charges are
        // billed here, so the same debt is never counted twice in the total below.
        const arrears = Math.max(0, num(challan.arrears));
        events.push({
          at: challan.created_at,
          type: 'Challan generated',
          admission: student?.admission_number ?? '—',
          student: challan.student_name || student?.full_name || 'Unknown student',
          reference: challan.challan_number ?? `${monthLabel(challan.month)} challan`,
          details: `${monthLabel(challan.month)} · due ${dateLabel(challan.due_date)} · ${challan.status}${arrears > 0 ? ` · ${formatMoney(arrears)} brought forward` : ''}`,
          amount: Math.max(0, num(challan.total) - arrears),
          sid: challan.student_id,
        });
      }

      for (const payment of paymentsInScope) {
        const student = studentById.get(payment.student_id);
        const name = payment.student_name || student?.full_name || 'Unknown student';
        const admission = payment.admission_number ?? student?.admission_number ?? '—';
        if (payment.voided) {
          events.push({
            at: payment.voided_at ?? payment.created_at,
            type: 'Receipt reversed',
            admission,
            student: name,
            reference: payment.receipt_number,
            details: payment.void_reason || 'Reversed by the office',
            amount: num(payment.amount),
            sid: payment.student_id,
          });
          continue;
        }
        events.push({
          at: payment.created_at,
          type: 'Fee received',
          admission,
          student: name,
          reference: payment.receipt_number,
          details: `Paid on ${dateLabel(payment.payment_date)} · ${payment.method}`,
          amount: -num(payment.amount),
          sid: payment.student_id,
        });
        if (num(payment.edit_count) > 0 && payment.updated_at) {
          // A correction changes the figures on a receipt that is already counted above;
          // no money moves a second time, so it carries no amount of its own.
          events.push({
            at: payment.updated_at,
            type: 'Receipt corrected',
            admission,
            student: name,
            reference: payment.receipt_number,
            details: `Corrected ${num(payment.edit_count)} time${num(payment.edit_count) === 1 ? '' : 's'} · receipt now ${formatMoney(num(payment.amount))}`,
            amount: 0,
            sid: payment.student_id,
          });
        }
      }

      for (const adjustment of adjustments) {
        const student = studentById.get(adjustment.student_id);
        events.push({
          at: adjustment.created_at,
          type: 'Adjustment posted',
          admission: adjustment.admission_number ?? student?.admission_number ?? '—',
          student: adjustment.student_name ?? student?.full_name ?? 'Unknown student',
          reference: adjustmentLabel(adjustment.adjustment_type),
          details: adjustment.reason || adjustment.remarks || 'No remarks recorded',
          amount: num(adjustment.amount),
          sid: adjustment.student_id,
        });
      }

      // The history rows carry the student's class, so they answer to the same class and
      // section scope as every other event in the trail.
      for (const entry of asArray<AdjustmentHistoryEntry>(data?.history)) {
        if (!matchesScope(entry.class_name, entry.section_name, filters)) continue;
        const student = studentById.get(entry.student_id);
        const removed = entry.action === 'delete';
        events.push({
          at: entry.changed_at,
          type: removed ? 'Adjustment removed' : 'Adjustment corrected',
          admission: entry.admission_number ?? student?.admission_number ?? '—',
          student: entry.student_name ?? student?.full_name ?? 'Unknown student',
          reference: removed ? 'Removed' : 'Edited',
          details: removed
            ? `${entry.previous_reason || 'No remarks recorded'} · was ${formatMoney(num(entry.previous_amount))}`
            : `${entry.previous_reason || 'No remarks'} → ${entry.new_reason || 'No remarks'}`,
          amount: removed ? -num(entry.previous_amount) : num(entry.new_amount) - num(entry.previous_amount),
          sid: entry.student_id,
        });
      }

      const rows = events
        .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
        .map((event) => ({
          at: stampOf(event.at),
          type: event.type,
          admission: event.admission,
          student: event.student,
          reference: event.reference,
          details: event.details,
          amount: event.amount,
        }));

      // The footer reads each part out of the events themselves, so billing and collection
      // are reported side by side rather than added together as if they were one figure.
      // The net line is the sum of the Amount column, which is the period's effect on dues.
      const sumOf = (types: string[]) => events.filter((event) => types.includes(event.type)).reduce((sum, event) => sum + event.amount, 0);
      const billed = sumOf(['Challan generated']);
      const received = -sumOf(['Fee received', 'Receipt reversed']);
      const adjusted = sumOf(['Adjustment posted', 'Adjustment removed', 'Adjustment corrected']);

      // Regroup the same events by student, so a total can be opened into the students
      // behind it. The students are ordered by the size of their share, biggest first,
      // which is the order a reader wants when checking a figure.
      const grouped = (types: string[], sign: number) => {
        const byStudent = new Map<string, { admission: string; student: string; events: number; amount: number }>();
        for (const event of events) {
          if (!types.includes(event.type)) continue;
          const entry = byStudent.get(event.sid)
            ?? { admission: event.admission, student: event.student, events: 0, amount: 0 };
          entry.events += 1;
          entry.amount += event.amount;
          byStudent.set(event.sid, entry);
        }
        return Array.from(byStudent.values())
          .map((entry) => ({ ...entry, amount: sign * entry.amount }))
          .filter((entry) => entry.amount !== 0)
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      };

      const breakdowns: FeeReportBreakdown[] = [
        {
          key: 'billed', label: 'Billed', total: billed,
          note: 'Challans raised in this period, counting each month\'s own charges only. Arrears carried forward from an earlier month were billed then and are not counted again.',
          lines: grouped(['Challan generated'], 1),
        },
        {
          key: 'received', label: 'Received', total: received,
          note: 'Receipts taken in this period, less any receipt reversed in it.',
          lines: grouped(['Fee received', 'Receipt reversed'], -1),
        },
        {
          key: 'adjusted', label: 'Adjustments', total: adjusted,
          note: 'Concessions and corrections posted in this period. A negative figure reduces what families owe.',
          lines: grouped(['Adjustment posted', 'Adjustment removed', 'Adjustment corrected'], 1),
        },
        {
          key: 'net', label: 'Change in dues', total: rows.reduce((sum, row) => sum + num(row.amount), 0),
          note: 'Every event in this period added together: what was billed, less what was received, plus or minus adjustments. This is how much the school\'s outstanding dues moved.',
          lines: grouped(['Challan generated', 'Fee received', 'Receipt reversed', 'Adjustment posted', 'Adjustment removed', 'Adjustment corrected'], 1),
        },
      ];
      return base(
        [
          { key: 'at', label: 'When' },
          { key: 'type', label: 'Event' },
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'reference', label: 'Reference' },
          { key: 'details', label: 'Details' },
          { key: 'amount', label: 'Effect on dues', format: 'money' },
        ],
        rows,
        {
          at: 'Total', type: `${rows.length} entries`, admission: '', student: '', reference: '',
          details: `Billed ${formatMoney(billed)} · Received ${formatMoney(received)} · Adjustments ${formatMoney(adjusted)}`,
          amount: rows.reduce((sum, row) => sum + num(row.amount), 0),
        },
        'No fee event was recorded in this period.',
        undefined,
        breakdowns,
      );
    }

    case 'nil-paid': {
      const picked = activeStudents
        .filter((student) => Math.max(0, num(student.fee_balance)) > 0 && (paidCountByStudent.get(student.id) ?? 0) === 0)
        .sort((a, b) => Math.max(0, num(b.fee_balance)) - Math.max(0, num(a.fee_balance)));
      const rows = picked
        .map((student) => ({
          admission: student.admission_number ?? '—',
          student: student.full_name,
          father: student.fathers_name || student.guardian_name || '—',
          classSection: classSection(student.class_name, student.section_name),
          billed: billedByStudent.get(student.id) ?? 0,
          due: Math.max(0, num(student.fee_balance)),
          paidInPeriod: 0,
          contact: contactFor(student),
        }));
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'father', label: 'Father' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'billed', label: 'Billed in period', format: 'money' },
          { key: 'due', label: 'Due amount', format: 'money' },
          { key: 'paidInPeriod', label: 'Paid in period', format: 'money' },
          { key: 'contact', label: 'Contact / WhatsApp', action: 'remind' },
        ],
        rows,
        {
          admission: 'Total', student: `${rows.length} students`, father: '', classSection: '',
          billed: rows.reduce((sum, row) => sum + row.billed, 0),
          due: rows.reduce((sum, row) => sum + row.due, 0),
          paidInPeriod: 0,
          contact: '',
        },
        'Every student with a balance paid something in this period.',
        picked,
      );
    }

    case 'defaulters': {
      const minimum = Number.isFinite(filters.minDue) ? Math.max(0, filters.minDue) : 0;
      const picked = activeStudents
        .filter((student) => Math.max(0, num(student.fee_balance)) >= minimum && Math.max(0, num(student.fee_balance)) > 0)
        .sort((a, b) => Math.max(0, num(b.fee_balance)) - Math.max(0, num(a.fee_balance)));
      const rows = picked
        .map((student) => ({
          admission: student.admission_number ?? '—',
          student: student.full_name,
          father: student.fathers_name || student.guardian_name || '—',
          classSection: classSection(student.class_name, student.section_name),
          pending: Math.max(0, num(student.fee_balance)),
          paidInPeriod: paidByStudent.get(student.id) ?? 0,
          lastPaid: lastPaidByStudent.has(student.id) ? dateLabel(lastPaidByStudent.get(student.id)) : 'No payment in period',
          contact: contactFor(student),
        }));
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'father', label: 'Father' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'pending', label: 'Pending balance', format: 'money' },
          { key: 'paidInPeriod', label: 'Paid in period', format: 'money' },
          { key: 'lastPaid', label: 'Last payment' },
          { key: 'contact', label: 'Contact / WhatsApp', action: 'remind' },
        ],
        rows,
        {
          admission: 'Total', student: `${rows.length} defaulters`, father: '', classSection: '',
          pending: rows.reduce((sum, row) => sum + row.pending, 0),
          paidInPeriod: rows.reduce((sum, row) => sum + row.paidInPeriod, 0),
          lastPaid: '', contact: '',
        },
        'No student in this scope owes the minimum balance you set.',
        picked,
      );
    }

    case 'cleared': {
      const rows = activeStudents
        .filter((student) => (paidByStudent.get(student.id) ?? 0) > 0 && Math.max(0, num(student.fee_balance)) === 0)
        .map((student) => ({
          admission: student.admission_number ?? '—',
          student: student.full_name,
          classSection: classSection(student.class_name, student.section_name),
          billed: billedByStudent.get(student.id) ?? 0,
          receipts: paidCountByStudent.get(student.id) ?? 0,
          received: paidByStudent.get(student.id) ?? 0,
          lastPaid: lastPaidByStudent.has(student.id) ? dateLabel(lastPaidByStudent.get(student.id)) : '—',
          balance: 'Clear',
        }))
        .sort((a, b) => b.received - a.received);
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'billed', label: 'Billed in period', format: 'money' },
          { key: 'receipts', label: 'Receipts', format: 'number' },
          { key: 'received', label: 'Received in period', format: 'money' },
          { key: 'lastPaid', label: 'Last payment' },
          { key: 'balance', label: 'Balance' },
        ],
        rows,
        {
          admission: 'Total', student: `${rows.length} cleared`, classSection: '',
          billed: rows.reduce((sum, row) => sum + row.billed, 0),
          receipts: rows.reduce((sum, row) => sum + row.receipts, 0),
          received: rows.reduce((sum, row) => sum + row.received, 0),
          lastPaid: '', balance: '',
        },
        'No student was fully cleared in this period.',
      );
    }

    case 'class-collection-pending': {
      const classes = new Map<string, { billed: number; collected: number; pending: number; students: number }>();
      const entryFor = (key: string) => {
        const entry = classes.get(key) ?? { billed: 0, collected: 0, pending: 0, students: 0 };
        classes.set(key, entry);
        return entry;
      };
      for (const challan of challans) entryFor(challan.class_name || 'Unassigned').billed += num(challan.total);
      for (const payment of payments) entryFor(payment.class_name || 'Unassigned').collected += num(payment.amount);
      for (const student of activeStudents) {
        const entry = entryFor(student.class_name || 'Unassigned');
        entry.students += 1;
        entry.pending += Math.max(0, num(student.fee_balance));
      }
      const rows = Array.from(classes.entries()).map(([className, entry]) => ({
        className,
        students: entry.students,
        billed: entry.billed,
        collected: entry.collected,
        pending: entry.pending,
        rate: entry.billed > 0 ? Math.round((entry.collected / entry.billed) * 1000) / 10 : 0,
      })).sort((a, b) => b.pending - a.pending);
      const billed = rows.reduce((sum, row) => sum + row.billed, 0);
      const collected = rows.reduce((sum, row) => sum + row.collected, 0);
      return base(
        [
          { key: 'className', label: 'Class' },
          { key: 'students', label: 'Students', format: 'number' },
          { key: 'billed', label: 'Billed', format: 'money' },
          { key: 'collected', label: 'Collected', format: 'money' },
          { key: 'pending', label: 'Pending', format: 'money' },
          { key: 'rate', label: 'Collected %', format: 'percent' },
        ],
        rows,
        {
          className: 'Total',
          students: rows.reduce((sum, row) => sum + row.students, 0),
          billed,
          collected,
          pending: rows.reduce((sum, row) => sum + row.pending, 0),
          rate: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0,
        },
        'No fee activity in this period.',
      );
    }

    case 'student-collection-balance': {
      // Everything billed up to the end date, less every concession or correction posted
      // against it. That is the fee the student is answerable for by the end of the period.
      const billedTillEnd = new Map<string, number>();
      const adjustedTillEnd = new Map<string, number>();
      const receivedTillEnd = new Map<string, number>();
      // Each student's charges with the date they fell due. The pending balance is aged
      // against these, so every rupee of debt is as old as the charge it came from.
      const chargesByStudent = new Map<string, { due: string; amount: number }[]>();

      // A report built without the cumulative read (for example a test, or a period that
      // started at the beginning of the record) falls back to the period's own rows, so the
      // figures stay honest instead of reading as zero.
      const lifetimeChallans = asArray<FeeChallan>(data?.cumulativeChallans).length > 0
        ? asArray<FeeChallan>(data?.cumulativeChallans)
        : challans;
      const lifetimePayments = asArray<FeePayment>(data?.cumulativePayments).length > 0
        ? asArray<FeePayment>(data?.cumulativePayments)
        : payments;

      for (const challan of lifetimeChallans) {
        if (!matchesScope(challan.class_name, challan.section_name, filters)) continue;
        // A challan carries the arrears of earlier months inside its total, so only this
        // month's own charges are counted. The arrears were billed in the month they belong
        // to and are picked up from that challan instead, never twice.
        const own = Math.max(0, num(challan.total) - Math.max(0, num(challan.arrears)));
        billedTillEnd.set(challan.student_id, (billedTillEnd.get(challan.student_id) ?? 0) + own);
        const charges = chargesByStudent.get(challan.student_id) ?? [];
        charges.push({ due: challan.due_date || challan.created_at, amount: own });
        chargesByStudent.set(challan.student_id, charges);
      }

      // Adjustments are stored signed, so a concession subtracts from what is owed.
      for (const adjustment of asArray<FeeAdjustment>(data?.adjustments)) {
        if (!adjustmentInScope(adjustment)) continue;
        adjustedTillEnd.set(adjustment.student_id, (adjustedTillEnd.get(adjustment.student_id) ?? 0) + num(adjustment.amount));
      }

      // Money that actually stayed with the school. A receipt reversed in the period is
      // money that came back, so it is taken off what was received both inside the period
      // and up to the end date. Both figures use the same rule, which is what lets the
      // three columns of a row add up: fee till end, less received, leaves the balance.
      const receivedInPeriod = new Map<string, number>();
      const netReceived = (payment: FeePayment, into: Map<string, number>) =>
        into.set(payment.student_id, (into.get(payment.student_id) ?? 0) + (payment.voided ? -1 : 1) * num(payment.amount));
      for (const payment of paymentsInScope) netReceived(payment, receivedInPeriod);
      for (const payment of lifetimePayments) {
        if (!matchesScope(payment.class_name, payment.section_name, filters)) continue;
        netReceived(payment, receivedTillEnd);
      }

      // A student belongs in the report when the period touched them, or when they still
      // owe something on the end date. Everyone else would only pad the list with zeroes.
      const inReport = scopedStudents.filter((student) =>
        (billedTillEnd.get(student.id) ?? 0) !== 0
        || (receivedInPeriod.get(student.id) ?? 0) !== 0
        || (adjustedByStudent.get(student.id) ?? 0) !== 0
        || Math.max(0, num(student.fee_balance)) > 0);

      // The class subtotal is worked out from the rows themselves, so the rows above it
      // always add up to the line printed underneath them. Every money column is summed,
      // aging brackets included, so a subtotal can be checked column by column.
      const MONEY_KEYS = ['tillEnd', 'received', 'balance', 'age30', 'age60', 'age90', 'age90plus'];
      const subtotalFor = (entries: FeeReportRow[]): FeeReportRow => {
        const totals: FeeReportRow = {
          admission: '', father: '', classSection: '', share: 0,
          student: `${entries.length} student${entries.length === 1 ? '' : 's'}`,
        };
        for (const key of MONEY_KEYS) totals[key] = entries.reduce((sum, row) => sum + num(row[key]), 0);
        return totals;
      };

      const built: FeeReportRow[] = [];
      const classTotals: { className: string; totals: FeeReportRow }[] = [];

      const classes = Array.from(new Set(inReport.map((student) => student.class_name || 'Unassigned'))).sort();
      for (const className of classes) {
        const inClass = inReport.filter((student) => (student.class_name || 'Unassigned') === className);
        const classRows: FeeReportRow[] = inClass.map((student) => {
          const tillEnd = billedTillEnd.get(student.id) ?? 0;
          const received = receivedInPeriod.get(student.id) ?? 0;
          // One formula for everyone, so a former student's balance is measured the same way
          // as an enrolled one's: what was billed and adjusted, less what was received.
          const balance = Math.max(0, tillEnd + (adjustedTillEnd.get(student.id) ?? 0) - (receivedTillEnd.get(student.id) ?? 0));
          const row: FeeReportRow = {
            admission: student.admission_number ?? '—',
            student: student.full_name,
            father: student.fathers_name || student.guardian_name || '—',
            classSection: classSection(student.class_name, student.section_name),
            tillEnd,
            received,
            share: tillEnd > 0 ? Math.round((received / tillEnd) * 1000) / 10 : 0,
            balance,
            // The balance split by how long it has been owed, aged to the report's end date.
            ...ageBuckets(balance, chargesByStudent.get(student.id) ?? [], filters.to),
          };
          // A part payment is worth pointing out: some money came in, and some is still owed.
          if (received > 0 && balance > 0) row.marker = 'Partial payment';
          return row;
        });
        built.push(...classRows);
        // The last row of a class carries the class name, which is how the table knows where
        // to print that class's subtotal. It is not a column, so it stays out of the export.
        const lastRow = classRows[classRows.length - 1];
        if (lastRow) lastRow.classEnd = className;
        classTotals.push({ className, totals: subtotalFor(classRows) });
      }

      const grand = subtotalFor(built);
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'father', label: 'Father' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'tillEnd', label: 'Total fee till period end', format: 'money' },
          { key: 'received', label: 'Received in period', format: 'money' },
          { key: 'share', label: 'Received %', format: 'percent' },
          { key: 'balance', label: 'Balance', format: 'money' },
          { key: 'age30', label: '0–30 days', format: 'money' },
          { key: 'age60', label: '31–60 days', format: 'money' },
          { key: 'age90', label: '61–90 days', format: 'money' },
          { key: 'age90plus', label: '90+ days', format: 'money' },
        ],
        built,
        {
          // Built from the same helper as the class subtotals, so the grand total can never
          // fall out of step with the rows above it.
          ...grand,
          admission: 'Grand total',
          student: `${built.length} student${built.length === 1 ? '' : 's'} in ${classTotals.length} class${classTotals.length === 1 ? '' : 'es'}`,
          share: num(grand.tillEnd) > 0 ? Math.round((num(grand.received) / num(grand.tillEnd)) * 1000) / 10 : 0,
        },
        'No student in this scope was billed or paid anything in this period.',
        undefined,
        undefined,
        classTotals,
      );
    }

    case 'inactive-dues': {
      const rows = scopedStudents
        .filter((student) => student.status !== 'active' && Math.max(0, num(student.fee_balance)) > 0)
        .map((student) => ({
          admission: student.admission_number ?? '—',
          student: student.full_name,
          father: student.fathers_name || student.guardian_name || '—',
          classSection: classSection(student.class_name, student.section_name),
          status: STATUS_LABELS[student.status] ?? student.status,
          pending: Math.max(0, num(student.fee_balance)),
          contact: contactFor(student),
        }))
        .sort((a, b) => b.pending - a.pending);
      return base(
        [
          { key: 'admission', label: 'Admission no.' },
          { key: 'student', label: 'Student' },
          { key: 'father', label: 'Father' },
          { key: 'classSection', label: 'Class-Section' },
          { key: 'status', label: 'Status' },
          { key: 'pending', label: 'Pending balance', format: 'money' },
          { key: 'contact', label: 'Contact / WhatsApp' },
        ],
        rows,
        {
          admission: 'Total', student: `${rows.length} former students`, father: '', classSection: '',
          status: '', pending: rows.reduce((sum, row) => sum + row.pending, 0), contact: '',
        },
        'No former student in this scope owes a balance.',
      );
    }
  }
}

// One formatted figure for a cell: money as rupees, percentages with a sign, counts
// with thousands separators, everything else as it stands. The CSV export and the
// printed sheet use the same rules through reportCsvRows and the print sheet.
export function reportCell(row: FeeReportRow, column: FeeReportColumn): string {
  const value = row[column.key];
  if (value === undefined || value === null || value === '') return '—';
  switch (column.format) {
    case 'money': return formatMoney(num(value));
    case 'number': return num(value).toLocaleString();
    case 'percent': return `${num(value)}%`;
    default: return String(value);
  }
}

export function reportCsvRows(report: FeeReport, filters: FeeReportFilters): (string | number | null)[][] {
  // Action columns are screen-only (approve/reject buttons, WhatsApp send) and carry no
  // data, so they are left out of the export entirely.
  const columns = report.columns.filter((column) => !column.action);
  const header = [`${report.title} — ${reportPeriodLabel(filters)}`, reportScopeLabel(filters)];
  const body = report.rows.map((row) => columns.map((column) => {
    const value = row[column.key];
    if (value === undefined || value === null) return '';
    if (column.format === 'money' || column.format === 'number' || column.format === 'percent') return num(value);
    return String(value);
  }));
  const totals = report.totals ? [columns.map((column) => {
    const value = report.totals?.[column.key];
    if (value === undefined || value === null) return '';
    if (column.format === 'money' || column.format === 'number' || column.format === 'percent') return num(value);
    return String(value);
  })] : [];
  return [
    header,
    [],
    columns.map((column) => column.label),
    ...body,
    ...totals,
  ];
}

export function reportFileName(id: FeeReportId, filters: FeeReportFilters): string {
  const stamp = `${filters.from || 'start'}_${filters.to || 'end'}`;
  return `fee-${id}-${stamp}.csv`;
}
