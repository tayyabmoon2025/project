import { supabase } from '@/lib/supabase';
import { compareSiblingOrder, findSiblingGroups, siblingSignalsFor, type SiblingGroup, type SiblingSignalSource } from '@/lib/feeAdjustments';
import type { Student } from '@/lib/schoolTypes';

// One row per child number in a family. The first child gets no sibling discount, so
// the rules start at the second child.
export type SiblingDiscountRule = {
  id: string;
  sibling_order: number;
  discount_percentage: number;
  label: string | null;
  updated_at?: string;
};

export type SiblingContext = {
  groupSize: number;
  siblingOrder: number;
  discountPercentage: number;
  ruleLabel: string | null;
  matchedReason: string | null;
  // The whole family in sibling order, with the student on the form included, so the
  // admission screen can show the family's combined fee position.
  students: Student[];
  candidateIndex: number;
};

const RULE_COLUMNS = 'id, sibling_order, discount_percentage, label, updated_at';

export async function fetchSiblingDiscountRules(): Promise<{ rules: SiblingDiscountRule[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_fee_discount_rules')
      .select(RULE_COLUMNS)
      .order('sibling_order');
    if (error) return { rules: [], error: 'The sibling discount rules could not be loaded.' };
    return { rules: (data ?? []) as SiblingDiscountRule[], error: null };
  } catch {
    return { rules: [], error: 'The sibling discount rules could not be loaded. Check your connection and try again.' };
  }
}

export async function saveSiblingDiscountRule(input: { id: string; discountPercentage: number }): Promise<string | null> {
  if (!Number.isFinite(input.discountPercentage) || input.discountPercentage < 0 || input.discountPercentage > 100) {
    return 'Enter a sibling discount between 0 and 100.';
  }
  try {
    const { error } = await supabase
      .from('school_fee_discount_rules')
      .update({ discount_percentage: input.discountPercentage, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    return error ? 'The sibling discount could not be saved. Please try again.' : null;
  } catch {
    return 'The sibling discount could not be saved. Check your connection and try again.';
  }
}

// The rule for a given child number is the highest one recorded at or below it, so a
// "fourth child onwards" rule also covers the fifth and sixth child.
export function discountForSiblingOrder(rules: SiblingDiscountRule[], order: number): SiblingDiscountRule | null {
  const applicable = rules
    .filter((rule) => Number(rule.sibling_order) <= order)
    .sort((a, b) => Number(b.sibling_order) - Number(a.sibling_order));
  return applicable[0] ?? null;
}

type FamilyMember = { id?: string; admission_number?: string; full_name?: string };

export type SiblingCandidate = SiblingSignalSource & FamilyMember;

export type SiblingContextInput = {
  candidate: SiblingCandidate;
  // The family groups to match against, which may be the roster with the student under
  // edit swapped back in for the edited version of their own record.
  groups: SiblingGroup[];
  rules: SiblingDiscountRule[];
};

// Works out which child of their family this student is, using the same family groups
// the Brother & Sister tab shows. Children are ordered chronologically — earliest
// admission date first, ties broken by the admission number — so the child who joined
// the school first counts as the first child. The candidate is only counted once: their
// stored roster row is dropped and the version typed on the form takes its place.
export function siblingContextFor({ candidate, groups, rules }: SiblingContextInput): SiblingContext {
  const signals = siblingSignalsFor(candidate);
  const group = groups.find((entry) => entry.students.some((member) => {
    const other = siblingSignalsFor(member);
    return (signals.phone.length >= 10 && other.phone === signals.phone)
      || (signals.cnic.length >= 10 && other.cnic === signals.cnic)
      || (signals.name.length >= 4 && other.name === signals.name);
  }));

  const self = candidate as unknown as Student;
  if (!group) {
    return { groupSize: 1, siblingOrder: 1, discountPercentage: 0, ruleLabel: null, matchedReason: null, students: [self], candidateIndex: 0 };
  }

  // The stored record of the student being edited is dropped so it is not counted twice;
  // the details currently on the form take its place in the family. For a brand-new
  // admission the candidate object itself is already in the group, so it is dropped by
  // reference as well.
  const siblings = group.students.filter((member) => member !== self && !(candidate.id ? member.id === candidate.id : false));
  const ordered = [...siblings, self].sort(compareSiblingOrder);

  const index = ordered.findIndex((member) => member === self);
  const siblingOrder = index < 0 ? ordered.length : index + 1;

  const rule = discountForSiblingOrder(rules, siblingOrder);
  return {
    groupSize: Math.max(ordered.length, group.students.length),
    siblingOrder,
    discountPercentage: rule ? Number(rule.discount_percentage) : 0,
    ruleLabel: rule?.label ?? null,
    matchedReason: group.reason,
    students: ordered,
    candidateIndex: index < 0 ? ordered.length - 1 : index,
  };
}

// The sibling discount is never typed in by hand. It follows the Fee Structure "Brothers
// and sisters" rules and the family a student belongs to, which is worked out from the
// same three signals the Brother & Sister tab groups on: a shared guardian phone, a shared
// CNIC, or a shared father / guardian name. This resolver works the whole roster out in one
// pass and hands back each student's percentage, so the fee screens, the challans, the
// ledger and the reports all read the same answer instead of each deciding for themselves.
export type FamilyDiscount = { percentage: number; ruleLabel: string | null; siblingOrder: number; matched: boolean };

const NO_FAMILY_DISCOUNT: FamilyDiscount = { percentage: 0, ruleLabel: null, siblingOrder: 1, matched: false };

export function resolveFamilyDiscounts(roster: Student[], rules: SiblingDiscountRule[]): Map<string, FamilyDiscount> {
  const resolved = new Map<string, FamilyDiscount>();
  if (roster.length === 0) return resolved;
  // Every student starts as the first child, so a student with no brothers and sisters
  // on the roll is always readable and always carries no discount.
  for (const student of roster) resolved.set(student.id, NO_FAMILY_DISCOUNT);
  if (rules.length === 0) return resolved;
  for (const group of findSiblingGroups(roster)) {
    const ordered = [...group.students].sort(compareSiblingOrder);
    ordered.forEach((student, index) => {
      const siblingOrder = index + 1;
      const rule = discountForSiblingOrder(rules, siblingOrder);
      resolved.set(student.id, {
        percentage: rule ? Math.max(0, Number(rule.discount_percentage) || 0) : 0,
        ruleLabel: rule?.label ?? null,
        siblingOrder,
        matched: true,
      });
    });
  }
  return resolved;
}
