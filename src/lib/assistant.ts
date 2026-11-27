import { supabase } from '@/lib/supabase';
import { fetchFeePayments, formatMoney, monthKey, monthLabel, collectedInMonth, collectedOn, methodTotals } from '@/lib/fees';
import { pickWhatsAppContact } from '@/lib/whatsapp';
import { DEFAULT_ALERT_WORDING } from '@/lib/alertStatuses';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { todayKey, formatPercentage } from '@/lib/attendance';
import { fetchPortalNotifications } from '@/lib/absenteeAlerts';
import { fetchHomework, fetchPortalHomework, portalDiaryText } from '@/lib/homework';
import { buildAiContext } from '@/lib/assistantAiContext';
import { askGemini } from '@/lib/assistantGemini';
import {
  canUseIntent,
  canUseTool,
  deniedMessage,
  isPortalRole,
  ROLE_LABELS,
  scopeLabel,
  type AssistantIntentKind,
  type AssistantTool,
} from '@/lib/assistantRoles';
import type { Attendance } from '@/lib/schoolData';
import type { Student } from '@/lib/schoolTypes';
import type { UserProfile, UserRole } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Reply shape — a small, fixed vocabulary of blocks the widget knows how to draw.
// Keeping the shape here means the assistant logic stays testable and the widget
// stays a dumb renderer.
// ---------------------------------------------------------------------------

export type AssistantStat = { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'info' };
export type AssistantListItem = { title: string; subtitle?: string; meta?: string };
export type AssistantTable = { columns: string[]; rows: string[][] };

export type AssistantAction =
  | { id: string; label: string; kind: 'copy'; text: string }
  | { id: string; label: string; kind: 'whatsapp'; phone: string; message: string }
  | { id: string; label: string; kind: 'navigate'; view: string }
  | { id: string; label: string; kind: 'tool'; tool: AssistantTool };

export type AssistantReply = {
  title: string;
  notes?: string[];
  stats?: AssistantStat[];
  table?: AssistantTable;
  list?: AssistantListItem[];
  actions?: AssistantAction[];
  followUps?: string[];
  openTool?: AssistantTool;
};

export type { AssistantIntentKind, AssistantTool };

export type AssistantIntent = { kind: AssistantIntentKind; query: string };

export type AssistantContext = {
  students: Student[];
  attendance: Attendance[];
  profile: UserProfile;
  // The student ids a parent account is linked to, and the id a student account belongs
  // to. Both are empty for staff, which is what keeps their answers school-wide.
  linkedStudentIds: string[];
  ownStudentId: string | null;
};

// ---------------------------------------------------------------------------
// Intent detection — plain keyword matching. No network, no model, no cost.
// Order matters: the more specific phrases are tested first so "fee defaulters"
// is not swallowed by the broader "fee" wording.
// ---------------------------------------------------------------------------

const RULES: { kind: AssistantIntentKind; pattern: RegExp }[] = [
  { kind: 'datesheet', pattern: /date\s*sheet|datesheet|exam schedule|paper schedule|schedule of papers/i },
  { kind: 'paper', pattern: /quiz|test paper|question paper|worksheet|mcqs?\b|past paper|generate .*paper|make .*paper|prepare .*paper|paper banao|paper ban|test banao/i },
  { kind: 'classOff', pattern: /class\s*(off|closed|holiday)|off day|mark .*off|close .*class|class off/i },
  { kind: 'results', pattern: /result|marks|grades?|report card|position|percentage|fail|pass(ed)?/i },
  { kind: 'missing', pattern: /missing|incomplete|not complete|pending detail|incomplete record|missing detail/i },
  { kind: 'notices', pattern: /notice|template|wording|message text|clearance reminder|warning notice|draft|announcement/i },
  { kind: 'homework', pattern: /home\s*work|homework|assignment|diary|copy work|class ?work/i },
  { kind: 'defaulters', pattern: /defaulter|dues?|pending fee|unpaid|outstanding|arrear|not paid|fee status|fee balance/i },
  { kind: 'collection', pattern: /collection|collected|received|takings|daily closing|cash (book|summary)/i },
  { kind: 'attendance', pattern: /attendance|present|absent|register|marked|leave/i },
  { kind: 'staff', pattern: /staff|teacher|employee|faculty/i },
  { kind: 'students', pattern: /student|lookup|find|search|admission|record of|my child|my son|my daughter|mera/i },
  { kind: 'help', pattern: /help|what can you|command|options|how do i|guide/i },
];

// Words that carry no search value, stripped before a name or number is matched.
const FILLER = /\b(the|a|an|of|for|find|search|lookup|look up|show|me|please|student|staff|record|details|detail|info|information|about|my|child|children|son|daughter|kya|ka|ki|hai|kar|do|ko|kaun|batao|bata|mera|meri)\b/gi;

export function detectIntent(raw: string): AssistantIntent {
  const text = raw.trim();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { kind: rule.kind, query: cleanQuery(text) };
    }
  }
  // A bare name or admission number is a student lookup.
  if (text.length >= 2) return { kind: 'students', query: cleanQuery(text) };
  return { kind: 'unknown', query: '' };
}

