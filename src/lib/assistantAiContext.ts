import { fetchPortalNotifications } from '@/lib/absenteeAlerts';
import { fetchHomework, fetchPortalHomework, type HomeworkEntry } from '@/lib/homework';
import { formatMoney } from '@/lib/fees';
import { isPortalRole } from '@/lib/assistantRoles';
import { supabase } from '@/lib/supabase';
import type { AssistantContext } from '@/lib/assistant';
import type { Student } from '@/lib/schoolTypes';

// The snapshot handed to Gemini, and the only school data the model ever sees.
//
// It is assembled here, in the browser, from data the signed-in person is already
// allowed to read, and it follows exactly the same rules as the local bot: staff see
// the school, a teacher sees their own classes, and a parent or student sees only their
// own child. The model is told which role is asking, but it is never trusted to enforce
// that — it simply is not given anything else.

export type AiStudentRow = {
  name: string;
  className: string;
  section: string;
  admissionNumber: string;
  feeBalance: string;
};

export type AiContextPayload = {
  student?: {
    name: string;
    className: string;
    section: string;
    admissionNumber: string;
    feeBalance: string;
    attendance?: string;
  };
  totals?: Record<string, string>;
  students?: AiStudentRow[];
  notices?: { date: string; title: string; body: string }[];
  homework?: { date: string; className: string; section: string; subject: string; detail: string; due: string | null }[];
};

const rosterOf = (ctx: AssistantContext): Student[] => {
  if (!isPortalRole(ctx.profile.role)) return ctx.students.filter((student) => student.status === 'active');
  const allowed = new Set([...ctx.linkedStudentIds, ...(ctx.ownStudentId ? [ctx.ownStudentId] : [])]);
  return ctx.students.filter((student) => allowed.has(student.id) && student.status === 'active');
};

// A teacher works with the classes they are attached to; where none is recorded the
// whole roster is kept, matching the local bot.
const classesOf = (ctx: AssistantContext): string[] | null => {
  if (ctx.profile.role !== 'teacher') return null;
  const classes = (ctx.profile as { class_names?: string[] | null }).class_names;
  return Array.isArray(classes) && classes.length > 0 ? classes : null;
};

const attendanceLabel = (status: string | undefined): string => {
  switch (status) {
    case 'present': return 'present today';
    case 'absent': return 'absent today';
    case 'late': return 'late today';
    case 'leave': return 'on leave today';
    default: return 'not marked yet';
  }
};

const noticeLine = (notification: { attendance_date: string | null; created_at: string; title: string; body: string }) => ({
  date: notification.attendance_date ?? notification.created_at.slice(0, 10),
  title: notification.title,
  body: notification.body,
});

const homeworkLine = (entry: HomeworkEntry) => ({
  date: entry.homework_date,
  className: entry.class_name,
  section: entry.section_name,
  subject: entry.subject_name,
  detail: entry.title + (entry.details ? ` — ${entry.details}` : ''),
  due: entry.due_date,
});

// The portal's homework goes through the same fee gate the local bot uses, so a family
// with a pending balance is never handed homework through the smart path either.
async function portalHomeworkLines(): Promise<AiContextPayload['homework']> {
  const { payload, error } = await fetchPortalHomework();
  if (error || !payload || payload.blocked) return [];
  return (payload.entries ?? []).slice(0, 8).map((entry) => ({
    date: entry.homework_date,
    className: entry.class_name,
    section: entry.section_name,
    subject: entry.subject_name,
    detail: entry.title + (entry.details ? ` — ${entry.details}` : ''),
    due: entry.due_date,
  }));
}

