export type Student = {
  id: string;
  admission_number: string;
  admission_date: string;
  date_of_birth?: string | null;
  full_name: string;
  full_name_urdu?: string | null;
  fathers_name_urdu?: string | null;
  mother_name_urdu?: string | null;
  student_name_prefix?: string | null;
  father_name_prefix?: string | null;
  mother_name?: string | null;
  gender: string;
  class_name: string;
  admitted_in_class?: string | null;
  section_name: string;
  guardian_name: string;
  guardian_phone: string;
  last_school?: string | null;
  last_class?: string | null;
  // The Transfer / School Leaving Certificate number from the previous school. Optional,
  // because a child is often admitted before that school hands the certificate over.
  tc_slc_number?: string | null;
  subject_group?: string | null;
  place_of_birth?: string | null;
  student_form_b?: string | null;
  photo_url?: string | null;
  fathers_name?: string | null;
  fathers_cnic?: string | null;
  blood_group?: string | null;
  roll_number?: string | null;
  mother_number?: string | null;
  religion?: string | null;
  house?: string | null;
  student_group?: string | null;
  area?: string | null;
  mother_tongue?: string | null;
  nationality?: string | null;
  current_address?: string | null;
  permanent_address?: string | null;
  father_contact_number?: string | null;
  messaging_number?: string | null;
  whatsapp_number?: string | null;
  father_profession?: string | null;
  guardian_relationship?: string | null;
  guardian_cnic?: string | null;
  tuition_fee?: number | null;
  fee_concession_percentage?: number | null;
  fee_concession_amount?: number | null;
  // Names the student's standing reduction so the Fee Concessions & Discounts report can
  // file it under the right category. The amount itself stays in the two columns above.
  fee_concession_category?: string | null;
  // The principal sign-off state for a special concession (orphan, scholarship, staff).
  // NULL when no approval is needed (plain concessions, discounts, no concession).
  concession_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  concession_approved_by?: string | null;
  concession_approved_at?: string | null;
  concession_rejection_reason?: string | null;
  net_tuition_fee?: number | null;
  sibling_discount_percentage?: number | null;
  fine_exempt?: boolean | null;
  // Leaving Info
  leaving_date?: string | null;
  leaving_reason?: string | null;
  leaving_remarks?: string | null;
  leaving_status?: string | null;
  leaving_class?: string | null;
  progress?: string | null;
  conduct?: string | null;
  fee_paid_upto?: string | null;
  leaving_certificate_number?: string | null;
  leaving_certificate_date?: string | null;
  // The attendance picture at the moment the student left, written in plain words.
  attendance_summary?: string | null;
  // The serial number printed on the School Leaving Certificate handed to the family.
  slc_serial_number?: string | null;
  // Submitted Documents
  submitted_b_form?: string | null;
  submitted_father_cnic?: string | null;
  submitted_previous_tc?: string | null;
  submitted_birth_certificate?: string | null;
  submitted_photos?: string | null;
  submitted_other_docs?: string | null;
  submitted_b_form_file?: string | null;
  submitted_father_cnic_file?: string | null;
  submitted_previous_tc_file?: string | null;
  submitted_birth_certificate_file?: string | null;
  submitted_photos_file?: string | null;
  submitted_other_docs_file?: string | null;
  // Issued Documents
  issued_tc_number?: string | null;
  issued_tc_date?: string | null;
  issued_character_certificate?: string | null;
  issued_migration_certificate?: string | null;
  issued_other_docs?: string | null;
  issued_dmc?: string | null;
  issued_dmc_file?: string | null;
  issued_provisional_certificate?: string | null;
  issued_provisional_certificate_file?: string | null;
  issued_original_certificate?: string | null;
  issued_original_certificate_file?: string | null;
  issued_birth_certificate?: string | null;
  issued_birth_certificate_file?: string | null;
  issued_character_certificate_file?: string | null;
  issued_migration_certificate_file?: string | null;
  data_source?: 'current_session' | 'archive' | null;
  clearance_status?: 'cleared' | 'not_clear' | null;
  fee_balance: number;
  fee_opening_balance?: number | null;
  fee_opening_balance_date?: string | null;
  status: 'active' | 'pending' | 'withdrawn' | 'promoted';
};