function cleanQuery(text: string): string {
  return text.replace(FILLER, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const activeStudents = (students: Student[]) => students.filter((student) => student.status === 'active');

const searchStudents = (students: Student[], query: string): Student[] => {
  const needle = query.toLowerCase();
  if (!needle) return [];
  return students.filter((student) => [
    student.full_name,
    student.admission_number,
    student.class_name,
    student.section_name,
    student.fathers_name ?? '',
    student.guardian_name ?? '',
    student.roll_number ?? '',
  ].join(' ').toLowerCase().includes(needle));
};

const hasContact = (student: Student) => Boolean(pickWhatsAppContact(student).number);

// The details an office most often finds missing when it needs them: a photo for
// the record, a reachable number, a guardian name, the fee setup, and a date of
// birth. Each missing one is reported by name so it can be fixed at the source.
function missingFields(student: Student, forPortal = false): string[] {
  const missing: string[] = [];
  if (!student.photo_url) missing.push('photo');
  if (!hasContact(student)) missing.push('phone no');
  if (!student.guardian_name && !student.fathers_name) missing.push('guardian name');
  const tuition = Number(student.tuition_fee ?? 0) || Number(student.net_tuition_fee ?? 0);
  if (tuition <= 0) missing.push('fee setup');
  // A date of birth is never named back to a parent or a student.
  if (!student.date_of_birth && !forPortal) missing.push('date of birth');
  return missing;
}

export const STUDENT_FIELDS = ['photo', 'phone no', 'guardian name', 'fee setup', 'date of birth'];

// The students a role is allowed to see at all. Staff see the whole roster; a parent
// sees only their linked children; a student sees only themselves.
function visibleStudents(ctx: AssistantContext): Student[] {
  if (!isPortalRole(ctx.profile.role)) return ctx.students;
  const allowed = new Set([...ctx.linkedStudentIds, ...(ctx.ownStudentId ? [ctx.ownStudentId] : [])]);
  return ctx.students.filter((student) => allowed.has(student.id));
}

const scopedRoster = (ctx: AssistantContext) => activeStudents(visibleStudents(ctx));

// A teacher works with the classes they are attached to. Where no attachment is
// recorded the teacher keeps the full roster, so nothing is hidden by accident.
function teacherClasses(profile: UserProfile): string[] | null {
  if (profile.role !== 'teacher') return null;
  const profileClasses = (profile as UserProfile & { class_names?: string[] | null }).class_names;
  return Array.isArray(profileClasses) && profileClasses.length > 0 ? profileClasses : null;
}

// ---------------------------------------------------------------------------
// Reply builders — staff
// ---------------------------------------------------------------------------

function attendanceReply(ctx: AssistantContext): AssistantReply {
  const restricted = teacherClasses(ctx.profile);
  const roster = scopedRoster(ctx).filter((student) => !restricted || restricted.includes(student.class_name));
  const byId = new Map(ctx.attendance.map((record) => [record.student_id, record.status]));
  const counts = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const student of roster) {
    const status = byId.get(student.id);
    if (status === 'present' || status === 'absent' || status === 'late' || status === 'leave') counts[status] += 1;
  }
  const marked = counts.present + counts.absent + counts.late + counts.leave;
  const percent = marked ? (counts.present / marked) * 100 : 0;
  const unmarked = Math.max(0, roster.length - marked);

  const classes = Array.from(new Set(roster.map((student) => student.class_name))).sort();
  const rows = classes.map((className) => {
    const inClass = roster.filter((student) => student.class_name === className);
    const tally = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const student of inClass) {
      const status = byId.get(student.id);
      if (status === 'present' || status === 'absent' || status === 'late' || status === 'leave') tally[status] += 1;
    }
    const classMarked = tally.present + tally.absent + tally.late + tally.leave;
    return [className, String(tally.present), String(tally.absent), String(tally.late), String(tally.leave), `${classMarked}/${inClass.length}`];
  });

  const canSendAlerts = ctx.profile.role === 'admin' || ctx.profile.role === 'office_assistant' || ctx.profile.role === 'teacher';
  return {
    title: `Today's attendance — ${todayKey()}`,
    notes: [
      unmarked > 0
        ? `${unmarked} student${unmarked === 1 ? '' : 's'} not marked yet. Open Daily Attendance to complete the register.`
        : 'The register is complete for today.',
      ...(restricted ? [`Showing only your classes: ${restricted.join(', ')}.`] : []),
    ],
    stats: [
      { label: 'Present', value: String(counts.present), tone: 'good' },
      { label: 'Absent', value: String(counts.absent), tone: 'bad' },
      { label: 'Late', value: String(counts.late), tone: 'warn' },
      { label: 'On leave', value: String(counts.leave), tone: 'info' },
      { label: 'Attendance', value: formatPercentage(percent), tone: 'info' },
      { label: 'Marked', value: `${marked}/${roster.length}`, tone: 'info' },
    ],
    table: rows.length ? { columns: ['Class', 'Present', 'Absent', 'Late', 'Leave', 'Marked'], rows } : undefined,
    actions: [
      { id: 'go-attendance', label: 'Open Daily Attendance', kind: 'navigate', view: 'attendance' },
      ...(canSendAlerts ? [{ id: 'go-sms', label: 'Send absentee alerts', kind: 'navigate' as const, view: 'sms' }] : []),
    ],
    followUps: ['Absentee notices', 'Missing records', 'Exam datesheet'],
  };
}

function defaultersReply(ctx: AssistantContext): AssistantReply {
  const defaulters = activeStudents(ctx.students)
    .map((student) => ({ student, due: Math.max(0, Number(student.fee_balance ?? 0)) }))
    .filter((row) => row.due > 0)
    .sort((a, b) => b.due - a.due);

  const totalDue = defaulters.reduce((sum, row) => sum + row.due, 0);
  const withPhone = defaulters.filter((row) => hasContact(row.student));

  const rows = defaulters.slice(0, 12).map((row) => [
    row.student.full_name,
    `${row.student.class_name}-${row.student.section_name}`,
    hasContact(row.student) ? 'Yes' : 'No',
    formatMoney(row.due),
  ]);

  const copyText = [
    `${SCHOOL_NAME} — Fee defaulters (${todayKey()})`,
    ...defaulters.map((row) => `${row.student.full_name} (${row.student.class_name}-${row.student.section_name}) — ${formatMoney(row.due)}`),
    `Total outstanding: ${formatMoney(totalDue)}`,
  ].join('\n');

  const canRemind = canUseTool(ctx.profile.role, 'reminders');
  return {
    title: 'Fee defaulters',
    notes: defaulters.length
      ? [`${defaulters.length} student${defaulters.length === 1 ? '' : 's'} with an outstanding balance. ${withPhone.length} can be reached on WhatsApp.`]
      : ['No outstanding balances right now. Every fee account is clear.'],
    stats: [
      { label: 'Defaulters', value: String(defaulters.length), tone: defaulters.length ? 'warn' : 'good' },
      { label: 'Total due', value: formatMoney(totalDue), tone: 'bad' },
      { label: 'Reachable', value: String(withPhone.length), tone: 'info' },
    ],
    table: rows.length ? { columns: ['Student', 'Class', 'WhatsApp', 'Due'], rows } : undefined,
    actions: defaulters.length ? [
      ...(canRemind ? [{ id: 'open-reminders', label: 'Send WhatsApp reminders', kind: 'tool' as const, tool: 'reminders' as const }] : []),
      { id: 'copy-defaulters', label: 'Copy list', kind: 'copy' as const, text: copyText },
      { id: 'go-fees', label: 'Open Fee Management', kind: 'navigate' as const, view: 'fees' },
    ] : [
      { id: 'go-fees', label: 'Open Fee Management', kind: 'navigate', view: 'fees' },
    ],
    followUps: ['Fee collection', 'Missing records', 'Notices & templates'],
  };
}

async function collectionReply(ctx: AssistantContext): Promise<AssistantReply> {
  const month = monthKey();
  const day = todayKey();
  const { payments, error } = await fetchFeePayments(500);

  if (error) {
    return {
      title: 'Fee collection snapshot',
      notes: [error],
      followUps: ['Fee defaulters', 'Missing records'],
    };
  }

  const collected = collectedInMonth(payments, month);
  const today = collectedOn(payments, day);
  const outstanding = activeStudents(ctx.students).reduce((sum, student) => sum + Math.max(0, Number(student.fee_balance ?? 0)), 0);
  const expected = collected + outstanding;
  const percent = expected ? (collected / expected) * 100 : 0;
  const methods = methodTotals(payments, month);

  const copyText = [
    `${SCHOOL_NAME} — Fee collection (${monthLabel(month)})`,
    `Collected: ${formatMoney(collected)}`,
    `Pending: ${formatMoney(outstanding)}`,
    `Collected today: ${formatMoney(today)}`,
    ...methods.map((method) => `${method.label}: ${formatMoney(method.amount)}`),
  ].join('\n');

  const canRemind = canUseTool(ctx.profile.role, 'reminders');
  return {
    title: `Fee collection — ${monthLabel(month)}`,
    notes: [`Collected against a total of ${formatMoney(expected)} billed this month (${formatPercentage(percent)} recovered).`],
    stats: [
      { label: 'Collected', value: formatMoney(collected), tone: 'good' },
      { label: 'Pending', value: formatMoney(outstanding), tone: 'bad' },
      { label: 'Today', value: formatMoney(today), tone: 'info' },
      { label: 'Recovered', value: formatPercentage(percent), tone: 'info' },
    ],
    table: { columns: ['Method', 'Collected this month'], rows: methods.map((method) => [method.label, formatMoney(method.amount)]) },
    actions: [
      { id: 'copy-collection', label: 'Copy snapshot', kind: 'copy', text: copyText },
      { id: 'go-fees', label: 'Open Fee Management', kind: 'navigate', view: 'fees' },
      ...(canRemind ? [{ id: 'open-reminders', label: 'Remind defaulters', kind: 'tool' as const, tool: 'reminders' as const }] : []),
    ],
    followUps: ['Fee defaulters', 'Notices & templates', 'Missing records'],
  };
}

