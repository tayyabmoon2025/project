import { SCHOOL_NAME } from '@/lib/noticeText';
import type { Student } from '@/lib/schoolTypes';

// A document counts as handed in when the office typed anything that is not a
// plain "pending" or "not received" note.
export function documentReceived(value: string | null | undefined): boolean {
  const text = (value ?? '').trim();
  if (!text) return false;
  return !/^(no|n\/a|na|nil|pending|awaiting|not\s)/i.test(text);
}

export type DocumentGap = 'tc' | 'b_form' | 'whatsapp';

// The short badge shown against a student in the records list.
export const DOCUMENT_GAP_LABELS: Record<DocumentGap, string> = {
  tc: 'Missing TC',
  b_form: 'Missing B-Form',
  whatsapp: 'No WhatsApp',
};

// How each pending item is described to a parent in the reminder message.
const DOCUMENT_GAP_REQUESTS: Record<DocumentGap, string> = {
  tc: 'the Transfer Certificate / School Leaving Certificate from the previous school',
  b_form: 'the student B-Form (NADRA birth registration certificate)',
  whatsapp: 'a working WhatsApp number for the family',
};

const blank = (value: string | null | undefined) => !(value ?? '').trim();

// The office chases three things: the Transfer Certificate from the previous school, the
// child's B-Form, and a number to reach the family on. A gap is only reported when the
// record itself is missing the detail, so a note typed on the document tab ("Received")
// clears the flag. A TC is only chased for a child who came from another school, or whose
// SLC document is still marked as not received.
export function studentDocumentGaps(student: Student): DocumentGap[] {
  const gaps: DocumentGap[] = [];
  const tcOutstanding = blank(student.tc_slc_number)
    && (!blank(student.last_school) || !documentReceived(student.submitted_previous_tc));
  if (tcOutstanding) gaps.push('tc');
  if (blank(student.student_form_b) || !documentReceived(student.submitted_b_form)) gaps.push('b_form');
  if (blank(student.whatsapp_number)) gaps.push('whatsapp');
  return gaps;
}

export function hasDocumentGap(student: Student, gap: DocumentGap): boolean {
  return studentDocumentGaps(student).includes(gap);
}

// The WhatsApp reminder asking a family to hand in whatever is still pending. All of a
// student's gaps go into one message so a parent is not messaged three times in a row.
export function documentReminderMessage(student: Student, gaps: DocumentGap[]): string {
  const requests = gaps.map((gap) => DOCUMENT_GAP_REQUESTS[gap]);
  const listed = requests.length <= 1
    ? requests[0] ?? ''
    : `${requests.slice(0, -1).join(', ')} and ${requests[requests.length - 1]}`;
  const klass = [student.class_name, student.section_name].filter(Boolean).join(' ');
  return [
    'Dear Parent,',
    '',
    `Our record for ${student.full_name}${klass ? ` (${klass})` : ''} at ${SCHOOL_NAME} is still missing ${listed}.`,
    'Kindly provide this at the school office at your earliest convenience so the record can be completed.',
    '',
    'Thank you,',
    SCHOOL_NAME,
  ].join('\n');
}
