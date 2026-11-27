import { useEffect, useState, type FormEvent } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { ChevronLeft, ChevronRight, ClipboardCheck, Camera, Download, FileText, Plus, Printer, Sparkles, Trash2, UserPlus, Users, Wallet, X } from 'lucide-react';
import { SaveButton, useSaveState } from '@/components/SaveButton';
import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { supabase } from '@/lib/supabase';
import type { AdmissionFormState, InformationRecord, Student } from '@/lib/schoolTypes';
import { buildAdmissionCsv } from '@/lib/admissionFormState';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { AdmissionOtherInfoFields } from '@/components/AdmissionOtherInfoFields';
import type { SiblingContext } from '@/lib/feeDiscountRules';
import type { FamilyLedger } from '@/lib/familyLedger';
import type { FamilyStatementInfo } from '@/lib/familyStatement';
import { AdmissionDocTabs } from '@/components/AdmissionDocTabs';
import { DropdownWithAdd } from '@/components/DropdownWithAdd';
import { InformationRecords, type InformationDraft } from '@/components/InformationRecords';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { DECLARATION_ENGLISH, DECLARATION_URDU, type ConsentLanguage } from '@/lib/declaration';
import { documentReceived } from '@/lib/documentGaps';
import { maskCnic, cnicDigits } from '@/lib/formatters';
import { useClassOptions, useSectionOptions, withCurrent } from '@/lib/classSections';
import { netTuitionAfterDiscounts } from '@/lib/admissionFees';

type AdmissionFormProps = {
  form: AdmissionFormState;
  setForm: (form: AdmissionFormState) => void;
  infoRecords: InformationRecord[];
  infoLoading?: boolean;
  infoLoadError?: boolean;
  onSaveInfo: (draft: InformationDraft) => Promise<boolean>;
  onDeleteInfo: (id: string) => Promise<boolean>;
  onSubmit: (event: FormEvent) => Promise<boolean | void>;
  onAddToSession?: () => Promise<void>;
  onClear?: () => void;
  onCancel: () => void;
  onToast: (message: string) => void;
  onAutoGenerate?: () => void;
  siblingContext?: SiblingContext | null;
  familyLedger?: FamilyLedger | null;
  familyStatementInfo?: FamilyStatementInfo | null;
  // Record pagination. Only supplied when the form is editing a student who is part of
  // the roster, so a brand-new admission never shows navigation it cannot use.
  onNavigate?: (target: 'first' | 'prev' | 'next' | 'last') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  // Opens the same sheet with every value blanked out, ready to be filled in by hand.
  onPrintBlank?: () => void;
  // Sets a new password on the family's portal login and shows the details to send.
  // Only supplied while editing an existing student as an administrator.
  onResetParentPassword?: () => void;
  // The saved student behind this form, so the Leaving Info tab can read their attendance
  // register and stay in step with the Withdraw Students screen.
  recordStudent?: Student | null;
};