function studentsReply(ctx: AssistantContext, query: string): AssistantReply {
  // A parent or a student has no school-wide lookup: the only record that exists for
  // them is the one linked to their own account.
  if (isPortalRole(ctx.profile.role)) {
    const roster = scopedRoster(ctx);
    if (roster.length === 0) {
      return {
        title: 'Your record',
        notes: ['No student record is linked to this account yet. Please contact the school office.'],
        followUps: ['Notices', 'Attendance'],
      };
    }
    return {
      title: 'Your record',
      notes: ['This assistant only ever shows the record linked to your own account.'],
      list: roster.map((student) => ({
        title: student.full_name,
        subtitle: `Class ${student.class_name}-${student.section_name} · Adm. no. ${student.admission_number}`,
        meta: Number(student.fee_balance ?? 0) > 0 ? `Fee pending: ${formatMoney(Number(student.fee_balance))}` : 'Fee clear',
      })),
      followUps: ['Exam results', 'Attendance', 'Notices', 'Fee status'],
    };
  }

  const roster = visibleStudents(ctx);
  if (!query) {
    return {
      title: 'Student lookup',
      notes: ['Type a student name or admission number, for example "Ayesha" or "SD-1042".'],
      followUps: ['Missing records', 'Fee defaulters'],
    };
  }

  const matches = searchStudents(roster, query);
  const rows = matches.slice(0, 15).map((student) => [
    student.full_name,
    student.admission_number,
    `${student.class_name}-${student.section_name}`,
    student.fathers_name || student.guardian_name || '—',
    formatMoney(Number(student.fee_balance ?? 0)),
  ]);

  return {
    title: `Student lookup — "${query}"`,
    notes: matches.length
      ? [`${matches.length} match${matches.length === 1 ? '' : 'es'} found.`]
      : ['No student matched that name or admission number.'],
    table: rows.length ? { columns: ['Name', 'Adm. no.', 'Class', 'Father / Guardian', 'Balance'], rows } : undefined,
    actions: matches.length
      ? [{ id: 'go-students', label: 'Open Student Search', kind: 'navigate', view: 'students' }]
      : undefined,
    followUps: ['Missing records', 'Fee defaulters'],
  };
}

async function staffReply(ctx: AssistantContext, query: string): Promise<AssistantReply> {
  const staffRoles = ['admin', 'teacher', 'office_assistant', 'accountant', 'support_staff'];
  let users: { id: string; username: string; full_name: string; role: string; status: string }[] = [];
  let loadError: string | null = null;
  try {
    const { data, error: queryError } = await supabase
      .from('user_profiles')
      .select('id, username, full_name, role, status')
      .in('role', staffRoles)
      .order('full_name');
    if (queryError) loadError = 'The staff list could not be loaded.';
    else users = (data ?? []) as typeof users;
  } catch {
    loadError = 'The staff list could not be loaded. Check your connection and try again.';
  }

  const needle = query.toLowerCase();
  const matches = needle
    ? users.filter((user) => `${user.full_name} ${user.username} ${user.role}`.toLowerCase().includes(needle))
    : users;

  const roleLabel: Record<string, string> = {
    admin: 'Administrator', teacher: 'Teacher', office_assistant: 'Office Assistant', accountant: 'Accountant',
  };

  return {
    title: query ? `Staff lookup — "${query}"` : 'Staff directory',
    notes: loadError
      ? [loadError]
      : [matches.length ? `${matches.length} staff member${matches.length === 1 ? '' : 's'} listed.` : 'No staff member matched that search.'],
    list: matches.slice(0, 20).map((user) => ({
      title: user.full_name,
      subtitle: `${roleLabel[user.role] ?? user.role} · @${user.username}`,
      meta: user.status === 'active' ? 'Active' : 'Suspended',
    })),
    actions: [{ id: 'go-staff', label: 'Open Staff Management', kind: 'navigate', view: 'staff' }],
    followUps: ["Today's attendance", 'Missing records'],
  };
}

