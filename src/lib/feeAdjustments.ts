import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

// The kinds of adjustment the office can post against a student's fee account. A
// positive amount increases what the family owes; a negative amount reduces it.
export const ADJUSTMENT_TYPES = [
  { value: 'concession', label: 'Concession', hint: 'A standing reduction, e.g. staff or need-based', direction: 'reduce' },
  { value: 'discount', label: 'Discount', hint: 'A one-off reduction on a bill', direction: 'reduce' },
  { value: 'scholarship', label: 'Scholarship', hint: 'Awarded amount taken off the dues', direction: 'reduce' },
  { value: 'write_off', label: 'Write-off', hint: 'Dues the school has decided not to collect', direction: 'reduce' },
  { value: 'correction', label: 'Correction', hint: 'Fix a figure posted in error, up or down', direction: 'either' },
] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]['value'];

export type FeeAdjustment = {
  id: string;
  student_id: string;
  adjustment_type: AdjustmentType;
  amount: number;
  reason: string | null;
  remarks: string | null;
  effective_date: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  student_name?: string;
  fathers_name?: string | null;
  guardian_name?: string | null;
  class_name?: string | null;
  section_name?: string | null;
  admission_number?: string | null;
  // The category the office filed the reduction under. Null on anything posted before the
  // category picker existed, and on corrections, which add to the dues rather than reduce them.
  category?: string | null;
};

const ADJUSTMENT_COLUMNS = 'id, student_id, adjustment_type, amount, reason, remarks, category, effective_date, entry_date, created_at, updated_at, created_by, updated_by';

export const adjustmentLabel = (type: string) =>
  ADJUSTMENT_TYPES.find((entry) => entry.value === type)?.label ?? type;

// The signed figure a type posts: reductions are stored negative, a correction keeps
// the sign the office typed.
export function adjustmentAmountFor(type: AdjustmentType, amount: number): number {
  const direction = ADJUSTMENT_TYPES.find((entry) => entry.value === type)?.direction ?? 'reduce';
  return direction === 'either' ? amount : -Math.abs(amount);
}

// Every adjustment posted against one student, newest first, for their ledger.
export async function fetchAdjustmentsForStudent(studentId: string): Promise<{ adjustments: FeeAdjustment[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_fee_adjustments')
      .select(ADJUSTMENT_COLUMNS)
      .eq('student_id', studentId)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return { adjustments: [], error: 'The fee adjustments could not be loaded.' };
    return { adjustments: (data ?? []) as FeeAdjustment[], error: null };
  } catch {
    return { adjustments: [], error: 'The fee adjustments could not be loaded. Check your connection and try again.' };
  }
}

// A read is only ever handed back as an array. A payload that is missing or not a list
// becomes an empty list, so the reports that read it cannot throw while filtering.
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// Every adjustment posted between two dates, oldest first. The reports read this rather
// than the single-date list so one range covers the whole period.
export async function fetchAdjustmentsInRange(from: string, to: string, limit = 5000): Promise<{ adjustments: FeeAdjustment[]; error: string | null }> {
  try {
    let query = supabase.from('school_fee_adjustments').select(ADJUSTMENT_COLUMNS);
    if (from) query = query.gte('entry_date', from);
    if (to) query = query.lte('entry_date', to);
    const { data, error } = await query.order('entry_date', { ascending: true }).limit(limit);
    if (error) return { adjustments: [], error: 'The fee adjustments could not be loaded.' };
    return { adjustments: list<FeeAdjustment>(data), error: null };
  } catch {
    return { adjustments: [], error: 'The fee adjustments could not be loaded. Check your connection and try again.' };
  }
}

// Every adjustment filed under one posted date, oldest first, so the day reads in the
// order the office worked through it. This is the datewise list's source.
export async function fetchAdjustmentsForDate(date: string): Promise<{ adjustments: FeeAdjustment[]; error: string | null }> {
  if (!date) return { adjustments: [], error: null };
  try {
    const { data, error } = await supabase
      .from('school_fee_adjustments')
      .select(ADJUSTMENT_COLUMNS)
      .eq('entry_date', date)
      .order('created_at', { ascending: true });
    if (error) return { adjustments: [], error: 'The adjustments for this date could not be loaded.' };
    return { adjustments: (data ?? []) as FeeAdjustment[], error: null };
  } catch {
    return { adjustments: [], error: 'The adjustments for this date could not be loaded. Check your connection and try again.' };
  }
}

// The datewise posted-adjustments report laid out as spreadsheet rows: a header, one
// row per adjustment, and the day's total at the foot. Amounts are exported as plain
// signed numbers so Excel adds the column up instead of reading them as text.
export type FeeAdjustmentExportRow = (string | number | null)[];

