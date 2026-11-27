import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Calculator, CalendarCheck, CalendarDays, ClipboardList, Contact, FileSpreadsheet,
  FileWarning, Landmark, Loader as Loader2, Phone, PiggyBank, Printer, UserMinus, X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { PersonAvatar } from '@/components/PersonAvatar';
import { SchoolLogo } from '@/components/SchoolLogo';
import { code39Shape, sanitizeBarcodeValue } from '@/lib/barcode';
import { downloadCsv, toCsv } from '@/lib/fees';
import type { UserRole } from '@/lib/auth';
import { STAFF_ROLE_OPTIONS, type StaffMemberRecord } from '@/lib/staffProfile';
import { STAFF_STATUS_LABELS, formatCnic, isStaffActive, staffId, type StaffStatus } from '@/lib/staffDirectory';
import {
  advanceOutstanding, currentMonthKey, fetchPfContributions, fetchSalaryPayments,
  fetchStaffAdvances, monthLabel, monthOptions as monthChoices,
  pfTotals, type PfContribution, type SalaryPayment, type StaffAdvance,
} from '@/lib/payroll';
import { fetchStaffAttendanceMonth, STAFF_ATTENDANCE_LABELS, type StaffAttendanceRecord } from '@/lib/staffAttendance';
import {
  fetchStaffLeave, leaveDateRange, leaveDayCount, STAFF_LEAVE_TYPE_LABELS, type StaffLeaveRequest,
} from '@/lib/staffLeave';
import { designationFor } from '@/lib/staffCertificates';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------- report catalogue

type ReportKey =
  | 'phonebook' | 'workload' | 'idcards' | 'missingdocs' | 'former'
  | 'paysheet' | 'banksheet' | 'advpf'
  | 'attfilled' | 'attblank' | 'leavesummary';

type ReportCategory = 'directory' | 'payroll' | 'attendance';

const CATEGORY_TITLES: Record<ReportCategory, { title: string; hint: string }> = {
  directory: { title: 'Directory & HR', hint: 'Who is on staff, how to reach them, and what is still missing from their file.' },
  payroll: { title: 'Payroll & Accounts', hint: 'Salaries, bank transfers, advances and the provident fund ledger.' },
  attendance: { title: 'Attendance & Leave', hint: 'The month at a glance — who came, who was late and who was on leave.' },
};

const REPORT_CATALOG: {
  key: ReportKey; category: ReportCategory; title: string; desc: string;
  icon: ComponentType<{ size?: number | string; className?: string }>; usesMonth: boolean;
}[] = [
  { key: 'phonebook', category: 'directory', title: 'Staff Phone Book & Directory', desc: 'The contact list of the current staff — name, role, staff ID and phone.', icon: Phone, usesMonth: false },
  { key: 'workload', category: 'directory', title: 'Class Teacher & Subject Workload', desc: 'Who leads each class and section, and the subjects and periods assigned to every teacher.', icon: BookOpen, usesMonth: false },
  { key: 'idcards', category: 'directory', title: 'Staff Identity Card Generator', desc: 'Printable front-and-back ID cards with photo, staff ID, role, CNIC and emergency contact.', icon: Contact, usesMonth: false },
  { key: 'missingdocs', category: 'directory', title: 'Missing Documents & Agreement Audit', desc: 'Every staff member still missing a signed agreement, CNIC copy, degrees or a photo.', icon: FileWarning, usesMonth: false },
  { key: 'former', category: 'directory', title: 'Former / Inactive Staff Register', desc: 'Past staff with joining date, leaving date and the reason recorded on the file.', icon: UserMinus, usesMonth: false },
  { key: 'paysheet', category: 'payroll', title: 'Monthly Master Pay Sheet', desc: 'The full salary register for the month with totals, ready for the Principal\u2019s signature.', icon: Calculator, usesMonth: true },
  { key: 'banksheet', category: 'payroll', title: 'Bank / Raast Salary Transfer Sheet', desc: 'Name, account mobile number and net payable for the month\u2019s transfers.', icon: Landmark, usesMonth: true },
  { key: 'advpf', category: 'payroll', title: 'Salary Advance & Provident Fund Ledger', desc: 'Each person\u2019s outstanding advance and PF balance, with the totals for the school.', icon: PiggyBank, usesMonth: false },
  { key: 'attfilled', category: 'attendance', title: 'Monthly Attendance Register — Filled', desc: 'The whole month\u2019s P/A/L grid as recorded, with a summary for every staff member.', icon: CalendarCheck, usesMonth: true },
  { key: 'attblank', category: 'attendance', title: 'Monthly Attendance Register — Blank', desc: 'Staff names with empty date boxes, ready to be marked by hand.', icon: CalendarDays, usesMonth: true },
  { key: 'leavesummary', category: 'attendance', title: 'Monthly Leave & Late Arrival Summary', desc: 'Approved, pending and rejected leave in the month, plus everyone who arrived late.', icon: ClipboardList, usesMonth: true },
];