function missingReply(ctx: AssistantContext): AssistantReply {
  const restricted = teacherClasses(ctx.profile);
  // A parent or student may only ask about their own record, so the check is narrowed
  // to them rather than listing the school.
  const ownOnly = isPortalRole(ctx.profile.role);
  const roster = scopedRoster(ctx).filter((student) => !restricted || restricted.includes(student.class_name));
  const rows = roster
    .map((student) => ({ student, missing: missingFields(student, ownOnly) }))
    .filter((row) => row.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  const table = rows.slice(0, 15).map((row) => [
    row.student.full_name,
    `${row.student.class_name}-${row.student.section_name}`,
    row.missing.join(', '),
  ]);

  const counts = STUDENT_FIELDS.map((field) => ({
    field,
    count: rows.filter((row) => row.missing.includes(field)).length,
  })).filter((item) => item.count > 0);

  const copyText = [
    `${SCHOOL_NAME} — Missing record check (${todayKey()})`,
    ...rows.map((row) => `${row.student.full_name} (${row.student.class_name}-${row.student.section_name}): ${row.missing.join(', ')}`),
  ].join('\n');

  // A parent or student may only ask about their own record, so the check is narrowed
  // to them rather than listing the school.
  return {
    title: 'Missing record check',
    notes: rows.length
      ? [
        ownOnly
          ? `Your record is missing: ${rows[0].missing.join(', ')}. Please bring the missing detail to the school office.`
          : `${rows.length} student${rows.length === 1 ? '' : 's'} have at least one detail missing. Incomplete records can be completed from Student Search.`,
      ]
      : [ownOnly ? 'Your record is complete. Nothing is missing.' : 'Every active student record is complete. Nothing is missing.'],
    stats: ownOnly ? undefined : counts.map((item) => ({ label: item.field, value: String(item.count), tone: 'warn' as const })),
    table: table.length ? { columns: ['Student', 'Class', 'Missing'], rows: table } : undefined,
    actions: rows.length && !ownOnly
      ? [
        { id: 'copy-missing', label: 'Copy list', kind: 'copy', text: copyText },
        { id: 'go-students', label: 'Open Student Search', kind: 'navigate', view: 'students' },
      ]
      : undefined,
    followUps: ['Fee defaulters', "Today's attendance"],
  };
}

// The wording lives in one place — the saved Message & Notice Templates — so the
// assistant reads the same rows the office edits in Settings.
type NoticeWording = { notice_type: string; language: 'English' | 'Urdu'; template_text: string };

async function noticesReply(ctx: AssistantContext): Promise<AssistantReply> {
  let templates: NoticeWording[] = [];
  try {
    const { data } = await supabase
      .from('school_notice_templates')
      .select('notice_type, language, body_english, body_urdu')
      .in('notice_type', ['fee_clearance_reminder', 'fee_due_reminder', 'warning_notice']);
    templates = ((data ?? []) as { notice_type: string; language: 'English' | 'Urdu'; body_english: string; body_urdu: string }[])
      .map((row) => ({
        notice_type: row.notice_type,
        language: row.language,
        template_text: row.language === 'Urdu' ? row.body_urdu : row.body_english,
      }));
  } catch {
    templates = [];
  }

  const find = (type: string, language: 'English' | 'Urdu') =>
    templates.find((template) => template.notice_type === type && template.language === language)?.template_text ?? '';

  const clearanceEn = find('fee_clearance_reminder', 'English') || find('fee_due_reminder', 'English') || 'Dear Parent, please clear the outstanding school dues for {student_name} at your earliest convenience. — {school_name}';
  const clearanceUr = find('fee_clearance_reminder', 'Urdu') || find('fee_due_reminder', 'Urdu') || 'محترم والدین، براہِ کرم {student_name} کے واجب الادا اسکول فیس جلد از جلد ادا کریں۔ — {school_name}';
  const warningEn = find('warning_notice', 'English') || 'Dear Parent, this is an important notice regarding {student_name} pending clearance. Kindly contact the school office. — {school_name}';
  const warningUr = find('warning_notice', 'Urdu') || 'محترم والدین، یہ {student_name} کی بقایا رقوم سے متعلق اہم نوٹس ہے۔ براہِ کرم اسکول دفتر سے رابطہ کریں۔ — {school_name}';

  // Staff draft and copy notices. A parent or student may read the wording their school
  // sends, but the assistant never messages anyone on their behalf.
  const canDraft = !isPortalRole(ctx.profile.role);
  const absenteeEn = DEFAULT_ALERT_WORDING.absent.English;
  const absenteeUr = DEFAULT_ALERT_WORDING.absent.Urdu;

  return {
    title: canDraft ? 'Notices & templates' : 'School notices',
    notes: canDraft
      ? [
        'The placeholders {student_name} and {school_name} are filled in automatically when a notice is sent.',
        'These are the saved templates. Edit the wording in Settings → Notice settings.',
      ]
      : [
        'These are the notices your school sends. The office prepares and sends them — this assistant will not message anyone on your behalf.',
      ],
    list: [
      { title: 'Fee clearance reminder — English', subtitle: clearanceEn, meta: 'Copy' },
      { title: 'Fee clearance reminder — اردو', subtitle: clearanceUr, meta: 'Copy' },
      { title: 'Warning notice — English', subtitle: warningEn, meta: 'Copy' },
      { title: 'Warning notice — اردو', subtitle: warningUr, meta: 'Copy' },
      { title: 'Absentee alert — English', subtitle: absenteeEn, meta: 'Copy' },
      { title: 'Absentee alert — اردو', subtitle: absenteeUr, meta: 'Copy' },
    ],
    actions: [
      { id: 'copy-clearance-en', label: 'Copy reminder (EN)', kind: 'copy', text: clearanceEn },
      { id: 'copy-clearance-ur', label: 'Copy reminder (UR)', kind: 'copy', text: clearanceUr },
      { id: 'copy-warning-en', label: 'Copy warning (EN)', kind: 'copy', text: warningEn },
      { id: 'copy-warning-ur', label: 'Copy warning (UR)', kind: 'copy', text: warningUr },
      ...(ctx.profile.role === 'admin'
        ? [{ id: 'go-settings', label: 'Open Notice settings', kind: 'navigate' as const, view: 'settings' }]
        : []),
    ],
    followUps: canDraft ? ['Fee defaulters', 'Class off day'] : ['Exam results', 'Fee status'],
  };
}

function classOffReply(ctx: AssistantContext): AssistantReply {
  const restricted = teacherClasses(ctx.profile);
  const canSendNotice = canUseTool(ctx.profile.role, 'datesheet');
  return {
    title: 'Mark a class off',
    notes: [
      'Choose a date and the classes that are off. Those classes are left out of that day\'s absentee alerts and WhatsApp SMS, so no parent is messaged for a class that was not expected in school.',
      canSendNotice
        ? 'You can also copy or send a short class-off notice to parents.'
        : 'You can mark the classes off; ask the administrator or office to send the parent notice.',
      ...(restricted ? [`Only your classes (${restricted.join(', ')}) should be marked off.`] : []),
    ],
    openTool: 'classOff',
    actions: [{ id: 'open-classoff', label: 'Open class-off tool', kind: 'tool', tool: 'classOff' }],
    followUps: ['Exam datesheet', "Today's attendance"],
  };
}

function datesheetReply(ctx: AssistantContext): AssistantReply {
  const restricted = teacherClasses(ctx.profile);
  return {
    title: 'Exam datesheet',
    notes: [
      'Pick a class, a start date and the subjects in order. The datesheet skips weekly off days and school holidays, and can leave a gap between papers.',
      'The finished sheet can be copied, printed, or exported as a notice.',
      ...(restricted ? [`Build datesheets for your classes: ${restricted.join(', ')}.`] : []),
    ],
    openTool: 'datesheet',
    actions: [{ id: 'open-datesheet', label: 'Open datesheet builder', kind: 'tool', tool: 'datesheet' }],
    followUps: ['Class off day', 'Notices & templates'],
  };
}

// The quiz and paper generator. The paper itself is written by Gemini on the server, so
// this reply only opens the tool and explains what it needs — a topic or a photo of the
// textbook page.
function paperReply(ctx: AssistantContext): AssistantReply {
  const restricted = teacherClasses(ctx.profile);
  return {
    title: 'Quiz / paper generator',
    notes: [
      'Take a photo of a textbook or exercise page, or type the topic, and the assistant writes a printable quiz paper with MCQs, short questions and an answer key.',
      'The finished paper can be copied, printed, or saved as a PDF from the print dialog.',
      ...(restricted ? [`You can set papers for your classes: ${restricted.join(', ')}.`] : []),
    ],
    openTool: 'paper',
    actions: [{ id: 'open-paper', label: 'Open quiz generator', kind: 'tool', tool: 'paper' }],
    followUps: ['Exam datesheet', 'Homework diary'],
  };
}

// ---------------------------------------------------------------------------
// Reply builders — the student's own record, and the parent's child
// ---------------------------------------------------------------------------

type ResultRow = { exam_name: string; subject_name: string; obtained_marks: number | null; is_absent: boolean; max_marks: number; pass_marks: number };

type ResultsPayload = {
  blocked?: boolean;
  error?: string;
  student_name?: string;
  class_name?: string;
  section_name?: string;
  due_amount?: number;
  results?: ResultRow[];
};

// The fee gate lives on the server: the database refuses to hand over marks while the
// student owes fees, and this screen simply shows what it is given.
async function fetchStudentResults(studentId: string): Promise<{ payload: ResultsPayload | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('assistant_student_results', { p_student_id: studentId });
    if (error) return { payload: null, error: 'The results could not be loaded.' };
    return { payload: (data ?? null) as ResultsPayload | null, error: null };
  } catch {
    return { payload: null, error: 'The results could not be loaded. Check your connection and try again.' };
  }
}

