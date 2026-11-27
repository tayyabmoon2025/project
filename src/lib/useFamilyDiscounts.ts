import { useEffect, useMemo, useState } from 'react';
import { fetchSiblingDiscountRules, resolveFamilyDiscounts, type FamilyDiscount, type SiblingDiscountRule } from '@/lib/feeDiscountRules';
import type { Student } from '@/lib/schoolTypes';

export type FamilyDiscountLookup = {
  rules: SiblingDiscountRule[];
  loading: boolean;
  // The family discount for one student. A student who is not on the roster, or who has
  // no brothers and sisters, reads as the first child and carries no discount.
  discountFor: (student: Student) => FamilyDiscount;
  // The percentage alone, for the helpers that only need the figure.
  percentageFor: (student: Student) => number;
};

const NO_DISCOUNT: FamilyDiscount = { percentage: 0, ruleLabel: null, siblingOrder: 1, matched: false };

// The sibling discount is decided once for the whole roster and read back by id, so the
// challan screen, the ledger, the collection summary and the reports cannot disagree
// about which child gets what. The rules themselves come from Fee Structure.
export function useFamilyDiscounts(roster: Student[]): FamilyDiscountLookup {
  const [rules, setRules] = useState<SiblingDiscountRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchSiblingDiscountRules().then((result) => {
      if (cancelled) return;
      setRules(result.rules);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const resolved = useMemo(() => resolveFamilyDiscounts(roster, rules), [roster, rules]);

  return useMemo(() => ({
    rules,
    loading,
    discountFor: (student: Student) => resolved.get(student.id) ?? NO_DISCOUNT,
    percentageFor: (student: Student) => (resolved.get(student.id) ?? NO_DISCOUNT).percentage,
  }), [rules, loading, resolved]);
}
