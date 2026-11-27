import { TriangleAlert as AlertTriangle, Award, ChartBar as BarChart3, CalendarRange, ClipboardList, FileSpreadsheet, GraduationCap, History, LayoutGrid, ListChecks, TrendingUp, Trophy, Users } from 'lucide-react';
import type { ReportKind } from '@/lib/examReportCsv';

export type ReportGroupId = 'academic' | 'cumulative' | 'performance' | 'diagnostic';

export type ReportCard = {
  id: ReportKind;
  title: string;
  hint: string;
  group: ReportGroupId;
  icon: typeof Trophy;
  // Some reports need a choice made first: which student, or which two exams.
  needsStudent?: boolean;
  needsSecondExam?: boolean;
  // Print sheet size, shown on the button so the office knows what comes out.
  paper?: 'A4' | 'A4 landscape' | 'A5';
};

export const REPORT_GROUPS: { id: ReportGroupId; label: string; hint: string }[] = [
  { id: 'academic', label: 'Core & cumulative academic reports', hint: 'The sheets a class teacher fills in and the ones the office files.' },
  { id: 'cumulative', label: 'Annual, grade-only & student history', hint: 'Whole-year totals, early-class grade cards and a student’s full record.' },
  { id: 'performance', label: 'Teacher & school-wide performance', hint: 'How each class and each paper performed across the school.' },
  { id: 'diagnostic', label: 'Diagnostic & parent-teacher reports', hint: 'Catch gaps before the DMCs are printed and prepare for the PTM.' },
];

// The reports that are about one class. With "All Classes" chosen they are held back
// rather than printing a sheet that mixes every class into one position list.
export const CLASS_SCOPED: ReportKind[] = [
  'broadsheet', 'marksheet-blank', 'marksheet-filled',
  'award', 'character-blank', 'character-filled', 'merit', 'summary',
  'cumulative-broadsheet', 'cumulative-dmc', 'grade-only-a4', 'grade-only-a5', 'ptm',
];

// Where a card's own wording is clearer than the paper size, the button says it.
const PRINT_LABELS: Partial<Record<ReportKind, string>> = {
  'marksheet-blank': 'Print Blank Sheet',
  'marksheet-filled': 'Print Filled Sheet',
  'character-blank': 'Print Blank Sheet',
  'character-filled': 'Print Filled Sheet',
  'grade-only-a5': 'Print A5',
};

export const printLabel = (card: ReportCard): string => PRINT_LABELS[card.id] ?? `Print ${card.paper ?? 'A4'}`;

export const REPORT_CARDS: ReportCard[] = [
  // Core & cumulative academic
  {
    id: 'broadsheet', group: 'academic', icon: FileSpreadsheet, paper: 'A4',
    title: 'Class Master Broadsheet / Gazette',
    hint: 'Every student against every subject with totals, percentage, position and result on one sheet.',
  },
  {
    id: 'marksheet-blank', group: 'academic', icon: LayoutGrid, paper: 'A4 landscape',
    title: 'All-Subjects Blank Marksheet',
    hint: 'Roll no., admission no. and name on the left, then wide empty boxes for each subject for hand entry.',
  },
  {
    id: 'marksheet-filled', group: 'academic', icon: LayoutGrid, paper: 'A4 landscape',
    title: 'All-Subjects Filled Marksheet',
    hint: 'The same master sheet with every entered mark already printed in its box.',
  },
  {
    id: 'award', group: 'academic', icon: FileSpreadsheet, paper: 'A4',
    title: 'Subject-Wise Award List',
    hint: 'One block per subject with a marks box beside every student, ready to sign.',
  },
  {
    id: 'character-blank', group: 'academic', icon: ClipboardList, paper: 'A4',
    title: 'Characteristic Quality Award List (Blank)',
    hint: 'Empty Behaviour, Cleanliness, Character and Punctuality boxes for the teacher to rate.',
  },
  {
    id: 'character-filled', group: 'academic', icon: ClipboardList, paper: 'A4',
    title: 'Characteristic Quality Award List (Filled)',
    hint: 'The same quality sheet pre-filled from each student’s result, ready to adjust by hand.',
  },
  {
    id: 'merit', group: 'academic', icon: Trophy, paper: 'A4',
    title: 'Top 3 Position Holders & Merit List',
    hint: 'The top three of the class followed by the full merit order.',
  },
  {
    id: 'summary', group: 'academic', icon: Award, paper: 'A4',
    title: 'Pass / Fail & Conditional Pass Summary',
    hint: 'Pass, fail and conditional counts with every affected student named.',
  },

  // Annual, grade-only & history
  {
    id: 'cumulative-broadsheet', group: 'cumulative', icon: CalendarRange, paper: 'A4 landscape',
    title: 'Cumulative Result Sheet (Annual)',
    hint: 'Adds First Term, Mid Term and Final Term into one grand total, percentage, grade and final position.',
  },
  {
    id: 'cumulative-dmc', group: 'cumulative', icon: GraduationCap, paper: 'A4',
    title: 'Cumulative DMC (Annual Report Card)',
    hint: 'One annual report card per student showing every term side by side with the grand total.',
  },
  {
    id: 'grade-only-a4', group: 'cumulative', icon: GraduationCap, paper: 'A4',
    title: 'Grade-Only Report Card (A4)',
    hint: 'Letter grades only, with no raw marks printed, for the early classes.',
  },
  {
    id: 'grade-only-a5', group: 'cumulative', icon: GraduationCap, paper: 'A5',
    title: 'Grade-Only Report Card (A5)',
    hint: 'The same grade-only card on a half-size A5 sheet to save paper.',
  },
  {
    id: 'history', group: 'cumulative', icon: History, paper: 'A4', needsStudent: true,
    title: 'Student Multi-Year Academic Record',
    hint: 'Pick any student to see and print every exam they have sat, session by session.',
  },

  // Teacher & school-wide
  {
    id: 'teacher-class', group: 'performance', icon: Users, paper: 'A4',
    title: 'Teacher Performance Report (Class-Wise)',
    hint: 'Each class teacher’s sections with student count, pass percentage, average and highest score.',
  },
  {
    id: 'teacher-subject', group: 'performance', icon: Users, paper: 'A4',
    title: 'Teacher Performance Report (Subject-Wise)',
    hint: 'Each subject of every class with how many appeared, how many passed, and the score spread.',
  },
  {
    id: 'all-classes', group: 'performance', icon: BarChart3, paper: 'A4',
    title: 'All-Classes Overall Performance Summary',
    hint: 'The whole school in one table: pass and fail counts, pass percentage and class averages.',
  },

  // Diagnostic & PTM
  {
    id: 'missing-marks', group: 'diagnostic', icon: ListChecks, paper: 'A4',
    title: 'Missing Marks Audit',
    hint: 'Scans every class and subject and lists exactly which papers are still to be entered.',
  },
  {
    id: 'at-risk', group: 'diagnostic', icon: AlertTriangle, paper: 'A4',
    title: 'At-Risk & Borderline Students',
    hint: 'Anyone who failed a paper or sits within 10% of the pass mark, with the reason spelled out.',
  },
  {
    id: 'progress', group: 'diagnostic', icon: TrendingUp, paper: 'A4', needsSecondExam: true,
    title: 'Term-over-Term Progress & Drop',
    hint: 'Compares two exams to show the biggest improvers and the sharpest score drops.',
  },
  {
    id: 'ptm', group: 'diagnostic', icon: ClipboardList, paper: 'A4',
    title: 'PTM Result Distribution & Signature Sheet',
    hint: 'Name, roll no., percentage and grade beside a parent signature box for the meeting.',
  },
];
