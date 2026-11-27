import { fetchAbsenteeSendMode } from '@/lib/absenteeAlerts';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatMoney, monthLabel } from '@/lib/fees';
import { queueSmsMessages, updateSmsStatus } from '@/lib/smsLog';
import { pickWhatsAppContact, whatsappLink, type AlertSendMode } from '@/lib/whatsapp';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';

// The wording of a fee reminder, shared by every screen that can send one.
export function feeReminderMessage(student: Student, due: number, month: string) {
  return [
    SCHOOL_NAME,
    `Fee reminder — ${monthLabel(month)}`,
    `Dear Parent, the fee account for ${student.full_name} (${student.class_name} · Section ${student.section_name}) has an outstanding balance of ${formatMoney(due)}.`,
    'Kindly clear the dues at the school office at your earliest convenience. Thank you.',
  ].join('\n');
}

export type QueuedReminder = {
  studentId: string;
  studentName: string;
  phone: string;
  link: string;
  message: string;
};

export type ReminderResult = {
  sent: number;
  skipped: number;
  error: string | null;
  queue: QueuedReminder[];
};

// Posts a fee reminder notification into the portal so it appears in both the Parent
// Portal and the Student Portal. The database unique index on
// (student_id, notification_type, attendance_date) prevents duplicates per day.
async function createPortalReminder(student: Student, due: number, today: string): Promise<void> {
  try {
    await supabase.rpc('create_fee_reminder_notification', {
      p_student_id: student.id,
      p_due_amount: due,
      p_reminder_date: today,
    });
  } catch {
    // The portal notification is a convenience, not a gate on the WhatsApp send.
  }
}

// Sends fee reminders through the school's existing WhatsApp route. Each message is
// logged first (so a send that fails is still visible in the SMS report) and only
// students with a usable contact number are messaged.
//
// Only the first student's WhatsApp chat is opened immediately — this keeps the
// browser from blocking a barrage of pop-ups. The remaining students are returned as
// a queue of clickable links so the caller can present them one at a time. Portal
// notifications are created for every student regardless of whether their WhatsApp
// opened automatically.
export async function sendFeeReminders(targets: Student[], month: string, today: string): Promise<ReminderResult> {
  if (targets.length === 0) return { sent: 0, skipped: 0, error: null, queue: [] };

  let sendMode: AlertSendMode = 'web';
  try { sendMode = await fetchAbsenteeSendMode(); } catch { sendMode = 'web'; }

  let sent = 0;
  let skipped = 0;
  const queue: QueuedReminder[] = [];
  let firstOpened = false;

  for (const student of targets) {
    const contact = pickWhatsAppContact(student);
    if (!contact.number) { skipped += 1; continue; }
    const due = Math.max(0, Number(student.fee_balance ?? 0));
    const body = feeReminderMessage(student, due, month);
    const { ids, error } = await queueSmsMessages([{
      student_id: student.id,
      student_name: student.full_name,
      class_name: student.class_name,
      section_name: student.section_name,
      parent_phone: contact.number,
      message_type: 'fee_reminder',
      message_body: body,
      attendance_date: today,
    }]);
    if (error) return { sent, skipped, error, queue };

    // Portal notification is created for every student, regardless of WhatsApp outcome.
    await createPortalReminder(student, due, today);

    if (!firstOpened) {
      // The first chat opens immediately while the click context is still valid.
      const result = openWhatsAppChat(contact.number, body, sendMode);
      if (result.ok) {
        sent += 1;
        await updateSmsStatus(ids, 'sent', `WhatsApp opened (${sendMode})`);
        firstOpened = true;
      } else {
        // Even the first was blocked or is an app-mode link — add it to the queue.
        await updateSmsStatus(ids, 'pending', 'Queued — open from the reminder list');
        queue.push({
          studentId: student.id,
          studentName: student.full_name,
          phone: contact.number,
          link: result.link,
          message: body,
        });
      }
    } else {
      // Subsequent chats are queued as clickable links to avoid popup-blocking.
      const link = whatsappLink(contact.number, body, sendMode);
      await updateSmsStatus(ids, 'pending', 'Queued — open from the reminder list');
      queue.push({
        studentId: student.id,
        studentName: student.full_name,
        phone: contact.number,
        link,
        message: body,
      });
    }
  }

  return { sent, skipped, error: null, queue };
}
