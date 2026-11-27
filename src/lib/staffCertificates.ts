import { supabase } from '@/lib/supabase';
import { formatCnic, staffId } from '@/lib/staffDirectory';
import { STAFF_ROLE_OPTIONS } from '@/lib/staffProfile';
import { allowanceTotal, packageGross, type PayPackage } from '@/lib/payroll';
import type { UserRole } from '@/lib/auth';

// ---------------------------------------------------------------- reference

// Every certificate the school issues is numbered TUS-CERT-<year>-<nnn>. The number is
// taken from the database so two certificates can never share one.
export const CERTIFICATE_PREFIX = 'TUS-CERT';

// -------------------------------------------------------------- the six types

export type CertificateType =
  | 'experience' | 'employment' | 'salary' | 'character' | 'no_objection' | 'appreciation';

export const CERTIFICATE_TYPES: { value: CertificateType; label: string; short: string; hint: string }[] = [
  { value: 'experience', label: 'Experience Certificate', short: 'Experience', hint: 'Service dates and conduct, for a new employer' },
  { value: 'employment', label: 'Employment / Service Certificate', short: 'Employment', hint: 'Confirms the staff member works at the school' },
  { value: 'salary', label: 'Salary Certificate', short: 'Salary', hint: 'Monthly salary drawn, from the pay package' },
  { value: 'character', label: 'Character Certificate', short: 'Character', hint: 'Conduct and character during service' },
  { value: 'no_objection', label: 'No Objection Certificate (NOC)', short: 'NOC', hint: 'No dues outstanding, no objection raised' },
  { value: 'appreciation', label: 'Appreciation Certificate', short: 'Appreciation', hint: 'Awarded in recognition of good service' },
];

export const certificateTypeLabel = (value: string) =>
  CERTIFICATE_TYPES.find((type) => type.value === value)?.label ?? value;

export const certificateTypeShort = (value: string) =>
  CERTIFICATE_TYPES.find((type) => type.value === value)?.short ?? value;

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  STAFF_ROLE_OPTIONS.map((option) => [option.value, option.label]),
);

export const designationFor = (role: string | null | undefined) =>
  ROLE_LABELS[role ?? ''] ?? (role ?? '').replace(/_/g, ' ');

// ------------------------------------------------------------------- records

export type StaffCertificate = {
  id: string;
  reference_no: string | null;
  certificate_type: CertificateType;
  purpose: string | null;
  issued_on: string;
  body: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
  staff_code: string | null;
  staff_role: string | null;
  staff_photo_url: string | null;
  issued_by: string | null;
  created_at: string;
};

const CERTIFICATE_COLUMNS = [
  'id', 'reference_no', 'certificate_type', 'purpose', 'issued_on', 'body',
  'staff_user_id', 'staff_name', 'staff_code', 'staff_role', 'staff_photo_url',
  'issued_by', 'created_at',
].join(', ');

// The register is also kept in the browser so the list is on screen the moment the tab
// opens, and stays readable if the connection drops. The database remains the record of
// truth: every save writes there first and the cache is refreshed from it.
const CACHE_KEY = 'schooldesk_staff_certificates';

function readCache(): StaffCertificate[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StaffCertificate[]) : [];
  } catch {
    return [];
  }
}

function writeCache(rows: StaffCertificate[]) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // A full or blocked storage area is not a failure of the certificate itself.
  }
}

export function cachedStaffCertificates(): StaffCertificate[] {
  return readCache();
}

const FRIENDLY: Record<string, string> = {
  'Only administrators can issue staff certificates': 'Only an administrator can issue a certificate.',
  'Only administrators can remove staff certificates': 'Only an administrator can remove a certificate.',
  'That staff member could not be found': 'That staff member could not be found.',
  'That certificate could not be found': 'That certificate could not be found.',
  'Choose a valid certificate type': 'Choose the kind of certificate to issue.',
  'The certificate wording cannot be empty': 'The certificate wording cannot be empty.',
  'A full name is required': 'The staff member needs a full name before a certificate can be issued.',
};

const friendly = (message: string | undefined, fallback: string) => (message ? FRIENDLY[message] ?? fallback : fallback);
const GENERIC = 'Could not reach the school server. Check your connection and try again.';