function feePendingReply(student: Student, due: number, reason: string): AssistantReply {
  return {
    title: 'Pending fee reminder',
    notes: [
      reason,
      `The fee account for ${student.full_name} (${student.class_name} · Section ${student.section_name}) has an outstanding balance of ${formatMoney(due)}.`,
      'Please clear the dues at the school office. Exam results and homework will be available again once the account is clear.',
    ],
    stats: [
      { label: 'Outstanding', value: formatMoney(due), tone: 'bad' },
      { label: 'Class', value: `${student.class_name}-${student.section_name}`, tone: 'info' },
    ],
    followUps: ['Notices', 'Attendance'],
  };
}

async function portalResultsReply(ctx: AssistantContext): Promise<AssistantReply> {
  const roster = scopedRoster(ctx);
  if (roster.length === 0) {
    return {
      title: 'Exam results',
      notes: ['No student record is linked to this account yet. Please contact the school office.'],
      followUps: ['Notices', 'Attendance'],
    };
  }

  // A parent may be linked to more than one child, so each child is reported on.
  const replies = await Promise.all(roster.map(async (student) => {
    const due = Math.max(0, Number(student.fee_balance ?? 0));
    if (due > 0) return { student, reply: feePendingReply(student, due, 'Exam results are held while the fee account has a pending balance.') };

    const { payload, error } = await fetchStudentResults(student.id);
    if (error || !payload) {
      return {
        student,
        reply: { title: `Exam results — ${student.full_name}`, notes: [error ?? 'The results could not be loaded.'] } as AssistantReply,
      };
    }
    if (payload.error === 'not_allowed') {
      return {
        student,
        reply: { title: 'Exam results', notes: ['This account is not allowed to view those results.'] } as AssistantReply,
      };
    }
    if (payload.blocked) {
      return { student, reply: feePendingReply(student, Number(payload.due_amount ?? due), 'Exam results are held while the fee account has a pending balance.') };
    }

    const rows = payload.results ?? [];
    if (rows.length === 0) {
      return {
        student,
        reply: {
          title: `Exam results — ${student.full_name}`,
          notes: [`No marks have been entered for ${student.full_name} yet. Results will appear here once the teacher publishes them.`],
          followUps: ['Notices', 'Attendance'],
        } as AssistantReply,
      };
    }

    const examNames = Array.from(new Set(rows.map((row) => row.exam_name)));
    const latest = examNames[examNames.length - 1];
    const latestRows = rows.filter((row) => row.exam_name === latest);

    let scored = 0;
    let possible = 0;
    for (const row of latestRows) {
      if (row.obtained_marks === null || row.is_absent) continue;
      scored += Number(row.obtained_marks);
      possible += Number(row.max_marks);
    }
    const percent = possible ? (scored / possible) * 100 : 0;

    const table: AssistantTable = {
      columns: ['Subject', 'Marks', 'Out of', 'Result'],
      rows: latestRows.map((row) => [
        row.subject_name,
        row.is_absent || row.obtained_marks === null ? '—' : String(Number(row.obtained_marks)),
        String(Number(row.max_marks)),
        row.is_absent ? 'Absent' : row.obtained_marks === null ? 'Not entered' : Number(row.obtained_marks) >= Number(row.pass_marks) ? 'Pass' : 'Fail',
      ]),
    };

    return {
      student,
      reply: {
        title: `Exam results — ${latest}`,
        notes: [
          `${student.full_name} · ${student.class_name} · Section ${student.section_name}`,
          examNames.length > 1 ? `Earlier exams on record: ${examNames.slice(0, -1).join(', ')}.` : 'This is the latest published result.',
        ],
        stats: [
          { label: 'Total', value: `${scored}/${possible}`, tone: 'info' },
          { label: 'Percentage', value: formatPercentage(percent), tone: percent >= 40 ? 'good' : 'bad' },
          { label: 'Subjects', value: String(latestRows.length), tone: 'info' },
        ],
        table,
        followUps: ['Notices', 'Attendance'],
      } as AssistantReply,
    };
  }));

  if (replies.length === 1) return replies[0].reply;
  return {
    title: 'Exam results',
    notes: [`${replies.length} children are linked to this account.`],
    list: replies.map((item) => ({
      title: item.reply.title,
      subtitle: item.reply.notes?.[0] ?? '',
    })),
    actions: replies.length === 1 ? replies[0].reply.actions : undefined,
    followUps: ['Notices', 'Attendance'],
  };
}

function portalFeeReply(ctx: AssistantContext): AssistantReply {
  const roster = scopedRoster(ctx);
  if (roster.length === 0) {
    return { title: 'Fee status', notes: ['No student record is linked to this account yet.'], followUps: ['Notices', 'Attendance'] };
  }

  const stats: AssistantStat[] = [];
  const notes: string[] = [];
  let anyDue = false;
  for (const student of roster) {
    const due = Math.max(0, Number(student.fee_balance ?? 0));
    if (due > 0) anyDue = true;
    stats.push({ label: `${student.full_name} — ${student.class_name}`, value: due > 0 ? formatMoney(due) : 'Clear', tone: due > 0 ? 'bad' : 'good' });
    notes.push(due > 0
      ? `${student.full_name} has an outstanding balance of ${formatMoney(due)}. Please clear it at the school office.`
      : `${student.full_name} has no outstanding balance.`);
  }

  return {
    title: 'Fee status',
    notes: [
      ...notes,
      anyDue ? 'While a balance is pending, exam results and homework are held back in this assistant.' : 'All dues are clear.',
    ],
    stats,
    followUps: ['Exam results', 'Notices'],
  };
}

async function portalNoticesReply(ctx: AssistantContext): Promise<AssistantReply> {
  const ids = scopedRoster(ctx).map((student) => student.id);
  if (ids.length === 0) {
    return { title: 'Notices', notes: ['No student record is linked to this account yet.'], followUps: ['Exam results', 'Attendance'] };
  }
  const { notifications, error } = await fetchPortalNotifications(ids);
  if (error) {
    return { title: 'Notices from the school', notes: [error], followUps: ['Exam results', 'Attendance'] };
  }
  if (notifications.length === 0) {
    return {
      title: 'Notices from the school',
      notes: ['There are no notices on your record yet. New notices from the office appear here.'],
      followUps: ['Exam results', 'Attendance'],
    };
  }
  return {
    title: 'Notices from the school',
    notes: [`${notifications.length} notice${notifications.length === 1 ? '' : 's'} on record, newest first.`],
    list: notifications.slice(0, 12).map((notice) => ({
      title: notice.title,
      subtitle: notice.body,
      meta: notice.attendance_date ?? undefined,
    })),
    followUps: ['Exam results', 'Attendance'],
  };
}

