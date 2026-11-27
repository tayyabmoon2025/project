import type { UserRole } from '@/lib/auth';

// The vocabulary the assistant understands, and who is allowed to use each part of it.
// Keeping the rules in one table means a role can never quietly gain a capability: the
// widget, the quick chips and the reply builders all read from here.

export type AssistantIntentKind =
  | 'attendance' | 'defaulters' | 'collection' | 'students' | 'staff'
  | 'missing' | 'notices' | 'classOff' | 'datesheet' | 'homework' | 'results' | 'paper' | 'help' | 'unknown';

// The panels that can be opened from inside the assistant.
export type AssistantTool = 'classOff' | 'datesheet' | 'reminders' | 'paper';

// What each role may ask the assistant for.
const ROLE_INTENTS: Record<UserRole, AssistantIntentKind[]> = {
  // Full access.
  admin: ['attendance', 'defaulters', 'collection', 'students', 'staff', 'missing', 'notices', 'classOff', 'datesheet', 'homework', 'results', 'paper', 'help', 'unknown'],
  // Office and teaching staff work the register, notices and records, but money is
  // left to the accounts office and the administrator.
  office_assistant: ['attendance', 'students', 'missing', 'notices', 'classOff', 'datesheet', 'homework', 'results', 'help', 'unknown'],
  teacher: ['attendance', 'students', 'notices', 'classOff', 'datesheet', 'homework', 'results', 'paper', 'help', 'unknown'],
  // The accounts office works fees, records and the datesheet, but not the register.
  accountant: ['defaulters', 'collection', 'students', 'missing', 'notices', 'datesheet', 'results', 'paper', 'help', 'unknown'],
  // Support staff — drivers, guards, helpers — read the same everyday things an office
  // assistant reads, but they do not keep the register or the datesheet.
  support_staff: ['students', 'notices', 'help', 'unknown'],
  // A parent and a student see only their own child's / their own record. No class-wide
  // figures, no defaulter lists, no datesheet or class-off tools, no broadcasts. Their
  // own fee status arrives through the same 'defaulters' wording, but the reply builder
  // turns it into a single-record answer.
  parent: ['attendance', 'notices', 'homework', 'results', 'defaulters', 'help', 'unknown'],
  student: ['attendance', 'notices', 'homework', 'results', 'defaulters', 'help', 'unknown'],
};

// What each role may open. A parent and a student open nothing: every action that
// changes school data or messages parents belongs to staff.
const ROLE_TOOLS: Record<UserRole, AssistantTool[]> = {
  admin: ['classOff', 'datesheet', 'reminders', 'paper'],
  office_assistant: ['classOff', 'datesheet'],
  teacher: ['classOff', 'datesheet', 'paper'],
  accountant: ['datesheet', 'reminders', 'paper'],
  support_staff: [],
  parent: [],
  student: [],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  support_staff: 'Support Staff',
  student: 'Student',
};

// A parent and a student are the two roles whose every answer must be limited to their
// own record, so they are handled by their own reply builders.
export const isPortalRole = (role: UserRole) => role === 'parent' || role === 'student';

export const canUseIntent = (role: UserRole, kind: AssistantIntentKind) => ROLE_INTENTS[role].includes(kind);

export const canUseTool = (role: UserRole, tool: AssistantTool) => ROLE_TOOLS[role].includes(tool);

// A short line under the assistant's title so the signed-in role can see at a glance
// what scope it is answering within.
export function scopeLabel(role: UserRole): string {
  switch (role) {
    case 'admin': return 'Administrator · full school access';
    case 'accountant': return 'Accounts office · fees, records and datesheet';
    case 'office_assistant': return 'Office · attendance, records and notices';
    case 'support_staff': return 'Support staff · records and notices';
    case 'teacher': return 'Teacher · your classes';
    case 'parent': return 'Parent · your child\'s record only';
    default: return 'Student · your own record only';  }
}

// The quick actions offered for a role, in the order they are most useful. The command
// text is what gets sent to the same parser a typed command goes through.
export function quickChipsFor(role: UserRole): { label: string; command: string }[] {
  const all: { label: string; command: string; kind: AssistantIntentKind }[] = [
    { label: "Today's attendance", command: "today's attendance", kind: 'attendance' },
    { label: 'Fee defaulters', command: 'fee defaulters', kind: 'defaulters' },
    { label: 'Fee collection', command: 'fee collection snapshot', kind: 'collection' },
    { label: 'Student lookup', command: 'student lookup', kind: 'students' },
    { label: 'Missing records', command: 'missing record check', kind: 'missing' },
    { label: 'Notices & templates', command: 'notices and templates', kind: 'notices' },
    { label: 'Homework diary', command: 'homework diary', kind: 'homework' },
    { label: 'Class off day', command: 'mark class off', kind: 'classOff' },
    { label: 'Exam datesheet', command: 'generate exam datesheet', kind: 'datesheet' },
    { label: 'Exam results', command: 'exam results', kind: 'results' },
    { label: 'Staff lookup', command: 'staff lookup', kind: 'staff' },
  ];
  const chips = all.filter((chip) => canUseIntent(role, chip.kind));
  // A parent and a student have only a handful of actions, so the wording is made
  // personal rather than school-wide.
  if (isPortalRole(role)) {
    return [
      { label: 'Homework', command: 'homework diary' },
      { label: 'Exam results', command: 'exam results' },
      { label: 'Attendance', command: 'attendance' },
      { label: 'Notices', command: 'notices' },
      { label: 'Fee status', command: 'fee status' },
    ];
  }
  return chips.map(({ label, command }) => ({ label, command }));
}

// A polite, role-aware refusal. It names the role so the person knows why they cannot
// see something, rather than the assistant appearing to be broken.
export function deniedMessage(role: UserRole, kind: AssistantIntentKind): string {
  const label = ROLE_LABELS[role];
  // The paper generator is the one capability the school asked to refuse in this exact
  // wording, whatever the role, so it is answered before any other rule.
  if (kind === 'paper') return 'this function is available for admins only.';
  if (isPortalRole(role)) {
    if (kind === 'datesheet' || kind === 'classOff') {
      return `Exam datesheets and class-off days are created by the school. A ${label.toLowerCase()} account cannot change the school timetable from here — ask the office if you need a copy.`;
    }
    if (kind === 'students' || kind === 'staff' || kind === 'missing') {
      return `A ${label.toLowerCase()} account can only see its own record, so other students and staff are never shown here.`;
    }
    if (kind === 'collection') {
      return `School-wide collection figures are limited to the administrator and the accounts office.`;
    }
    return `A ${label.toLowerCase()} account can only see its own record. This assistant will not show other students, fee defaulter lists, or send any messages. Ask the school office if you need more.`;
  }
  if (kind === 'defaulters' || kind === 'collection') {
    return `Fee information is limited to the administrator and the accounts office. Your ${label.toLowerCase()} account can still use the rest of the assistant.`;
  }
  if (kind === 'homework') {
    return `Setting homework belongs to teachers and the administrator. Your ${label.toLowerCase()} account can read the homework that has already been published.`;
  }
  if (kind === 'attendance') {
    return `The attendance register is not part of a ${label.toLowerCase()} account. Ask the administrator or a teacher if you need a figure.`;
  }
  return `Your ${label.toLowerCase()} account does not have access to that.`;
}
