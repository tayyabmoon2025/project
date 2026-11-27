import { supabase } from '@/lib/supabase';
import { currentSession } from '@/lib/promotions';
import type { Student } from '@/lib/schoolTypes';

// --------------------------------------------------------------- the catalogue

export type CertificateCategory = 'official' | 'academic' | 'merit';

export type StudentCertificateType =
  | 'school_leaving' | 'transfer' | 'birth_dob' | 'character' | 'bonafide'
  | 'fee_clearance' | 'attempt' | 'hope' | 'provisional'
  | 'position_holder' | 'merit' | 'achievement' | 'sports' | 'cocurricular'
  | 'full_attendance';

export type StudentCertificateTypeInfo = {
  value: StudentCertificateType;
  label: string;
  short: string;
  category: CertificateCategory;
  // The heading printed across the middle of the certificate.
  title: string;
  hint: string;
  // The kind of extra detail the certificate needs beyond the student's own record.
  extra?: 'exam' | 'position' | 'event' | 'attempt' | 'achievement';
  extraLabel?: string;
  extraPlaceholder?: string;
};

export const CERTIFICATE_CATEGORIES: { value: CertificateCategory; label: string; hint: string }[] = [
  { value: 'official', label: 'Official & Transfer Certificates', hint: 'Leaving, birth, character, bonafide and no-dues certificates' },
  { value: 'academic', label: 'Academic & Board Certificates', hint: 'Attempt, hope and provisional certificates' },
  { value: 'merit', label: 'Merit, Position & Co-Curricular Certificates', hint: 'Awards for results, effort, sport and school life' },
];

export const STUDENT_CERTIFICATE_TYPES: StudentCertificateTypeInfo[] = [
  { value: 'school_leaving', label: 'School Leaving Certificate (SLC / TC)', short: 'SLC / TC', category: 'official', title: 'School Leaving Certificate', hint: 'Filled from the saved Leaving Info — serial no., dates, conduct and attendance' },
  { value: 'transfer', label: 'Transfer Certificate (TC)', short: 'Transfer', category: 'official', title: 'Transfer Certificate', hint: 'Transfer to another school, from the saved Leaving Info' },
  { value: 'birth_dob', label: 'Birth / Date of Birth Certificate', short: 'Birth / DOB', category: 'official', title: 'Date of Birth Certificate', hint: 'Date of birth in figures and in words, from the admission register' },
  { value: 'character', label: 'Character / Conduct Certificate', short: 'Character', category: 'official', title: 'Character Certificate', hint: 'Conduct and character during the student’s time at the school' },
  { value: 'bonafide', label: 'Bonafide / Regular Student Certificate', short: 'Bonafide', category: 'official', title: 'Bonafide Certificate', hint: 'Confirms the student is on the school roll in the stated class' },
  { value: 'fee_clearance', label: 'Fee Clearance / No-Dues Certificate', short: 'No dues', category: 'official', title: 'Fee Clearance Certificate', hint: 'Confirms the school has no dues outstanding against the student' },
  { value: 'attempt', label: 'Attempt Certificate', short: 'Attempt', category: 'academic', title: 'Attempt Certificate', hint: 'Records the number of attempts made at the board examination', extra: 'attempt', extraLabel: 'Attempt year and attempt number', extraPlaceholder: 'For example: 2026 — first attempt' },
  { value: 'hope', label: 'Hope Certificate', short: 'Hope', category: 'academic', title: 'Hope Certificate', hint: 'For a student awaiting their board result', extra: 'exam', extraLabel: 'Board / examination awaited', extraPlaceholder: 'For example: Matriculation Annual 2026' },
  { value: 'provisional', label: 'Provisional Certificate', short: 'Provisional', category: 'academic', title: 'Provisional Certificate', hint: 'Issued after passing, until the board certificate arrives', extra: 'exam', extraLabel: 'Examination passed', extraPlaceholder: 'For example: Matriculation Annual 2026' },
  { value: 'position_holder', label: 'Position Holder Certificate', short: 'Position', category: 'merit', title: 'Position Holder Certificate', hint: 'Awarded for a first, second or third position', extra: 'position', extraLabel: 'Examination and position', extraPlaceholder: 'For example: Annual Examination 2026 — 1st Position' },
  { value: 'merit', label: 'Merit Certificate', short: 'Merit', category: 'merit', title: 'Certificate of Merit', hint: 'For outstanding academic performance', extra: 'exam', extraLabel: 'Examination and standard', extraPlaceholder: 'For example: Annual Examination 2026 — Class 8' },
  { value: 'achievement', label: 'Achievement Certificate', short: 'Achievement', category: 'merit', title: 'Certificate of Achievement', hint: 'For a specific achievement during the year', extra: 'achievement', extraLabel: 'What the achievement was for', extraPlaceholder: 'For example: outstanding work in the science exhibition' },
  { value: 'sports', label: 'Sports & Athletics Certificate', short: 'Sports', category: 'merit', title: 'Sports Certificate', hint: 'For sporting and athletic achievement', extra: 'event', extraLabel: 'Sport, event and result', extraPlaceholder: 'For example: Inter-school cricket tournament — winners' },
  { value: 'cocurricular', label: 'Co-Curricular / Debate / Naat / Quiz Certificate', short: 'Co-curricular', category: 'merit', title: 'Certificate of Co-Curricular Achievement', hint: 'For debate, Naat, quiz and other school activities', extra: 'event', extraLabel: 'Activity and result', extraPlaceholder: 'For example: Inter-house Naat competition — first place' },
  { value: 'full_attendance', label: '100% Attendance Award Certificate', short: 'Attendance', category: 'merit', title: 'Certificate of Full Attendance', hint: 'Awarded for a full year without a single absence' },
];