export type FeeTransaction = {
  id: string;
  kind: 'payment' | 'charge';
  amount: number;
  balance_after: number;
  created_at: string;
};

export type SmsLogStatus = 'sent' | 'failed' | 'pending';

export type SmsLogEntry = {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  parent_phone: string | null;
  message_type: AlertNoticeType;
  message_body: string | null;
  status: SmsLogStatus;
  provider_response: string | null;
  attendance_date: string | null;
  sent_at: string | null;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
};

export type DmcRecord = {
  id: string;
  student_id: string;
  term: string | null;
  session: string | null;
  period_start: string | null;
  period_end: string | null;
  attendance_total: number;
  attendance_present: number;
  attendance_absent: number;
  attendance_percentage: number;
  attendance_manual: boolean;
  remarks: string | null;
  issued_date: string;
  updated_at: string;
};

// The category tag shown on a template card. It is what the Send Notice modal reads
// to decide which saved wording suits the screen the notice is being sent from.
export type NoticeCategory = 'NOTICE' | 'REMINDER' | 'WARNING' | 'ATTENDANCE' | 'FEE' | 'HOMEWORK' | 'EXAM' | 'GENERAL';

export const NOTICE_CATEGORIES: NoticeCategory[] = ['NOTICE', 'REMINDER', 'WARNING', 'ATTENDANCE', 'FEE', 'HOMEWORK', 'EXAM', 'GENERAL'];

// One saved message. The table keeps a row per language, but the app reads them as a
// single bilingual template, so both bodies travel together.
export type NoticeTemplate = {
  id: string;
  // A short machine-readable kind. Older features (absentee alerts, homework) look the
  // wording up by this value, so it is kept even though the office only sees the title.
  notice_type: string;
  title: string;
  category: NoticeCategory;
  body_english: string;
  body_urdu: string;
  is_active: boolean;
  updated_at: string;
};

// How a notice was worded when it went out.
export type NoticeLanguage = 'English' | 'Urdu' | 'Bilingual';

export const NOTICE_LANGUAGES: NoticeLanguage[] = ['English', 'Urdu', 'Bilingual'];

// One row of the Sent Notices History: what was sent, to whom, by which route and when.
export type SentNotice = {
  id: string;
  student_id: string | null;
  template_id: string | null;
  title: string;
  category: NoticeCategory;
  language: NoticeLanguage;
  rendered_text: string;
  delivery_channels: string[];
  status: string;
  whatsapp_number: string;
  sent_by_name: string;
  created_at: string;
  student_name?: string | null;
  class_name?: string | null;
  section_name?: string | null;
};

// A register mark that reaches parents: absent, on leave, or late.
export type AbsenteeAlertStatus = 'absent' | 'leave' | 'late';

// Each alert kind keeps its own saved wording, one row per kind and language.
// Fee reminders and homework notices reuse the same message log, so they are listed here too.
export type AlertNoticeType =
  | 'absentee_alert' | 'leave_alert' | 'late_alert'
  | 'fee_reminder' | 'homework_alert' | 'homework_reminder';

export type AbsenteeTemplate = {
  id?: string;
  notice_type: AlertNoticeType;
  language: 'English' | 'Urdu';
  template_text: string;
  updated_at?: string;
};

export type AbsenteeQueueStatus = 'queued' | 'sent';

export type AbsenteeQueueEntry = {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  parent_phone: string | null;
  attendance_date: string;
  attendance_status: AbsenteeAlertStatus;
  language: 'English' | 'Urdu';
  message_body: string | null;
  status: AbsenteeQueueStatus;
  sent_at: string | null;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
};

