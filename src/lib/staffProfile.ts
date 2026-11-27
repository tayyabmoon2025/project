import { supabase } from '@/lib/supabase';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { cleanPhoneNumber } from '@/lib/whatsapp';
import { cnicDigits, formatCnic, type StaffStatus } from '@/lib/staffDirectory';
import type { UserProfile, UserRole } from '@/lib/auth';

// A staff member's record as the directory and the edit form need it. The shared
// UserProfile type deliberately stays small, because only this screen reads the
// personnel fields.
export type StaffMemberRecord = UserProfile & {
  staff_code: string | null;
  full_name_urdu: string | null;
  marital_status: string | null;
  relation_type: string | null;
  father_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  cnic: string | null;
  qualification: string | null;
  previous_experience: string | null;
  joining_date: string | null;
  mobile_number: string | null;
  home_address: string | null;
  leaving_date: string | null;
  leaving_reason: string | null;
  photo_url: string | null;
};

// Every column the staff directory and the form read. Kept in one place so the query
// and the record type can never drift apart.
export const STAFF_MEMBER_COLUMNS = [
  'id', 'username', 'full_name', 'role', 'status', 'created_at',
  'staff_code', 'full_name_urdu', 'marital_status', 'relation_type', 'father_name',
  'gender', 'date_of_birth', 'cnic', 'qualification', 'previous_experience',
  'joining_date', 'mobile_number', 'home_address', 'leaving_date', 'leaving_reason',
  'photo_url',
].join(', ');

// The roles a staff member may hold, in the order the office expects to see them.
export const STAFF_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'teacher', label: 'Teacher' },
  { value: 'office_assistant', label: 'Office Assistant' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'admin', label: 'Administrator' },
  { value: 'support_staff', label: 'Support Staff' },
];

export const MARITAL_OPTIONS = [
  { value: 'unmarried', label: 'Unmarried' },
  { value: 'married', label: 'Married' },
];

export const RELATION_OPTIONS = [
  { value: 'son', label: 'Son of (S/O)' },
  { value: 'daughter', label: 'Daughter of (D/O)' },
  { value: 'wife', label: 'Wife of (W/O)' },
];

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

// ---------------------------------------------------------------- documents

export type StaffDocType = 'agreement' | 'cnic_front' | 'cnic_back' | 'degree' | 'experience' | 'other';

export type StaffDocument = {
  id: string;
  staff_user_id: string;
  doc_type: StaffDocType;
  file_name: string;
  file_path: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
};

export const STAFF_DOC_GROUPS: { value: StaffDocType; label: string; hint: string; required?: boolean }[] = [
  {
    value: 'agreement',
    label: 'Signed employment agreement',
    hint: 'The signed contract. An image or a PDF.',
    required: true,
  },
  { value: 'cnic_front', label: 'CNIC — front', hint: 'The front side of the identity card.' },
  { value: 'cnic_back', label: 'CNIC — back', hint: 'The back side of the identity card.' },
  { value: 'degree', label: 'Educational degrees & certificates', hint: 'One file per certificate.' },
  { value: 'experience', label: 'Experience documents', hint: 'Experience letters and references.' },
  { value: 'other', label: 'Other documents', hint: 'Anything else the office wants on file.' },
];

export const DOC_ACCEPT = '.jpg,.jpeg,.png,.pdf';
const DOC_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
// The school's storage refuses anything over 10 MB, and a paper form scans far smaller
// than that, so the form stops well short of the hard limit.
const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function documentError(file: File): string | null {
  if (!DOC_MIME_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or PDF file.';
  if (file.size > MAX_DOC_BYTES) return 'That file is larger than 5 MB. Please choose a smaller one.';
  return null;
}

// A file the office picked while filling in the form. It is held in the browser until
// the staff record has an id to file it against, which is what lets a document be
// attached during a brand-new staff member's first save.
export type PendingStaffDocument = {
  key: string;
  docType: StaffDocType;
  file: File;
  previewUrl: string;
};

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80) || 'document';

// ------------------------------------------------------------- form model