// ------------------------------------------------------- border & font styles

// The decorative frame drawn around a printed certificate. Chosen when the certificate is
// issued and stored with it, so a reprint months later looks identical.
export type CertificateBorderStyle =
  | 'classic_gold_navy' | 'official_slate' | 'royal_emerald' | 'modern_geometric' | 'plain';

// The typography used for the wording on a printed certificate.
export type CertificateFontStyle =
  | 'classic_serif' | 'elegant_playfair' | 'modern_sans' | 'formal_garamond';

export const CERTIFICATE_BORDER_STYLES: {
  value: CertificateBorderStyle;
  label: string;
  hint: string;
}[] = [
  { value: 'classic_gold_navy', label: 'Classic Double Gold & Navy', hint: 'Ornate double line with corner accents — position, merit and sports' },
  { value: 'official_slate', label: 'Official Formal Slate', hint: 'Thin double border with a header rule — SLC/TC, birth and bonafide' },
  { value: 'royal_emerald', label: 'Royal Emerald Frame', hint: 'Rich green and gold inner and outer frame' },
  { value: 'modern_geometric', label: 'Modern Geometric Accent', hint: 'Sleek corner brackets with clean lines' },
  { value: 'plain', label: 'Plain Letterhead (No Border)', hint: 'Clean white paper for pre-printed school letterheads' },
];

export const CERTIFICATE_FONT_STYLES: {
  value: CertificateFontStyle;
  label: string;
  hint: string;
}[] = [
  { value: 'classic_serif', label: 'Classic Serif (Times / Georgia)', hint: 'Formal official look' },
  { value: 'elegant_playfair', label: 'Elegant Calligraphic (Playfair)', hint: 'Ceremonial look for awards and appreciation' },
  { value: 'modern_sans', label: 'Clean Modern Sans (Inter / Arial)', hint: 'Crisp, easy-to-read modern style' },
  { value: 'formal_garamond', label: 'Formal Bookman / Garamond', hint: 'Traditional academic certificate typography' },
];

export const DEFAULT_BORDER_STYLE: CertificateBorderStyle = 'classic_gold_navy';
export const DEFAULT_FONT_STYLE: CertificateFontStyle = 'classic_serif';

// A saved value that is missing or unrecognised falls back to the default, so a certificate
// issued before these options existed still prints cleanly.
export const certificateBorderStyle = (value: string | null | undefined): CertificateBorderStyle =>
  (CERTIFICATE_BORDER_STYLES.some((style) => style.value === value)
    ? (value as CertificateBorderStyle)
    : DEFAULT_BORDER_STYLE);

