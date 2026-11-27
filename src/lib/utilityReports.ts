import {
  CalendarClock, CalendarOff, ClipboardCheck, ClipboardList, Contact, FileSpreadsheet,
  ListChecks, Megaphone, MessageSquare, UserSearch, Users,
} from 'lucide-react';
import {
  type UtilityReportBundle,
  type UtilityReportFilters,
} from '@/lib/utilityReportData';
import { WEEKDAY_FULL } from '@/lib/utilityTools';

export type UtilityReportId =
  | 'class-timetable'
  | 'teacher-timetable'
  | 'master-timetable'
  | 'free-teachers'
  | 'class-subjects'
  | 'unassigned-subjects'
  | 'visitor-register'
  | 'job-register'
  | 'communication-log'
  | 'events-schedule'
  | 'holiday-register';

export type UtilityReportGroupId = 'academic' | 'admin' | 'communication';

export type UtilityReportCard = {
  id: UtilityReportId;
  title: string;
  hint: string;
  group: UtilityReportGroupId;
  icon: typeof Users;
  paper: 'A4' | 'A4 landscape';
};

export const UTILITY_REPORT_GROUPS: { id: UtilityReportGroupId; label: string; hint: string }[] = [
  { id: 'academic', label: 'Academic & timetable reports', hint: 'How the week is built: class schedules, teacher loads, free periods and subject coverage.' },
  { id: 'admin', label: 'Admin, visitor & HR reports', hint: 'The paper trail the office keeps: visitors at the gate and candidates who applied.' },
  { id: 'communication', label: 'Communication & calendar reports', hint: 'What was sent out, what is coming up, and which days the school is closed.' },
];

export const UTILITY_REPORT_CARDS: UtilityReportCard[] = [
  {
    id: 'class-timetable', group: 'academic', icon: CalendarClock, paper: 'A4',
    title: 'Class & Section-Wise Timetable',
    hint: 'One week on a single sheet: every period of a chosen class and section with its subject and teacher.',
  },
  {
    id: 'teacher-timetable', group: 'academic', icon: Users, paper: 'A4',
    title: 'Staff / Teacher-Wise Timetable',
    hint: 'Every period a teacher takes across the week, with their total weekly periods at the foot of the sheet.',
  },
  {
    id: 'master-timetable', group: 'academic', icon: FileSpreadsheet, paper: 'A4 landscape',
    title: 'Day-Wise Master School Timetable',
    hint: 'The whole school for one day: every class and section down the page against every period across it.',
  },
  {
    id: 'free-teachers', group: 'academic', icon: UserSearch, paper: 'A4',
    title: 'Free / Vacant Teachers per Period (Substitution Finder)',
    hint: 'Who is not teaching in each period, so a substitution can be found at a glance.',
  },
  {
    id: 'class-subjects', group: 'academic', icon: ClipboardList, paper: 'A4',
    title: 'Class-Wise Subjects & Assigned Teachers List',
    hint: 'Each class and section with its subjects, the teacher named against each one, and the periods a week.',
  },
  {
    id: 'unassigned-subjects', group: 'academic', icon: ListChecks, paper: 'A4',
    title: 'Unassigned Subjects Audit',
    hint: 'Subjects with no teacher named and sections with no timetable at all, so nothing is left uncovered.',
  },
  {
    id: 'visitor-register', group: 'admin', icon: Contact, paper: 'A4',
    title: 'Visitor Gate Pass & Entry/Exit Register',
    hint: 'The register kept at the gate: who came, on what business, and a line for the exit time and signature.',
  },
  {
    id: 'job-register', group: 'admin', icon: ClipboardCheck, paper: 'A4',
    title: 'Job Applications & Candidate Register',
    hint: 'Every candidate with the post applied for, contact details, date and current status.',
  },
  {
    id: 'communication-log', group: 'communication', icon: MessageSquare, paper: 'A4',
    title: 'SMS / WhatsApp & Announcements Log',
    hint: 'Messages actually sent to parents with their delivery status, followed by the school announcements.',
  },
  {
    id: 'events-schedule', group: 'communication', icon: Megaphone, paper: 'A4',
    title: 'School Events & Functions Schedule',
    hint: 'The events calendar in date order with venue, type, status and a line for remarks.',
  },
  {
    id: 'holiday-register', group: 'communication', icon: CalendarOff, paper: 'A4',
    title: 'Annual Session Holidays & Closed Days Register',
    hint: 'Every closed day of the session with its type, dates and the reason recorded.',
  },
];

