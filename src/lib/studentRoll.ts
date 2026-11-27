import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

// Which identifier the marks sheets show and search by. "Both" is the default so a
// teacher can always find a child by whichever number they have to hand.
export type IdentifierMode = 'roll' | 'admission' | 'both';

export const IDENTIFIER_MODES: { id: IdentifierMode; label: string }[] = [
  { id: 'roll', label: 'Roll No.' },
  { id: 'admission', label: 'Admission No.' },
  { id: 'both', label: 'Both' },
];

export const identifierColumnLabel = (mode: IdentifierMode): string => {
  if (mode === 'roll') return 'Roll no.';
  if (mode === 'admission') return 'Admission no.';
  return 'Roll / Admission no.';
};

const rollOf = (student: Student): string => (student.roll_number ?? '').trim();

export const rollLabel = (student: Student): string => rollOf(student) || '—';

export const admissionLabel = (student: Student): string => (student.admission_number ?? '').trim() || '—';

// Search matches the identifiers the sheet is actually showing, so the box never
// hides a student the teacher can plainly see in the column.
export const matchesIdentifier = (student: Student, mode: IdentifierMode, term: string): boolean => {
  if (!term) return true;
  const needle = term.toLowerCase();
  const name = student.full_name.toLowerCase();
  if (mode === 'roll') return name.includes(needle) || rollOf(student).toLowerCase().includes(needle);
  if (mode === 'admission') return name.includes(needle) || (student.admission_number ?? '').toLowerCase().includes(needle);
  return name.includes(needle)
    || rollOf(student).toLowerCase().includes(needle)
    || (student.admission_number ?? '').toLowerCase().includes(needle);
};

// The roll number leads the order; a student who has not been numbered yet sorts by
// name after those who have, so the sheet reads 01, 02, 03, then the stragglers.
export function compareRoster(a: Student, b: Student): number {
  const aRoll = rollOf(a);
  const bRoll = rollOf(b);
  if (aRoll && bRoll) return aRoll.localeCompare(bRoll, undefined, { numeric: true });
  if (aRoll) return -1;
  if (bRoll) return 1;
  return a.full_name.localeCompare(b.full_name, undefined, { numeric: true });
}

// How the office wants a class re-sequenced. Alphabetical suits the usual class
// register; admission number order keeps the numbers steady as children join mid-year.
export type RollSortOrder = 'name' | 'admission';

export const ROLL_SORT_ORDERS: { id: RollSortOrder; label: string }[] = [
  { id: 'name', label: 'Alphabetical by Name (A–Z)' },
  { id: 'admission', label: 'By Admission No. / Date' },
];

// The two sequences schools actually use: a plain 01, 02, 03, or a 101, 102, 103
// block for classes that continue the numbering on from another group.
export const ROLL_START_CHOICES = [1, 101] as const;

const digitsOf = (value: string): number => Number(value.match(/(\d+)$/)?.[1] ?? 0);

// The order the new numbers are handed out in. Ties fall back to admission number so
// two children with the same name still come out in a stable, repeatable order.
export function sortForRollAssignment(students: Student[], order: RollSortOrder): Student[] {
  return [...students].sort((a, b) => {
    if (order === 'admission') return digitsOf(a.admission_number) - digitsOf(b.admission_number);
    return a.full_name.localeCompare(b.full_name, undefined, { numeric: true })
      || digitsOf(a.admission_number) - digitsOf(b.admission_number);
  });
}

export const nextRollNumber = (start: number, index: number, width = 2): string => String(start + index).padStart(width, '0');

export type RollAssignResult = { assigned: number; error: string | null };

// Fills in the missing roll numbers for one class. A roll number already typed in by
// the office is never touched, and a number it already uses is never handed out twice.
export async function ensureClassRollNumbers(className: string): Promise<RollAssignResult> {
  if (!className.trim()) return { assigned: 0, error: null };
  const { data, error } = await supabase.rpc('ensure_class_roll_numbers', { p_class_name: className });
  if (error) return { assigned: 0, error: 'Roll numbers could not be generated for this class.' };
  return { assigned: Number(data ?? 0), error: null };
}

// Writes the whole sequence in one call. The ids arrive in the order the preview showed,
// so the numbers saved are exactly the numbers the office agreed to. Anything that has
// left the class since the preview was opened is skipped by the database function.
export async function bulkAssignRollNumbers(
  className: string,
  sectionName: string,
  orderedIds: string[],
  start: number,
): Promise<RollAssignResult> {
  if (!className.trim() || orderedIds.length === 0) return { assigned: 0, error: null };
  const { data, error } = await supabase.rpc('bulk_assign_roll_numbers', {
    p_class_name: className,
    p_section_name: sectionName,
    p_student_ids: orderedIds,
    p_start: start,
  });
  if (error) return { assigned: 0, error: 'The new roll numbers could not be saved. Please try again.' };
  return { assigned: Number(data ?? 0), error: null };
}

// Runs the numbering once per class (and again if students are added later), then
// asks the shared roster to reload so the new numbers appear on the sheet. Passing no
// class name numbers every class that still has an unnumbered student, which is what
// the Examinations module does when it is opened.
export function useAutoRollNumbers(
  className: string,
  students: Student[],
  refresh: () => Promise<void>,
): { pending: boolean; error: string | null } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef('');

  const missing = students.filter((student) => (
    student.status === 'active'
    && (!className || student.class_name === className)
    && !rollOf(student)
  ));
  const missingByClass = new Map<string, string[]>();
  for (const student of missing) {
    const ids = missingByClass.get(student.class_name) ?? [];
    ids.push(student.id);
    missingByClass.set(student.class_name, ids);
  }
  const missingKey = Array.from(missingByClass.entries())
    .map(([klass, ids]) => `${klass}:${ids.sort().join(',')}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!missingKey) return;
    if (attemptedRef.current === missingKey) return;
    attemptedRef.current = missingKey;
    const classNames = Array.from(missingByClass.keys());
    let cancelled = false;
    void (async () => {
      setPending(true);
      let firstError: string | null = null;
      let assigned = 0;
      for (const klass of classNames) {
        const result = await ensureClassRollNumbers(klass);
        if (result.error && !firstError) firstError = result.error;
        assigned += result.assigned;
      }
      if (cancelled) return;
      setError(firstError);
      if (!firstError && assigned > 0) await refresh();
      if (!cancelled) setPending(false);
    })();
    return () => { cancelled = true; };
  // missingByClass is derived from missingKey; re-running on the key keeps this stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, refresh]);

  return { pending, error };
}
