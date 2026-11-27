// Student ID cards.
//
// Every card is drawn at the exact ISO/IEC 7810 CR80 size — 85.6 mm x 54 mm landscape,
// 54 mm x 85.6 mm portrait — so a printed card slides straight into a PVC holder or a
// lamination pouch without trimming. The same templates drive both the on-screen
// gallery and the print sheet, so what the office clicks is what comes out of the
// printer.

import type { Student } from '@/lib/schoolTypes';

export type CardOrientation = 'landscape' | 'portrait';

export type StudentIdTemplate = {
  key: string;
  name: string;
  orientation: CardOrientation;
  // One line describing the look, shown under the preview in the gallery.
  blurb: string;
};

export const STUDENT_ID_TEMPLATES: StudentIdTemplate[] = [
  { key: 'cobalt', name: 'Electric Cobalt & Gold', orientation: 'landscape', blurb: 'Deep royal blue with a bright gold accent strip' },
  { key: 'emerald', name: 'Emerald Scholar', orientation: 'landscape', blurb: 'Sharp emerald green wave on dark slate' },
  { key: 'crimson', name: 'Crimson & Midnight', orientation: 'landscape', blurb: 'Rich navy header with a vibrant crimson badge' },
  { key: 'indigo', name: 'Royal Indigo Lanyard', orientation: 'portrait', blurb: 'Indigo-to-sky gradient arc and a circular photo frame' },
  { key: 'coral', name: 'Sunset Coral & Navy', orientation: 'portrait', blurb: 'Midnight navy header with a coral accent stripe' },
  { key: 'teal', name: 'Teal & Charcoal Modern', orientation: 'portrait', blurb: 'Teal wave, crisp white centre, charcoal footer' },
];

export const DEFAULT_STUDENT_ID_TEMPLATE = 'cobalt';

export const DEFAULT_ACADEMIC_SESSION = '2026-2027';
export const DEFAULT_CARD_EXPIRY = '2027-03-31';

export const CARD_FILTERS: { id: 'all' | CardOrientation; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'landscape', label: 'Horizontal / Landscape' },
  { id: 'portrait', label: 'Vertical / Portrait' },
];

export const templateByKey = (key: string): StudentIdTemplate =>
  STUDENT_ID_TEMPLATES.find((template) => template.key === key) ?? STUDENT_ID_TEMPLATES[0];

// "2027-03-31" reads as "31 Mar 2027" on the card. An unparseable value is shown as it
// was typed rather than as an invalid date.
export function formatCardDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The card prints a clean "01" even when the roll number was typed without padding.
export const cardRollNumber = (student: Student): string => (student.roll_number ?? '').trim() || '—';

// ---------------------------------------------------------------------------
// Remembered choices
// ---------------------------------------------------------------------------
// The session and expiry only change once a year, so the last-used values are kept
// between visits rather than typed again for every batch.

const SESSION_KEY = 'schooldesk_student_id_session';
const EXPIRY_KEY = 'schooldesk_student_id_expiry';
const TEMPLATE_KEY = 'schooldesk_student_id_template';

const readStored = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key)?.trim() || fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in a private window; the defaults still work.
  }
};

export const storedAcademicSession = (): string => readStored(SESSION_KEY, DEFAULT_ACADEMIC_SESSION);
export const storedCardExpiry = (): string => readStored(EXPIRY_KEY, DEFAULT_CARD_EXPIRY);
export const storedCardTemplate = (): string => readStored(TEMPLATE_KEY, DEFAULT_STUDENT_ID_TEMPLATE);

export const rememberCardSettings = (settings: { session: string; expiry: string; templateKey: string }) => {
  writeStored(SESSION_KEY, settings.session.trim());
  writeStored(EXPIRY_KEY, settings.expiry.trim());
  writeStored(TEMPLATE_KEY, settings.templateKey);
};