// ============================================================================
// Report models — the flat shapes the sheet and the spreadsheet both read
// ============================================================================

export type ReportSection = { title?: string; head: string[]; rows: (string | number)[][]; foot?: (string | number)[] };
export type ReportKpis = { label: string; value: string }[];
export type UtilityReportModel = {
  title: string;
  subtitle: string;
  filters: string[];
  kpis: ReportKpis;
  sections: ReportSection[];
  notes: string[];
};

const dash = (value: string | null | undefined) => (value && value.trim() ? value : '—');

const labelFor = (day: number) => WEEKDAY_FULL[day] ?? `Day ${day}`;

// A blank line for a time the register is filled in by hand.
const BLANK = '';

const inDateRange = (value: string, filters: UtilityReportFilters) => {
  const day = (value || '').slice(0, 10);
  if (filters.dateFrom && day < filters.dateFrom) return false;
  if (filters.dateTo && day > filters.dateTo) return false;
  return true;
};

const sectionKey = (className: string, sectionName: string) => `${className} · ${sectionName || '—'}`;

// ============================================================================
// Category 1 — Academic & timetable
// ============================================================================

function classTimetable(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const className = filters.className;
  const rows = bundle.periods.filter((row) => !className || row.class_name === className);
  const sections = Array.from(new Set(rows.map((row) => `${row.class_name}\u0000${row.section_name}`)))
    .map((key) => {
      const [cls, sec] = key.split('\u0000');
      return { className: cls, sectionName: sec };
    })
    .sort((a, b) => `${a.className}${a.sectionName}`.localeCompare(`${b.className}${b.sectionName}`));

  const days = Array.from(new Set(rows.map((row) => row.day_of_week))).sort((a, b) => a - b);
  const periods = Array.from(new Set(rows.map((row) => row.period))).sort((a, b) => a - b);

  const sectionsOut: ReportSection[] = sections.map((group) => {
    const cellFor = (day: number, period: number) => {
      const found = rows.find((row) => row.class_name === group.className && row.section_name === group.sectionName && row.day_of_week === day && row.period === period);
      return found ? `${found.subject} — ${dash(found.teacher_name)}` : '—';
    };
    return {
      title: `${sectionKey(group.className, group.sectionName)}`,
      head: ['Period', ...days.map(labelFor)],
      rows: periods.map((period) => {
        const time = rows.find((row) => row.period === period && row.class_name === group.className && row.section_name === group.sectionName);
        const label = time && time.start_time && time.end_time
          ? `${period} (${time.start_time.slice(0, 5)}–${time.end_time.slice(0, 5)})`
          : String(period);
        return [label, ...days.map((day) => cellFor(day, period))];
      }),
    };
  });

  return {
    title: 'Class & Section-Wise Timetable',
    subtitle: className ? `Weekly timetable for ${className}` : 'Weekly timetable for every class and section',
    filters: [className ? `Class: ${className}` : 'Class: All classes'],
    kpis: [
      { label: 'Sections covered', value: String(sections.length) },
      { label: 'Periods a week', value: String(rows.length) },
      { label: 'Days scheduled', value: String(days.length) },
    ],
    sections: sectionsOut.length ? sectionsOut : [{ head: ['Period'], rows: [], title: 'Nothing scheduled' }],
    notes: rows.length === 0 ? ['No timetable has been set up yet. Add periods on the Timetable tab first.'] : [],
  };
}

