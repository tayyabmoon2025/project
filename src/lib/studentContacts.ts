import { supabase } from '@/lib/supabase';

export type SaveWhatsappResult = { ok: boolean; message: string; saved: string };

// Saves the number the office corrected straight onto the student's WhatsApp Number
// field. Staff already hold update rights on the student table, so no separate
// privilege is needed; the row is re-read afterwards so the caller shows what the
// database actually stored rather than what was typed.
export async function saveStudentWhatsappNumber(studentId: string, raw: string): Promise<SaveWhatsappResult> {
  const value = raw.trim();
  try {
    const { data, error } = await supabase
      .from('school_students')
      .update({ whatsapp_number: value || null })
      .eq('id', studentId)
      .select('whatsapp_number')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, message: 'The WhatsApp number could not be saved. Please try again.', saved: '' };
    }
    const saved = ((data as { whatsapp_number: string | null }).whatsapp_number ?? '').trim();
    return {
      ok: true,
      saved,
      message: saved ? 'WhatsApp number saved. Reminders can now be sent.' : 'WhatsApp number cleared from this record.',
    };
  } catch {
    return { ok: false, message: 'The school server could not be reached, so the number was not saved.', saved: '' };
  }
}