export const certificateFontStyle = (value: string | null | undefined): CertificateFontStyle =>
  (CERTIFICATE_FONT_STYLES.some((style) => style.value === value)
    ? (value as CertificateFontStyle)
    : DEFAULT_FONT_STYLE);

export const certificateTypeInfo = (value: string): StudentCertificateTypeInfo | undefined =>
  STUDENT_CERTIFICATE_TYPES.find((type) => type.value === value);

export const certificateTypeLabel = (value: string) => certificateTypeInfo(value)?.label ?? value;

export const certificateTypeShort = (value: string) => certificateTypeInfo(value)?.short ?? value;

export const certificateTypeTitle = (value: string) => certificateTypeInfo(value)?.title ?? certificateTypeLabel(value);

// --------------------------------------------------------------- the records

export type CertificateApprovalStatus = 'pending' | 'approved';

export type StudentCertificate = {
  id: string;
  student_id: string;
  certificate_type: StudentCertificateType;
  certificate_number: string | null;
  slc_serial_number: string | null;
  title: string;
  body: string;
  issued_on: string;
  border_style?: CertificateBorderStyle | null;
  font_style?: CertificateFontStyle | null;
  // The code printed under the QR mark at the foot of the certificate. It is what makes
  // the verification page safe to leave open to the public: the number is on the paper for
  // anyone to read, the code is not.
  verification_code?: string | null;
  approval_status: CertificateApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  issued_by: string | null;
  created_at: string;
  // Attached by the issuing function so the register can print without a second lookup.
  student_name?: string | null;
  admission_number?: string | null;
  class_name?: string | null;
  section_name?: string | null;
};

const CERTIFICATE_COLUMNS = [
  'id', 'student_id', 'certificate_type', 'certificate_number', 'slc_serial_number',
  'title', 'body', 'issued_on', 'approval_status', 'approved_by', 'approved_at',
  'issued_by', 'created_at', 'border_style', 'font_style', 'verification_code',
].join(', ');

const GENERIC = 'Could not reach the school server. Check your connection and try again.';

const FRIENDLY: Record<string, string> = {
  'Only administrators can issue student certificates': 'Only an administrator can issue a student certificate.',
  'Only administrators can approve or hold a student certificate': 'Only an administrator can release or hold a certificate.',
  'Only administrators can remove a student certificate': 'Only an administrator can remove a certificate.',
  'Only administrators can change a certificate code': 'Only an administrator can change a certificate code.',
  'That student could not be found': 'That student could not be found.',
  'That certificate could not be found': 'That certificate could not be found.',
  'Choose a valid certificate type': 'Choose the kind of certificate to issue.',
  'The certificate wording cannot be empty': 'The certificate wording cannot be empty.',
  'Choose either approve or hold': 'Choose either release or hold.',
};

const friendly = (message: string | undefined, fallback: string) =>
  (message ? FRIENDLY[message] ?? fallback : fallback);