export type StaffFormState = {
  userId: string | null;
  username: string;
  password: string;
  fullName: string;
  fullNameUrdu: string;
  maritalStatus: string;
  relationType: string;
  fatherName: string;
  cnic: string;
  gender: string;
  dateOfBirth: string;
  qualification: string;
  previousExperience: string;
  role: UserRole;
  joiningDate: string;
  mobileNumber: string;
  homeAddress: string;
  status: StaffStatus;
  leavingDate: string;
  leavingReason: string;
  photoUrl: string;
};

export const emptyStaffForm = (): StaffFormState => ({
  userId: null,
  username: '',
  password: '',
  fullName: '',
  fullNameUrdu: '',
  maritalStatus: '',
  relationType: 'son',
  fatherName: '',
  cnic: '',
  gender: '',
  dateOfBirth: '',
  qualification: '',
  previousExperience: '',
  role: 'teacher',
  joiningDate: '',
  mobileNumber: '',
  homeAddress: '',
  status: 'active',
  leavingDate: '',
  leavingReason: '',
  photoUrl: '',
});

export const staffFormFrom = (member: StaffMemberRecord): StaffFormState => ({
  userId: member.id,
  username: member.username,
  password: '',
  fullName: member.full_name,
  fullNameUrdu: member.full_name_urdu ?? '',
  maritalStatus: member.marital_status ?? '',
  relationType: member.relation_type ?? 'son',
  fatherName: member.father_name ?? '',
  cnic: formatCnic(member.cnic),
  gender: member.gender ?? '',
  dateOfBirth: member.date_of_birth ? member.date_of_birth.slice(0, 10) : '',
  qualification: member.qualification ?? '',
  previousExperience: member.previous_experience ?? '',
  role: member.role,
  joiningDate: member.joining_date ? member.joining_date.slice(0, 10) : '',
  mobileNumber: member.mobile_number ?? '',
  homeAddress: member.home_address ?? '',
  // A suspended or former staff member keeps the exact state they are already in, so
  // opening the form and saving it again never quietly rewrites that status.
  status: (member.status as StaffStatus) ?? 'inactive',
  leavingDate: member.leaving_date ? member.leaving_date.slice(0, 10) : '',
  leavingReason: member.leaving_reason ?? '',
  photoUrl: member.photo_url ?? '',
});

// What is wrong with what has been typed, or null when the form can be saved. The first
// problem is returned so the office is told one clear thing to fix at a time.
export function staffFormProblem(form: StaffFormState, hasAgreement: boolean): string | null {
  if (form.fullName.trim().length < 2) return 'Please enter the full name in English.';
  if (form.role !== 'admin' && !/^\d{10,15}$/.test(cleanPhoneNumber(form.mobileNumber))) {
    return 'Enter a mobile number with at least 10 digits, for example 0300 1234567.';
  }
  if (form.role === 'admin' && form.mobileNumber.trim() && !/^\d{10,15}$/.test(cleanPhoneNumber(form.mobileNumber))) {
    return 'Enter a mobile number with at least 10 digits, for example 0300 1234567.';
  }
  if (form.cnic.trim() && cnicDigits(form.cnic).length !== 13) {
    return 'A CNIC must be exactly 13 digits, for example 14301-1234567-1.';
  }
  if (form.status !== 'active') {
    if (!form.leavingDate) return 'Choose the leaving date.';
    if (!form.leavingReason.trim()) return 'Write the reason the staff member is leaving.';
  }
  if (!form.userId) {
    if (form.username.trim().length < 3) return 'Enter a username with at least 3 characters.';
    if (form.password.length < 6) return 'The password must be at least 6 characters.';
  } else if (form.password && form.password.length < 6) {
    return 'A new password must be at least 6 characters.';
  }
  if (!hasAgreement) return 'Attach the signed employment agreement before saving.';
  return null;
}

// --------------------------------------------------------------- saving

export type SavedStaffMember = {
  userId: string;
  staffCode: string;
  username: string;
  fullName: string;
  role: UserRole;
  status: string;
  created: boolean;
  // Carried through from the form so the sign-in slip can show the face that was just
  // recorded, rather than sending the office back to the directory to look it up.
  photoUrl: string | null;
};

