import { supabase } from '@/lib/supabase';
import { WEEKDAY_LABELS } from '@/lib/attendance';

export type RequestMode = 'In-Person' | 'Phone Call';

export type HalfDayLeave = {
  id: string;
  gate_pass_id: string;
  student_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  leave_date: string;
  exit_time: string;
  request_mode: RequestMode;
  receiver_name: string;
  receiver_cnic: string;
  reason: string;
  approved_by: string;
  receiver_photo_url: string | null;
  created_at: string;
};

export type CreateHalfDayLeaveInput = {
  student_id: string;
  request_mode: RequestMode;
  receiver_name: string;
  receiver_cnic: string;
  reason: string;
  approved_by: string;
  receiver_photo_url?: string | null;
};

export type CreateHalfDayLeaveResult = {
  ok: boolean;
  leave: HalfDayLeave | null;
  error: string | null;
};

export async function createHalfDayLeave(input: CreateHalfDayLeaveInput): Promise<CreateHalfDayLeaveResult> {
  try {
    const { data, error } = await supabase.rpc('create_half_day_leave', {
      p_student_id: input.student_id,
      p_request_mode: input.request_mode,
      p_receiver_name: input.receiver_name,
      p_receiver_cnic: input.receiver_cnic,
      p_reason: input.reason,
      p_approved_by: input.approved_by,
      p_receiver_photo_url: input.receiver_photo_url ?? null,
    });
    if (error) return { ok: false, leave: null, error: error.message };
    return { ok: true, leave: data as HalfDayLeave, error: null };
  } catch (err) {
    return { ok: false, leave: null, error: err instanceof Error ? err.message : 'Could not issue gate pass' };
  }
}

