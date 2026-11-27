import { supabase } from '@/lib/supabase';
import type { AdmissionFormState, Student } from '@/lib/schoolTypes';

const numericSuffix = (value: string) => Number(value.match(/(\d+)$/)?.[1] ?? 0);

export function nextAdmissionNumber(students: Student[]): string {
  const highest = students.reduce((max, student) => Math.max(max, numericSuffix(student.admission_number)), 0);
  return `SD-${highest + 1}`;
}

export async function fetchNextAdmissionNumber(): Promise<string> {
  const { data } = await supabase.from('school_students').select('admission_number');
  const highest = ((data ?? []) as { admission_number: string }[]).reduce((max, row) => Math.max(max, numericSuffix(row.admission_number)), 0);
  return `SD-${highest + 1}`;
}

export async function admissionNumberExists(value: string): Promise<boolean> {
  const { data } = await supabase.from('school_students').select('id').eq('admission_number', value.trim()).maybeSingle();
  return Boolean(data);
}

export function createAdmissionForm(students: Student[]): AdmissionFormState {
  return { admission_number: nextAdmissionNumber(students), admission_date: new Date().toISOString().slice(0, 10), date_of_birth: '', admitted_in_class: 'Class 5', student_name_prefix: '', full_name: '', father_name_prefix: '', fathers_name: '', mother_name: '', fathers_cnic: '', blood_group: '', student_form_b: '', class_name: 'Class 5', section_name: 'B', roll_number: '', last_school: '', last_class: '', tc_slc_number: '', gender: 'Girl', status: 'active', religion: '', nationality: 'Indian', student_group: '', subject_group: '', house: '', place_of_birth: '', guardian_name: '', guardian_phone: '', photo_url: '', data_source: 'current_session', full_name_urdu: '', fathers_name_urdu: '', mother_name_urdu: '', current_address: '', permanent_address: '', father_contact_number: '', messaging_number: '', whatsapp_number: '', father_profession: '', mother_tongue: '', guardian_relationship: '', guardian_cnic: '', tuition_fee: '', fee_concession_percentage: '', fee_concession_amount: '', fee_concession_category: '', concession_approval_status: '' as const, concession_rejection_reason: '', net_tuition_fee: '', sibling_discount_percentage: '', fine_exempt: false, leaving_date: '', leaving_reason: '', leaving_remarks: '', leaving_status: '', leaving_class: '', progress: '', conduct: '', fee_paid_upto: '', leaving_certificate_number: '', leaving_certificate_date: '', attendance_summary: '', slc_serial_number: '', submitted_b_form: '', submitted_father_cnic: '', submitted_previous_tc: '', submitted_birth_certificate: '', submitted_photos: '', submitted_other_docs: '', submitted_b_form_file: '', submitted_father_cnic_file: '', submitted_previous_tc_file: '', submitted_birth_certificate_file: '', submitted_photos_file: '', submitted_other_docs_file: '', issued_tc_number: '', issued_tc_date: '', issued_character_certificate: '', issued_migration_certificate: '', issued_other_docs: '', issued_dmc: '', issued_dmc_file: '', issued_provisional_certificate: '', issued_provisional_certificate_file: '', issued_original_certificate: '', issued_original_certificate_file: '', issued_birth_certificate: '', issued_birth_certificate_file: '', issued_character_certificate_file: '', issued_migration_certificate_file: '' };
}