export function adjustmentExportRows(adjustments: FeeAdjustment[], postedDate: string): FeeAdjustmentExportRow[] {
  const total = adjustments.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
  return [
    ['Admission no.', 'Student', 'Father', 'Class', 'Section', 'Type', 'Remarks', 'Amount (Rs)', 'Posted date'],
    ...adjustments.map((row) => [
      row.admission_number ?? '',
      row.student_name ?? '',
      row.fathers_name ?? row.guardian_name ?? '',
      row.class_name ?? '',
      row.section_name ?? '',
      adjustmentLabel(row.adjustment_type),
      row.reason ?? row.remarks ?? '',
      Number(row.amount),
      row.entry_date || postedDate,
    ]),
    ['', '', '', '', '', '', 'Total adjusted', total, ''],
  ];
}

export function adjustmentExportFilename(postedDate: string): string {
  return `fee-adjustments-${postedDate || 'report'}.csv`;
}

// Posts an adjustment and returns the student's recomputed balance. The database
// checks the caller is fee staff and does the write inside one transaction.
export async function createFeeAdjustment(input: {
  studentId: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  effectiveDate: string;
  category?: string;
}): Promise<{ id: string | null; error: string | null }> {
  if (!input.studentId) return { id: null, error: 'Choose a student first.' };
  if (!Number.isFinite(input.amount) || input.amount === 0) return { id: null, error: 'Enter an adjustment amount other than zero.' };
  if (Math.abs(input.amount) > 10000000) return { id: null, error: 'That adjustment amount is too large.' };
  try {
    const { data, error } = await supabase.rpc('create_fee_adjustment', {
      p_student_id: input.studentId,
      p_adjustment_type: input.adjustmentType,
      p_amount: input.amount,
      p_reason: input.reason.trim() || null,
      p_effective_date: input.effectiveDate || null,
      p_category: input.category || null,
    });
    if (error) {
      if (error.code === 'P0001' && error.message) return { id: null, error: error.message };
      return { id: null, error: 'The adjustment could not be saved. Please try again.' };
    }
    return { id: (data as string | null) ?? null, error: null };
  } catch {
    return { id: null, error: 'The adjustment could not be saved. Check your connection and try again.' };
  }
}

// Corrects a posted adjustment in place. The database keeps a history row of the
// previous figures and recalculates the student's balance in the same transaction.
export async function updateFeeAdjustment(input: {
  id: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  entryDate: string;
  category?: string;
}): Promise<string | null> {
  if (!input.id) return 'Choose an adjustment to edit first.';
  if (!Number.isFinite(input.amount) || input.amount === 0) return 'Enter an adjustment amount other than zero.';
  if (Math.abs(input.amount) > 10000000) return 'That adjustment amount is too large.';
  try {
    const { error } = await supabase.rpc('update_fee_adjustment', {
      p_id: input.id,
      p_adjustment_type: input.adjustmentType,
      p_amount: input.amount,
      p_reason: input.reason.trim() || null,
      p_entry_date: input.entryDate || null,
      p_category: input.category || null,
    });
    if (error) {
      if (error.code === 'P0001' && error.message) return error.message;
      return 'The adjustment could not be updated. Please try again.';
    }
    return null;
  } catch {
    return 'The adjustment could not be updated. Check your connection and try again.';
  }
}

export async function deleteFeeAdjustment(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('delete_fee_adjustment', { p_id: id });
    return error ? 'The adjustment could not be removed.' : null;
  } catch {
    return 'The adjustment could not be removed. Check your connection and try again.';
  }
}

// Sets a student's carried-forward opening balance and returns nothing; the caller
// reloads the roster to pick up the recomputed fee_balance.
export async function setFeeOpeningBalance(input: {
  studentId: string;
  amount: number;
  asOf: string;
}): Promise<string | null> {
  if (!input.studentId) return 'Choose a student first.';
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 10000000) {
    return 'Enter a valid opening balance.';
  }
  try {
    const { error } = await supabase.rpc('set_fee_opening_balance', {
      p_student_id: input.studentId,
      p_amount: input.amount,
      p_as_of: input.asOf || null,
    });
    if (error) {
      if (error.code === 'P0001' && error.message) return error.message;
      return 'The opening balance could not be saved. Please try again.';
    }
    return null;
  } catch {
    return 'The opening balance could not be saved. Check your connection and try again.';
  }
}

// Groups the roster into family clusters by shared guardian phone, shared guardian
// CNIC, or an identical father/guardian name — the three signals the school records
// that reliably identify brothers and sisters. Students in more than one cluster are
// merged, so a family with several matching signals still appears once.
export type SiblingSignals = { phone: string; cnic: string; name: string };

