import { toCsv } from '@/lib/fees';
import { SCHOOL_NAME } from '@/lib/noticeText';
import type { FamilyLedger, FamilyLedgerRow } from '@/lib/familyLedger';

// Who the statement is addressed to, taken from the admission form so the family sees
// their own name and contact details on the printed copy.
export type FamilyStatementInfo = {
  guardianName: string;
  guardianPhone: string;
  guardianCnic: string;
  preparedFor: string;
  matchedReason: string | null;
};

export const statementDate = (date: Date = new Date()) =>
  date.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });

export const statementChildName = (row: FamilyLedgerRow) => row.name || 'New student';

export const statementMoney = (value: number) => Math.round(Number(value) || 0);

const HEADINGS = [
  'Child',
  'Student',
  'Admission no.',
  'Class',
  'Tuition (Rs)',
  'Concession (Rs)',
  'Sibling discount (Rs)',
  'Sibling %',
  'Net tuition (Rs)',
  'Monthly charge (Rs)',
  'Outstanding (Rs)',
];

// The same figures the ledger panel shows, written out as a spreadsheet the office can
// keep or hand to the family.
export function familyStatementCsv(ledger: FamilyLedger, info: FamilyStatementInfo, date = new Date()): string {
  const rows: (string | number | null)[][] = [
    [`${SCHOOL_NAME} — Family Fee Statement`],
    ['Statement date', statementDate(date)],
    ['Guardian', info.guardianName || '—'],
    ['Contact', info.guardianPhone || '—'],
    ['CNIC', info.guardianCnic || '—'],
    ['Prepared for', info.preparedFor || '—'],
    info.matchedReason ? ['Family matched on', info.matchedReason] : [],
    [],
    HEADINGS,
    ...ledger.rows.map((row) => [
      row.siblingOrder,
      statementChildName(row),
      row.admissionNumber || '—',
      row.className || '—',
      statementMoney(row.tuition),
      statementMoney(row.concession),
      statementMoney(row.siblingDiscount),
      row.discountPercentage,
      statementMoney(row.netTuition),
      statementMoney(row.monthlyCharge),
      statementMoney(row.outstanding),
    ]),
    [],
    [
      '',
      'Family total',
      `${ledger.rows.length} children`,
      '',
      statementMoney(ledger.totalTuition),
      statementMoney(ledger.totalConcession),
      statementMoney(ledger.totalSiblingDiscount),
      '',
      '',
      statementMoney(ledger.totalMonthly),
      statementMoney(ledger.totalOutstanding),
    ],
    [],
    ['Total payable by the family (Rs)', statementMoney(ledger.totalOutstanding)],
  ];
  return toCsv(rows);
}

export function familyStatementFilename(info: FamilyStatementInfo, date = new Date()): string {
  const slug = (info.guardianName || 'family')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'family';
  return `family-fee-statement-${slug}-${date.toISOString().slice(0, 10)}.csv`;
}