function portalAttendanceReply(ctx: AssistantContext): AssistantReply {
  const roster = scopedRoster(ctx);
  if (roster.length === 0) {
    return { title: 'Attendance', notes: ['No student record is linked to this account yet.'], followUps: ['Exam results', 'Notices'] };
  }
  const byId = new Map(ctx.attendance.map((record) => [record.student_id, record.status]));
  const stats: AssistantStat[] = [];
  for (const student of roster) {
    const status = byId.get(student.id);
    const label = status === 'present' ? 'Present today' : status === 'absent' ? 'Absent today' : status === 'late' ? 'Late today' : status === 'leave' ? 'On leave today' : 'Not marked yet';
    const tone: AssistantStat['tone'] = status === 'present' ? 'good' : status === 'absent' ? 'bad' : status === 'late' ? 'warn' : 'info';
    stats.push({ label: `${student.full_name} — ${student.class_name}`, value: label, tone });
  }
  return {
    title: `Attendance — ${todayKey()}`,
    notes: ['This shows today\'s register for your record only.'],
    stats,
    followUps: ['Exam results', 'Notices'],
  };
}

async function portalHomeworkReply(): Promise<AssistantReply> {
  const { payload, error } = await fetchPortalHomework();
  if (error || !payload) {
    return { title: 'Homework diary', notes: [error ?? 'The homework diary could not be loaded.'], followUps: ['Notices', 'Attendance'] };
  }
  if (payload.blocked) {
    const due = Number(payload.due_amount ?? 0);
    return {
      title: 'Pending fee reminder',
      notes: [
        'Homework is held while the fee account has a pending balance.',
        `The outstanding balance on this account is ${formatMoney(due)}.`,
        'Please clear the dues at the school office. The homework diary and exam results appear again as soon as the account is clear.',
      ],
      stats: [{ label: 'Outstanding', value: formatMoney(due), tone: 'bad' }],
      followUps: ['Fee status', 'Notices'],
    };
  }

  const entries = payload.entries ?? [];
  const day = todayKey();
  if (entries.length === 0) {
    return {
      title: 'Homework diary',
      notes: ['No homework has been published yet. New work appears here the day the teacher publishes it.'],
      followUps: ['Notices', 'Attendance'],
    };
  }

  const todays = entries.filter((entry) => entry.homework_date === day);
  const upcoming = entries.filter((entry) => entry.due_date && entry.due_date >= day);

  return {
    title: `Homework diary — ${day}`,
    notes: [
      todays.length
        ? `${todays.length} assignment${todays.length === 1 ? '' : 's'} set for today.`
        : 'Nothing new was set for today. The most recent work is listed below.',
      upcoming.length ? `${upcoming.length} hand-in date${upcoming.length === 1 ? '' : 's'} still to come.` : 'No hand-in dates are still ahead.',
      'This is the published homework for your own record only.',
    ],
    stats: [
      { label: 'Today', value: String(todays.length), tone: 'info' },
      { label: 'On record', value: String(entries.length), tone: 'info' },
      { label: 'Coming up', value: String(upcoming.length), tone: upcoming.length ? 'warn' : 'good' },
    ],
    list: entries.slice(0, 12).map((entry) => ({
      title: `${entry.subject_name} — ${entry.title}`,
      subtitle: entry.details ?? `${entry.class_name} · Section ${entry.section_name}`,
      meta: entry.due_date ? `Set ${entry.homework_date} · hand in by ${entry.due_date}` : `Set ${entry.homework_date}`,
    })),
    actions: [{ id: 'copy-diary', label: 'Copy the homework list', kind: 'copy', text: portalDiaryText(entries, day) }],
    followUps: ['Exam results', 'Attendance', 'Notices'],
  };
}