const FRIENDLY: Record<string, string> = {
  'Only administrators can manage staff': 'Only an administrator can save a staff record.',
  'Only administrators can create accounts': 'Only an administrator can create an account.',
  'Only administrators can change usernames': 'Only an administrator can change a username.',
  'Only administrators can reset passwords': 'Only an administrator can set a password.',
  'That staff role is not allowed': 'That staff role is not allowed.',
  'That staff status is not allowed': 'That staff status is not allowed.',
  'That account type is not allowed': 'That account type is not allowed.',
  'A full name is required': 'A full name is required.',
  'A CNIC must be exactly 13 digits': 'A CNIC must be exactly 13 digits.',
  'A mobile number needs at least 10 digits': 'Enter a mobile number with at least 10 digits.',
  'A leaving date is required when the staff member is not active': 'Choose the leaving date.',
  'A leaving reason is required when the staff member is not active': 'Write the reason the staff member is leaving.',
  'A password is required for a new staff member': 'Enter a password for the new staff member.',
  'A username is required': 'Enter a username.',
  'Username must be at least 3 characters': 'The username must be at least 3 characters.',
  'Password must be at least 6 characters': 'The password must be at least 6 characters.',
  'Username already taken': 'That username is already in use. Please choose another.',
  'That staff record no longer exists': 'That staff record no longer exists.',
  'That account no longer exists': 'That account no longer exists.',
  'You cannot change your own role': 'You cannot change your own role.',
  'You cannot change your own account status': 'You cannot change your own account status.',
  'The last administrator account cannot be demoted': 'The last administrator must stay an administrator.',
  'An administrator password can only be changed by that administrator': 'An administrator password can only be changed by that administrator.',
};

const friendly = (message: string | undefined, fallback: string) => (message ? FRIENDLY[message] ?? fallback : fallback);