// ---------------------------------------------------------------- shared data types

type SubjectAssignment = {
  staff_user_id: string;
  class_name: string;
  section_name: string | null;
  subject_name: string;
  weekly_periods: number | null;
};

type SectionRow = { class_name: string; section_name: string | null; class_teacher: string | null };

type DocumentRow = { staff_user_id: string; doc_type: string };

type Cell = string | number | null;

type ReportTable = { title?: string; head: string[]; rows: Cell[][]; totalsRow?: Cell[] };

type AttGridRow = { name: string; role: string; cells: string[]; present: number; absent: number; late: number; leave: number };

type ReportModel = {
  title: string;
  subtitle: string;
  landscape: boolean;
  tables: ReportTable[];
  idcards?: StaffMemberRecord[];
  attGrid?: { days: number; rows: AttGridRow[] };
  signature?: string;
  note?: string;
};

const STAFF_ROLES: UserRole[] = STAFF_ROLE_OPTIONS.map((option) => option.value);

// ---------------------------------------------------------- ID card design templates

// Every template draws the card at the exact ISO/IEC 7810 CR80 size — 85.6 mm × 54 mm
// landscape or 54 mm × 85.6 mm portrait — so a printed sheet fits PVC holders and
// lamination pouches without trimming.
type IdTemplate = { key: string; name: string; orientation: 'landscape' | 'portrait' };

const ID_TEMPLATES: IdTemplate[] = [
  { key: 'navy', name: 'Classic Navy Corporate', orientation: 'landscape' },
  { key: 'lanyard', name: 'Modern Vertical Lanyard', orientation: 'portrait' },
  { key: 'emerald', name: 'Emerald Academic', orientation: 'landscape' },
  { key: 'indigo', name: 'Royal Indigo Split', orientation: 'portrait' },
  { key: 'crimson', name: 'Crimson Executive', orientation: 'landscape' },
  { key: 'sky', name: 'Sky Blue Clean', orientation: 'portrait' },
];

const DEFAULT_ID_TEMPLATE = 'navy';

const money = (value: number) => `Rs ${Math.round(value).toLocaleString()}`;

const shortDate = (value: string | null) => {
  if (!value) return '';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

const todayLabel = () => new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });

const daysInMonth = (monthStart: string) => {
  const { year, month } = { year: Number(monthStart.slice(0, 4)), month: Number(monthStart.slice(5, 7)) };
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
};

const ATT_LETTERS: Record<string, string> = { present: 'P', absent: 'A', late: 'L', leave: 'Lv' };

// ---------------------------------------------------------------- component