export async function buildAiContext(ctx: AssistantContext): Promise<AiContextPayload> {
  const role = ctx.profile.role;
  const restricted = classesOf(ctx);
  const roster = rosterOf(ctx).filter((student) => !restricted || restricted.includes(student.class_name));
  const statusById = new Map(ctx.attendance.map((record) => [record.student_id, record.status]));
  const payload: AiContextPayload = {};

  if (isPortalRole(role)) {
    const student = roster[0];
    if (student) {
      payload.student = {
        name: student.full_name,
        className: student.class_name,
        section: student.section_name,
        admissionNumber: student.admission_number,
        feeBalance: formatMoney(Math.max(0, Number(student.fee_balance ?? 0))),
        attendance: attendanceLabel(statusById.get(student.id)),
      };
      payload.totals = {
        'Fee balance': formatMoney(Math.max(0, Number(student.fee_balance ?? 0))),
        'Attendance today': attendanceLabel(statusById.get(student.id)),
      };
    }

    const ids = roster.map((entry) => entry.id);
    if (ids.length > 0) {
      const { notifications, error } = await fetchPortalNotifications(ids);
      if (!error && notifications.length > 0) {
        payload.notices = notifications.slice(0, 8).map(noticeLine);
      }
    }
    payload.homework = await portalHomeworkLines();
    return payload;
  }

  const canSeeFees = role === 'admin' || role === 'accountant';
  const canSeeAttendance = role === 'admin' || role === 'teacher' || role === 'office_assistant';

  const counts = { present: 0, absent: 0, late: 0, leave: 0, marked: 0 };
  for (const student of roster) {
    const status = statusById.get(student.id);
    if (!status) continue;
    counts.marked += 1;
    if (status === 'present' || status === 'absent' || status === 'late' || status === 'leave') counts[status] += 1;
  }

  const defaulters = roster
    .map((student) => ({ student, due: Math.max(0, Number(student.fee_balance ?? 0)) }))
    .filter((row) => row.due > 0)
    .sort((a, b) => b.due - a.due);

  const totals: Record<string, string> = { 'Active students': String(roster.length) };
  if (canSeeAttendance) {
    totals['Present today'] = String(counts.present);
    totals['Absent today'] = String(counts.absent);
    totals['Late today'] = String(counts.late);
    totals['On leave today'] = String(counts.leave);
    totals['Register marked'] = `${counts.marked} of ${roster.length}`;
  }
  if (canSeeFees) {
    totals['Fee defaulters'] = String(defaulters.length);
    totals['Total outstanding'] = formatMoney(defaulters.reduce((sum, row) => sum + row.due, 0));
  }
  if (restricted) totals['Showing classes'] = restricted.join(', ');
  payload.totals = totals;

  // Fee figures only travel for the roles entitled to them, and only for the students
  // those roles may see.
  if (canSeeFees) {
    payload.students = roster.slice(0, 40).map((student) => ({
      name: student.full_name,
      className: student.class_name,
      section: student.section_name,
      admissionNumber: student.admission_number,
      feeBalance: formatMoney(Math.max(0, Number(student.fee_balance ?? 0))),
    }));
  } else {
    payload.students = roster.slice(0, 40).map((student) => ({
      name: student.full_name,
      className: student.class_name,
      section: student.section_name,
      admissionNumber: student.admission_number,
      feeBalance: 'not available to this role',
    }));
  }

  // Notices and homework are read straight from the tables the relevant screens already
  // read; a failure there simply leaves that section out rather than failing the answer.
  try {
    const { data } = await supabase
      .from('school_portal_notifications')
      .select('title, body, attendance_date, created_at')
      .order('created_at', { ascending: false })
      .limit(8);
    const rows = (data ?? []) as { title: string; body: string; attendance_date: string | null; created_at: string }[];
    if (rows.length > 0) payload.notices = rows.map(noticeLine);
  } catch {
    // Left out on purpose: a missing notice list must not stop the answer.
  }

  try {
    const { entries, error } = await fetchHomework(60);
    if (!error) {
      const scoped = restricted ? entries.filter((entry) => restricted.includes(entry.class_name)) : entries;
      const published = scoped.filter((entry) => entry.status === 'published').slice(0, 8);
      if (published.length > 0) payload.homework = published.map(homeworkLine);
    }
  } catch {
    // Same here.
  }

  return payload;
}
