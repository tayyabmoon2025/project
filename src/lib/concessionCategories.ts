// The categories a concession or discount is filed under. One list, shared by the student
// record, the Fee Adjustment screen and the Fee Concessions & Discounts report, so a
// reduction is assigned and reported under exactly the same name.
//
// Sibling is deliberately absent. A brother or sister discount is never chosen by hand: it
// is worked out from the family groups and the Fee Structure "Brothers and sisters" rules
// and applied on its own, so offering it here would let the same reduction be recorded
// twice. The report still shows it, which is why the report's own list adds it below.
export const CONCESSION_CATEGORY_OPTIONS = [
  { value: 'orphan', label: 'Orphan' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'staff', label: "Teacher's son / Staff" },
  { value: 'concession', label: 'Concession (standing / agreed)' },
  { value: 'discount', label: 'Discount' },
  { value: 'write_off', label: 'Write-off' },
  { value: 'other', label: 'Other reduction' },
] as const;

// The report's dropdown leads with "All categories", so the list it renders is this one
// with the empty choice in front and Sibling offered for the family discounts.
export const FEE_CONCESSION_CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'All categories' },
  { value: 'sibling', label: 'Sibling' },
  ...CONCESSION_CATEGORY_OPTIONS,
];

// A reduction filed as "sibling" is never read as a sibling discount. The family discount
// comes from the rules, so a record that carries the old value is treated as a plain
// concession instead of being counted a second time.
export const concessionCategoryLabel = (value: string): string =>
  FEE_CONCESSION_CATEGORIES.find((entry) => entry.value === value)?.label ?? value;

// The words that name a category when a remark is typed by hand. Only used as a fallback
// for reductions posted before a category could be picked, or where the wording is more
// specific than the category chosen.
const CONCESSION_KEYWORDS: { key: string; words: string[] }[] = [
  { key: 'orphan', words: ['orphan', 'yateem', 'widow'] },
  { key: 'scholarship', words: ['scholarship', 'merit', 'talent', 'position holder'] },
  { key: 'staff', words: ['staff', 'teacher', 'faculty', 'employee', 'principal', 'ward'] },
  { key: 'sibling', words: ['sibling', 'brother', 'sister'] },
];

// A colour theme for each category, so the concession card on the admission form takes on
// the tone of the reduction being given rather than a single fixed colour. The classes are
// Tailwind utilities that work inside the admission form's light surface.
export type ConcessionCategoryTheme = {
  border: string;
  bg: string;
  icon: string;
  title: string;
  sub: string;
};

export const CONCESSION_CATEGORY_THEMES: Record<string, ConcessionCategoryTheme> = {
  '': { border: 'border-slate-200', bg: 'bg-slate-50/60', icon: 'text-slate-500', title: 'text-slate-700', sub: 'text-slate-500' },
  orphan: { border: 'border-amber-300', bg: 'bg-amber-50/70', icon: 'text-amber-700', title: 'text-amber-900', sub: 'text-amber-800' },
  scholarship: { border: 'border-blue-300', bg: 'bg-blue-50/70', icon: 'text-blue-700', title: 'text-blue-900', sub: 'text-blue-800' },
  staff: { border: 'border-teal-300', bg: 'bg-teal-50/70', icon: 'text-teal-700', title: 'text-teal-900', sub: 'text-teal-800' },
  concession: { border: 'border-sky-300', bg: 'bg-sky-50/70', icon: 'text-sky-700', title: 'text-sky-900', sub: 'text-sky-800' },
  discount: { border: 'border-rose-300', bg: 'bg-rose-50/70', icon: 'text-rose-700', title: 'text-rose-900', sub: 'text-rose-800' },
  write_off: { border: 'border-slate-400', bg: 'bg-slate-100/80', icon: 'text-slate-600', title: 'text-slate-800', sub: 'text-slate-600' },
  other: { border: 'border-cyan-300', bg: 'bg-cyan-50/70', icon: 'text-cyan-700', title: 'text-cyan-900', sub: 'text-cyan-800' },
};

export const concessionCategoryTheme = (value: string): ConcessionCategoryTheme =>
  CONCESSION_CATEGORY_THEMES[value] ?? CONCESSION_CATEGORY_THEMES[''];

// Categories that need a principal's sign-off before the concession takes effect. A
// staff member can assign them, but the fee concession will be held as pending until an
// administrator approves it. Plain concessions, discounts and write-offs do not need one.
export const APPROVAL_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set(['orphan', 'scholarship', 'staff']);

export const concessionNeedsApproval = (category: string | null | undefined): boolean =>
  Boolean(category && APPROVAL_REQUIRED_CATEGORIES.has(category));

export const concessionCategoriesFor = (text: string | null | undefined): string[] => {
  const haystack = (text ?? '').toLowerCase();
  if (!haystack) return [];
  return CONCESSION_KEYWORDS.filter((entry) => entry.words.some((word) => haystack.includes(word))).map((entry) => entry.key);
};