function teacherTimetable(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.periods.filter((row) => !filters.className || row.class_name === filters.className);
  const teachers = Array.from(new Set(rows.map((row) => row.teacher_name || '—')))
    .filter((name) => name !== '—')
    .filter((name) => !filters.teacherName || name === filters.teacherName)
    .sort((a, b) => a.localeCompare(b));

  const days = Array.from(new Set(rows.map((row) => row.day_of_week))).sort((a, b) => a - b);
  const periods = Array.from(new Set(rows.map((row) => row.period))).sort((a, b) => a - b);

  const sectionsOut: ReportSection[] = teachers.map((teacher) => {
    const mine = rows.filter((row) => row.teacher_name === teacher);
    return {
      title: `${teacher} — ${mine.length} period${mine.length === 1 ? '' : 's'} a week`,
      head: ['Period', ...days.map(labelFor)],
      rows: periods.map((period) => {
        const cell = (day: number) => {
          const found = mine.find((row) => row.day_of_week === day && row.period === period);
          return found ? `${found.subject} (${found.class_name} ${found.section_name})` : '—';
        };
        return [String(period), ...days.map(cell)];
      }),
      foot: ['Weekly periods', ...days.map((day) => String(mine.filter((row) => row.day_of_week === day).length))],
    };
  });

  const totalPeriods = teachers.reduce((sum, teacher) => sum + rows.filter((row) => row.teacher_name === teacher).length, 0);

  return {
    title: 'Staff / Teacher-Wise Timetable',
    subtitle: filters.teacherName ? `Weekly load for ${filters.teacherName}` : 'Weekly load for every teacher',
    filters: [filters.className ? `Class: ${filters.className}` : 'Class: All classes', filters.teacherName ? `Teacher: ${filters.teacherName}` : 'Teacher: All teachers'],
    kpis: [
      { label: 'Teachers listed', value: String(teachers.length) },
      { label: 'Periods a week', value: String(totalPeriods) },
      { label: 'Average load', value: teachers.length ? (Math.round((totalPeriods / teachers.length) * 10) / 10).toFixed(1) : '0' },
    ],
    sections: sectionsOut.length ? sectionsOut : [{ title: 'Nothing scheduled', head: ['Period'], rows: [] }],
    notes: rows.length === 0 ? ['No timetable has been set up yet, so no teacher load can be worked out.'] : [],
  };
}

function masterTimetable(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.periods.filter((row) => !filters.className || row.class_name === filters.className);
  const days = Array.from(new Set(rows.map((row) => row.day_of_week))).sort((a, b) => a - b);
  const periods = Array.from(new Set(rows.map((row) => row.period))).sort((a, b) => a - b);
  const groups = Array.from(new Set(rows.map((row) => `${row.class_name}\u0000${row.section_name}`)))
    .map((key) => {
      const [cls, sec] = key.split('\u0000');
      return { className: cls, sectionName: sec };
    })
    .sort((a, b) => `${a.className}${a.sectionName}`.localeCompare(`${b.className}${b.sectionName}`));

  const sectionsOut: ReportSection[] = days.map((day) => ({
    title: labelFor(day),
    head: ['Class · Section', ...periods.map((period) => `P${period}`)],
    rows: groups.map((group) => [
      sectionKey(group.className, group.sectionName),
      ...periods.map((period) => {
        const found = rows.find((row) => row.day_of_week === day && row.period === period && row.class_name === group.className && row.section_name === group.sectionName);
        return found ? `${found.subject} / ${dash(found.teacher_name)}` : '—';
      }),
    ]),
  }));

  return {
    title: 'Day-Wise Master School Timetable',
    subtitle: filters.className ? `Every section of ${filters.className}, day by day` : 'Every class and section, day by day',
    filters: [filters.className ? `Class: ${filters.className}` : 'Class: All classes'],
    kpis: [
      { label: 'Days scheduled', value: String(days.length) },
      { label: 'Sections', value: String(groups.length) },
      { label: 'Periods a day', value: String(periods.length) },
    ],
    sections: sectionsOut.length ? sectionsOut : [{ title: 'Nothing scheduled', head: ['Class · Section'], rows: [] }],
    notes: rows.length === 0 ? ['No timetable has been set up yet.'] : [],
  };
}

