import { supabase } from '@/lib/supabase';
import { whatsappLink } from '@/lib/whatsapp';
import { SCHOOL_NAME } from '@/lib/noticeText';

export type LiveClassMode = 'audio' | 'video';
export type LiveClassStatus = 'pending' | 'approved' | 'rejected' | 'live' | 'ended';

export type LiveClass = {
  id: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  lesson_topic: string;
  class_date: string;
  start_time: string;
  duration_minutes: number;
  mode: LiveClassMode;
  room_id: string;
  status: LiveClassStatus;
  teacher_id: string | null;
  teacher_name: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  reviewed_at: string | null;
  admin_remarks: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveClassAttendance = {
  id: string;
  class_id: string;
  student_id: string;
  student_name: string;
  joined_at: string;
  left_at: string | null;
  minutes_present: number | null;
  joined_by: string | null;
};

export type LiveClassStudent = {
  id: string;
  full_name: string;
  class_name: string;
  section_name: string;
  guardian_phone: string | null;
};

export type LiveClassHand = {
  id: string;
  class_id: string;
  student_id: string;
  student_name: string;
  raised_at: string;
  lowered_at: string | null;
};

export type LiveClassDraft = {
  className: string;
  sectionName: string;
  subjectName: string;
  lessonTopic: string;
  classDate: string;
  startTime: string;
  durationMinutes: number;
  mode: LiveClassMode;
};

export const LIVE_CLASS_COLUMNS =
  'id, class_name, section_name, subject_name, lesson_topic, class_date, start_time, duration_minutes, mode, room_id, status, teacher_id, teacher_name, requested_at, approved_by, approved_at, reviewed_at, admin_remarks, started_at, ended_at, ended_by, created_at, updated_at';

export const LIVE_ATTENDANCE_COLUMNS =
  'id, class_id, student_id, student_name, joined_at, left_at, minutes_present, joined_by';

export const DURATION_CHOICES = [30, 40, 45, 60, 75, 90, 120];

// A room name has to survive being pasted into WhatsApp and typed by a parent, so it
// keeps the school name and the class in plain letters and only the random tail is
// unpredictable — that tail is what stops a stranger guessing a live room.
export function makeRoomId(className: string): string {
  const cleaned = className.replace(/[^A-Za-z0-9]/g, '').slice(0, 18) || 'Class';
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `UjalaSchool_${cleaned}_${tail}`;
}

// The external meeting room runs on a login-free Jitsi server: nobody is ever asked to
// sign in, the pre-join screen is skipped, and whoever is joining lands straight in the
// live session under the name the app already knows.
export function jitsiRoomUrl(roomId: string, displayName?: string): string {
  const base = `https://meet.ffmuc.net/${encodeURIComponent(roomId)}`;
  const name = displayName
    ? `&userInfo.displayName=%22${encodeURIComponent(displayName.slice(0, 60))}%22`
    : '';
  return `${base}#config.prejoinPageEnabled=false${name}`;
}

export const modeLabel = (mode: LiveClassMode) => (mode === 'audio' ? 'Audio Only' : 'Audio + Video');

export const statusLabel = (status: LiveClassStatus) => ({
  pending: 'Pending Admin Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live now',
  ended: 'Completed',
}[status]);

// A date and time that reads the way the office says it out loud.
export function formatClassDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

// Postgres hands back a time as HH:MM:SS; the form and the sheets want HH:MM.
export function formatClassTime(time: string): string {
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return time;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${(minuteText ?? '00').slice(0, 2)} ${suffix}`;
}

export const formatDuration = (minutes: number) => `${minutes} mins`;

export function normalizeTime(value: string): string {
  const parts = value.split(':');
  const hour = (parts[0] ?? '00').padStart(2, '0').slice(0, 2);
  const minute = (parts[1] ?? '00').padStart(2, '0').slice(0, 2);
  return `${hour}:${minute}:00`;
}

export function normalizeDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

// When the lesson is meant to begin, used to tell "starting now" from "already over".
export function classStartMoment(liveClass: LiveClass): Date {
  return new Date(`${liveClass.class_date.slice(0, 10)}T${normalizeTime(liveClass.start_time)}`);
}

export function isStartingSoon(liveClass: LiveClass, windowMinutes = 30): boolean {
  const start = classStartMoment(liveClass).getTime();
  const now = Date.now();
  return start - now <= windowMinutes * 60 * 1000 && start + liveClass.duration_minutes * 60 * 1000 > now;
}

export function joinTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// WhatsApp notice
// ---------------------------------------------------------------------------

export function liveClassShareNotice(liveClass: LiveClass): string {
  return [
    SCHOOL_NAME,
    `Online live class — ${liveClass.subject_name}`,
    `Dear Parents, ${liveClass.teacher_name} will hold an online class for ${liveClass.class_name} ${liveClass.section_name} on ${formatClassDate(liveClass.class_date)} at ${formatClassTime(liveClass.start_time)} (${formatDuration(liveClass.duration_minutes)}, ${modeLabel(liveClass.mode)}).`,
    `Topic: ${liveClass.lesson_topic}`,
    `Join here: ${jitsiRoomUrl(liveClass.room_id)}`,
    'Please join a few minutes early. Attendance is recorded automatically when your child joins the room.',
  ].join('\n');
}

export const liveClassWhatsAppLink = (liveClass: LiveClass) => whatsappLink(null, liveClassShareNotice(liveClass), 'web');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchLiveClasses(): Promise<{ classes: LiveClass[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_live_classes')
      .select(LIVE_CLASS_COLUMNS)
      .order('class_date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(200);
    if (error) return { classes: [], error: error.message };
    return { classes: (data ?? []) as LiveClass[], error: null };
  } catch {
    return { classes: [], error: 'The live class list could not be loaded.' };
  }
}

export async function fetchLiveAttendance(classId: string): Promise<{ entries: LiveClassAttendance[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_live_class_attendance')
      .select(LIVE_ATTENDANCE_COLUMNS)
      .eq('class_id', classId)
      .order('joined_at', { ascending: true });
    if (error) return { entries: [], error: error.message };
    return { entries: (data ?? []) as LiveClassAttendance[], error: null };
  } catch {
    return { entries: [], error: 'The attendance list could not be loaded.' };
  }
}

export async function fetchLiveHands(classId: string): Promise<{ hands: LiveClassHand[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_live_class_hands')
      .select('id, class_id, student_id, student_name, raised_at, lowered_at')
      .eq('class_id', classId)
      .order('raised_at', { ascending: true });
    if (error) return { hands: [], error: error.message };
    return { hands: (data ?? []) as LiveClassHand[], error: null };
  } catch {
    return { hands: [], error: 'The raised-hands list could not be loaded.' };
  }
}

export async function fetchClassStudents(className: string, sectionName: string): Promise<{ students: LiveClassStudent[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_students')
      .select('id, full_name, class_name, section_name, guardian_phone')
      .eq('class_name', className)
      .eq('section_name', sectionName)
      .eq('status', 'active')
      .order('full_name');
    if (error) return { students: [], error: error.message };
    return { students: (data ?? []) as LiveClassStudent[], error: null };
  } catch {
    return { students: [], error: 'The class list could not be loaded.' };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function requestLiveClass(
  draft: LiveClassDraft,
  teacher: { id: string; fullName: string },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_live_classes').insert({
      class_name: draft.className.trim(),
      section_name: draft.sectionName.trim(),
      subject_name: draft.subjectName.trim(),
      lesson_topic: draft.lessonTopic.trim(),
      class_date: normalizeDate(draft.classDate),
      start_time: normalizeTime(draft.startTime),
      duration_minutes: draft.durationMinutes,
      mode: draft.mode,
      room_id: makeRoomId(draft.className),
      status: 'pending',
      teacher_id: teacher.id,
      teacher_name: teacher.fullName,
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The live class request could not be sent.' };
  }
}

export async function reviewLiveClass(
  classId: string,
  decision: 'approved' | 'rejected',
  remarks: string,
): Promise<{ parentNotices: number; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('review_live_class', {
      p_class_id: classId,
      p_decision: decision,
      p_remarks: remarks.trim() ? remarks.trim() : null,
    });
    if (error) return { parentNotices: 0, error: error.message };
    const payload = (data ?? {}) as { parent_notices?: number };
    return { parentNotices: Number(payload.parent_notices) || 0, error: null };
  } catch {
    return { parentNotices: 0, error: 'The decision could not be saved.' };
  }
}

// Only the running state is written from the browser. Approval is never set here —
// the database refuses to let a teacher write those columns.
export async function setLiveClassState(
  classId: string,
  patch: Partial<Pick<LiveClass, 'status' | 'started_at' | 'ended_at' | 'ended_by'>>,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_live_classes').update(patch).eq('id', classId);
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The live class could not be updated.' };
  }
}

export async function deleteLiveClass(classId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('school_live_classes').delete().eq('id', classId);
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The live class could not be removed.' };
  }
}

export async function joinLiveClass(classId: string, studentId: string): Promise<{ joinedAt: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('join_live_class', {
      p_class_id: classId,
      p_student_id: studentId,
    });
    if (error) return { joinedAt: null, error: error.message };
    const payload = (data ?? {}) as { joined_at?: string };
    return { joinedAt: payload.joined_at ?? null, error: null };
  } catch {
    return { joinedAt: null, error: 'Attendance could not be recorded for this class.' };
  }
}

export async function leaveLiveClass(classId: string, studentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('leave_live_class', {
      p_class_id: classId,
      p_student_id: studentId,
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The leave time could not be recorded.' };
  }
}

export async function raiseHand(classId: string, studentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('raise_hand', {
      p_class_id: classId,
      p_student_id: studentId,
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The raised hand could not be sent to the teacher.' };
  }
}

export async function lowerHand(classId: string, studentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('lower_hand', {
      p_class_id: classId,
      p_student_id: studentId,
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'The lowered hand could not be recorded.' };
  }
}