// The whole register. An administrator sees every certificate; a family or a teacher
// sees only the ones that have been released, because the database hides the rest.
export async function fetchStudentCertificates(): Promise<{ certificates: StudentCertificate[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_student_certificates')
      .select(CERTIFICATE_COLUMNS)
      .order('issued_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return { certificates: [], error: 'The certificate register could not be loaded.' };
    return { certificates: (data ?? []) as unknown as StudentCertificate[], error: null };
  } catch {
    return { certificates: [], error: GENERIC };
  }
}

// The released certificates for one student, with the student's name attached. Used by
// the family portals, where only released certificates come back at all.
export async function fetchReleasedCertificatesFor(studentIds: string[]): Promise<StudentCertificate[]> {
  if (studentIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('school_student_certificates')
      .select(CERTIFICATE_COLUMNS)
      .in('student_id', studentIds)
      .eq('approval_status', 'approved')
      .order('issued_on', { ascending: false });
    if (error) return [];
    return (data ?? []) as unknown as StudentCertificate[];
  } catch {
    return [];
  }
}

// The next free number for the chosen kind of certificate, asked for as the form is
// filled in so the office can quote it. The database allocates the real one at save time.
export async function fetchNextCertificateNumber(
  type: StudentCertificateType,
  year: number,
): Promise<string> {
  const prefix = type === 'school_leaving' || type === 'transfer'
    ? 'TUS-SLC'
    : type === 'birth_dob'
      ? 'TUS-DOB'
      : 'TUS-CERT';
  const fallback = `${prefix}-${year}-001`;
  try {
    const { data, error } = await supabase.rpc('next_student_certificate_number', {
      p_certificate_type: type,
      p_year: year,
    });
    if (error || typeof data !== 'string' || !data) return fallback;
    return data;
  } catch {
    return fallback;
  }
}

export type IssueCertificateResult = { certificate: StudentCertificate | null; error: string | null };

export async function issueStudentCertificate(params: {
  studentId: string;
  certificateType: StudentCertificateType;
  title: string;
  body: string;
  slcSerialNumber: string;
  certificateNumber: string;
  issuedOn: string;
  approveNow: boolean;
  borderStyle: CertificateBorderStyle;
  fontStyle: CertificateFontStyle;
}): Promise<IssueCertificateResult> {
  try {
    const { data, error } = await supabase.rpc('admin_issue_student_certificate', {
      p_student_id: params.studentId,
      p_certificate_type: params.certificateType,
      p_title: params.title.trim(),
      p_body: params.body.trim(),
      p_slc_serial_number: params.slcSerialNumber.trim() || null,
      p_certificate_number: params.certificateNumber.trim() || null,
      p_issued_on: params.issuedOn || null,
      p_approval_status: params.approveNow ? 'approved' : 'pending',
      p_border_style: params.borderStyle,
      p_font_style: params.fontStyle,
    });
    if (error) return { certificate: null, error: friendly(error.message, 'The certificate could not be issued.') };
    const row = (data ?? null) as unknown as StudentCertificate | null;
    if (!row || typeof row.id !== 'string') {
      return { certificate: null, error: 'The certificate was saved but could not be read back.' };
    }
    return { certificate: row, error: null };
  } catch {
    return { certificate: null, error: GENERIC };
  }
}

// Release a certificate to the family portals, or put it back on hold.
export async function decideStudentCertificate(
  id: string,
  decision: 'approve' | 'hold',
): Promise<{ certificate: StudentCertificate | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('admin_decide_student_certificate', {
      p_id: id,
      p_decision: decision,
    });
    if (error) return { certificate: null, error: friendly(error.message, 'The certificate could not be updated.') };
    const row = (data ?? null) as unknown as StudentCertificate | null;
    if (!row || typeof row.id !== 'string') {
      return { certificate: null, error: 'The change was saved but could not be read back.' };
    }
    return { certificate: row, error: null };
  } catch {
    return { certificate: null, error: GENERIC };
  }
}