export function AdmissionForm({ form, setForm, infoRecords, infoLoading = false, infoLoadError = false, onSaveInfo, onDeleteInfo, onSubmit, onAddToSession, onClear, onCancel, onToast, onAutoGenerate, siblingContext = null, familyLedger = null, familyStatementInfo = null, onNavigate, hasPrev = false, hasNext = false, onPrintBlank, onResetParentPassword, recordStudent = null }: AdmissionFormProps) {
  const update = (key: keyof AdmissionFormState, value: string) => setForm({ ...form, [key]: value });
  const saveState = useSaveState();
  const handleSubmit = (event: FormEvent) => saveState.run(() => onSubmit(event));
  const patch = (changes: Partial<AdmissionFormState>) => setForm({ ...form, ...changes });
  const classNames = useClassOptions();
  const sectionNames = useSectionOptions();
  const admittedClassOptions = withCurrent(classNames, form.admitted_in_class);
  const currentClassOptions = withCurrent(classNames, form.class_name);
  const currentSectionOptions = withCurrent(sectionNames, form.section_name);
  const [activeTab, setActiveTab] = useState<'info' | 'other' | 'leaving' | 'submitted' | 'issued'>('info');
  const [consentLanguage, setConsentLanguage] = useState<ConsentLanguage>('English');
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  useEffect(() => { void fetchInstitutionProfile().then(({ profile }) => setInstitution(profile)); }, []);
  const contactLine = [institution?.address?.trim(), institution?.city?.trim(), institution?.phone?.trim() ? `Phone: ${institution.phone.trim()}` : ''].filter(Boolean).join(' • ');
  const submittedChecklist = [
    { label: 'B-Form', value: form.submitted_b_form },
    { label: 'Father CNIC', value: form.submitted_father_cnic },
    { label: 'Photos', value: form.submitted_photos },
    { label: 'SLC', value: form.submitted_previous_tc },
  ];
  const [dropdownOptions, setDropdownOptions] = useState<Record<string, string[]>>({ student_group: [], subject_group: [], house: [], religion: [], father_profession: [], mother_tongue: [], information_type: [] });
  const loadDropdownOptions = () => { void supabase.from('school_admission_options').select('category, label').order('label').then(({ data }) => { if (data) { const grouped: Record<string, string[]> = { student_group: [], subject_group: [], house: [], religion: [], father_profession: [], mother_tongue: [], information_type: [] }; for (const row of data as { category: string; label: string }[]) { if (grouped[row.category]) grouped[row.category].push(row.label); } setDropdownOptions(grouped); } }); };
  useEffect(loadDropdownOptions, []);
  const readPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onToast('Please choose an image file for the student photo'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') update('photo_url', reader.result); };
    reader.readAsDataURL(file);
  };

  // Family helpers: pressing Get on Father Name, Father's CNIC or Form-B looks for a
  // brother or sister already on the roll and copies the shared family details across.
  const [familyMatches, setFamilyMatches] = useState<Student[] | null>(null);
  const [getSearching, setGetSearching] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // The sibling discount is never typed in. The family detected from the guardian phone,
  // CNIC or father name decides which child this student is, and the Fee Structure
  // "Brothers and sisters" rule for that place in the family sets the percentage. It is
  // applied to the form the moment the family details change — clicking Get, or typing a
  // matching name, CNIC or WhatsApp number — so the banner and the net tuition fee are
  // live before the record is saved.
  const siblingPercentage = siblingContext && siblingContext.discountPercentage > 0 ? String(siblingContext.discountPercentage) : '';
  useEffect(() => {
    if (form.sibling_discount_percentage === siblingPercentage) return;
    const net = netTuitionAfterDiscounts(form.tuition_fee, form.fee_concession_amount, siblingPercentage);
    patch({
      sibling_discount_percentage: siblingPercentage,
      net_tuition_fee: net === null ? '' : String(net),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingPercentage, form.tuition_fee, form.fee_concession_amount]);

  const applyFamilyDetails = (sibling: Student) => patch({
    father_name_prefix: form.father_name_prefix || (sibling.father_name_prefix ?? ''),
    fathers_name: sibling.fathers_name || form.fathers_name,
    fathers_name_urdu: sibling.fathers_name_urdu || form.fathers_name_urdu,
    mother_name: sibling.mother_name || form.mother_name,
    mother_name_urdu: sibling.mother_name_urdu || form.mother_name_urdu,
    fathers_cnic: sibling.fathers_cnic ? maskCnic(sibling.fathers_cnic) : form.fathers_cnic,
    guardian_name: sibling.guardian_name || form.guardian_name,
    guardian_phone: sibling.guardian_phone || form.guardian_phone,
    current_address: sibling.current_address || form.current_address,
    permanent_address: sibling.permanent_address || form.permanent_address,
  });
  const searchFamily = async (field: 'father' | 'cnic' | 'formb') => {
    const father = form.fathers_name.trim();
    const cnic = cnicDigits(form.fathers_cnic);
    const formB = cnicDigits(form.student_form_b);
    let column = 'fathers_name';
    let value = father;
    if (field === 'cnic') { column = 'fathers_cnic'; value = cnic; }
    if (field === 'formb') { column = 'student_form_b'; value = formB; }
    if (value.length < (field === 'father' ? 3 : 5)) {
      onToast(field === 'father' ? 'Type the father name first, then press Get' : 'Enter more digits first, then press Get');
      return;
    }
    setGetSearching(true);
    // CNIC and Form-B are stored dash-masked, so the search keeps the mask on the typed
    // value; the father name matches case-insensitively against the normalized column.
    const storedValue = field === 'father' ? value.toLowerCase() : maskCnic(value);
    const { data, error } = await supabase.from('school_students').select('*').ilike(column, `%${storedValue}%`).limit(25);
    setGetSearching(false);
    if (error) { onToast('Could not search the roster right now — please try again'); return; }
    const matches = ((data ?? []) as Student[])
      .filter((row) => row.id !== recordStudent?.id)
      .filter((row) => !form.full_name.trim() || (row.full_name ?? '').trim() !== form.full_name.trim());
    if (matches.length === 0) { onToast('No existing student matches — please fill the family details by hand'); return; }
    if (matches.length === 1) {
      applyFamilyDetails(matches[0]);
      onToast(`Family details filled from ${matches[0].full_name}'s record`);
      return;
    }
    setFamilyMatches(matches);
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([buildAdmissionCsv(form)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `admission-${form.admission_number.replace(/[^A-Za-z0-9-]+/g, '-') || 'form'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onToast('Admission form exported as CSV');
  };
  const saveAsPdf = () => {
    onToast('In the print window, choose "Save as PDF" as the destination');
    window.print();
  };

  const printRows = (rows: [string, string | number | boolean | undefined][]) => rows.map(([label, value]) => (
    <div className="print-row" key={label}>
      <span className="print-row-label">{label}</span>
      <span className="print-row-value">{value === '' || value === undefined || value === null ? '—' : value === true ? 'Yes' : value === false ? 'No' : String(value)}</span>
    </div>
  ));

  const printName = (prefix: string, name: string) => `${prefix ? `${prefix} ` : ''}${name}`.trim();

  const printSheet = usePrintSheet(true, <section className="print-only print-admission-sheet" aria-hidden="true">
    <div className="print-sheet-page">
      <header className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          {contactLine && <p className="print-header-contact">{contactLine}</p>}
          <p className="print-header-form">Student Admission Form</p>
        </div>
        <div className="print-header-badge">
          <div>
            <span>Admitted Class</span>
            <strong>{form.admitted_in_class || form.class_name || '—'}</strong>
          </div>
          <div>
            <span>Admission No.</span>
            <strong>{form.admission_number || '—'}</strong>
          </div>
        </div>
      </header>

      <div className="print-top">
        <div className="print-photo">
          {form.photo_url ? <img src={form.photo_url} alt="Student" /> : <div className="print-photo-empty">Photo</div>}
          <strong>{printName(form.student_name_prefix, form.full_name) || 'Student name'}</strong>
        </div>
        <section className="print-card print-card-admission">
          <h2>Admission Info</h2>
          {printRows([
            ['Admission No.', form.admission_number],
            ['Admission Date', form.admission_date],
            ['Admitted in Class', form.admitted_in_class],
            ['Current Class', form.class_name],
            ['Roll No.', form.roll_number],
            ['Section', form.section_name],
            ['Date of Birth', form.date_of_birth],
            ['Gender', form.gender],
            ['Student Name', printName(form.student_name_prefix, form.full_name)],
            ['Father Name', printName(form.father_name_prefix, form.fathers_name)],
            ['Mother Name', form.mother_name],
            ['Guardian Name', form.guardian_name],
            ['Guardian Phone', form.guardian_phone],
            ['Student B-Form No.', form.student_form_b],
            ['Father CNIC', form.fathers_cnic],
            ['Blood Group', form.blood_group],
            ['Previous School', form.last_school],
            ['TC / SLC No.', form.tc_slc_number],
          ])}
        </section>
      </div>

      <section className="print-card print-card-other">
        <h2>Other Info</h2>
        <div className="print-other-grid">
          {printRows([
            ['Father Contact No.', form.father_contact_number],
            ['Messaging Number', form.messaging_number],
            ['WhatsApp Number', form.whatsapp_number],
            ['Current Address', form.current_address],
            ['Permanent Address', form.permanent_address],
            ['Father’s Profession', form.father_profession],
            ['Mother Tongue', form.mother_tongue],
            ['Nationality', form.nationality],
            ['Religion', form.religion],
            ['Place of Birth', form.place_of_birth],
            ['Monthly Tuition Fee', form.tuition_fee ? `Rs ${Number(form.tuition_fee).toLocaleString()}` : ''],
            ['Concession', form.fee_concession_amount ? `Rs ${Number(form.fee_concession_amount).toLocaleString()}${form.fee_concession_percentage ? ` (${Number(form.fee_concession_percentage)}%)` : ''}` : ''],
            ['Sibling Discount', form.sibling_discount_percentage ? `${Number(form.sibling_discount_percentage)}%${siblingContext?.ruleLabel ? ` — ${siblingContext.ruleLabel}` : ''}` : ''],
            ['Actual / Net Tuition Fee', form.net_tuition_fee ? `Rs ${Number(form.net_tuition_fee).toLocaleString()}` : ''],
          ])}
        </div>
      </section>

      <section className="print-docs">
        <strong className="print-docs-title">Submitted Documents</strong>
        <div className="print-docs-list">
          {submittedChecklist.map((item) => (
            <div className="print-doc" key={item.label}>
              <span className={`print-doc-box${documentReceived(item.value) ? ' received' : ''}`} aria-hidden="true">{documentReceived(item.value) ? '✓' : ''}</span>
              <span className="print-doc-label">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={`print-foot${consentLanguage === 'English' ? '' : ' print-foot-wide'}`}>
        <section className="print-declaration">
          <h2>{consentLanguage === 'Urdu' ? 'Declaration / اقرار نامہ' : 'Declaration'}</h2>
          {consentLanguage !== 'Urdu' && <p className="print-declaration-en">{DECLARATION_ENGLISH}</p>}
          {consentLanguage !== 'English' && <p className="print-declaration-ur" dir="rtl" lang="ur">{DECLARATION_URDU}</p>}
        </section>
        <section className="print-office-use">
          <h2>Office Use Only</h2>
          <div className="print-office-grid">
            <div className="print-office-line"><span>Verified By</span></div>
            <div className="print-office-line"><span>Date</span></div>
            <div className="print-office-line"><span>Fee Received</span></div>
            <div className="print-office-line"><span>School Stamp</span></div>
          </div>
        </section>
      </div>

      <div className="print-sign-space" aria-hidden="true" />

      <div className="print-signatures">
        <div className="print-signature"><span>Parent / Guardian Signature</span></div>
        <div className="print-signature"><span>Principal Signature</span></div>
      </div>
    </div>
  </section>);

  return <form className="panel admission-form" onSubmit={handleSubmit}>
    <div className="form-heading"><div><span className="eyebrow">{onClear ? 'New admission' : 'Edit student'}</span><h2>Student Admission Form</h2></div><div className="form-heading-side"><div className="admission-photo">{form.photo_url ? <img src={form.photo_url} alt="Student preview" /> : <div className="photo-placeholder"><UserPlus size={24} /></div>}<div className="admission-photo-copy"><span>Student Photo</span><div className="admission-photo-buttons"><button type="button" className="secondary-button photo-upload" onClick={() => setCameraOpen(true)}><Camera size={14} /> Take photo</button><label className="secondary-button photo-upload">Upload photo<input type="file" accept="image/*" onChange={(event) => readPhoto(event.target.files?.[0])} /></label></div></div></div><button type="button" className="close-button" onClick={onCancel} aria-label="Close admission form"><X size={18} /></button></div></div>
    <div className="admission-tabs"><button type="button" className={activeTab === 'info' ? 'active' : ''} onClick={() => setActiveTab('info')}><ClipboardCheck size={16} /> Admission Info</button><button type="button" className={activeTab === 'other' ? 'active' : ''} onClick={() => setActiveTab('other')}><Wallet size={16} /> Other Info</button><button type="button" className={activeTab === 'submitted' ? 'active' : ''} onClick={() => setActiveTab('submitted')}><FileText size={16} /> Submitted Doc</button><button type="button" className={activeTab === 'issued' ? 'active' : ''} onClick={() => setActiveTab('issued')}><FileText size={16} /> Issued Doc</button><button type="button" className={activeTab === 'leaving' ? 'active' : ''} onClick={() => setActiveTab('leaving')}><FileText size={16} /> Leaving Info</button></div>
    {activeTab === 'info' && <div className="form-grid admission-info-grid">
      <div className="get-field"><label>Admission No.</label><div><input required value={form.admission_number} onChange={(event) => update('admission_number', event.target.value)} />{onAutoGenerate && <button type="button" className="secondary-button" onClick={onAutoGenerate}><Sparkles size={14} /> Auto Generate</button>}</div></div>
      <label>Admission Date<input required type="date" value={form.admission_date} onChange={(event) => update('admission_date', event.target.value)} /></label>
      <label>Admitted in Class<select value={form.admitted_in_class} onChange={(event) => update('admitted_in_class', event.target.value)}>{admittedClassOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>Current Class<select value={form.class_name} onChange={(event) => update('class_name', event.target.value)}>{currentClassOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>Section<select value={form.section_name} onChange={(event) => update('section_name', event.target.value)}>{currentSectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>Roll No.<input value={form.roll_number} onChange={(event) => update('roll_number', event.target.value)} placeholder="Leave blank to number automatically" /></label>
      <label>Date of Birth<input type="date" value={form.date_of_birth} onChange={(event) => update('date_of_birth', event.target.value)} /></label>
      <label>Gender<select value={form.gender} onChange={(event) => update('gender', event.target.value)}><option>Girl</option><option>Boy</option><option>Other</option></select></label>
      <label>Student Status<select value={form.status} onChange={(event) => update('status', event.target.value)}><option value="active">Active</option><option value="pending">Pending</option><option value="withdrawn">InActive</option><option value="promoted">Pass Out</option></select></label>
      <label>Last School<input value={form.last_school} onChange={(event) => update('last_school', event.target.value)} /></label>
      <label>Last Class<input value={form.last_class} onChange={(event) => update('last_class', event.target.value)} /></label>
      <label>TC / SLC No.<input value={form.tc_slc_number} onChange={(event) => update('tc_slc_number', event.target.value)} placeholder="Optional — add when the previous school issues it" /></label>
      <DropdownWithAdd category="religion" label="Religion" value={form.religion} options={dropdownOptions.religion} onChange={(value) => update('religion', value)} onOptionsChanged={loadDropdownOptions} onToast={onToast} />
      <label>Nationality<select value={form.nationality} onChange={(event) => update('nationality', event.target.value)}><option>Indian</option><option>Pakistani</option><option>Bangladeshi</option><option>Nepali</option><option>Other</option></select></label>
      <DropdownWithAdd category="student_group" label="Student Group" value={form.student_group} options={dropdownOptions.student_group} onChange={(value) => update('student_group', value)} onOptionsChanged={loadDropdownOptions} onToast={onToast} />
      <DropdownWithAdd category="subject_group" label="Subject Group" value={form.subject_group} options={dropdownOptions.subject_group} onChange={(value) => update('subject_group', value)} onOptionsChanged={loadDropdownOptions} onToast={onToast} />
      <DropdownWithAdd category="house" label="House" value={form.house} options={dropdownOptions.house} onChange={(value) => update('house', value)} onOptionsChanged={loadDropdownOptions} onToast={onToast} />
      <label>Place of Birth<input value={form.place_of_birth} onChange={(event) => update('place_of_birth', event.target.value)} /></label>
      <div className="col-span-full"><InformationRecords records={infoRecords} loading={infoLoading} loadError={infoLoadError} options={dropdownOptions.information_type} onOptionsChanged={loadDropdownOptions} onToast={onToast} onSave={onSaveInfo} onDelete={onDeleteInfo} /></div>
      <div className="form-section-title">Student and family details</div>
      <div className="prefix-field"><label>Student Name</label><div><select value={form.student_name_prefix} onChange={(event) => update('student_name_prefix', event.target.value)}><option value="">Prefix</option><option>Master</option><option>Miss</option><option>Mr.</option><option>Ms.</option></select><input required value={form.full_name} onChange={(event) => update('full_name', event.target.value)} placeholder="Enter student name" /></div></div>
      <label>Urdu<input className="urdu-input" dir="rtl" lang="ur" value={form.full_name_urdu} onChange={(event) => update('full_name_urdu', event.target.value)} placeholder="طالب علم کا نام" /></label>
      <div className="prefix-field"><label>Father Name</label><div><select value={form.father_name_prefix} onChange={(event) => update('father_name_prefix', event.target.value)}><option value="">Prefix</option><option>Mr.</option><option>Dr.</option></select><input required value={form.fathers_name} onChange={(event) => update('fathers_name', event.target.value)} placeholder="Enter father name" /><button type="button" className="get-pill" disabled={getSearching} onClick={() => void searchFamily('father')}>Get</button></div></div>
      <label>Urdu<input className="urdu-input" dir="rtl" lang="ur" value={form.fathers_name_urdu} onChange={(event) => update('fathers_name_urdu', event.target.value)} placeholder="والد کا نام" /></label>
      <label>Mother Name<input value={form.mother_name} onChange={(event) => update('mother_name', event.target.value)} /></label>
      <label>Urdu<input className="urdu-input" dir="rtl" lang="ur" value={form.mother_name_urdu} onChange={(event) => update('mother_name_urdu', event.target.value)} placeholder="والدہ کا نام" /></label>
      <div className="get-field"><label>Father’s CNIC</label><div><input inputMode="numeric" value={form.fathers_cnic} onChange={(event) => update('fathers_cnic', maskCnic(event.target.value))} placeholder="35202-1234567-1" /><button type="button" className="get-pill" disabled={getSearching} onClick={() => void searchFamily('cnic')}>Get</button></div></div>
      <div className="get-field"><label>Student Form-B</label><div><input inputMode="numeric" value={form.student_form_b} onChange={(event) => update('student_form_b', maskCnic(event.target.value))} placeholder="12345-1234567-1" /><button type="button" className="get-pill" disabled={getSearching} onClick={() => void searchFamily('formb')}>Get</button></div></div>
      <label>Guardian Name<input required value={form.guardian_name} onChange={(event) => update('guardian_name', event.target.value)} /></label>
      <label>Guardian Phone<input required value={form.guardian_phone} onChange={(event) => update('guardian_phone', event.target.value)} /></label>
    </div>}
    {activeTab === 'other' && <AdmissionOtherInfoFields form={form} update={update} patch={patch} dropdownOptions={dropdownOptions} onOptionsChanged={loadDropdownOptions} onToast={onToast} siblingContext={siblingContext} familyLedger={familyLedger} familyStatementInfo={familyStatementInfo} onResetParentPassword={onResetParentPassword} />}
    {(activeTab === 'leaving' || activeTab === 'submitted' || activeTab === 'issued') && <AdmissionDocTabs tab={activeTab} form={form} update={update} patch={patch} onToast={onToast} recordStudent={recordStudent} />}
    <div className="print-section no-print mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div><span className="eyebrow">Declaration language</span><p className="text-sm text-slate-600">Choose the language of the parent consent that appears on the printed form.</p></div>
      <div className="segmented-control compact" role="group" aria-label="Declaration language">
        {(['English', 'Urdu', 'Both'] as const).map((option) => (
          <button key={option} type="button" className={consentLanguage === option ? 'selected' : ''} aria-pressed={consentLanguage === option} onClick={() => setConsentLanguage(option)}>{option}</button>
        ))}
      </div>
    </div>
    <div className="print-section no-print mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div><span className="eyebrow">Print and export</span><p className="text-sm text-slate-600">Share a copy of this admission form.</p></div>
      <div className="admission-action-buttons">
        <button type="button" className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print</button>
        <button type="button" className="secondary-button" onClick={saveAsPdf}><FileText size={15} /> Save as PDF</button>
        <button type="button" className="secondary-button" onClick={exportCsv}><Download size={15} /> Export as CSV</button>
        {onPrintBlank && <button type="button" className="secondary-button" onClick={onPrintBlank}><FileText size={15} /> Print Blank Form</button>}
      </div>
    </div>
    <div className="form-footer admission-actions no-print">{onNavigate && <div className="record-navigation"><button type="button" disabled={!hasPrev} onClick={() => onNavigate('first')} aria-label="First record" title="First student"><ChevronLeft size={14} /><ChevronLeft size={14} /></button><button type="button" disabled={!hasPrev} onClick={() => onNavigate('prev')} aria-label="Previous record" title="Previous student"><ChevronLeft size={14} /></button><button type="button" disabled={!hasNext} onClick={() => onNavigate('next')} aria-label="Next record" title="Next student"><ChevronRight size={14} /></button><button type="button" disabled={!hasNext} onClick={() => onNavigate('last')} aria-label="Last record" title="Last student"><ChevronRight size={14} /><ChevronRight size={14} /></button></div>}<div className="admission-action-buttons">{onClear && <><button type="button" className="secondary-button" onClick={onClear}><Trash2 size={15} /> Delete</button><button type="button" className="secondary-button" onClick={onClear}><Plus size={15} /> New</button></>}{onAddToSession && <><button type="button" className="secondary-button" onClick={() => void onAddToSession()}>Add to Session</button><button type="button" className="secondary-button" onClick={() => onToast('SMS is ready to send after saving this student')}>Send SMS</button></>}<button type="button" className="secondary-button" onClick={onCancel}>Close</button><SaveButton state={saveState.state} /></div></div>
    {printSheet}
    {cameraOpen && <CameraCaptureModal onCapture={(dataUrl) => update('photo_url', dataUrl)} onClose={() => setCameraOpen(false)} onToast={onToast} />}
    {familyMatches && (
      <div className="notice-overlay" onClick={() => setFamilyMatches(null)}>
        <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
          <div className="notice-preview-top">
            <div>
              <span className="eyebrow">SchoolDesk · Family found</span>
              <h2 className="send-notice-heading">Which brother or sister?</h2>
              <small className="send-notice-sub">Pick the student whose family details should be copied into this form.</small>
            </div>
            <button type="button" className="close-button" onClick={() => setFamilyMatches(null)} aria-label="Close"><X size={18} /></button>
          </div>
          <ul className="send-notice-history-list">
            {familyMatches.map((match) => (
              <li key={match.id}>
                <div>
                  <strong>{match.full_name}</strong>
                  <small>{[match.class_name, match.section_name].filter(Boolean).join(' · ')} · {match.fathers_name || match.guardian_name || '—'}</small>
                </div>
                <button type="button" className="primary-button" onClick={() => { setFamilyMatches(null); applyFamilyDetails(match); onToast(`Family details filled from ${match.full_name}'s record`); }}><Users size={14} /> Use details</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    )}
  </form>;
}
