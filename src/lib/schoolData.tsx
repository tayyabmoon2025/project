import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { admissionNumberExists } from '@/lib/admissionFormState';
import { toStudentFeePayload } from '@/lib/admissionFees';
import type { AdmissionFormState, InformationRecord, Student } from '@/lib/schoolTypes';

export type Attendance = { student_id: string; status: 'present' | 'absent' | 'late' | 'leave' };

export type AddStudentResult = { ok: boolean; message: string; student?: Student };

type SchoolDataValue = {
  students: Student[];
  attendance: Attendance[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addStudent: (student: AdmissionFormState, records: InformationRecord[]) => Promise<AddStudentResult>;
};

const STUDENT_COLUMNS = 'id, admission_number, admission_date, date_of_birth, admitted_in_class, full_name, student_name_prefix, father_name_prefix, mother_name, gender, class_name, section_name, guardian_name, guardian_phone, fathers_name, fathers_cnic, blood_group, student_form_b, last_school, last_class, tc_slc_number, subject_group, place_of_birth, photo_url, roll_number, mother_number, religion, house, student_group, area, mother_tongue, nationality, data_source, clearance_status, fee_balance, status, current_address, permanent_address, father_contact_number, messaging_number, father_profession, guardian_relationship, guardian_cnic, whatsapp_number, tuition_fee, fee_concession_percentage, fee_concession_amount, fee_concession_category, concession_approval_status, concession_approved_by, concession_approved_at, concession_rejection_reason, net_tuition_fee, sibling_discount_percentage, fine_exempt, fee_opening_balance, fee_opening_balance_date, full_name_urdu, fathers_name_urdu, mother_name_urdu, leaving_date, leaving_reason, leaving_remarks, leaving_status, leaving_class, progress, conduct, fee_paid_upto, leaving_certificate_number, leaving_certificate_date, attendance_summary, slc_serial_number, submitted_b_form, submitted_father_cnic, submitted_previous_tc, submitted_birth_certificate, submitted_photos, submitted_other_docs, submitted_b_form_file, submitted_father_cnic_file, submitted_previous_tc_file, submitted_birth_certificate_file, submitted_photos_file, submitted_other_docs_file, issued_tc_number, issued_tc_date, issued_character_certificate, issued_migration_certificate, issued_other_docs, issued_dmc, issued_dmc_file, issued_provisional_certificate, issued_provisional_certificate_file, issued_original_certificate, issued_original_certificate_file, issued_birth_certificate, issued_birth_certificate_file, issued_character_certificate_file, issued_migration_certificate_file';

const RETRY_DELAY_MS = 1000;
const MAX_ATTEMPTS = 3;

const SchoolDataContext = createContext<SchoolDataValue | undefined>(undefined);

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

const byName = (a: Student, b: Student) => a.full_name.localeCompare(b.full_name);

export function SchoolDataProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading } = useAuth();
  const userId = profile?.id ?? null;
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  // The roster is only readable once the signed-in user is known, so the query
  // waits for a confirmed session and retries a couple of times before giving up.
  const load = useCallback(async () => {
    if (!userId) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);

    let lastError = 'Student records could not be loaded. Please try again.';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let attemptError: string | null = null;
      try {
        const [studentResult, attendanceResult] = await Promise.all([
          supabase.from('school_students').select(STUDENT_COLUMNS).order('full_name'),
          supabase.from('school_attendance').select('student_id, status').eq('attendance_date', new Date().toISOString().slice(0, 10)),
        ]);
        if (requestRef.current !== requestId) return;

        if (!studentResult.error) {
          setStudents((studentResult.data ?? []) as Student[]);
          setAttendance(attendanceResult.error ? [] : ((attendanceResult.data ?? []) as Attendance[]));
          setLoading(false);
          return;
        }

        attemptError = studentResult.error.message;
      } catch {
        attemptError = 'The school server could not be reached.';
      }

      if (requestRef.current !== requestId) return;
      lastError = attemptError || lastError;
      if (attempt < MAX_ATTEMPTS - 1) {
        await wait(RETRY_DELAY_MS);
        if (requestRef.current !== requestId) return;
      }
    }

    setError(lastError);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      requestRef.current += 1;
      setStudents([]);
      setAttendance([]);
      setError(null);
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, userId, load]);

  const addStudent = useCallback(async (student: AdmissionFormState, records: InformationRecord[]): Promise<AddStudentResult> => {
    const admissionNumber = student.admission_number.trim();
    if (!admissionNumber) return { ok: false, message: 'Please enter an admission number.' };

    try {
      if (await admissionNumberExists(admissionNumber)) return { ok: false, message: 'This admission number is already in use. Please use a different one.' };

      const { data, error: insertError } = await supabase
        .from('school_students')
        .insert({ ...toStudentFeePayload({ ...student, admission_number: admissionNumber }), admission_date: student.admission_date || new Date().toISOString().slice(0, 10) })
        .select()
        .maybeSingle();
      if (insertError || !data) {
        return { ok: false, message: insertError?.message ? `The student could not be saved: ${insertError.message}` : 'The student could not be saved. Please check the admission number.' };
      }

      // Add to the shared roster straight away so it survives tab switches.
      const savedStudent = data as Student;
      setStudents((current) => [...current.filter((item) => item.id !== savedStudent.id), savedStudent].sort(byName));

      const { error: recordError } = records.length
        ? await supabase.from('school_other_information').insert(records.map((record) => ({ student_id: savedStudent.id, information_type: record.information_type, notes: record.notes })))
        : { error: null };

      return { ok: true, message: recordError ? 'Student saved, but their other information could not be saved' : 'New student added to the roster', student: savedStudent };
    } catch {
      return { ok: false, message: 'The student could not be saved because the school server could not be reached. Please try again.' };
    }
  }, []);

  const value = useMemo<SchoolDataValue>(() => ({ students, attendance, loading, error, refresh: load, addStudent }), [students, attendance, loading, error, load, addStudent]);

  return <SchoolDataContext.Provider value={value}>{children}</SchoolDataContext.Provider>;
}

export function useSchoolData() {
  const ctx = useContext(SchoolDataContext);
  if (!ctx) throw new Error('useSchoolData must be used within SchoolDataProvider');
  return ctx;
}