export async function deleteStudentCertificate(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_student_certificate', { p_id: id });
    if (error) return { error: friendly(error.message, 'The certificate could not be removed.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

// Issues a fresh verification code for a certificate whose printed code has to be
// withdrawn — a misprint, or a copy that was never handed out. The old paper stops
// verifying the moment this succeeds.
export async function regenerateCertificateCode(id: string): Promise<{ certificate: StudentCertificate | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('regenerate_student_certificate_code', { p_id: id });
    if (error) return { certificate: null, error: friendly(error.message, 'A new code could not be issued.') };
    const row = (data ?? null) as unknown as StudentCertificate | null;
    if (!row || typeof row.id !== 'string') {
      return { certificate: null, error: 'The new code was saved but could not be read back.' };
    }
    return { certificate: row, error: null };
  } catch {
    return { certificate: null, error: GENERIC };
  }
}

// --------------------------------------------------------------- dates and words

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

// 1 to 99 in words, which is all a day of the month or a year suffix needs.
function twoDigits(value: number): string {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
}

// "Two Thousand and Twenty-Six" — the way a date of birth is written out in full.
export function yearInWords(year: number): string {
  if (year < 1000 || year > 9999) return String(year);
  const thousands = Math.floor(year / 1000);
  const hundreds = Math.floor((year % 1000) / 100);
  const rest = year % 100;
  const parts = [`${ONES[thousands]} Thousand`];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(`and ${twoDigits(rest)}`);
  return parts.join(' ');
}

export function longDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')} ${MONTHS[parsed.getMonth()].slice(0, 3)} ${parsed.getFullYear()}`;
}

// "22nd November 2013" — the formal way a date of birth is written on a certificate.
export function dateInWords(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = parsed.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
      : day % 10 === 3 && day !== 13 ? 'rd'
        : 'th';
  return `${day}${suffix} ${MONTHS[parsed.getMonth()]} ${yearInWords(parsed.getFullYear())}`;
}

// A date of birth with the figures and the words together, which is what a birth
// certificate and a leaving certificate both have to show.
export function dobInFiguresAndWords(value: string | null | undefined): string {
  const figures = longDate(value);
  const words = dateInWords(value);
  if (!figures) return 'not recorded on the admission register';
  return `${figures} (${words})`;
}

// --------------------------------------------------------------- wording

export type CertificateDraft = {
  title: string;
  body: string;
  // The serial number that goes on a leaving certificate, if any.
  slcSerialNumber: string;
};

const text = (value: string | null | undefined) => (value ?? '').trim();

// S/O for a boy, D/O for a girl, taken from the gender saved on the admission form. When
// the gender is blank the relationship recorded against the guardian decides instead.
function genderWord(student: Student): 'S/O' | 'D/O' {
  const gender = text(student.gender).toLowerCase();
  if (gender.startsWith('f') || gender.includes('female') || gender.includes('girl')) return 'D/O';
  if (gender.startsWith('m') || gender.includes('male') || gender.includes('boy')) return 'S/O';
  return text(student.guardian_relationship).toLowerCase().includes('mother') ? 'D/O' : 'S/O';
}

// The student's name the way the office writes it on a formal document:
// "Mr. Ali Raza S/O Abdul Karim". The relation is stated exactly once — no certificate
// wording adds a second ", son/daughter of ..." phrase beside it.
function studentIdentity(student: Student): string {
  const prefix = text(student.student_name_prefix);
  const name = text(student.full_name);
  const parent = text(student.fathers_name) || text(student.guardian_name);
  const named = prefix ? `${prefix} ${name}` : name;
  return parent ? `${named} ${genderWord(student)} ${parent}` : named;
}

function admissionClause(student: Student): string {
  const admission = text(student.admission_number);
  const date = longDate(student.admission_date);
  if (admission && date) return `The school's admission register records admission number ${admission}, dated ${date}.`;
  if (admission) return `The school's admission register records admission number ${admission}.`;
  return '';
}

function classLine(student: Student): string {
  const className = text(student.class_name);
  const section = text(student.section_name);
  if (className && section) return `${className} · Section ${section}`;
  return className || 'the current class';
}

// The wording for every kind of certificate. It is only a starting point — every word
// stays editable on the screen before the certificate is saved.
export function buildCertificateDraft(params: {
  type: StudentCertificateType;
  student: Student;
  schoolName: string;
  extra: string;
  session?: string;
  serialNumber?: string;
  issuedOn?: string;
}): CertificateDraft {
  const { type, student, schoolName } = params;
  const who = studentIdentity(student);
  const klass = classLine(student);
  const extra = text(params.extra);
  const session = text(params.session) || currentSession();
  const dob = dobInFiguresAndWords(student.date_of_birth);

  const leavingDate = longDate(student.leaving_date);
  const conduct = text(student.conduct) || 'Good';
  const progress = text(student.progress) || 'Satisfactory';
  const feePaidUpto = longDate(student.fee_paid_upto);
  const attendance = text(student.attendance_summary);
  const leavingReason = text(student.leaving_reason);
  const slcSerial = text(params.serialNumber) || text(student.slc_serial_number);
  const awardedOn = longDate(params.issuedOn) || longDate(new Date().toISOString().slice(0, 10));

  const recordLine = [
    `Date of birth: ${dob}.`,
    `Father's / guardian's name: ${text(student.fathers_name) || text(student.guardian_name) || 'as recorded on the admission form'}.`,
    `Class last attended: ${klass}.`,
  ].join('\n');

  const leavingLines = [
    slcSerial ? `School Leaving Certificate serial no.: ${slcSerial}.` : '',
    leavingDate ? `Date of leaving the school: ${leavingDate}.` : '',
    text(student.leaving_class) ? `Class at the time of leaving: ${text(student.leaving_class)}.` : '',
    leavingReason ? `Reason for leaving: ${leavingReason}.` : '',
    feePaidUpto ? `School dues paid up to: ${feePaidUpto}.` : '',
    `Conduct: ${conduct}.`,
    `Progress in studies: ${progress}.`,
    attendance ? `Attendance: ${attendance}.` : '',
  ].filter(Boolean).join('\n');

  switch (type) {
    case 'school_leaving':
      return {
        title: 'School Leaving Certificate',
        slcSerialNumber: slcSerial,
        body: `This is to certify that ${who} was a bonafide student of ${schoolName}, studying in ${klass}.

${recordLine}

${leavingLines || 'The leaving details are recorded in the school register.'}

${text(student.leaving_remarks) ? `${text(student.leaving_remarks)}\n\n` : ''}This certificate is issued at the request of the parent or guardian for official use. The school records are open to the issuing authority for verification.`,
      };

    case 'transfer':
      return {
        title: 'Transfer Certificate',
        slcSerialNumber: slcSerial,
        body: `This is to certify that ${who} was a student on the rolls of ${schoolName}, in ${klass}.

${recordLine}

${leavingLines || 'The leaving details are recorded in the school register.'}

The school has no objection to the student continuing their education at another institution, and this certificate is issued for the purpose of transfer. All dues have been settled as recorded above.`,
      };

    case 'birth_dob':
      return {
        title: 'Date of Birth Certificate',
        slcSerialNumber: '',
        body: `This is to certify that the date of birth of ${who} is recorded in the admission register of ${schoolName} as ${dob}.

${admissionClause(student)}

The student's date of birth is verified from the school's admission record as stated above.

This certificate is issued for official use on the request of the parent or guardian.`,
      };

    case 'character':
      return {
        title: 'Character Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} is a student of ${schoolName}, studying in ${klass}.

During the period of study, the student's character and conduct have been found to be ${conduct.toLowerCase()}. The student has been well behaved, courteous and cooperative with the teachers and fellow students.

${progress ? `Progress in studies has been ${progress.toLowerCase()}.\n\n` : ''}The school has no hesitation in certifying the good character of the student.

This certificate is issued on the request of the parent or guardian for official use.`,
      };

    case 'bonafide':
      return {
        title: 'Bonafide Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} is a bonafide regular student of ${schoolName}, studying in ${klass} during the academic session ${session}.

${recordLine}

${admissionClause(student)}

This certificate is issued on the request of the parent or guardian for official use.`,
      };

    case 'fee_clearance':
      return {
        title: 'Fee Clearance Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} is a student of ${schoolName}, studying in ${klass}.

The school's accounts record shows that all dues payable by the student${feePaidUpto ? ` up to ${feePaidUpto}` : ''} have been cleared. No amount is outstanding against the student in the school's fee register as on the date of this certificate.

This certificate is issued on the request of the parent or guardian for official use.`,
      };

    case 'attempt':
      return {
        title: 'Attempt Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} is a student of ${schoolName} and appeared in the board examination in ${klass}.

${extra ? `The student appeared for the examination in ${extra}.` : 'The number of attempts made by the student is recorded in the school examination register.'}

The examination record of the school confirms the above.

This certificate is issued on the request of the parent or guardian for official use.`,
      };

    case 'hope':
      return {
        title: 'Hope Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} is a regular student of ${schoolName} in ${klass}.

The student has appeared in ${extra || 'the forthcoming board examination'}, the result of which has not yet been announced. On the basis of the student's performance in the school's internal assessments and pre-board examinations, the school is hopeful that the student will pass.

This certificate is issued on the request of the parent or guardian, to be placed before the concerned authority as proof that the student is awaiting the result.`,
      };

    case 'provisional':
      return {
        title: 'Provisional Certificate',
        slcSerialNumber: '',
        body: `This is to certify that ${who} was a regular student of ${schoolName} in ${klass}.

The student appeared in ${extra || 'the board examination'} and has passed the same as per the school's examination record. The result is provisional and is subject to the declaration of the final result by the board.

This certificate is issued on the request of the parent or guardian as a provisional document until the board certificate is issued. It does not replace the final certificate.`,
      };

    case 'position_holder':
      return {
        title: 'Position Holder Certificate',
        slcSerialNumber: '',
        body: `This certificate of achievement is proudly presented to ${who} of ${klass} in ${schoolName}.

${extra ? `The student secured ${extra} in the examination conducted by the school.` : 'The student secured a top position in the examination conducted by the school.'}

This is an outstanding achievement and a matter of great pride for the student, the parents and the school. The school records this achievement and congratulates the student.

Awarded on ${awardedOn}.`,
      };

    case 'merit':
      return {
        title: 'Certificate of Merit',
        slcSerialNumber: '',
        body: `This certificate of merit is awarded to ${who} of ${klass} in ${schoolName}.

${extra ? `The student’s performance in ${extra} has been outstanding.` : 'The student’s academic performance during the session has been outstanding.'} Diligence, consistency and a sincere attitude towards studies have placed the student among the very best of the school.

The school records its appreciation and wishes the student continued success.

Awarded on ${awardedOn}.`,
      };

    case 'achievement':
      return {
        title: 'Certificate of Achievement',
        slcSerialNumber: '',
        body: `This certificate of achievement is presented to ${who} of ${klass} in ${schoolName}.

${extra ? `The student is recognised for ${extra}.` : 'The student is recognised for a notable achievement during the session.'} This accomplishment reflects dedication, effort and a spirit of excellence.

The school records its appreciation and congratulates the student on this achievement.

Awarded on ${awardedOn}.`,
      };

    case 'sports':
      return {
        title: 'Sports Certificate',
        slcSerialNumber: '',
        body: `This sports certificate is proudly presented to ${who} of ${klass} in ${schoolName}.

${extra ? `The student took part in ${extra} and brought honour to the school.` : 'The student represented the school in sporting events and brought honour to the school.'} The student’s sportsmanship, discipline and team spirit have been exemplary.

The school records its appreciation and wishes the student success in all future competitions.

Awarded on ${awardedOn}.`,
      };

    case 'cocurricular':
      return {
        title: 'Certificate of Co-Curricular Achievement',
        slcSerialNumber: '',
        body: `This certificate is presented to ${who} of ${klass} in ${schoolName}.

${extra ? `The student participated in ${extra} and performed with distinction.` : 'The student participated in the co-curricular activities of the school and performed with distinction.'} The student’s confidence, talent and participation in the life of the school are greatly appreciated.

The school records its appreciation and congratulates the student.

Awarded on ${awardedOn}.`,
      };

    case 'full_attendance':
      return {
        title: 'Certificate of Full Attendance',
        slcSerialNumber: '',
        body: `This certificate of full attendance is awarded to ${who} of ${klass} in ${schoolName}.

The student attended the school on every working day of the academic session ${session} and maintained one hundred percent attendance. Such regularity, discipline and commitment are truly commendable.

The school records its appreciation and encourages the student to keep up this excellent habit.

Awarded on ${awardedOn}.`,
      };
  }
}

// --------------------------------------------------------------- WhatsApp

export function certificateMessage(
  record: { certificate_number: string | null; certificate_type: string; issued_on: string; title?: string },
  studentName: string,
  schoolName: string,
): string {
  return [
    `${schoolName} — ${record.title || certificateTypeLabel(record.certificate_type)}`,
    `Issued to: ${studentName}`,
    `Certificate no.: ${record.certificate_number ?? '—'}`,
    `Date of issue: ${longDate(record.issued_on)}`,
    '',
    'The certificate has been issued and signed by the school office. Please collect the printed copy, or ask the office to send it across.',
  ].join('\n');
}