export type SiblingSignalSource = {
  guardian_phone?: string | null;
  father_contact_number?: string | null;
  messaging_number?: string | null;
  whatsapp_number?: string | null;
  guardian_cnic?: string | null;
  fathers_cnic?: string | null;
  guardian_name?: string | null;
  fathers_name?: string | null;
};

// The three family signals, normalised the same way everywhere they are compared: a
// phone without its leading zero, a CNIC without punctuation, a lower-cased name.
export function siblingSignalsFor(source: SiblingSignalSource): SiblingSignals {
  return {
    phone: digitsFrom(source.guardian_phone, source.father_contact_number, source.messaging_number, source.whatsapp_number),
    cnic: digitsFrom(source.fathers_cnic, source.guardian_cnic),
    name: nameFrom(source.fathers_name, source.guardian_name),
  };
}

// Blank-looking entries — dashes, "N/A" and friends — are never read as a family
// signal, so two unrelated students who both left a field empty are not merged.
const isPlaceholder = (value: string) => /^(|-+|n\/?a\.?|na|nil|none|null)$/i.test(value.trim());

// The first field that carries a real value wins, so a child whose guardian phone is
// "N/A" is still matched on the WhatsApp number typed further along the record.
const digitsFrom = (...values: (string | null | undefined)[]) => {
  for (const value of values) {
    const digits = (value ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length >= 10) return digits;
  }
  return '';
};

const nameFrom = (...values: (string | null | undefined)[]) => {
  for (const value of values) {
    const name = (value ?? '').trim();
    if (name !== '' && !isPlaceholder(name)) return name.toLowerCase();
  }
  return '';
};

export type SiblingGroup = {
  key: string;
  reason: string;
  students: Student[];
  combinedBalance: number;
};

// Brothers and sisters are counted in the order the family joined the school: the
// earliest admission date is the first child, ties broken by the admission number's
// trailing digits, then by name. Every screen that ranks a child uses this comparator
// so the discount for "Child 2" lands on the same student everywhere.
export function compareSiblingOrder(a: Student, b: Student): number {
  const dateA = a.admission_date ?? '';
  const dateB = b.admission_date ?? '';
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  const seqA = Number((a.admission_number ?? '').match(/(\d+)$/)?.[1] ?? 0);
  const seqB = Number((b.admission_number ?? '').match(/(\d+)$/)?.[1] ?? 0);
  if (seqA !== seqB) return seqA - seqB;
  return (a.full_name ?? '').localeCompare(b.full_name ?? '');
}

export function findSiblingGroups(students: Student[]): SiblingGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const seen = parent.get(id);
    if (!seen || seen === id) { parent.set(id, id); return id; }
    const root = find(seen);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const student of students) parent.set(student.id, student.id);

  // Signal -> the student ids that share it.
  const byPhone = new Map<string, string[]>();
  const byCnic = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), id]);
  };

  for (const student of students) {
    const signals = siblingSignalsFor(student);
    push(byPhone, signals.phone.length >= 10 ? signals.phone : '', student.id);
    push(byCnic, signals.cnic.length >= 10 ? signals.cnic : '', student.id);
    // Four letters and up: short enough for fathers like "Abid", long enough that a
    // stray two-letter entry cannot swallow unrelated families.
    push(byName, signals.name.length >= 4 ? signals.name : '', student.id);
  }

  const link = (map: Map<string, string[]>) => {
    for (const ids of map.values()) {
      for (let i = 1; i < ids.length; i += 1) union(ids[0], ids[i]);
    }
  };
  link(byPhone);
  link(byCnic);
  link(byName);

  const groups = new Map<string, Student[]>();
  for (const student of students) {
    const root = find(student.id);
    groups.set(root, [...(groups.get(root) ?? []), student]);
  }

  const reasonsFor = (members: Student[]): string => {
    const reasons: string[] = [];
    const signals = members.map((member) => siblingSignalsFor(member));
    const shares = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const key of values) {
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.values()).some((count) => count > 1 && count === values.length);
    };
    if (shares(signals.map((s) => s.phone))) reasons.push('same guardian phone');
    if (shares(signals.map((s) => s.cnic))) reasons.push('same guardian CNIC');
    if (shares(signals.map((s) => s.name))) reasons.push('same father / guardian name');
    return reasons.length > 0 ? reasons.join(', ') : 'linked record';
  };

  return Array.from(groups.entries())
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const sorted = [...members].sort(compareSiblingOrder);
      return {
        key,
        reason: reasonsFor(sorted),
        students: sorted,
        combinedBalance: sorted.reduce((total, student) => total + Math.max(0, Number(student.fee_balance ?? 0)), 0),
      };
    })
    .sort((a, b) => b.students.length - a.students.length || b.combinedBalance - a.combinedBalance);
}