function freeTeachers(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.periods.filter((row) => !filters.className || row.class_name === filters.className);
  const allTeachers = Array.from(new Set([
    ...bundle.teachers.map((teacher) => teacher.full_name),
    ...rows.map((row) => row.teacher_name),
  ].filter((name) => name && name.trim())))
    .filter((name) => !filters.teacherName || name === filters.teacherName)
    .sort((a, b) => a.localeCompare(b));

  const days = Array.from(new Set(rows.map((row) => row.day_of_week))).sort((a, b) => a - b);
  const periods = Array.from(new Set(rows.map((row) => row.period))).sort((a, b) => a - b);

  const sectionsOut: ReportSection[] = days.map((day) => ({
    title: labelFor(day),
    head: ['Period', 'Teaching', 'Free / available for substitution'],
    rows: periods.map((period) => {
      const busy = rows.filter((row) => row.day_of_week === day && row.period === period);
      const busyNames = new Set(busy.map((row) => row.teacher_name));
      const free = allTeachers.filter((name) => !busyNames.has(name));
      return [
        `P${period}`,
        busy.map((row) => `${row.teacher_name} (${row.class_name} ${row.section_name})`).join(', ') || '—',
        free.join(', ') || 'Nobody free',
      ];
    }),
  }));

  const totalFreeSlots = days.reduce((sum, day) => sum + periods.reduce((inner, period) => {
    const busy = new Set(rows.filter((row) => row.day_of_week === day && row.period === period).map((row) => row.teacher_name));
    return inner + allTeachers.filter((name) => !busy.has(name)).length;
  }, 0), 0);

  return {
    title: 'Free / Vacant Teachers per Period',
    subtitle: 'Substitution finder — who can cover a period at a glance',
    filters: [filters.className ? `Class: ${filters.className}` : 'Class: All classes', filters.teacherName ? `Teacher: ${filters.teacherName}` : 'Teacher: All teachers'],
    kpis: [
      { label: 'Teachers considered', value: String(allTeachers.length) },
      { label: 'Free slots a week', value: String(totalFreeSlots) },
      { label: 'Days covered', value: String(days.length) },
    ],
    sections: sectionsOut.length ? sectionsOut : [{ title: 'Nothing scheduled', head: ['Period'], rows: [] }],
    notes: rows.length === 0
      ? ['No timetable has been set up yet, so every teacher counts as free. Add periods on the Timetable tab first.']
      : ['A teacher is listed as free when no timetable period names them for that day and period.'],
  };
}

function classSubjects(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const assignments = bundle.assignments.filter((row) => !filters.className || row.class_name === filters.className);
  const periodRows = bundle.periods.filter((row) => !filters.className || row.class_name === filters.className);

  const keys = Array.from(new Set([
    ...assignments.map((row) => `${row.class_name}\u0000${row.section_name}\u0000${row.subject_name}`),
    ...periodRows.map((row) => `${row.class_name}\u0000${row.section_name}\u0000${row.subject}`),
  ]));

  const sectionsOut: ReportSection[] = keys
    .map((key) => {
      const [className, sectionName, subject] = key.split('\u0000');
      const assigned = assignments.find((row) => row.class_name === className && row.section_name === sectionName && row.subject_name === subject);
      const periods = periodRows.filter((row) => row.class_name === className && row.section_name === sectionName && row.subject === subject);
      const fromTimetable = Array.from(new Set(periods.map((row) => row.teacher_name).filter((name) => name && name.trim())));
      const teacher = assigned?.staff_name && assigned.staff_name !== '—' ? assigned.staff_name : fromTimetable.join(', ');
      return {
        className, sectionName, subject,
        teacher: teacher || '',
        weekly: assigned?.weekly_periods ?? periods.length,
      };
    })
    .sort((a, b) => `${a.className}${a.sectionName}${a.subject}`.localeCompare(`${b.className}${b.sectionName}${b.subject}`))
    .map((row) => ({
      title: sectionKey(row.className, row.sectionName),
      head: ['Subject', 'Assigned teacher', 'Periods a week'],
      rows: [[row.subject, row.teacher || 'Not assigned', row.weekly]],
    }));

  const grouped = new Map<string, ReportSection>();
  for (const section of sectionsOut) {
    const existing = grouped.get(section.title ?? '');
    if (existing) existing.rows.push(...section.rows);
    else grouped.set(section.title ?? '', { ...section, rows: [...section.rows] });
  }

  const out = Array.from(grouped.values());
  const missingTeacher = out.reduce((sum, section) => sum + section.rows.filter((row) => String(row[1]) === 'Not assigned').length, 0);

  return {
    title: 'Class-Wise Subjects & Assigned Teachers',
    subtitle: filters.className ? `Subjects taught in ${filters.className}` : 'Every subject taught in every class',
    filters: [filters.className ? `Class: ${filters.className}` : 'Class: All classes'],
    kpis: [
      { label: 'Class · sections', value: String(out.length) },
      { label: 'Subjects listed', value: String(out.reduce((sum, section) => sum + section.rows.length, 0)) },
      { label: 'Without a teacher', value: String(missingTeacher) },
    ],
    sections: out.length ? out : [{ title: 'Nothing set up', head: ['Subject', 'Assigned teacher', 'Periods a week'], rows: [] }],
    notes: missingTeacher > 0 ? [`${missingTeacher} subject${missingTeacher === 1 ? ' has' : 's have'} no teacher named. Assign them on the Timetable tab.`] : [],
  };
}