export async function fetchStaffCertificates(): Promise<{ certificates: StaffCertificate[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_staff_certificates')
      .select(CERTIFICATE_COLUMNS)
      .order('issued_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return { certificates: readCache(), error: 'The certificate register could not be loaded.' };
    const rows = (data ?? []) as unknown as StaffCertificate[];
    writeCache(rows);
    return { certificates: rows, error: null };
  } catch {
    return { certificates: readCache(), error: GENERIC };
  }
}

// The next free number for a year, asked for before anything is saved so the office can
// see it on the form. The database allocates the real one at save time.
export async function fetchNextCertificateReference(year: number): Promise<string> {
  const fallback = `${CERTIFICATE_PREFIX}-${year}-001`;
  try {
    const { data, error } = await supabase.rpc('next_staff_certificate_reference', { p_year: year });
    if (error || typeof data !== 'string' || !data) return fallback;
    return data;
  } catch {
    return fallback;
  }
}

export async function issueStaffCertificate(params: {
  staffUserId: string;
  certificateType: CertificateType;
  purpose: string;
  issueDate: string;
  body: string;
}): Promise<{ certificate: StaffCertificate | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('admin_issue_staff_certificate', {
      p_staff_user_id: params.staffUserId,
      p_certificate_type: params.certificateType,
      p_purpose: params.purpose.trim() || null,
      p_reference_no: null,
      p_issued_on: params.issueDate || null,
      p_remarks: params.body.trim(),
    });
    if (error) return { certificate: null, error: friendly(error.message, 'The certificate could not be issued.') };
    const row = (data ?? null) as unknown as StaffCertificate | null;
    if (!row || typeof row.id !== 'string') {
      return { certificate: null, error: 'The certificate was saved but could not be read back.' };
    }
    return { certificate: row, error: null };
  } catch {
    return { certificate: null, error: GENERIC };
  }
}

export async function deleteStaffCertificate(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_staff_certificate', { p_id: id });
    if (error) return { error: friendly(error.message, 'The certificate could not be removed.') };
    return { error: null };
  } catch {
    return { error: GENERIC };
  }
}

// ------------------------------------------------------------------- wording

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

const money = (value: number) => `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;

// The staff fields a certificate is written from. A narrow shape rather than the whole
// personnel record, so the wording helper can be called from anywhere.
export type CertificateStaff = {
  id: string;
  full_name: string;
  role: UserRole;
  status: string;
  staff_code: string | null;
  gender: string | null;
  relation_type: string | null;
  father_name: string | null;
  cnic: string | null;
  joining_date: string | null;
  leaving_date: string | null;
  leaving_reason: string | null;
  mobile_number: string | null;
  photo_url: string | null;
};

export const certificateStaffCode = (staff: CertificateStaff) => staff.staff_code ?? staffId(staff.id);

export const isServingStaff = (staff: CertificateStaff) => staff.status === 'active';

type Pronouns = { subj: string; subjLower: string; obj: string; poss: string; possLower: string; title: string };

function pronounsFor(gender: string | null | undefined): Pronouns {
  const female = (gender ?? '').trim().toLowerCase().startsWith('f');
  return female
    ? { subj: 'She', subjLower: 'she', obj: 'her', poss: 'Her', possLower: 'her', title: 'Ms.' }
    : { subj: 'He', subjLower: 'he', obj: 'him', poss: 'His', possLower: 'his', title: 'Mr.' };
}

function relationPrefix(relationType: string | null | undefined): string {
  if (relationType === 'daughter') return 'D/O';
  if (relationType === 'wife') return 'W/O';
  return 'S/O';
}

// "Mr. Ali Raza S/O Abdul Karim" — the way the office writes a name on a formal letter.
function identityLine(staff: CertificateStaff): string {
  const pronouns = pronounsFor(staff.gender);
  const name = `${pronouns.title} ${staff.full_name.trim()}`;
  const father = (staff.father_name ?? '').trim();
  return father ? `${name} ${relationPrefix(staff.relation_type)} ${father}` : name;
}

function cnicClause(staff: CertificateStaff): string {
  const cnic = formatCnic(staff.cnic);
  return cnic ? `, holding CNIC ${cnic},` : '';
}

// "from 1 March 2019 to 30 June 2025", or "with effect from 1 March 2019" for someone
// still serving, or nothing at all when no joining date is on record.
function servicePeriod(staff: CertificateStaff): string {
  const joining = longDate(staff.joining_date);
  const leaving = longDate(staff.leaving_date);
  if (joining && leaving) return ` from ${joining} to ${leaving}`;
  if (joining) return ` with effect from ${joining}`;
  return '';
}

function leavingSentence(staff: CertificateStaff): string {
  const leaving = longDate(staff.leaving_date);
  if (!leaving) return '';
  const reason = (staff.leaving_reason ?? '').trim();
  const pronouns = pronounsFor(staff.gender);
  return `\n\n${pronouns.poss} service with the school ended on ${leaving}${reason ? ` on account of ${reason}` : ''}.`;
}

// Builds the wording the office would otherwise type by hand, filled in from the staff
// member's own record. It is only a starting point — every word stays editable.
export function buildCertificateBody(params: {
  type: CertificateType;
  staff: CertificateStaff;
  schoolName: string;
  purpose: string;
  payPackage: PayPackage | null;
}): string {
  const { type, staff, schoolName, purpose, payPackage } = params;
  const p = pronounsFor(staff.gender);
  const who = identityLine(staff);
  const cnic = cnicClause(staff);
  const period = servicePeriod(staff);
  const left = leavingSentence(staff);
  const designation = designationFor(staff.role);
  const asked = purpose.trim();

  switch (type) {
    case 'experience':
      return `TO WHOM IT MAY CONCERN