export function admissionFormFromStudent(student: Student): AdmissionFormState {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return {
    admission_number: student.admission_number,
    admission_date: student.admission_date,
    date_of_birth: text(student.date_of_birth),
    student_name_prefix: text(student.student_name_prefix),
    full_name: student.full_name,
    full_name_urdu: text(student.full_name_urdu),
    father_name_prefix: text(student.father_name_prefix),
    fathers_name: text(student.fathers_name),
    fathers_name_urdu: text(student.fathers_name_urdu),
    mother_name: text(student.mother_name),
    mother_name_urdu: text(student.mother_name_urdu),
    fathers_cnic: text(student.fathers_cnic),
    blood_group: text(student.blood_group),
    student_form_b: text(student.student_form_b),
    admitted_in_class: text(student.admitted_in_class),
    class_name: student.class_name,
    section_name: student.section_name,
    roll_number: text(student.roll_number),
    last_school: text(student.last_school),
    last_class: text(student.last_class),
    tc_slc_number: text(student.tc_slc_number),
    gender: student.gender,
    status: student.status,
    religion: text(student.religion),
    nationality: text(student.nationality),
    student_group: text(student.student_group),
    subject_group: text(student.subject_group),
    house: text(student.house),
    place_of_birth: text(student.place_of_birth),
    guardian_name: student.guardian_name,
    guardian_phone: student.guardian_phone,
    photo_url: text(student.photo_url),
    data_source: student.data_source ?? 'current_session',
    current_address: text(student.current_address),
    permanent_address: text(student.permanent_address),
    father_contact_number: text(student.father_contact_number),
    messaging_number: text(student.messaging_number),
    whatsapp_number: text(student.whatsapp_number),
    father_profession: text(student.father_profession),
    mother_tongue: text(student.mother_tongue),
    guardian_relationship: text(student.guardian_relationship),
    guardian_cnic: text(student.guardian_cnic),
    tuition_fee: text(student.tuition_fee),
    fee_concession_percentage: text(student.fee_concession_percentage),
    fee_concession_amount: text(student.fee_concession_amount),
    fee_concession_category: text(student.fee_concession_category),
    concession_approval_status: text(student.concession_approval_status) as AdmissionFormState['concession_approval_status'],
    concession_rejection_reason: text(student.concession_rejection_reason),
    net_tuition_fee: text(student.net_tuition_fee),
    sibling_discount_percentage: text(student.sibling_discount_percentage),
    fine_exempt: student.fine_exempt ?? false,
    leaving_date: text(student.leaving_date),
    leaving_reason: text(student.leaving_reason),
    leaving_remarks: text(student.leaving_remarks),
    leaving_status: text(student.leaving_status),
    leaving_class: text(student.leaving_class),
    progress: text(student.progress),
    conduct: text(student.conduct),
    fee_paid_upto: text(student.fee_paid_upto),
    leaving_certificate_number: text(student.leaving_certificate_number),
    leaving_certificate_date: text(student.leaving_certificate_date),
    attendance_summary: text(student.attendance_summary),
    slc_serial_number: text(student.slc_serial_number),
    submitted_b_form: text(student.submitted_b_form),
    submitted_father_cnic: text(student.submitted_father_cnic),
    submitted_previous_tc: text(student.submitted_previous_tc),
    submitted_birth_certificate: text(student.submitted_birth_certificate),
    submitted_photos: text(student.submitted_photos),
    submitted_other_docs: text(student.submitted_other_docs),
    submitted_b_form_file: text(student.submitted_b_form_file),
    submitted_father_cnic_file: text(student.submitted_father_cnic_file),
    submitted_previous_tc_file: text(student.submitted_previous_tc_file),
    submitted_birth_certificate_file: text(student.submitted_birth_certificate_file),
    submitted_photos_file: text(student.submitted_photos_file),
    submitted_other_docs_file: text(student.submitted_other_docs_file),
    issued_tc_number: text(student.issued_tc_number),
    issued_tc_date: text(student.issued_tc_date),
    issued_character_certificate: text(student.issued_character_certificate),
    issued_migration_certificate: text(student.issued_migration_certificate),
    issued_other_docs: text(student.issued_other_docs),
    issued_dmc: text(student.issued_dmc),
    issued_dmc_file: text(student.issued_dmc_file),
    issued_provisional_certificate: text(student.issued_provisional_certificate),
    issued_provisional_certificate_file: text(student.issued_provisional_certificate_file),
    issued_original_certificate: text(student.issued_original_certificate),
    issued_original_certificate_file: text(student.issued_original_certificate_file),
    issued_birth_certificate: text(student.issued_birth_certificate),
    issued_birth_certificate_file: text(student.issued_birth_certificate_file),
    issued_character_certificate_file: text(student.issued_character_certificate_file),
    issued_migration_certificate_file: text(student.issued_migration_certificate_file),
  };
}

export function buildAdmissionCsv(form: AdmissionFormState) {
  const rows = [['Field', 'Value'], ...Object.entries(form).map(([key, value]) => [key.replace(/_/g, ' '), String(value)])];
  return '\uFEFF' + rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n');
}