function unassignedSubjects(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const assignments = bundle.assignments.filter((row) => !filters.className || row.class_name === filters.className);
  const periods = bundle.periods.filter((row) => !filters.className || row.class_name === filters.className);

  const classNames = filters.className
    ? [filters.className]
    : Array.from(new Set([
        ...bundle.subjects.map((row) => row.class_name),
        ...bundle.students.filter((row) => row.status === 'active').map((row) => row.class_name),
        ...periods.map((row) => row.class_name),
        ...assignments.map((row) => row.class_name),
      ])).sort();

  const sectionNames = Array.from(new Set([
    ...bundle.sections.map((row) => row.section_name),
    ...bundle.students.filter((row) => row.status === 'active').map((row) => row.section_name),
    ...periods.map((row) => row.section_name),
  ].filter((name) => name && name.trim()))).sort();

  const noTeacher: (string | number)[][] = [];
  for (const key of Array.from(new Set([
    ...assignments.map((row) => `${row.class_name}\u0000${row.section_name}\u0000${row.subject_name}\u0000${row.staff_name}`),
    ...periods.map((row) => `${row.class_name}\u0000${row.section_name}\u0000${row.subject}\u0000${row.teacher_name}`),
  ]))) {
    const [className, sectionName, subject, teacher] = key.split('\u0000');
    if (!teacher || !teacher.trim() || teacher === '—') {
      noTeacher.push([className, sectionName || '—', subject, 'No teacher named']);
    }
  }

  const noTimetable: (string | number)[][] = [];
  for (const className of classNames) {
    for (const sectionName of sectionNames) {
      const hasStudents = bundle.students.some((row) => row.status === 'active' && row.class_name === className && row.section_name === sectionName);
      const hasPeriods = periods.some((row) => row.class_name === className && row.section_name === sectionName);
      if (hasStudents && !hasPeriods) noTimetable.push([className, sectionName, 'Students enrolled but no timetable']);
    }
  }

  const subjectsWithoutTeacher = noTeacher.length;

  return {
    title: 'Unassigned Subjects Audit',
    subtitle: 'Subjects with no teacher named, and sections with no timetable at all',
    filters: [filters.className ? `Class: ${filters.className}` : 'Class: All classes'],
    kpis: [
      { label: 'Subjects without a teacher', value: String(subjectsWithoutTeacher) },
      { label: 'Sections without a timetable', value: String(noTimetable.length) },
      { label: 'Classes checked', value: String(classNames.length) },
    ],
    sections: [
      {
        title: 'Subjects with no teacher named',
        head: ['Class', 'Section', 'Subject', 'Problem'],
        rows: noTeacher.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      },
      {
        title: 'Sections with students but no timetable',
        head: ['Class', 'Section', 'Problem'],
        rows: noTimetable.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      },
    ],
    notes: [
      'A section is only flagged when it has active students on roll, so an empty section is not reported as a gap.',
      subjectsWithoutTeacher + noTimetable.length === 0 ? 'Nothing is outstanding — every subject has a teacher and every section has a timetable.' : 'Work through the lists above on the Timetable tab to clear the audit.',
    ],
  };
}

// ============================================================================
// Category 2 — Admin, visitor & HR
// ============================================================================

function visitorRegister(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.visitors.filter((row) => inDateRange(row.created_at, filters));
  const staff = rows.filter((row) => row.card_type === 'staff').length;

  return {
    title: 'Visitor Gate Pass & Entry/Exit Register',
    subtitle: 'The register kept at the gate',
    filters: [
      filters.dateFrom ? `From: ${filters.dateFrom}` : 'From: the beginning',
      filters.dateTo ? `To: ${filters.dateTo}` : 'To: today',
    ],
    kpis: [
      { label: 'Entries', value: String(rows.length) },
      { label: 'Staff cards', value: String(staff) },
      { label: 'Outside visitors', value: String(rows.length - staff) },
    ],
    sections: [{
      head: ['#', 'Date', 'Name', 'Designation / purpose', 'Organisation', 'Contact', 'Time in', 'Time out', 'Signature'],
      rows: rows.map((row, index) => [
        index + 1,
        row.created_at.slice(0, 10),
        row.person_name,
        dash(row.designation),
        dash(row.organization),
        dash(row.phone),
        row.created_at.slice(11, 16),
        BLANK,
        BLANK,
      ]),
    }],
    notes: [
      'The time in is recorded when the card is issued. The time out and signature lines are left blank for the gate staff to complete by hand.',
      rows.length === 0 ? 'No visitor has been recorded in the chosen dates.' : '',
    ].filter(Boolean),
  };
}