export type PortalNotification = {
  id: string;
  // Null on a school-wide notice (a holiday announcement, for example), which is
  // addressed to everybody rather than to one child.
  student_id: string | null;
  notification_type: string;
  title: string;
  body: string;
  attendance_date: string | null;
  created_at: string;
  attachment_url: string | null;
  challan_id?: string | null;
  homework_id?: string | null;
  audience?: string | null;
};

// The two kinds of homework message: the notice raised when work is published, and
// the reminder raised as the hand-in date approaches.
export type HomeworkAlertKind = 'assigned' | 'reminder';

// The WhatsApp alert list raised when homework is published or when it falls due.
export type HomeworkAlertEntry = {
  id: string;
  homework_id: string;
  student_id: string;
  student_name: string;
  class_name: string | null;
  section_name: string | null;
  parent_phone: string | null;
  homework_date: string;
  language: 'English' | 'Urdu';
  message_body: string | null;
  attachment_url: string | null;
  status: AbsenteeQueueStatus;
  sent_at: string | null;
  created_at: string;
  alert_kind: HomeworkAlertKind;
  reminder_days_before: number | null;
};

export type InformationRecord = {
  id: string;
  information_type: string;
  notes: string;
  updated_at: string;
};

export type AdmissionFormState = {
  admission_number: string;
  admission_date: string;
  date_of_birth: string;
  student_name_prefix: string;
  full_name: string;
  full_name_urdu: string;
  father_name_prefix: string;
  fathers_name: string;
  fathers_name_urdu: string;
  mother_name: string;
  mother_name_urdu: string;
  fathers_cnic: string;
  blood_group: string;
  student_form_b: string;
  admitted_in_class: string;
  class_name: string;
  section_name: string;
  // Left blank, the app fills this in automatically the first time the class is opened
  // on a marks sheet. Anything typed here is kept as it is.
  roll_number: string;
  last_school: string;
  last_class: string;
  tc_slc_number: string;
  gender: string;
  status: Student['status'];
  religion: string;
  nationality: string;
  student_group: string;
  subject_group: string;
  house: string;
  place_of_birth: string;
  guardian_name: string;
  guardian_phone: string;
  photo_url: string;
  data_source: 'current_session' | 'archive';
  current_address: string;
  permanent_address: string;
  father_contact_number: string;
  messaging_number: string;
  whatsapp_number: string;
  father_profession: string;
  mother_tongue: string;
  guardian_relationship: string;
  guardian_cnic: string;
  tuition_fee: string;
  fee_concession_percentage: string;
  fee_concession_amount: string;
  fee_concession_category: string;
  concession_approval_status: 'pending' | 'approved' | 'rejected' | '';
  concession_rejection_reason: string;
  net_tuition_fee: string;
  sibling_discount_percentage: string;
  fine_exempt: boolean;
  // Leaving Info
  leaving_date: string;
  leaving_reason: string;
  leaving_remarks: string;
  leaving_status: string;
  leaving_class: string;
  progress: string;
  conduct: string;
  fee_paid_upto: string;
  leaving_certificate_number: string;
  leaving_certificate_date: string;
  attendance_summary: string;
  slc_serial_number: string;
  // Submitted Documents
  submitted_b_form: string;
  submitted_father_cnic: string;
  submitted_previous_tc: string;
  submitted_birth_certificate: string;
  submitted_photos: string;
  submitted_other_docs: string;
  submitted_b_form_file: string;
  submitted_father_cnic_file: string;
  submitted_previous_tc_file: string;
  submitted_birth_certificate_file: string;
  submitted_photos_file: string;
  submitted_other_docs_file: string;
  // Issued Documents
  issued_tc_number: string;
  issued_tc_date: string;
  issued_character_certificate: string;
  issued_migration_certificate: string;
  issued_other_docs: string;
  issued_dmc: string;
  issued_dmc_file: string;
  issued_provisional_certificate: string;
  issued_provisional_certificate_file: string;
  issued_original_certificate: string;
  issued_original_certificate_file: string;
  issued_birth_certificate: string;
  issued_birth_certificate_file: string;
  issued_character_certificate_file: string;
  issued_migration_certificate_file: string;
};