export async function saveStaffMember(form: StaffFormState): Promise<{ member: SavedStaffMember | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('admin_save_staff_member', {
      p_payload: {
        user_id: form.userId,
        username: form.username.trim().toLowerCase(),
        password: form.password || null,
        full_name: form.fullName.trim(),
        full_name_urdu: form.fullNameUrdu.trim(),
        role: form.role,
        status: form.status,
        marital_status: form.maritalStatus,
        relation_type: form.relationType,
        father_name: form.fatherName.trim(),
        gender: form.gender,
        date_of_birth: form.dateOfBirth,
        cnic: form.cnic.trim(),
        qualification: form.qualification.trim(),
        previous_experience: form.previousExperience.trim(),
        joining_date: form.joiningDate,
        mobile_number: form.mobileNumber.trim(),
        home_address: form.homeAddress.trim(),
        photo_url: form.photoUrl,
        leaving_date: form.status === 'active' ? null : form.leavingDate,
        leaving_reason: form.status === 'active' ? null : form.leavingReason.trim(),
      },
    });
    if (error) return { member: null, error: friendly(error.message, 'The staff record could not be saved.') };
    const row = (data ?? {}) as Record<string, unknown>;
    if (typeof row.user_id !== 'string') return { member: null, error: 'The staff record could not be saved.' };
    return {
      member: {
        userId: row.user_id,
        staffCode: typeof row.staff_code === 'string' ? row.staff_code : '',
        username: typeof row.username === 'string' ? row.username : form.username,
        fullName: typeof row.full_name === 'string' ? row.full_name : form.fullName,
        role: (row.role as UserRole) ?? form.role,
        status: typeof row.status === 'string' ? row.status : form.status,
        created: Boolean(row.created),
        photoUrl: form.photoUrl || null,
      },
      error: null,
    };
  } catch {
    return { member: null, error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// -------------------------------------------------------- document storage

export async function fetchStaffDocuments(staffUserId: string): Promise<{ documents: StaffDocument[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_staff_documents')
      .select('id, staff_user_id, doc_type, file_name, file_path, file_url, file_size, mime_type, created_at')
      .eq('staff_user_id', staffUserId)
      .order('created_at');
    if (error) return { documents: [], error: 'The documents on file could not be loaded.' };
    return { documents: (data ?? []) as StaffDocument[], error: null };
  } catch {
    return { documents: [], error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// The file goes into the uploader's own folder in the private bucket, which is the only
// place the storage rules allow a write, and the record of it is written by a function
// that checks the administrator for itself.
export async function uploadStaffDocument(
  staffUserId: string,
  docType: StaffDocType,
  file: File,
): Promise<{ document: StaffDocument | null; error: string | null }> {
  const invalid = documentError(file);
  if (invalid) return { document: null, error: invalid };

  try {
    const { data: session } = await supabase.auth.getUser();
    const uploaderId = session.user?.id;
    if (!uploaderId) return { document: null, error: 'Your session has ended. Sign in again to attach a file.' };

    const path = `${uploaderId}/staff-docs/${staffUserId}-${Date.now()}-${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from('whatsapp-attachments')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return { document: null, error: 'The file could not be uploaded. Please try again.' };

    const { data: signed, error: signError } = await supabase.storage
      .from('whatsapp-attachments')
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError || !signed?.signedUrl) {
      return { document: null, error: 'The file uploaded but its link could not be created.' };
    }

    const { data, error } = await supabase.rpc('admin_save_staff_document', {
      p_staff_user_id: staffUserId,
      p_doc_type: docType,
      p_file_name: file.name,
      p_file_path: path,
      p_file_url: signed.signedUrl,
      p_file_size: file.size,
      p_mime_type: file.type,
    });
    if (error) {
      return {
        document: null,
        error: friendly(
          error.message,
          error.message === 'That document type is not allowed'
            ? 'That document type is not allowed.'
            : 'The file uploaded but could not be filed against this staff member.',
        ),
      };
    }

    const row = (data ?? {}) as { id?: string };
    return {
      document: {
        id: row.id ?? `${path}`,
        staff_user_id: staffUserId,
        doc_type: docType,
        file_name: file.name,
        file_path: path,
        file_url: signed.signedUrl,
        file_size: file.size,
        mime_type: file.type,
        created_at: new Date().toISOString(),
      },
      error: null,
    };
  } catch {
    return { document: null, error: 'The file could not be uploaded. Check your connection and try again.' };
  }
}

// Attaches several files in turn and reports what happened to each one. Degrees and
// experience letters arrive as a stack of papers, so a single failure must not throw
// away the files that did upload.
export async function uploadStaffDocuments(
  staffUserId: string,
  docType: StaffDocType,
  files: File[],
): Promise<{ documents: StaffDocument[]; failed: string[]; error: string | null }> {
  const documents: StaffDocument[] = [];
  const failed: string[] = [];
  let error: string | null = null;

  for (const file of files) {
    const result = await uploadStaffDocument(staffUserId, docType, file);
    if (result.document) documents.push(result.document);
    else {
      failed.push(file.name);
      if (!error) error = result.error;
    }
  }

  return { documents, failed, error };
}

export async function deleteStaffDocument(document: StaffDocument): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_delete_staff_document', { p_id: document.id });
    if (error) return { error: friendly(error.message, 'The document could not be removed.') };
    // The row is gone; the file itself is best-effort tidy-up, so a storage failure is
    // not reported as a failure of the removal the office asked for.
    await supabase.storage.from('whatsapp-attachments').remove([document.file_path]);
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

// ------------------------------------------------------------- login slip

export function staffLoginLink(): string {
  return `${window.location.origin}/`;
}

// A member of staff signs in with a username rather than an email address, so the wording
// says exactly that. The link is included because most of them will be on a phone.
export function staffCredentialMessage(member: { fullName: string; username: string }, password: string): string {
  return [
    `${SCHOOL_NAME} — staff portal sign-in`,
    `${member.fullName}`,
    `Login link: ${staffLoginLink()}`,
    `Username: ${member.username}`,
    `Password: ${password}`,
    'Please keep these details private.',
  ].join('\n');
}