function jobRegister(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.jobs.filter((row) => inDateRange(row.applied_date, filters));
  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);

  return {
    title: 'Job Applications & Candidate Register',
    subtitle: 'Every candidate who applied, with their current status',
    filters: [
      filters.dateFrom ? `From: ${filters.dateFrom}` : 'From: the beginning',
      filters.dateTo ? `To: ${filters.dateTo}` : 'To: today',
    ],
    kpis: [
      { label: 'Applications', value: String(rows.length) },
      { label: 'Shortlisted', value: String(byStatus.get('shortlisted') ?? 0) },
      { label: 'Hired', value: String(byStatus.get('hired') ?? 0) },
    ],
    sections: [{
      head: ['#', 'Applied', 'Candidate', 'Post applied for', 'Contact', 'Email', 'Status', 'Remarks'],
      rows: rows.map((row, index) => [
        index + 1,
        row.applied_date,
        row.applicant_name,
        row.position_applied,
        dash(row.phone),
        dash(row.email),
        row.status,
        dash(row.notes),
      ]),
    }],
    notes: [
      rows.length === 0 ? 'No application was received in the chosen dates.' : '',
      byStatus.size > 1 ? `Statuses on this sheet: ${Array.from(byStatus.entries()).map(([status, count]) => `${status} ${count}`).join(', ')}.` : '',
    ].filter(Boolean),
  };
}

// ============================================================================
// Category 3 — Communication & calendar
// ============================================================================

function communicationLog(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const sms = bundle.sms.filter((row) => inDateRange(row.sent_at, filters) && (!filters.className || row.class_name === filters.className));
  const announcements = bundle.announcements.filter((row) => inDateRange(row.start_date, filters));
  const sent = sms.filter((row) => row.status === 'sent').length;

  return {
    title: 'SMS / WhatsApp & Announcements Log',
    subtitle: 'What was sent to parents, and what the school announced',
    filters: [
      filters.className ? `Class: ${filters.className}` : 'Class: All classes',
      filters.dateFrom ? `From: ${filters.dateFrom}` : 'From: the beginning',
      filters.dateTo ? `To: ${filters.dateTo}` : 'To: today',
    ],
    kpis: [
      { label: 'Messages logged', value: String(sms.length) },
      { label: 'Delivered', value: String(sent) },
      { label: 'Announcements', value: String(announcements.length) },
    ],
    sections: [
      {
        title: 'Messages sent to parents',
        head: ['#', 'Sent', 'Student', 'Class', 'Number', 'Type', 'Status', 'Message'],
        rows: sms.map((row, index) => [
          index + 1,
          row.sent_at.slice(0, 16).replace('T', ' '),
          row.student_name,
          sectionKey(row.class_name, row.section_name),
          dash(row.parent_phone),
          row.message_type,
          row.status,
          row.message_body,
        ]),
      },
      {
        title: 'School announcements',
        head: ['#', 'From', 'To', 'Title', 'Audience', 'Priority', 'Live'],
        rows: announcements.map((row, index) => [
          index + 1,
          row.start_date,
          dash(row.end_date),
          row.title,
          row.audience,
          row.priority,
          row.is_active ? 'Yes' : 'No',
        ]),
      },
    ],
    notes: [
      'A message counts as delivered when the sending gateway confirmed it. Messages still queued or failed stay in the log so nothing is lost.',
      sms.length === 0 && announcements.length === 0 ? 'Nothing has been sent or announced in the chosen dates.' : '',
    ].filter(Boolean),
  };
}