export function StaffReportsTab({ staff, onToast }: { staff: StaffMemberRecord[]; onToast: (message: string) => void }) {
  const [month, setMonth] = useState(currentMonthKey());
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [scope, setScope] = useState<'active' | 'inactive' | 'all'>('active');
  const [openReport, setOpenReport] = useState<ReportKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [cardTemplate, setCardTemplate] = useState(DEFAULT_ID_TEMPLATE);
  const [idCardStaff, setIdCardStaff] = useState<'all' | string>('all');

  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [contributions, setContributions] = useState<PfContribution[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<StaffLeaveRequest[]>([]);
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchInstitutionProfile().then((result) => {
      if (!cancelled) setInstitution(result.profile);
    });
    return () => { cancelled = true; };
  }, []);

  // A report only loads the data it actually needs, the moment it is opened.
  useEffect(() => {
    if (!openReport) return;
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      const jobs: Promise<void>[] = [];
      if (openReport === 'paysheet' || openReport === 'banksheet' || openReport === 'advpf') {
        jobs.push(fetchSalaryPayments().then((rows) => { if (!cancelled) setPayments(rows); }));
      }
      if (openReport === 'advpf') {
        jobs.push(fetchStaffAdvances().then((rows) => { if (!cancelled) setAdvances(rows); }));
        jobs.push(fetchPfContributions().then((rows) => { if (!cancelled) setContributions(rows); }));
      }
      if (openReport === 'attfilled' || openReport === 'attblank' || openReport === 'leavesummary') {
        jobs.push(fetchStaffAttendanceMonth(month).then((rows) => { if (!cancelled) setAttendance(rows); }));
      }
      if (openReport === 'leavesummary') {
        jobs.push(fetchStaffLeave().then((rows) => { if (!cancelled) setLeaves(rows); }));
      }
      if (openReport === 'workload') {
        jobs.push((async () => {
          const { data } = await supabase.from('school_staff_subject_assignments')
            .select('staff_user_id, class_name, section_name, subject_name, weekly_periods');
          if (!cancelled) setAssignments((data ?? []) as SubjectAssignment[]);
        })());
        jobs.push((async () => {
          const { data } = await supabase.from('school_sections')
            .select('class_name, section_name, class_teacher')
            .order('class_name').order('section_name');
          if (!cancelled) setSections((data ?? []) as SectionRow[]);
        })());
      }
      if (openReport === 'missingdocs') {
        jobs.push((async () => {
          const { data } = await supabase.from('school_staff_documents').select('staff_user_id, doc_type');
          if (!cancelled) setDocuments((data ?? []) as DocumentRow[]);
        })());
      }
      await Promise.all(jobs);
      if (!cancelled) setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [openReport, month]);

  const staffByRole = useMemo(
    () => (roleFilter === 'all' ? staff : staff.filter((member) => member.role === roleFilter)),
    [staff, roleFilter],
  );

  const model: ReportModel | null = useMemo(() => {
    if (!openReport) return null;
    return buildReportModel(openReport, {
      staff: staffByRole, month, scope, institution, payments, advances, contributions, attendance, leaves, assignments, sections, documents,
      cardTemplate, idCardStaff,
    });
  }, [openReport, staffByRole, month, scope, institution, payments, advances, contributions, attendance, leaves, assignments, sections, documents, cardTemplate, idCardStaff]);

  const printSheet = usePrintSheet(model !== null, model ? (
    <section className="print-only print-report-sheet">
      <style>{`@page { size: A4 ${model.landscape ? 'landscape' : 'portrait'}; margin: 8mm; }`}</style>
      <ReportSheet model={model} institution={institution} templateKey={cardTemplate} />
    </section>
  ) : null);

  const exportCsv = () => {
    if (!model || !openReport) return;
    const tables = model.attGrid ? [attGridTable(model)] : model.tables;
    const rows: Cell[][] = [];
    tables.forEach((table, index) => {
      if (index > 0) rows.push([]);
      if (table.title) rows.push([table.title]);
      rows.push(table.head);
      table.rows.forEach((row) => rows.push(row));
      if (table.totalsRow) rows.push(table.totalsRow);
    });
    if (model.idcards) {
      rows.push(['Name', 'Staff ID', 'Role', 'CNIC', 'Phone', 'Address', 'Joining date']);
      model.idcards.forEach((member) => rows.push(idCardCsvRow(member)));
    }
    downloadCsv(`${openReport}-${month.slice(0, 7)}.csv`, toCsv(rows));
    onToast('The report was exported as a CSV file.');
  };

  const scopeChoices: { value: 'active' | 'inactive' | 'all'; label: string }[] = [
    { value: 'active', label: 'Active staff' },
    { value: 'inactive', label: 'Former & inactive' },
    { value: 'all', label: 'All staff' },
  ];

  return (
    <div className="admin-panel reports-panel">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Reports</span>
          <h2>Staff report hub</h2>
          <p>Every staff register in one place. Pick a report, set the filters, then print it on the letterhead or export it as a CSV file.</p>
        </div>
      </div>

      <div className="report-filter-bar">
        <label className="control-field">
          Month / Year
          <select value={month} onChange={(event) => setMonth(event.target.value)} disabled={openReport !== null && !REPORT_CATALOG.find((report) => report.key === openReport)?.usesMonth}>
            {monthChoices().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="control-field">
          Role
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}>
            <option value="all">All roles</option>
            {STAFF_ROLES.map((role) => <option key={role} value={role}>{designationFor(role)}</option>)}
          </select>
        </label>
        <label className="control-field">
          Status
          <select value={scope} onChange={(event) => setScope(event.target.value as 'active' | 'inactive' | 'all')}>
            {scopeChoices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span className="report-filter-hint">The filters apply to every report that uses them.</span>
      </div>

      {(Object.keys(CATEGORY_TITLES) as ReportCategory[]).map((category) => (
        <section key={category} className="report-category">
          <header className="report-category-head">
            <h3>{CATEGORY_TITLES[category].title}</h3>
            <p>{CATEGORY_TITLES[category].hint}</p>
          </header>
          <div className="report-cards">
            {REPORT_CATALOG.filter((report) => report.category === category).map((report) => {
              const Icon = report.icon;
              return (
                <button key={report.key} type="button" className="report-card" onClick={() => setOpenReport(report.key)}>
                  <span className="report-card-icon"><Icon size={20} /></span>
                  <span className="report-card-copy">
                    <strong>{report.title}</strong>
                    <span>{report.desc}</span>
                  </span>
                  <span className="report-card-go">Open<Printer size={13} /></span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {openReport && (
        <div className="notice-overlay" onClick={() => setOpenReport(null)}>
          <section className="notice-modal report-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow"><Printer size={14} /> Print preview — A4</span>
              <button className="close-button" onClick={() => setOpenReport(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <h2 className="payroll-modal-title">{model?.title ?? 'Report'}</h2>
            <p className="payroll-modal-sub">{model?.subtitle}</p>

            {openReport === 'idcards' && (
              <div className="idc-controls">
                <label className="control-field idc-staff-field">
                  Select staff
                  <select value={idCardStaff} onChange={(event) => setIdCardStaff(event.target.value)}>
                    <option value="all">All staff ({model?.idcards?.length ?? 0} cards)</option>
                    {staffByRole.map((member) => (
                      <option key={member.id} value={member.id}>{member.full_name} — {designationFor(member.role)}</option>
                    ))}
                  </select>
                </label>
                <IdTemplateGallery value={cardTemplate} onChange={setCardTemplate} />
              </div>
            )}

            {loading ? (
              <div className="empty-state large report-loading"><Loader2 size={18} className="spin" /> Preparing the report…</div>
            ) : model && hasContent(model) ? (
              <div className="report-preview-scroll"><ReportSheet model={model} institution={institution} templateKey={cardTemplate} /></div>
            ) : (
              <div className="empty-state large">No records were found for these filters. Try another month, role or status.</div>
            )}

            <div className="report-preview-actions">
              <button type="button" className="primary-button" onClick={() => window.print()} disabled={loading || !model || !hasContent(model)}>
                <Printer size={16} /> Print Report
              </button>
              <button type="button" className="secondary-button" onClick={exportCsv} disabled={loading || !model || !hasContent(model)}>
                <FileSpreadsheet size={16} /> Export CSV
              </button>
            </div>
          </section>
        </div>
      )}

      {printSheet}
    </div>
  );
}

// ---------------------------------------------------------------- model builder

type ModelInput = {
  staff: StaffMemberRecord[];
  month: string;
  scope: 'active' | 'inactive' | 'all';
  institution: InstitutionProfile | null;
  payments: SalaryPayment[];
  advances: StaffAdvance[];
  contributions: PfContribution[];
  attendance: StaffAttendanceRecord[];
  leaves: StaffLeaveRequest[];
  assignments: SubjectAssignment[];
  sections: SectionRow[];
  documents: DocumentRow[];
  cardTemplate: string;
  idCardStaff: 'all' | string;
};

const monthPart = (month: string) => month.slice(0, 7);

function buildReportModel(report: ReportKey, input: ModelInput): ReportModel {
  const { staff, month, scope, cardTemplate, idCardStaff } = input;
  const monthText = monthLabel(month);
  const asOf = `Prepared ${todayLabel()}`;

  const scopedStaff = staff.filter((member) =>
    scope === 'all' ? true : isStaffActive(member.status) === (scope === 'active'));
  const activeStaff = staff.filter((member) => isStaffActive(member.status));
  const name = (userId: string) => staff.find((member) => member.id === userId)?.full_name ?? 'Unknown';
  const roleOf = (userId: string) => {
    const member = staff.find((row) => row.id === userId);
    return member ? designationFor(member.role) : '';
  };

  switch (report) {
    case 'phonebook':
      return {
        title: 'Staff Phone Book & Directory',
        subtitle: `${monthText} · ${scopedStaff.length} staff · ${asOf}`,
        landscape: false,
        tables: [{
          head: ['Name', 'Staff ID', 'Role', 'Phone', 'CNIC', 'Status'],
          rows: scopedStaff.map((member) => [
            member.full_name,
            member.staff_code || staffId(member.id),
            designationFor(member.role),
            member.mobile_number ?? '',
            formatCnic(member.cnic),
            STAFF_STATUS_LABELS[member.status as StaffStatus] ?? member.status,
          ]),
        }],
      };

    case 'workload': {
      const workloadRows = input.assignments.map((row) => [
        name(row.staff_user_id),
        roleOf(row.staff_user_id),
        row.class_name + (row.section_name ? `-${row.section_name}` : ''),
        row.subject_name,
        row.weekly_periods ?? '',
      ]);
      const periodsByTeacher = new Map<string, number>();
      input.assignments.forEach((row) => {
        periodsByTeacher.set(row.staff_user_id, (periodsByTeacher.get(row.staff_user_id) ?? 0) + Number(row.weekly_periods ?? 0));
      });
      const totalsRows = [...periodsByTeacher.entries()].map(([userId, periods]) => [name(userId), periods]);
      return {
        title: 'Class Teacher & Subject Workload',
        subtitle: `${monthText} · ${asOf}`,
        landscape: false,
        tables: [
          {
            title: 'Class teachers',
            head: ['Class', 'Section', 'Class teacher'],
            rows: input.sections.map((row) => [row.class_name, row.section_name ?? '—', row.class_teacher ?? 'Not assigned']),
          },
          {
            title: 'Subject assignments & weekly periods',
            head: ['Teacher', 'Role', 'Class', 'Subject', 'Weekly periods'],
            rows: workloadRows,
            totalsRow: ['Total weekly periods', '', '', '', ''],
          },
          {
            title: 'Workload per teacher',
            head: ['Teacher', 'Weekly periods'],
            rows: totalsRows,
          },
        ],
        note: input.assignments.length === 0 && input.sections.length === 0
          ? 'No class or subject assignments have been recorded yet. Set them up in the Class & subjects tab.'
          : undefined,
      };
    }

    case 'idcards': {
      const cardStaff = idCardStaff === 'all'
        ? scopedStaff
        : scopedStaff.filter((member) => member.id === idCardStaff);
      return {
        title: 'Staff Identity Cards',
        subtitle: `${cardStaff.length} CR80 card${cardStaff.length === 1 ? '' : 's'} · ${ID_TEMPLATES.find((tpl) => tpl.key === cardTemplate)?.name ?? ''} · ${asOf}`,
        landscape: false,
        tables: [],
        idcards: cardStaff,
        note: 'Each card is printed at the international CR80 size (85.6 mm × 54 mm landscape, 54 mm × 85.6 mm portrait) — cut along the border and it fits a standard PVC holder or lamination pouch.',
      };
    }

    case 'missingdocs': {
      const docsByStaff = new Map<string, Set<string>>();
      input.documents.forEach((row) => {
        if (!docsByStaff.has(row.staff_user_id)) docsByStaff.set(row.staff_user_id, new Set());
        docsByStaff.get(row.staff_user_id)!.add(row.doc_type);
      });
      const rows: Cell[][] = [];
      activeStaff.forEach((member) => {
        const docs = docsByStaff.get(member.id) ?? new Set<string>();
        const missing: string[] = [];
        if (!docs.has('agreement')) missing.push('Signed agreement');
        if (!member.cnic || !docs.has('cnic_front')) missing.push('CNIC');
        if (!docs.has('degree')) missing.push('Degrees');
        if (!member.photo_url) missing.push('Photo');
        if (missing.length > 0) rows.push([member.full_name, designationFor(member.role), member.staff_code || staffId(member.id), missing.join(', ')]);
      });
      return {
        title: 'Missing Documents & Agreement Audit',
        subtitle: `${rows.length} of ${activeStaff.length} staff have gaps in their file · ${asOf}`,
        landscape: false,
        tables: [{
          head: ['Name', 'Role', 'Staff ID', 'Missing from the file'],
          rows,
        }],
        note: rows.length === 0 ? 'Every active staff file is complete — nothing is missing.' : undefined,
      };
    }

    case 'former': {
      const former = scopedStaff.filter((member) => !isStaffActive(member.status));
      return {
        title: 'Former / Inactive Staff Register',
        subtitle: `${former.length} records · ${asOf}`,
        landscape: false,
        tables: [{
          head: ['Name', 'Role', 'Joining date', 'Leaving date', 'Reason'],
          rows: former.map((member) => [
            member.full_name,
            designationFor(member.role),
            shortDate(member.joining_date),
            shortDate(member.leaving_date),
            member.leaving_reason ?? '',
          ]),
        }],
      };
    }

    case 'paysheet': {
      const monthPayments = input.payments.filter((row) => row.period_month.slice(0, 7) === monthPart(month));
      const sum = (pick: (row: SalaryPayment) => number) => monthPayments.reduce((total, row) => total + pick(row), 0);
      const table: ReportTable = {
        head: ['Name', 'Role', 'Basic', 'H. rent', 'Conv.', 'Medical', 'Other', 'Gross', 'Absent', 'Late', 'Advance', 'PF', 'Other ded.', 'Total ded.', 'Net paid'],
        rows: monthPayments.map((row) => [
          row.staff_name, designationFor(row.staff_role), row.basic_salary, row.house_rent_allowance, row.conveyance_allowance,
          row.medical_allowance, row.other_allowance, row.gross_salary, row.absent_deduction, row.late_deduction,
          row.advance_deduction, row.pf_deduction, row.other_deduction, row.total_deductions, row.net_salary,
        ]),
        totalsRow: [
          'TOTAL', '', sum((row) => row.basic_salary), sum((row) => row.house_rent_allowance), sum((row) => row.conveyance_allowance),
          sum((row) => row.medical_allowance), sum((row) => row.other_allowance), sum((row) => row.gross_salary), sum((row) => row.absent_deduction),
          sum((row) => row.late_deduction), sum((row) => row.advance_deduction), sum((row) => row.pf_deduction), sum((row) => row.other_deduction),
          sum((row) => row.total_deductions), sum((row) => row.net_salary),
        ],
      };
      return {
        title: 'Monthly Master Pay Sheet',
        subtitle: `${monthText} · ${monthPayments.length} payments · Net paid ${money(sum((row) => row.net_salary))}`,
        landscape: true,
        tables: [table],
        signature: input.institution?.principal_name?.trim()
          ? `Principal: ${input.institution.principal_name.trim()}`
          : 'Principal',
        note: monthPayments.length === 0 ? `No salaries have been paid for ${monthText} yet. Pay them in the Pay salary tab first.` : undefined,
      };
    }

    case 'banksheet': {
      const monthPayments = input.payments.filter((row) => row.period_month.slice(0, 7) === monthPart(month));
      const mobileOf = (userId: string) => staff.find((member) => member.id === userId)?.mobile_number ?? '';
      const total = monthPayments.reduce((sum, row) => sum + row.net_salary, 0);
      return {
        title: 'Bank / Raast Salary Transfer Sheet',
        subtitle: `${monthText} · ${monthPayments.length} transfers · Total ${money(total)}`,
        landscape: false,
        tables: [{
          head: ['Name', 'Role', 'Account / Raast mobile', 'Net payable'],
          rows: monthPayments.map((row) => [row.staff_name, designationFor(row.staff_role), mobileOf(row.staff_user_id), row.net_salary]),
          totalsRow: ['TOTAL', '', '', total],
        }],
        note: monthPayments.length === 0 ? `No salaries have been paid for ${monthText} yet.` : 'Raast transfers go to the mobile number registered against each staff member.',
      };
    }

    case 'advpf': {
      const rows: Cell[][] = [];
      let totalAdvance = 0;
      let totalEmployee = 0;
      let totalSchool = 0;
      let totalPf = 0;
      activeStaff.forEach((member) => {
        const outstanding = advanceOutstanding(input.advances, input.payments, member.id);
        const pf = pfTotals(input.contributions, member.id);
        if (outstanding <= 0 && pf.balance <= 0) return;
        totalAdvance += outstanding;
        totalEmployee += pf.employee;
        totalSchool += pf.school;
        totalPf += pf.balance;
        rows.push([member.full_name, designationFor(member.role), outstanding, pf.employee, pf.school, pf.balance, pf.months]);
      });
      return {
        title: 'Salary Advance & Provident Fund Ledger',
        subtitle: `As of ${monthText} · ${asOf}`,
        landscape: false,
        tables: [{
          head: ['Name', 'Role', 'Advance outstanding', 'PF — employee', 'PF — school', 'PF balance', 'Months'],
          rows,
          totalsRow: ['TOTAL', '', totalAdvance, totalEmployee, totalSchool, totalPf, ''],
        }],
        note: rows.length === 0 ? 'No salary advances or provident fund balances are on record yet.' : undefined,
      };
    }

    case 'attfilled': {
      const grid = buildAttGrid(input.staff, input.attendance, month);
      return {
        title: 'Monthly Attendance Register — Filled',
        subtitle: `${monthText} · ${asOf}`,
        landscape: true,
        tables: [],
        attGrid: grid,
        note: `P = Present, A = Absent, L = Late, Lv = On leave. ${STAFF_ATTENDANCE_LABELS.leave} days were approved through the leave register.`,
      };
    }

    case 'attblank': {
      const days = daysInMonth(month);
      return {
        title: 'Monthly Attendance Register — Blank',
        subtitle: `${monthText} · to be marked by hand`,
        landscape: true,
        tables: [],
        attGrid: { days, rows: activeStaff.map((member) => ({
          name: member.full_name,
          role: designationFor(member.role),
          cells: Array.from({ length: days }, () => ''),
          present: 0, absent: 0, late: 0, leave: 0,
        })) },
        note: 'Mark P for present, A for absent, L for late and Lv for leave in the day boxes.',
      };
    }

    case 'leavesummary': {
      const monthText2 = monthText;
      const inMonth = input.leaves.filter((request) =>
        leaveDateRange(request.start_date, request.end_date).some((day) => day.slice(0, 7) === monthPart(month)));
      const lateByStaff = new Map<string, number>();
      input.attendance.forEach((row) => {
        if (row.status === 'late' && row.attendance_date.slice(0, 7) === monthPart(month)) {
          lateByStaff.set(row.staff_user_id, (lateByStaff.get(row.staff_user_id) ?? 0) + 1);
        }
      });
      const lateRows: Cell[][] = [...lateByStaff.entries()].map(([userId, count]) => [name(userId), roleOf(userId), count]);
      return {
        title: 'Monthly Leave & Late Arrival Summary',
        subtitle: `${monthText2} · ${inMonth.length} leave requests · ${lateRows.length} late arrivals · ${asOf}`,
        landscape: false,
        tables: [
          {
            title: 'Leave requests touching this month',
            head: ['Name', 'Type', 'From', 'To', 'Days', 'Status', 'Reason'],
            rows: inMonth.map((request) => [
              name(request.staff_user_id),
              STAFF_LEAVE_TYPE_LABELS[request.leave_type],
              shortDate(request.start_date),
              shortDate(request.end_date),
              leaveDayCount(request.start_date, request.end_date),
              request.status,
              request.reason ?? '',
            ]),
          },
          {
            title: 'Late arrivals this month',
            head: ['Name', 'Role', 'Late days'],
            rows: lateRows,
          },
        ],
        note: inMonth.length === 0 && lateRows.length === 0 ? `No leave requests or late arrivals were recorded for ${monthText2}.` : undefined,
      };
    }
  }
}

function buildAttGrid(staff: StaffMemberRecord[], attendance: StaffAttendanceRecord[], month: string): { days: number; rows: AttGridRow[] } {
  const days = daysInMonth(month);
  const byStaff = new Map<string, Map<string, string>>();
  attendance.forEach((row) => {
    if (row.attendance_date.slice(0, 7) !== monthPart(month)) return;
    if (!byStaff.has(row.staff_user_id)) byStaff.set(row.staff_user_id, new Map());
    byStaff.get(row.staff_user_id)!.set(row.attendance_date.slice(8, 10), ATT_LETTERS[row.status] ?? '?');
  });
  const rows = staff.map((member) => {
    const marks = byStaff.get(member.id) ?? new Map<string, string>();
    const cells = Array.from({ length: days }, (_, index) => marks.get(String(index + 1).padStart(2, '0')) ?? '');
    const count = (letter: string) => cells.filter((cell) => cell === letter).length;
    return {
      name: member.full_name,
      role: designationFor(member.role),
      cells,
      present: count('P'),
      absent: count('A'),
      late: count('L'),
      leave: count('Lv'),
    };
  });
  return { days, rows };
}

function attGridTable(model: ReportModel): ReportTable {
  const grid = model.attGrid!;
  return {
    head: ['Name', ...Array.from({ length: grid.days }, (_, index) => String(index + 1)), 'P', 'A', 'L', 'Lv'],
    rows: grid.rows.map((row) => [row.name, ...row.cells, row.present, row.absent, row.late, row.leave]),
  };
}

function idCardCsvRow(member: StaffMemberRecord): Cell[] {
  return [
    member.full_name,
    member.staff_code || staffId(member.id),
    designationFor(member.role),
    formatCnic(member.cnic),
    member.mobile_number ?? '',
    member.home_address ?? '',
    shortDate(member.joining_date),
  ];
}

function hasContent(model: ReportModel): boolean {
  if (model.attGrid && model.attGrid.rows.length > 0) return true;
  if (model.idcards && model.idcards.length > 0) return true;
  return model.tables.some((table) => table.rows.length > 0);
}

// ---------------------------------------------------------------- on-screen + print sheet

function ReportSheet({ model, institution, templateKey }: { model: ReportModel; institution: InstitutionProfile | null; templateKey: string }) {
  const schoolName = institution?.school_name?.trim() || 'Ujala Public School';
  const schoolNameUrdu = institution?.school_name_urdu?.trim() || '';
  const address = [institution?.address, institution?.city].filter(Boolean).join(', ');
  const contact = [institution?.phone, institution?.email].filter(Boolean).join(' · ');
  const principalName = institution?.principal_name?.trim() || '';

  const idTemplateKey = ID_TEMPLATES.some((tpl) => tpl.key === templateKey) ? templateKey : DEFAULT_ID_TEMPLATE;

  return (
    <article className="report-sheet">
      <header className="report-sheet-head">
        <SchoolLogo alt={`${schoolName} logo`} className="report-sheet-logo" />
        <div className="report-sheet-head-copy">
          <h1>{schoolName}</h1>
          {schoolNameUrdu && <p className="report-sheet-urdu">{schoolNameUrdu}</p>}
          <p>{[address, contact].filter(Boolean).join(' — ')}</p>
        </div>
      </header>
      <div className="report-sheet-meta">
        <span><b>Report:</b> {model.title}</span>
        <span><b>Period:</b> {model.subtitle}</span>
      </div>
      <h2 className="report-sheet-title">{model.title}</h2>

      {model.idcards && model.idcards.length > 0 && (
        <div className={`idc-sheet idc-${idTemplateKey}`}>
          {model.idcards.map((member) => (
            <IdCardPair
              key={member.id}
              member={member}
              templateKey={idTemplateKey}
              schoolName={schoolName}
              principalName={principalName}
            />
          ))}
        </div>
      )}

      {model.attGrid && model.attGrid.rows.length > 0 && (
        <table className="report-sheet-table report-att-grid">
          <thead>
            <tr>
              <th>Name</th>
              {Array.from({ length: model.attGrid.days }, (_, index) => <th key={index}>{index + 1}</th>)}
              <th>P</th><th>A</th><th>L</th><th>Lv</th>
            </tr>
          </thead>
          <tbody>
            {model.attGrid.rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td className="report-att-name">{row.name}</td>
                {row.cells.map((cell, cellIndex) => <td key={cellIndex} className="report-att-cell">{cell}</td>)}
                <td>{row.present}</td><td>{row.absent}</td><td>{row.late}</td><td>{row.leave}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {model.tables.map((table, tableIndex) => (
        <div key={tableIndex}>
          {table.title && <h3 className="report-sheet-table-title">{table.title}</h3>}
          {table.rows.length > 0 ? (
            <table className="report-sheet-table">
              <thead>
                <tr>{table.head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={typeof cell === 'number' ? 'report-num' : undefined}>
                        {typeof cell === 'number' && isMoneyCell(table, cellIndex) ? money(cell) : (cell ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.totalsRow && (
                <tfoot>
                  <tr>
                    {table.totalsRow.map((cell, cellIndex) => (
                      <td key={cellIndex} className={typeof cell === 'number' ? 'report-num' : undefined}>
                        {typeof cell === 'number' && isMoneyCell(table, cellIndex) ? money(cell) : (cell ?? '')}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <p className="report-empty-note">No records for these filters.</p>
          )}
        </div>
      ))}

      {model.note && <p className="report-sheet-note">{model.note}</p>}

      {model.signature && (
        <div className="report-sheet-sign-row">
          <div className="report-sheet-signature">
            <strong>{model.signature}</strong>
            <span>Signature & date</span>
          </div>
        </div>
      )}
    </article>
  );
}

// Money columns are any column whose header or rows carry salary amounts; the simplest
// safe rule is: numeric cells in columns past the third are formatted as rupees.
const MONEY_REPORTS_WITH_HEADERS = new Set([
  'Basic', 'H. rent', 'Conv.', 'Medical', 'Other', 'Gross', 'Absent', 'Late', 'Advance', 'PF',
  'Other ded.', 'Total ded.', 'Net paid', 'Net payable', 'Advance outstanding', 'PF — employee',
  'PF — school', 'PF balance',
]);

function isMoneyCell(table: ReportTable, columnIndex: number): boolean {
  return MONEY_REPORTS_WITH_HEADERS.has(table.head[columnIndex] ?? '');
}


// ---------------------------------------------------------------- ID card renderer

// The card is drawn at the exact CR80 print size using millimetre units, so the browser
// and the printer agree on its physical dimensions. A CSS variable carries the selected
// design, and every template styles the same markup its own way.
function IdCardPair({ member, templateKey, schoolName, principalName }: {
  member: StaffMemberRecord;
  templateKey: string;
  schoolName: string;
  principalName: string;
}) {
  const template = ID_TEMPLATES.find((tpl) => tpl.key === templateKey) ?? ID_TEMPLATES[0];
  const code = member.staff_code || staffId(member.id);
  const barcode = code39Shape(sanitizeBarcodeValue(code), 1, 26);

  return (
    <div className={`idc-pair idc-${template.key}${template.orientation === 'portrait' ? ' idc-portrait' : ''}`}>
      <div className="idc-card idc-front">
        <div className="idc-head">
          <span className="idc-logo-badge"><SchoolLogo alt="" className="idc-logo" /></span>
          <span className="idc-school">{schoolName}</span>
          <span className="idc-tag">Staff ID Card</span>
        </div>
        <div className="idc-photo-wrap">
          <PersonAvatar photoUrl={member.photo_url} name={member.full_name} className="idc-photo" />
        </div>
        <div className="idc-details">
          <strong className="idc-name">{member.full_name}</strong>
          <span className="idc-role">{designationFor(member.role)}</span>
          <span className="idc-code">{code}</span>
        </div>
        <div className="idc-foot">
          <svg
            className="idc-barcode"
            role="img"
            aria-label={`Barcode ${sanitizeBarcodeValue(code)}`}
            viewBox={`0 0 ${barcode.width} ${barcode.height}`}
            preserveAspectRatio="none"
          >
            {barcode.bars.map((bar) => (
              <rect key={`${bar.x}-${bar.width}`} x={bar.x} y="0" width={bar.width} height={barcode.height} fill="#111111" />
            ))}
          </svg>
        </div>
      </div>
      <div className="idc-card idc-back">
        <div className="idc-head idc-head-back">
          <span className="idc-school">{schoolName}</span>
          <span className="idc-tag">Staff ID Card — Back</span>
        </div>
        <div className="idc-back-rows">
          <p><b>CNIC</b>{formatCnic(member.cnic) || '—'}</p>
          <p><b>Emergency contact</b>{member.mobile_number || '—'}</p>
          <p><b>Address</b>{member.home_address || '—'}</p>
          <p><b>Joined</b>{shortDate(member.joining_date) || '—'}</p>
        </div>
        <div className="idc-back-foot">
          <span className="idc-return">If found, please return to {schoolName}.</span>
          <span className="idc-sign">
            <i>{principalName || 'Principal'}</i>
            <em>Principal Signature</em>
          </span>
        </div>
      </div>
    </div>
  );
}

// The click-to-apply design gallery: six live mini-previews drawn with the same CSS
// classes as the real cards, scaled down, so what you click is what prints.
function IdTemplateGallery({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="idc-gallery" role="listbox" aria-label="ID card design">
      {ID_TEMPLATES.map((template) => (
        <button
          key={template.key}
          type="button"
          role="option"
          aria-selected={value === template.key}
          className={`idc-thumb${value === template.key ? ' selected' : ''}`}
          onClick={() => onChange(template.key)}
          title={`${template.name} (${template.orientation})`}
        >
          <span className={`idc-thumb-card idc-${template.key}${template.orientation === 'portrait' ? ' idc-portrait' : ''}`}>
            <span className="idc-thumb-head" />
            <span className="idc-thumb-photo" />
            <span className="idc-thumb-line" />
            <span className="idc-thumb-line short" />
          </span>
          <span className="idc-thumb-name">{template.name}</span>
          <span className="idc-thumb-orient">{template.orientation}</span>
        </button>
      ))}
    </div>
  );
}