// The homework on record for the whole school, or for a teacher's own classes.
async function homeworkReply(ctx: AssistantContext): Promise<AssistantReply> {
  const { entries, error } = await fetchHomework(200);
  if (error) {
    return { title: 'Homework diary', notes: [error], followUps: ['Notices & templates', 'Missing records'] };
  }

  const restricted = teacherClasses(ctx.profile);
  const scoped = restricted ? entries.filter((entry) => restricted.includes(entry.class_name)) : entries;
  const day = todayKey();
  const published = scoped.filter((entry) => entry.status === 'published');
  const drafts = scoped.filter((entry) => entry.status === 'draft');
  const todays = published.filter((entry) => entry.homework_date === day);

  const rows = todays.slice(0, 12).map((entry) => [
    `${entry.class_name}-${entry.section_name}`,
    entry.subject_name,
    entry.title,
    entry.due_date ?? '—',
  ]);

  return {
    title: `Homework diary — ${day}`,
    notes: [
      todays.length
        ? `${todays.length} assignment${todays.length === 1 ? '' : 's'} published for today.`
        : 'Nothing has been published for today yet.',
      drafts.length
        ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} still waiting to be published — parents cannot see a draft.`
        : 'No drafts are waiting.',
      ...(restricted ? [`Showing only your classes: ${restricted.join(', ')}.`] : []),
    ],
    stats: [
      { label: 'Published today', value: String(todays.length), tone: 'good' },
      { label: 'Drafts', value: String(drafts.length), tone: drafts.length ? 'warn' : 'info' },
      { label: 'On record', value: String(published.length), tone: 'info' },
    ],
    table: rows.length ? { columns: ['Class', 'Subject', 'Homework', 'Hand in'], rows } : undefined,
    actions: [
      { id: 'go-homework', label: 'Open Homework', kind: 'navigate', view: 'homework' },
      ...(todays.length
        ? [{ id: 'copy-diary', label: "Copy today's diary", kind: 'copy' as const, text: portalDiaryText(published.filter((entry) => entry.homework_date === day), day) }]
        : []),
    ],
    followUps: ["Today's attendance", 'Exam datesheet', 'Notices & templates'],
  };
}

// ---------------------------------------------------------------------------
// Help, greeting and the role-aware dispatcher
// ---------------------------------------------------------------------------

function helpReply(ctx: AssistantContext): AssistantReply {
  const role = ctx.profile.role;
  const capabilities: Record<UserRole, AssistantListItem[]> = {
    admin: [
      { title: "Today's attendance", subtitle: 'Present, absent, late and on-leave totals with a class breakdown' },
      { title: 'Fee defaulters & collection', subtitle: 'Who owes what, collected vs pending, and WhatsApp reminders' },
      { title: 'Student & staff lookup', subtitle: 'Find a student or staff member by name or number' },
      { title: 'Missing record check', subtitle: 'Students missing a photo, phone no, fee setup and more' },
      { title: 'Notices & templates', subtitle: 'Fee and warning notices in English and Urdu' },
      { title: 'Class off day', subtitle: 'Mark a class off and skip its absentee alerts' },
      { title: 'Exam datesheet', subtitle: 'Build a clean datesheet, copy, print or send' },
      { title: 'Homework diary', subtitle: 'Set homework for a class, publish it and share the day\'s diary' },
    ],
    accountant: [
      { title: 'Fee defaulters', subtitle: 'Who owes what, and send WhatsApp reminders' },
      { title: 'Fee collection snapshot', subtitle: 'Collected vs pending, with today\'s takings' },
      { title: 'Student fee lookup', subtitle: 'Find a student and their balance' },
      { title: 'Missing record check', subtitle: 'Students missing a phone no, date of birth, photo or fee setup' },
      { title: 'Exam datesheet', subtitle: 'Build a datesheet, copy, print or send a notice' },
      { title: 'Reminder notices', subtitle: 'Fee and missing-information reminders to send' },
    ],
    office_assistant: [
      { title: "Today's attendance", subtitle: 'Register totals with a class breakdown' },
      { title: 'Student lookup', subtitle: 'Find a student by name or admission number' },
      { title: 'Missing record check', subtitle: 'Students missing key details' },
      { title: 'Notices & templates', subtitle: 'Notices in English and Urdu' },
      { title: 'Class off day', subtitle: 'Mark a class off and skip its alerts' },
      { title: 'Exam datesheet', subtitle: 'Build, copy, print or send a datesheet' },
      { title: 'Homework diary', subtitle: 'Read the published homework and share the day\'s diary' },
    ],
    support_staff: [
      { title: 'Student lookup', subtitle: 'Find a student by name or admission number' },
      { title: 'Notices', subtitle: 'Notices in English and Urdu' },
    ],
    teacher: [
      { title: "Today's attendance", subtitle: 'Register totals for your classes' },
      { title: 'Student lookup', subtitle: 'Find a student in your classes' },
      { title: 'Absentee & class notices', subtitle: 'Ready wording in English and Urdu' },
      { title: 'Class off day', subtitle: 'Mark a class off and skip its alerts' },
      { title: 'Exam datesheet', subtitle: 'Build a datesheet for your class' },
      { title: 'Homework diary', subtitle: 'Set homework, mark submissions and share the diary' },
    ],
    parent: [
      { title: 'Homework diary', subtitle: 'The daily assignments your child has been set' },
      { title: 'Exam results', subtitle: 'Your child\'s marks and percentage' },
      { title: 'Attendance', subtitle: 'Today\'s register for your child' },
      { title: 'Notices', subtitle: 'Notices the school has sent you' },
      { title: 'Fee status', subtitle: 'Whether any fee is pending' },
    ],
    student: [
      { title: 'Homework diary', subtitle: 'The daily assignments you have been set' },
      { title: 'Exam results', subtitle: 'Your marks and percentage' },
      { title: 'Attendance', subtitle: 'Your register for today' },
      { title: 'Notices', subtitle: 'Notices the school has sent you' },
      { title: 'Fee status', subtitle: 'Whether any fee is pending' },
    ],
  };

  return {
    title: `What I can do — ${ROLE_LABELS[role]}`,
    notes: [
      scopeLabel(role),
      isPortalRole(role)
        ? 'I only ever answer for your own record. I cannot show other students, fee defaulter lists, or send messages.'
        : 'I answer from your live school data — nothing leaves your school, and no external service is used.',
    ],
    list: capabilities[role],
    followUps: role === 'admin'
      ? ["Today's attendance", 'Fee defaulters', 'Missing records', 'Exam datesheet']
      : role === 'accountant'
        ? ['Fee defaulters', 'Fee collection', 'Missing records', 'Exam datesheet']
        : isPortalRole(role)
          ? ['Exam results', 'Attendance', 'Notices', 'Fee status']
          : role === 'support_staff'
            ? ['Student lookup', 'Notices', 'Help']
            : ["Today's attendance", 'Missing records', 'Exam datesheet', 'Homework diary'],
  };
}

// The opening card, showing only figures the signed-in role is entitled to.
export function greetingFor(ctx: AssistantContext): AssistantReply {
  const role = ctx.profile.role;
  const roster = scopedRoster(ctx);

  if (isPortalRole(role)) {
    const ids = roster.map((student) => student.id);
    const byId = new Map(ctx.attendance.map((record) => [record.student_id, record.status]));
    const due = roster.reduce((sum, student) => sum + Math.max(0, Number(student.fee_balance ?? 0)), 0);
    const names = roster.map((student) => student.full_name).join(', ');
    return {
      title: `Hello — I'm your ${SCHOOL_NAME} assistant`,
      notes: [
        names ? `I can help with ${names}.` : 'No student record is linked to this account yet.',
        'I answer only for your own record. Ask about homework, exam results, attendance, notices or fee status.',
      ],
      stats: [
        { label: 'Linked records', value: String(ids.length), tone: 'info' },
        { label: 'Present today', value: String(roster.filter((student) => byId.get(student.id) === 'present').length), tone: 'good' },
        { label: 'Fee pending', value: due > 0 ? formatMoney(due) : 'Clear', tone: due > 0 ? 'bad' : 'good' },
      ],
      followUps: ['Homework', 'Exam results', 'Attendance', 'Notices'],
    };
  }

  const restricted = teacherClasses(ctx.profile);
  const visible = restricted ? roster.filter((student) => restricted.includes(student.class_name)) : roster;
  const byId = new Map(ctx.attendance.map((record) => [record.student_id, record.status]));
  const present = visible.filter((student) => byId.get(student.id) === 'present').length;
  const marked = visible.filter((student) => byId.has(student.id)).length;
  const defaulters = visible.filter((student) => Number(student.fee_balance ?? 0) > 0).length;
  const canSeeFees = role === 'admin' || role === 'accountant';
  const canSeeAttendance = role === 'admin' || role === 'teacher' || role === 'office_assistant';

  const stats: AssistantStat[] = [{ label: 'Active students', value: String(visible.length), tone: 'info' }];
  if (canSeeAttendance) {
    stats.push({ label: 'Marked today', value: `${marked}/${visible.length}`, tone: 'info' });
    stats.push({ label: 'Present', value: String(present), tone: 'good' });
  }
  if (canSeeFees) stats.push({ label: 'Fee defaulters', value: String(defaulters), tone: defaulters ? 'warn' : 'good' });

  return {
    title: `Good day — I'm your ${SCHOOL_NAME} assistant`,
    notes: [
      scopeLabel(role),
      'Tap a quick action below, type what you need in plain words, or use the microphone to speak it.',
    ],
    stats,
    followUps: canSeeFees
      ? ['Fee defaulters', 'Fee collection', 'Missing records', 'Homework diary']
      : canSeeAttendance
        ? ["Today's attendance", 'Missing records', 'Exam datesheet', 'Homework diary']
        : ['Missing records', 'Exam datesheet', 'Homework diary'],
  };
}

