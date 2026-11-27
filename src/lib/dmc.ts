export type DmcMarksRow = { subject: string; total_marks: string; obtained_marks: string };

export type DmcDraft = {
  term: string;
  session: string;
  period_start: string;
  period_end: string;
  remarks: string;
};

const MARK_ROWS = 8;

export function createDmcDraft(start: string, end: string): DmcDraft {
  const year = new Date(`${start}T00:00:00`).getFullYear();
  const sessionStart = Number.isNaN(year) ? new Date().getFullYear() : year;
  return {
    term: 'Annual',
    session: `${sessionStart}-${sessionStart + 1}`,
    period_start: start,
    period_end: end,
    remarks: '',
  };
}

export function createMarksRows(count = MARK_ROWS): DmcMarksRow[] {
  return Array.from({ length: count }, () => ({ subject: '', total_marks: '', obtained_marks: '' }));
}
