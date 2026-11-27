import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { toStudentFeePayload, validateFeeFields } from '@/lib/admissionFees';
import { admissionFormFromStudent } from '@/lib/admissionFormState';
import type { AdmissionFormState, InformationRecord, Student } from '@/lib/schoolTypes';
import { AdmissionForm } from '@/components/AdmissionForm';
import type { InformationDraft } from '@/components/InformationRecords';
import { findSiblingGroups } from '@/lib/feeAdjustments';
import { fetchSiblingDiscountRules, siblingContextFor, type SiblingDiscountRule } from '@/lib/feeDiscountRules';
import { buildFamilyLedger } from '@/lib/familyLedger';
import type { FamilyStatementInfo } from '@/lib/familyStatement';
import { fetchFeeStructures, type FeeStructure } from '@/lib/fees';
import { useAuth } from '@/lib/auth';
import { generatePassword, resetParentPassword } from '@/lib/portalAccounts';
import { admittedClassLabel, guardianNameFor, parentUsernameFor, pickAdmissionContact, type AdmissionWelcome } from '@/lib/admissionWelcome';
import { AdmissionWelcomeModal } from '@/components/AdmissionWelcomeModal';

export function StudentAdmissionEditor({ student, students, onClose, onSaved, onToast }: { student: Student; students: Student[]; onClose: () => void; onSaved: () => Promise<void>; onToast: (message: string) => void }) {
  // The editor walks the roster it was opened from. The id is held here rather than in
  // the parent so the four footer arrows can step through students without reopening
  // the modal, while the roster order stays exactly as the search list showed it.
  const [currentId, setCurrentId] = useState(student.id);
  const currentIndex = students.findIndex((row) => row.id === currentId);
  const currentStudent = currentIndex >= 0 ? students[currentIndex] : student;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < students.length - 1;

  const [form, setForm] = useState<AdmissionFormState>(() => admissionFormFromStudent(currentStudent));
  const [records, setRecords] = useState<InformationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState(false);
  const [siblingRules, setSiblingRules] = useState<SiblingDiscountRule[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [welcome, setWelcome] = useState<{ welcome: AdmissionWelcome; noticeError: string | null } | null>(null);
  // Only administrators may change a portal password, so the button is hidden for everyone else.
  const { profile } = useAuth();
  const canResetParentPassword = profile?.role === 'admin';

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    const { data, error } = await supabase.from('school_other_information').select('id, information_type, notes, updated_at').eq('student_id', currentStudent.id).order('updated_at', { ascending: false });
    setRecordsError(Boolean(error));
    setRecords(error ? [] : (data as InformationRecord[]));
    setRecordsLoading(false);
  }, [currentStudent.id]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  // Every field and tab is re-seeded from the student now on screen, so moving between
  // records never leaves the previous student's details behind.
  useEffect(() => { setForm(admissionFormFromStudent(currentStudent)); }, [currentStudent]);

  useEffect(() => {
    void fetchSiblingDiscountRules().then((result) => setSiblingRules(result.rules));
    void fetchFeeStructures().then((result) => setStructures(result.structures));
  }, []);

  const navigate = (target: 'first' | 'prev' | 'next' | 'last') => {
    if (currentIndex < 0) return;
    const last = students.length - 1;
    const nextIndex = target === 'first' ? 0 : target === 'last' ? last : target === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex > last || nextIndex === currentIndex) return;
    setCurrentId(students[nextIndex].id);
  };

  // The family groups are built from the roster with this student's saved details, then
  // this student's own entry is replaced by the version on the form. That way a change to
  // their guardian phone or father name is reflected before the discount is worked out.
  const siblingGroups = useMemo(() => {
    const roster = students.some((row) => row.id === currentStudent.id)
      ? students.map((row) => (row.id === currentStudent.id ? { ...row, ...form } as unknown as Student : row))
      : [...students, { ...currentStudent, ...form } as unknown as Student];
    return findSiblingGroups(roster);
  }, [students, currentStudent, form]);

  const siblingContext = useMemo(() => siblingContextFor({
    candidate: { ...currentStudent, ...form } as unknown as Student,
    groups: siblingGroups,
    rules: siblingRules,
  }), [currentStudent, form, siblingGroups, siblingRules]);

  const familyLedger = useMemo(
    () => buildFamilyLedger(siblingContext.students, siblingContext.candidateIndex, siblingRules, structures),
    [siblingContext, siblingRules, structures],
  );

  // Who the printed statement is addressed to. It follows what is typed on the form, so a
  // corrected guardian name or phone appears on the statement straight away.
  const familyStatementInfo = useMemo<FamilyStatementInfo>(() => ({
    guardianName: form.guardian_name.trim() || form.fathers_name.trim(),
    guardianPhone: form.guardian_phone.trim() || form.father_contact_number.trim() || form.messaging_number.trim(),
    guardianCnic: form.guardian_cnic.trim() || form.fathers_cnic.trim(),
    preparedFor: form.full_name.trim(),
    matchedReason: siblingContext.matchedReason,
  }), [form, siblingContext.matchedReason]);

  const saveInfo = async (draft: InformationDraft) => {
    const payload = { information_type: draft.information_type, notes: draft.notes, updated_at: new Date().toISOString() };
    const { error } = draft.id
      ? await supabase.from('school_other_information').update(payload).eq('id', draft.id)
      : await supabase.from('school_other_information').insert({ ...payload, student_id: currentStudent.id });
    if (error) { onToast('The note could not be saved. Please try again.'); return false; }
    onToast('Other information saved');
    await loadRecords();
    return true;
  };

  const deleteInfo = async (id: string) => {
    const { error } = await supabase.from('school_other_information').delete().eq('id', id);
    if (error) { onToast('The note could not be deleted. Please try again.'); return false; }
    onToast('Other information deleted');
    await loadRecords();
    return true;
  };

  // The password reset works from what is on the form right now, so a WhatsApp number typed
  // in a moment ago is used for the login name without saving the record first.
  const onResetParentPassword = async () => {
    const merged = { ...currentStudent, ...form } as unknown as Student;
    const contact = pickAdmissionContact(merged);
    const username = parentUsernameFor(merged, contact.number);
    if (!username) {
      onToast('Add the family’s WhatsApp number or an admission number before resetting the password.');
      return;
    }
    const password = generatePassword();
    const result = await resetParentPassword({
      username,
      password,
      fullName: guardianNameFor(merged),
      studentId: currentStudent.id,
      mobile: contact.display || contact.number || null,
    });
    if (result.error) { onToast(result.error); return; }
    setWelcome({
      welcome: {
        student: merged,
        studentName: form.full_name.trim() || currentStudent.full_name,
        admissionNumber: form.admission_number.trim(),
        admittedClass: admittedClassLabel(merged),
        whatsappNumber: contact.number,
        whatsappDisplay: contact.display,
        guardianName: guardianNameFor(merged),
        credentials: { username: result.username, password, isReset: true },
        loginNote: null,
      },
      noticeError: null,
    });
  };

  const submit = async (event: FormEvent): Promise<boolean | void> => {
    event.preventDefault();
    const feeError = validateFeeFields(form);
    if (feeError) { onToast(feeError); return false; }
    const { error } = await supabase.from('school_students').update(toStudentFeePayload(form)).eq('id', currentStudent.id);
    if (error) { onToast('The changes could not be saved. Please check the admission number.'); return false; }
    onToast(`${form.full_name} was updated`);
    await onSaved();
    onClose();
    return true;
  };

  return (
    <div className="notice-overlay">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto">
        <AdmissionForm
          form={form}
          setForm={setForm}
          infoRecords={records}
          infoLoading={recordsLoading}
          infoLoadError={recordsError}
          onSaveInfo={saveInfo}
          onDeleteInfo={deleteInfo}
          onSubmit={submit}
          onCancel={onClose}
          onToast={onToast}
          siblingContext={siblingContext}
          familyLedger={familyLedger}
          familyStatementInfo={familyStatementInfo}
          onNavigate={navigate}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onResetParentPassword={canResetParentPassword ? () => void onResetParentPassword() : undefined}
          recordStudent={currentStudent}
        />
      </div>
      {welcome && (
        <AdmissionWelcomeModal
          welcome={welcome.welcome}
          noticeError={welcome.noticeError}
          onClose={() => setWelcome(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