export async function fetchRecentHalfDayLeaves(limit = 20): Promise<{ leaves: HalfDayLeave[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_half_day_leaves')
      .select(`
        id, gate_pass_id, student_id, leave_date, exit_time, request_mode,
        receiver_name, receiver_cnic, reason, approved_by, receiver_photo_url, created_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { leaves: [], error: error.message };
    const leaves = (data ?? []).map((row) => ({
      ...row,
      student_name: '',
      class_name: null,
      section_name: null,
    })) as HalfDayLeave[];
    return { leaves, error: null };
  } catch {
    return { leaves: [], error: 'Could not load recent gate passes' };
  }
}

export function formatHalfDayMessage(leave: HalfDayLeave): string {
  const date = new Date(leave.exit_time);
  const dayName = WEEKDAY_LABELS[date.getDay()];
  const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const className = leave.class_name ?? '';
  return `Half-Day Alert: ${leave.student_name} (Class ${className}) has been released from school on ${dayName}, ${dateStr} at exactly ${timeStr}. Handed over to: ${leave.receiver_name} (CNIC: ${leave.receiver_cnic}).`;
}

export type SmsPlaceholder = {
  studentName: string;
  className: string;
  dayName: string;
  dateStr: string;
  timeStr: string;
  receiverName: string;
  receiverCnic: string;
  message: string;
};

export function buildSmsPlaceholder(leave: HalfDayLeave): SmsPlaceholder {
  const date = new Date(leave.exit_time);
  return {
    studentName: leave.student_name,
    className: leave.class_name ?? '',
    dayName: WEEKDAY_LABELS[date.getDay()],
    dateStr: date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    timeStr: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
    receiverName: leave.receiver_name,
    receiverCnic: leave.receiver_cnic,
    message: formatHalfDayMessage(leave),
  };
}

export async function sendHalfDaySmsPlaceholder(leave: HalfDayLeave): Promise<{ ok: boolean; error: string | null }> {
  const payload = buildSmsPlaceholder(leave);
  void payload;
  return { ok: false, error: 'SMS/WhatsApp gateway not configured yet — this is a placeholder for future integration' };
}

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80) || 'photo';

export async function uploadReceiverPhoto(
  file: File,
): Promise<{ url: string; error: string | null }> {
  if (!file.type.startsWith('image/')) {
    return { url: '', error: 'Please choose an image file.' };
  }
  try {
    const { data: session } = await supabase.auth.getUser();
    const userId = session.user?.id;
    if (!userId) return { url: '', error: 'Your session has ended. Sign in again to upload a photo.' };

    const path = `${userId}/gate-pass-${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await supabase.storage
      .from('whatsapp-attachments')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { url: '', error: 'The photo could not be uploaded. Please try again.' };

    const { data: signed, error: signError } = await supabase.storage
      .from('whatsapp-attachments')
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError || !signed?.signedUrl) {
      return { url: '', error: 'The photo uploaded but its link could not be created.' };
    }
    return { url: signed.signedUrl, error: null };
  } catch {
    return { url: '', error: 'The photo could not be uploaded. Check your connection and try again.' };
  }
}

export async function fetchHalfDayLeavesByDate(
  date: string,
): Promise<{ leaves: HalfDayLeave[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_half_day_leaves')
      .select(`
        id, gate_pass_id, student_id, leave_date, exit_time, request_mode,
        receiver_name, receiver_cnic, reason, approved_by, receiver_photo_url, created_at,
        student:school_students(full_name, class_name, section_name)
      `)
      .eq('leave_date', date)
      .order('exit_time', { ascending: false });
    if (error) return { leaves: [], error: error.message };
    const leaves = (data ?? []).map((row) => {
      const student = row.student as unknown as { full_name: string; class_name: string | null; section_name: string | null } | null;
      return {
        id: row.id,
        gate_pass_id: row.gate_pass_id,
        student_id: row.student_id,
        student_name: student?.full_name ?? 'Unknown',
        class_name: student?.class_name ?? null,
        section_name: student?.section_name ?? null,
        leave_date: row.leave_date,
        exit_time: row.exit_time,
        request_mode: row.request_mode as RequestMode,
        receiver_name: row.receiver_name,
        receiver_cnic: row.receiver_cnic,
        reason: row.reason,
        approved_by: row.approved_by,
        receiver_photo_url: row.receiver_photo_url,
        created_at: row.created_at,
      } satisfies HalfDayLeave;
    });
    return { leaves, error: null };
  } catch {
    return { leaves: [], error: 'Could not load issued gate passes' };
  }
}

export type HalfDayPhoto = {
  id: string;
  gate_pass_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  receiver_name: string;
  receiver_cnic: string;
  reason: string;
  request_mode: RequestMode;
  approved_by: string;
  exit_time: string;
  receiver_photo_url: string | null;
};

export async function fetchHalfDayPhotos(
  limit = 60,
): Promise<{ photos: HalfDayPhoto[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_half_day_leaves')
      .select(`
        id, gate_pass_id, receiver_name, receiver_cnic, reason,
        request_mode, approved_by, exit_time, receiver_photo_url,
        student:school_students(full_name, class_name, section_name)
      `)
      .not('receiver_photo_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { photos: [], error: error.message };
    const photos = (data ?? []).map((row) => {
      const student = row.student as unknown as { full_name: string; class_name: string | null; section_name: string | null } | null;
      return {
        id: row.id,
        gate_pass_id: row.gate_pass_id,
        student_name: student?.full_name ?? 'Unknown',
        class_name: student?.class_name ?? null,
        section_name: student?.section_name ?? null,
        receiver_name: row.receiver_name,
        receiver_cnic: row.receiver_cnic,
        reason: row.reason,
        request_mode: row.request_mode as RequestMode,
        approved_by: row.approved_by,
        exit_time: row.exit_time,
        receiver_photo_url: row.receiver_photo_url,
      } satisfies HalfDayPhoto;
    });
    return { photos, error: null };
  } catch {
    return { photos: [], error: 'Could not load gallery photos' };
  }
}

export function compressPhotoToBlob(file: File, maxSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress photo'))),
        'image/jpeg',
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image failed to load')); };
    img.src = url;
  });
}