This is to certify that ${who}${cnic} served at ${schoolName} as ${designation}${period}.

During ${p.possLower} tenure with the institution, ${p.subjLower} was found to be hardworking, sincere and professionally competent. ${p.poss} conduct and ${p.possLower} cooperation with colleagues and students remained exemplary throughout.${left}

We wish ${p.obj} every success in ${p.possLower} future endeavours.`;

    case 'employment':
      return `TO WHOM IT MAY CONCERN

This is to certify that ${who}${cnic} is employed with ${schoolName} as ${designation}${period}.

${p.poss} employment record with the institution is satisfactory, and no disciplinary action has ever been taken against ${p.obj}.

This certificate is issued on ${p.possLower} request${asked ? ` for ${asked}` : ' for official record and verification'}.`;

    case 'salary': {
      const salaryLine = payPackage
        ? `${p.poss} gross monthly salary is ${money(packageGross(payPackage))}/-, comprising a basic salary of ${money(payPackage.basic_salary)}/- together with allowances of ${money(allowanceTotal(payPackage))}/- per month.`
        : `${p.poss} salary is paid monthly as recorded in the school's payroll register, and the office will confirm the exact figure on request.`;
      return `TO WHOM IT MAY CONCERN

This is to certify that ${who}${cnic} is employed with ${schoolName} as ${designation}${period}.

${salaryLine}

This certificate is issued on ${p.possLower} request${asked ? ` for ${asked}` : ' for official record'}.`;
    }

    case 'character':
      return `TO WHOM IT MAY CONCERN

This is to certify that ${who}${cnic} served at ${schoolName} as ${designation}${period}.

During ${p.possLower} stay with the institution, ${p.possLower} character and conduct were found to be excellent. ${p.subj} was honest, well mannered and cooperative with colleagues and students alike.${left}

We have no hesitation in certifying ${p.possLower} good character, and we wish ${p.obj} success in all future endeavours.`;

    case 'no_objection':
      return `TO WHOM IT MAY CONCERN

This is to certify that ${who}${cnic} is serving at ${schoolName} as ${designation}${period}.

The school has no dues outstanding against ${p.obj}, and no objection is raised to ${p.obj} ${asked || 'pursuing higher studies or accepting employment elsewhere'}.

This certificate is issued on ${p.possLower} request for the purpose stated above.`;

    case 'appreciation':
      return `CERTIFICATE OF APPRECIATION

This certificate of appreciation is proudly presented to ${who}${cnic} in recognition of ${p.possLower} dedication, hard work and valuable service to ${schoolName} as ${designation}.

${p.poss} commitment has contributed meaningfully to the institution and to the students in our care. We record our sincere gratitude and wish ${p.obj} continued success.${left}`;
  }
}

// --------------------------------------------------------------- WhatsApp

export function certificateMessage(record: {
  reference_no: string | null;
  certificate_type: string;
  issued_on: string;
  staff_name: string | null;
}, schoolName: string): string {
  return [
    `${schoolName} — ${certificateTypeLabel(record.certificate_type)}`,
    `Issued to: ${record.staff_name ?? 'Staff member'}`,
    `Reference no.: ${record.reference_no ?? '—'}`,
    `Date of issue: ${longDate(record.issued_on)}`,
    '',
    'The certificate has been issued and signed by the school office. Please collect the printed copy, or ask the office to send it across.',
  ].join('\n');
}