function eventsSchedule(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.events.filter((row) => inDateRange(row.event_date, filters));
  const upcoming = rows.filter((row) => row.status === 'upcoming').length;

  return {
    title: 'School Events & Functions Schedule',
    subtitle: 'The events calendar in date order',
    filters: [
      filters.dateFrom ? `From: ${filters.dateFrom}` : 'From: the beginning',
      filters.dateTo ? `To: ${filters.dateTo}` : 'To: the end of the calendar',
    ],
    kpis: [
      { label: 'Events listed', value: String(rows.length) },
      { label: 'Still upcoming', value: String(upcoming) },
      { label: 'Completed', value: String(rows.filter((row) => row.status === 'completed').length) },
    ],
    sections: [{
      head: ['#', 'Date', 'Ends', 'Event', 'Venue', 'Type', 'Status', 'Remarks'],
      rows: rows.map((row, index) => [
        index + 1,
        row.event_date,
        dash(row.end_date),
        row.title,
        dash(row.location),
        row.event_type,
        row.status,
        BLANK,
      ]),
    }],
    notes: rows.length === 0 ? ['No event falls in the chosen dates.'] : [],
  };
}

function holidayRegister(bundle: UtilityReportBundle, filters: UtilityReportFilters): UtilityReportModel {
  const rows = bundle.holidays.filter((row) => inDateRange(row.day_date, filters));
  const byType = new Map<string, number>();
  for (const row of rows) byType.set(row.day_type, (byType.get(row.day_type) ?? 0) + 1);

  return {
    title: 'Annual Session Holidays & Closed Days Register',
    subtitle: 'Every closed day of the session',
    filters: [
      filters.dateFrom ? `From: ${filters.dateFrom}` : 'From: the beginning of the session',
      filters.dateTo ? `To: ${filters.dateTo}` : 'To: the end of the session',
    ],
    kpis: [
      { label: 'Closed days', value: String(rows.length) },
      { label: 'Holidays', value: String(byType.get('holiday') ?? 0) },
      { label: 'Types recorded', value: String(byType.size) },
    ],
    sections: [{
      head: ['#', 'Date', 'Ends', 'Type', 'Title', 'Reason / notes', 'Signature'],
      rows: rows.map((row, index) => [
        index + 1,
        row.day_date,
        dash(row.end_date),
        row.day_type,
        row.title,
        dash(row.notes),
        BLANK,
      ]),
    }],
    notes: [
      'Closed days are read from the school calendar, so a day added there appears here as well.',
      rows.length === 0 ? 'No closed day falls in the chosen dates.' : '',
    ].filter(Boolean),
  };
}

// ============================================================================
// Entry point
// ============================================================================

export function buildUtilityReport(
  id: UtilityReportId,
  bundle: UtilityReportBundle,
  filters: UtilityReportFilters,
): UtilityReportModel {
  switch (id) {
    case 'class-timetable': return classTimetable(bundle, filters);
    case 'teacher-timetable': return teacherTimetable(bundle, filters);
    case 'master-timetable': return masterTimetable(bundle, filters);
    case 'free-teachers': return freeTeachers(bundle, filters);
    case 'class-subjects': return classSubjects(bundle, filters);
    case 'unassigned-subjects': return unassignedSubjects(bundle, filters);
    case 'visitor-register': return visitorRegister(bundle, filters);
    case 'job-register': return jobRegister(bundle, filters);
    case 'communication-log': return communicationLog(bundle, filters);
    case 'events-schedule': return eventsSchedule(bundle, filters);
    case 'holiday-register': return holidayRegister(bundle, filters);
  }
}

export const utilityReportFileName = (id: UtilityReportId, model: UtilityReportModel) =>
  `utility-${id}-${model.subtitle.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.csv`;

// One row per line, with the report heading and filters repeated at the top so a
// spreadsheet opened on its own still says what it is.
export function utilityReportCsv(model: UtilityReportModel): string {
  const escape = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const text = (value: string | number) => String(value ?? '');
  const lines: string[][] = [
    [model.title],
    [model.subtitle],
    model.filters.map(text),
    [],
    ['Summary'],
    ...model.kpis.map((kpi) => [kpi.label, kpi.value]),
    [],
  ];
  for (const section of model.sections) {
    if (section.title) lines.push([section.title]);
    lines.push(section.head.map(text));
    for (const row of section.rows) lines.push(row.map(text));
    if (section.foot) lines.push(section.foot.map(text));
    lines.push([]);
  }
  if (model.notes.length) {
    lines.push(['Notes']);
    for (const note of model.notes) lines.push([note]);
  }
  return lines.map((row) => row.map(escape).join(',')).join('\n');
}