// The single entry point: work out whether the role may use this part of the assistant,
// then build the answer. Every branch is guarded here rather than in the widget, so a
// new screen cannot bypass the rules.
export async function buildReply(intent: AssistantIntent, ctx: AssistantContext): Promise<AssistantReply> {
  const role = ctx.profile.role;

  // The paper generator is refused in one fixed sentence for everyone who may not use it,
  // so the wording is identical wherever the request came from.
  if (intent.kind === 'paper' && !canUseIntent(role, 'paper')) {
    return { title: 'Quiz / paper generator', notes: [deniedMessage(role, 'paper')] };
  }

  if (!canUseIntent(role, intent.kind)) {
    return {
      title: 'Not available for your account',
      notes: [deniedMessage(role, intent.kind)],
      followUps: isPortalRole(role) ? ['Exam results', 'Attendance', 'Notices'] : ['Help'],
    };
  }

  if (isPortalRole(role)) {
    switch (intent.kind) {
      case 'results': return portalResultsReply(ctx);
      case 'defaulters': return portalFeeReply(ctx);
      case 'notices': return portalNoticesReply(ctx);
      case 'attendance': return portalAttendanceReply(ctx);
      case 'homework': return portalHomeworkReply();
      case 'paper': return paperReply(ctx);
      case 'missing': return missingReply(ctx);
      case 'students': return studentsReply(ctx, intent.query);
      default: return helpReply(ctx);
    }
  }

  switch (intent.kind) {
    case 'attendance': return attendanceReply(ctx);
    case 'defaulters': return defaultersReply(ctx);
    case 'collection': return collectionReply(ctx);
    case 'students': return studentsReply(ctx, intent.query);
    case 'staff': return staffReply(ctx, intent.query);
    case 'missing': return missingReply(ctx);
    case 'notices': return noticesReply(ctx);
    case 'classOff': return classOffReply(ctx);
    case 'datesheet': return datesheetReply(ctx);
    case 'paper': return paperReply(ctx);
    case 'homework': return homeworkReply(ctx);
    case 'results': return studentsReply(ctx, intent.query);
    case 'help': return helpReply(ctx);
    default: return helpReply(ctx);
  }
}

// Exposed for the reminder tool: the defaulters the assistant would message.
export function defaulterTargets(students: Student[]): Student[] {
  return activeStudents(students)
    .filter((student) => Number(student.fee_balance ?? 0) > 0)
    .sort((a, b) => Number(b.fee_balance ?? 0) - Number(a.fee_balance ?? 0));
}

// ---------------------------------------------------------------------------
// Google Gemini upgrade
//
// The model is used for what it is good at: understanding English, Roman Urdu and a
// mix of the two, and writing the answer in the words the person used. It is NOT given
// authority. The data block it receives is filtered by role before it is sent, and the
// buttons, tool openings and live school tables always come from the local rule-based
// builders, which already enforce every permission. When the model is unavailable the
// local answer stands on its own.
// ---------------------------------------------------------------------------

const MAX_AI_NOTES = 3;
const MAX_AI_STATS = 4;
const MAX_AI_ROWS = 8;
const MAX_AI_LIST = 4;

const plainText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const statsFrom = (value: unknown): AssistantStat[] => {
  if (!Array.isArray(value)) return [];
  const stats: AssistantStat[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const label = plainText(row.label, 40);
    const figure = plainText(row.value, 40);
    if (!label || !figure) continue;
    stats.push({ label, value: figure, tone: 'info' });
    if (stats.length >= MAX_AI_STATS) break;
  }
  return stats;
};

const tableFrom = (value: unknown): AssistantTable | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const columns = (Array.isArray(source.columns) ? source.columns : []).map((column) => plainText(column, 30)).filter(Boolean);
  if (columns.length === 0) return undefined;
  const rows: string[][] = [];
  for (const entry of Array.isArray(source.rows) ? source.rows : []) {
    if (!Array.isArray(entry)) continue;
    const row = entry.slice(0, columns.length).map((cell) => plainText(cell, 60));
    while (row.length < columns.length) row.push('');
    rows.push(row);
    if (rows.length >= MAX_AI_ROWS) break;
  }
  return rows.length > 0 ? { columns, rows } : undefined;
};

const listFrom = (value: unknown): AssistantListItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: AssistantListItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const title = plainText(row.title, 90);
    if (!title) continue;
    items.push({
      title,
      subtitle: plainText(row.subtitle, 200) || undefined,
      meta: plainText(row.meta, 60) || undefined,
    });
    if (items.length >= MAX_AI_LIST) break;
  }
  return items.length > 0 ? items : undefined;
};

// Turns whatever the model returned into the widget's reply shape. Anything that does
// not fit is dropped, so a malformed answer degrades into a plain one rather than
// breaking the panel.
export function replyFromAi(raw: unknown): AssistantReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const notes = (Array.isArray(source.notes) ? source.notes : [])
    .map((note) => plainText(note, 400))
    .filter(Boolean)
    .slice(0, MAX_AI_NOTES);
  const followUps = (Array.isArray(source.followUps) ? source.followUps : [])
    .map((item) => plainText(item, 60))
    .filter(Boolean)
    .slice(0, 4);
  const table = tableFrom(source.table);
  const list = listFrom(source.list);
  if (notes.length === 0 && !table && !list) return null;
  return {
    title: plainText(source.title, 90) || 'School Assistant',
    notes: notes.length > 0 ? notes : undefined,
    stats: statsFrom(source.stats),
    table,
    list,
    followUps: followUps.length > 0 ? followUps : undefined,
  };
}

// The model writes the explanation; the local builder keeps the controls. Actions and
// tool openings are always taken from the rule-based answer, so a model answer can never
// hand someone a button or a panel their account is not entitled to.
export function mergeAiReply(ai: AssistantReply, local: AssistantReply, role: UserRole): AssistantReply {
  return {
    ...ai,
    stats: ai.stats && ai.stats.length > 0 ? ai.stats : local.stats,
    table: ai.table ?? local.table,
    list: ai.list ?? local.list,
    actions: local.actions,
    openTool: local.openTool && canUseTool(role, local.openTool) ? local.openTool : undefined,
    followUps: ai.followUps ?? local.followUps,
  };
}

export type AssistantAnswer = {
  reply: AssistantReply;
  // Which engine answered, so the panel can say so and the office can tell whether the
  // smart assistant is actually being used.
  source: 'ai' | 'local';
  notice?: string;
};

// The single entry point for a question. Gemini answers when it can; the local
// rule-based bot answers when the key is missing, the service fails, or the quota runs
// out — so a question always gets an answer.
export async function answerQuestion(question: string, ctx: AssistantContext): Promise<AssistantAnswer> {
  let local: AssistantReply;
  try {
    local = await buildReply(detectIntent(question), ctx);
  } catch {
    return {
      reply: {
        title: 'I could not work that out',
        notes: ['Try one of the quick actions below, or ask about attendance, fees, records or results.'],
        followUps: ['Help'],
      },
      source: 'local',
    };
  }

  let context: unknown = {};
  try {
    context = await buildAiContext(ctx);
  } catch {
    context = {};
  }

  const outcome = await askGemini({ question, role: ctx.profile.role, today: todayKey(), context });

  if (outcome.status === 'ok') {
    const ai = replyFromAi(outcome.reply);
    if (ai) return { reply: mergeAiReply(ai, local, ctx.profile.role), source: 'ai' };
    return {
      reply: local,
      source: 'local',
      notice: 'The smart assistant sent an answer that could not be read, so the built-in answer is shown.',
    };
  }

  return { reply: local, source: 'local', notice: outcome.message };
}
