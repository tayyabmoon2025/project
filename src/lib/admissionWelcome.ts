import { supabase } from '@/lib/supabase';
import { cleanPhoneNumber, formatWhatsAppNumber, isValidWhatsAppNumber } from '@/lib/whatsapp';
import type { Student } from '@/lib/schoolTypes';

// The school name the welcome messages use. The admission copy the office approved
// reads "The Ujala School", which is what families see on the WhatsApp message and in
// the portal notification.
export const ADMISSION_SCHOOL_NAME = 'The Ujala School';

// The admitted class as it should read inside a sentence: the form stores "Class 5",
// so the word "Class" is dropped and re-added around it.
export function admittedClassLabel(student: Student): string {
  const raw = (student.admitted_in_class ?? '').trim() || (student.class_name ?? '').trim();
  if (!raw) return 'the new class';
  return raw.replace(/^class\s+/i, '');
}

export function admissionCongratulation(student: Student): string {
  return `Congratulations! Your child ${student.full_name} has been admitted to Class ${admittedClassLabel(student)} at ${ADMISSION_SCHOOL_NAME}.`;
}

// Where the family signs in. The address is the page the office is already using, so
// the link always points at the school's own portal.
export function portalLoginUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/`;
}

export type AdmissionWelcome = {
  student: Student;
  studentName: string;
  admissionNumber: string;
  admittedClass: string;
  // The guardian's WhatsApp number in the international digits-only form, empty when
  // the admission carries no usable contact number.
  whatsappNumber: string;
  whatsappDisplay: string;
  guardianName: string;
  // Null when no parent login could be created (no contact number, or the account
  // could not be made). The message then carries no sign-in details.
  credentials: { username: string; password: string; isReset?: boolean } | null;
  // Why no login is shown, so the office knows what to do next.
  loginNote: string | null;
};

export function pickAdmissionContact(student: Student): { number: string; display: string } {
  const candidates = [
    student.whatsapp_number,
    student.messaging_number,
    student.guardian_phone,
    student.father_contact_number,
    student.mother_number,
  ];
  for (const candidate of candidates) {
    const raw = (candidate ?? '').trim();
    if (!raw || !isValidWhatsAppNumber(raw)) continue;
    return { number: cleanPhoneNumber(raw), display: formatWhatsAppNumber(raw) };
  }
  return { number: '', display: '' };
}

export function guardianNameFor(student: Student): string {
  return (student.guardian_name ?? '').trim()
    || (student.fathers_name ?? '').trim()
    || (student.full_name ?? '').trim()
    || 'Parent';
}

// The parent signs in with the family's WhatsApp number, so one account covers every
// child from the same household. When no number is saved, the admission number is used
// instead so the login can still be created.
export function parentUsernameFor(student: Student, contactDigits: string): string {
  if (contactDigits.length >= 10) return contactDigits;
  const base = (student.admission_number ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `parent-${base}` : '';
}

export function admissionWelcomeMessage(welcome: AdmissionWelcome): string {
  const isReset = welcome.credentials?.isReset === true;
  const lines = isReset
    ? [
        `${ADMISSION_SCHOOL_NAME}`,
        '',
        `Dear ${welcome.guardianName},`,
        `A new password has been set for your Parent Portal account for ${welcome.studentName} (Class ${welcome.admittedClass}).`,
      ]
    : [
        `${ADMISSION_SCHOOL_NAME}`,
        '',
        admissionCongratulation(welcome.student),
        `Admission No.: ${welcome.admissionNumber || '—'}`,
      ];

  if (welcome.credentials) {
    lines.push(
      '',
      isReset ? 'Your new login details:' : 'Parent Portal login details:',
      `Link: ${portalLoginUrl()}`,
      `Username: ${welcome.credentials.username}`,
      `Password: ${welcome.credentials.password}`,
      '',
      'Please keep these details safe and change the password after your next sign-in.',
    );
  } else {
    lines.push(
      '',
      'The school office will share the Parent Portal login details with you shortly.',
    );
  }

  lines.push('', `Regards,`, `${ADMISSION_SCHOOL_NAME} — Office`);
  return lines.join('\n');
}

// Writes the welcome notice into the parent portal. The notification is a convenience:
// a failure here never blocks the admission itself.
export async function notifyAdmissionSaved(studentId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('create_admission_notification', { p_student_id: studentId });
    return { error: error ? error.message : null };
  } catch {
    return { error: 'The portal notification could not be created.' };
  }
}

export type AdmissionWelcomeResult = { welcome: AdmissionWelcome; noticeError: string | null };

// Runs the two automated steps that follow a first admission:
//   1. a portal notice for the family, and
//   2. a parent login (reused when a brother or sister already has one).
// The WhatsApp welcome message itself is composed here and sent by the office from the
// modal, so nothing leaves the school without a person pressing Send.
export async function prepareAdmissionWelcome(
  student: Student,
  credentials: { username: string; password: string } | null,
  canCreateLogins: boolean,
): Promise<AdmissionWelcomeResult> {
  const contact = pickAdmissionContact(student);
  const notice = await notifyAdmissionSaved(student.id);

  const loginNote = credentials
    ? null
    : !canCreateLogins
      ? 'Only an administrator can create portal logins. The office can set one up from the User Accounts screen.'
      : !contact.number
        ? 'No guardian contact number is saved on this admission, so no portal login was created. Add the family\'s WhatsApp number to the student record to create one.'
        : 'The parent portal login could not be created just now. The admission is saved — it can be created again from the User Accounts screen.';

  return {
    welcome: {
      student,
      studentName: student.full_name,
      admissionNumber: student.admission_number,
      admittedClass: admittedClassLabel(student),
      whatsappNumber: contact.number,
      whatsappDisplay: contact.display,
      guardianName: guardianNameFor(student),
      credentials,
      loginNote,
    },
    noticeError: notice.error,
  };
}
