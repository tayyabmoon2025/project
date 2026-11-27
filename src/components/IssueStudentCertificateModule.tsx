import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert as AlertCircle,
  FileBadge2,
  Loader as Loader2,
  Lock,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
  UserRound,
} from 'lucide-react';
import { PersonAvatar } from '@/components/PersonAvatar';
import { AsyncSaveButton } from '@/components/SaveButton';
import {
  StudentCertificateLetterhead,
  StudentCertificatePreviewModal,
  StudentCertificateStylePicker,
} from '@/components/StudentCertificatePreviewModal';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { cleanPhoneNumber, whatsappLink } from '@/lib/whatsapp';
import { currentSession } from '@/lib/promotions';
import {
  buildCertificateDraft,
  certificateMessage,
  certificateTypeInfo,
  certificateTypeLabel,
  certificateTypeShort,
  CERTIFICATE_CATEGORIES,
  DEFAULT_BORDER_STYLE,
  DEFAULT_FONT_STYLE,
  decideStudentCertificate,
  deleteStudentCertificate,
  fetchNextCertificateNumber,
  fetchStudentCertificates,
  issueStudentCertificate,
  regenerateCertificateCode,
  shortDate,
  STUDENT_CERTIFICATE_TYPES,
  type CertificateBorderStyle,
  type CertificateCategory,
  type CertificateFontStyle,
  type StudentCertificate,
  type StudentCertificateType,
} from '@/lib/studentCertificates';
import type { Student } from '@/lib/schoolTypes';

const today = () => new Date().toISOString().slice(0, 10);

const STUDENT_STATUS_LABELS: Record<Student['status'], string> = {
  active: 'Active',
  pending: 'Pending',
  withdrawn: 'Inactive',
  promoted: 'Pass Out',
};

type ApprovalFilter = 'all' | 'pending' | 'approved';

// The one screen the school office issues a certificate from: choose the student, choose
// the kind, adjust the wording, save, and the certificate is numbered and filed. Nothing
// reaches a family until an administrator releases it from the register below.
export function IssueStudentCertificateModule({ students, onToast }: {
  students: Student[];
  onToast: (message: string) => void;
}) {
  const [certificates, setCertificates] = useState<StudentCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);

  const [chosen, setChosen] = useState<Student | null>(null);
  const [type, setType] = useState<StudentCertificateType>('school_leaving');
  const [number, setNumber] = useState('');
  const [numberEdited, setNumberEdited] = useState(false);
  const [issueDate, setIssueDate] = useState(today());
  const [extra, setExtra] = useState('');
  const [serial, setSerial] = useState('');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [border, setBorder] = useState<CertificateBorderStyle>(DEFAULT_BORDER_STYLE);
  const [font, setFont] = useState<CertificateFontStyle>(DEFAULT_FONT_STYLE);
  const [bodyEdited, setBodyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [preview, setPreview] = useState<StudentCertificate | null>(null);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentStatusFilter, setStudentStatusFilter] = useState<'all' | 'active' | 'left'>('all');
  const [registerQuery, setRegisterQuery] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
  const [removing, setRemoving] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState<string | null>(null);

  const loadRegister = useCallback(async () => {
    setLoading(true);
    const { certificates: rows, error: registerError } = await fetchStudentCertificates();
    setCertificates(rows);
    setLoadError(registerError ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { void loadRegister(); }, [loadRegister]);
  useEffect(() => { void fetchInstitutionProfile().then(({ profile }) => setInstitution(profile)); }, []);

  // The certificate number is shown before saving, so the office can quote it if asked.
  useEffect(() => {
    if (numberEdited) return;
    const year = Number((issueDate || today()).slice(0, 4));
    void fetchNextCertificateNumber(type, year).then(setNumber);
  }, [type, issueDate, numberEdited]);

  const typeInfo = certificateTypeInfo(type);

  // The wording is rewritten whenever the student, the kind or the extra detail changes,
  // but never after the office has started editing it by hand.
  useEffect(() => {
    if (!chosen || bodyEdited) return;
    const draft = buildCertificateDraft({
      type,
      student: chosen,
      schoolName: institution?.school_name?.trim() || SCHOOL_NAME,
      extra,
      session: currentSession(),
      serialNumber: serial,
      issuedOn: issueDate,
    });
    setBody(draft.body);
    setTitle(draft.title);
    if (!serial && draft.slcSerialNumber) setSerial(draft.slcSerialNumber);
  }, [chosen, type, extra, serial, issueDate, bodyEdited, institution]);

  const pickStudent = (student: Student) => {
    setChosen(student);
    setBodyEdited(false);
    setExtra('');
    setSerial(student.slc_serial_number ?? '');
    setError('');
  };

  const changeType = (next: StudentCertificateType) => {
    setType(next);
    setBodyEdited(false);
    setExtra('');
  };

  const regenerate = () => {
    if (!chosen) return;
    setBodyEdited(false);
    const draft = buildCertificateDraft({
      type,
      student: chosen,
      schoolName: institution?.school_name?.trim() || SCHOOL_NAME,
      extra,
      session: currentSession(),
      serialNumber: serial,
      issuedOn: issueDate,
    });
    setBody(draft.body);
    setTitle(draft.title);
    onToast('The wording was rebuilt from the student record.');
  };

  const clearForm = () => {
    setChosen(null);
    setBody('');
    setTitle('');
    setExtra('');
    setSerial('');
    setBodyEdited(false);
    setNumberEdited(false);
    setError('');
  };

  const save = async (approveNow: boolean): Promise<boolean | void> => {
    setError('');
    if (!chosen) { setError('Choose the student the certificate is for.'); return false; }
    if (!body.trim()) { setError('The certificate wording cannot be empty.'); return false; }
    setBusy(true);
    const { certificate, error: saveError } = await issueStudentCertificate({
      studentId: chosen.id,
      certificateType: type,
      title: title.trim() || certificateTypeLabel(type),
      body,
      slcSerialNumber: serial,
      certificateNumber: number,
      issuedOn: issueDate,
      approveNow,
      borderStyle: border,
      fontStyle: font,
    });
    setBusy(false);
    if (saveError || !certificate) { setError(saveError ?? 'The certificate could not be issued.'); return false; }

    const saved: StudentCertificate = {
      ...certificate,
      student_name: certificate.student_name ?? chosen.full_name,
      admission_number: certificate.admission_number ?? chosen.admission_number,
      class_name: certificate.class_name ?? chosen.class_name,
      section_name: certificate.section_name ?? chosen.section_name,
    };
    await loadRegister();
    setPreview(saved);
    onToast(approveNow
      ? `${certificateTypeLabel(type)} ${saved.certificate_number ?? ''} was issued to ${chosen.full_name} and released to the portals.`
      : `${certificateTypeLabel(type)} ${saved.certificate_number ?? ''} was issued to ${chosen.full_name} and is awaiting your approval.`);
    setBodyEdited(false);
    setNumberEdited(false);
    setExtra('');
    return true;
  };

  const decide = async (record: StudentCertificate, decision: 'approve' | 'hold') => {
    setDeciding(record.id);
    const { certificate, error: decideError } = await decideStudentCertificate(record.id, decision);
    setDeciding(null);
    if (decideError || !certificate) { onToast(decideError ?? 'The certificate could not be updated.'); return; }
    setCertificates((current) => current.map((row) => (
      row.id === record.id ? { ...row, ...certificate } : row
    )));
    onToast(decision === 'approve'
      ? `Certificate ${record.certificate_number ?? ''} was released to the family portals.`
      : `Certificate ${record.certificate_number ?? ''} was put back on hold and is hidden again.`);
  };

  const remove = async (record: StudentCertificate) => {
    setRemoving(record.id);
    const { error: removeError } = await deleteStudentCertificate(record.id);
    setRemoving(null);
    if (removeError) { onToast(removeError); return; }
    setCertificates((current) => current.filter((row) => row.id !== record.id));
    onToast(`Certificate ${record.certificate_number ?? ''} was removed from the register.`);
  };

  // Withdraws the code printed on a certificate and puts a fresh one in its place. Used
  // when a copy was printed in error and must not be confirmable any more; the paper that
  // carries the old code stops verifying the moment this succeeds.
  const reissueCode = async (record: StudentCertificate) => {
    setReissuing(record.id);
    const { certificate, error: codeError } = await regenerateCertificateCode(record.id);
    setReissuing(null);
    if (codeError || !certificate) { onToast(codeError ?? 'A new code could not be issued.'); return; }
    setCertificates((current) => current.map((row) => (
      row.id === record.id ? { ...row, verification_code: certificate.verification_code } : row
    )));
    onToast(`Certificate ${record.certificate_number ?? ''} now carries the code ${certificate.verification_code ?? ''}. Print it again to hand over the new code.`);
  };

  const studentNameFor = (id: string) => students.find((student) => student.id === id)?.full_name ?? 'Student';

  const registerPhone = (record: StudentCertificate) => {
    const student = students.find((row) => row.id === record.student_id);
    return cleanPhoneNumber(student?.whatsapp_number ?? student?.guardian_phone ?? null);
  };

  const pickerStudents = useMemo(() => {
    const needle = studentQuery.trim().toLowerCase();
    return students
      .filter((student) => {
        if (studentStatusFilter === 'active' && student.status !== 'active') return false;
        if (studentStatusFilter === 'left' && student.status === 'active') return false;
        if (!needle) return true;
        return [
          student.full_name, student.admission_number, student.class_name,
          student.section_name, student.roll_number ?? '', student.fathers_name ?? '',
          student.guardian_name, studentStatusFor(student),
        ].join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [students, studentQuery, studentStatusFilter]);

  const filteredRegister = useMemo(() => {
    const needle = registerQuery.trim().toLowerCase();
    const nameById = new Map(students.map((student) => [student.id, student.full_name]));
    return certificates.filter((row) => {
      if (approvalFilter !== 'all' && row.approval_status !== approvalFilter) return false;
      if (!needle) return true;
      return [
        row.certificate_number ?? '',
        row.title,
        nameById.get(row.student_id) ?? 'Student',
        certificateTypeLabel(row.certificate_type),
        shortDate(row.issued_on),
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [certificates, registerQuery, approvalFilter, students]);

  const pendingCount = certificates.filter((row) => row.approval_status === 'pending').length;
  const approvedCount = certificates.filter((row) => row.approval_status === 'approved').length;
  const thisYear = new Date().getFullYear();
  const issuedThisYear = certificates.filter((row) => row.issued_on.slice(0, 4) === String(thisYear)).length;
  const leftCount = students.filter((student) => student.status !== 'active').length;

  const categories: CertificateCategory[] = ['official', 'academic', 'merit'];

  return (
    <div className="page cert-module-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow"><FileBadge2 size={14} /> Issue certificate</span>
          <h1>Student certificates, issued and released</h1>
          <p>
            Choose the student and the kind of certificate, and the wording is written from their own record. Every
            certificate is numbered and filed below. Nothing reaches a family until you release it.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void loadRegister()}>
          <RefreshCw size={16} /> Refresh register
        </button>
      </div>

      <div className="cert-stat-row">
        <div className="cert-stat-card">
          <span className="cert-stat-icon blue"><FileBadge2 size={18} /></span>
          <strong>{certificates.length}</strong>
          <span>Certificates issued</span>
          <small>Everything in the register</small>
        </div>
        <div className="cert-stat-card pending">
          <span className="cert-stat-icon amber"><Lock size={18} /></span>
          <strong>{pendingCount}</strong>
          <span>Pending admin approval</span>
          <small>Hidden from every portal</small>
        </div>
        <div className="cert-stat-card approved">
          <span className="cert-stat-icon green"><ShieldCheck size={18} /></span>
          <strong>{approvedCount}</strong>
          <span>Released to portals</span>
          <small>Visible to parents and students</small>
        </div>
        <div className="cert-stat-card">
          <span className="cert-stat-icon slate"><BadgeCheck size={18} /></span>
          <strong>{issuedThisYear}</strong>
          <span>Issued in {thisYear}</span>
          <small>{number || '—'} is next in this series</small>
        </div>
      </div>

      <div className="cert-workspace">
        {/* ---------------------------------------------------- student selector */}
        <aside className="panel cert-picker">
          <div className="cert-panel-head">
            <h4>Choose a student</h4>
            <p>Active students and students who have left the school are both listed here.</p>
          </div>

          <div className="cert-picker-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                value={studentQuery}
                onChange={(event) => setStudentQuery(event.target.value)}
                placeholder="Search name, admission no., roll no. or class"
              />
            </div>
            <div className="cert-status-tabs">
              {([
                { value: 'all', label: 'All', count: students.length },
                { value: 'active', label: 'Active', count: students.length - leftCount },
                { value: 'left', label: 'Inactive / Pass Out', count: leftCount },
              ] as const).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`cert-status-tab${studentStatusFilter === tab.value ? ' active' : ''}`}
                  onClick={() => setStudentStatusFilter(tab.value)}
                >
                  {tab.label}<b>{tab.count}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="cert-student-list">
            {pickerStudents.length === 0 ? (
              <p className="empty-state">No student matches this search.</p>
            ) : pickerStudents.map((student) => (
              <button
                key={student.id}
                type="button"
                className={`cert-student-row${chosen?.id === student.id ? ' selected' : ''}`}
                onClick={() => pickStudent(student)}
              >
                <PersonAvatar photoUrl={student.photo_url} name={student.full_name} />
                <span className="cert-student-copy">
                  <strong>{student.full_name}</strong>
                  <small>
                    {student.admission_number}
                    {student.roll_number ? ` · Roll ${student.roll_number}` : ''} · {student.class_name}
                    {student.section_name ? `-${student.section_name}` : ''}
                  </small>
                </span>
                <span className={`cert-status-pill ${statusTone(student.status)}`}>{STUDENT_STATUS_LABELS[student.status]}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* ---------------------------------------------------- certificate form */}
        <section className="panel cert-form-panel">
          <div className="cert-panel-head">
            <h4>Certificate details</h4>
            <p>The wording below is a starting point — every word stays editable.</p>
          </div>

          <StudentCertificateStylePicker border={border} font={font} onBorder={setBorder} onFont={setFont} />

          <div className="cert-mini-preview">
            <span className="cert-mini-preview-tag">Live preview</span>
            <div className="cert-mini-preview-sheet">
              {chosen ? (
                <StudentCertificateLetterhead
                  record={{
                    id: 'draft',
                    student_id: chosen.id,
                    certificate_type: type,
                    certificate_number: number || null,
                    slc_serial_number: serial || null,
                    title: title || certificateTypeLabel(type),
                    body: body || 'The wording appears here as you fill the form.',
                    issued_on: issueDate,
                    approval_status: 'pending',
                    approved_by: null,
                    approved_at: null,
                    issued_by: null,
                    created_at: '',
                  }}
                  institution={institution}
                  studentName={chosen.full_name}
                  studentPhoto={chosen.photo_url ?? null}
                  admissionNumber={chosen.admission_number}
                  borderStyle={border}
                  fontStyle={font}
                />
              ) : (
                <div className="cert-mini-preview-empty">
                  <UserRound size={20} />
                  Choose a student on the left to see the certificate take shape here.
                </div>
              )}
            </div>
          </div>

          <div className="cert-form-grid">
            <div className="control-field full">
              <span>Certificate type</span>
              <div className="cert-type-groups">
                {categories.map((category) => (
                  <div className="cert-type-group" key={category}>
                    <div className="cert-type-group-head">
                      <strong>{CERTIFICATE_CATEGORIES.find((item) => item.value === category)?.label}</strong>
                      <small>{CERTIFICATE_CATEGORIES.find((item) => item.value === category)?.hint}</small>
                    </div>
                    <div className="cert-type-grid">
                      {STUDENT_CERTIFICATE_TYPES.filter((option) => option.category === category).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`cert-type-option${type === option.value ? ' selected' : ''}`}
                          onClick={() => changeType(option.value)}
                        >
                          <strong>{option.label}</strong>
                          <small>{option.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <label className="control-field">
              Certificate / dispatch number
              <input
                value={number}
                onChange={(event) => { setNumber(event.target.value); setNumberEdited(true); }}
                placeholder="Generated automatically"
              />
              {numberEdited && (
                <button type="button" className="cert-inline-reset" onClick={() => setNumberEdited(false)}>
                  Use the next automatic number
                </button>
              )}
            </label>

            <label className="control-field">
              Issue date
              <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
            </label>

            {typeInfo?.extra && (
              <label className="control-field full">
                {typeInfo.extraLabel}
                <input
                  value={extra}
                  placeholder={typeInfo.extraPlaceholder}
                  onChange={(event) => { setExtra(event.target.value); setBodyEdited(false); }}
                />
              </label>
            )}

            {(type === 'school_leaving' || type === 'transfer') && (
              <label className="control-field full">
                SLC serial no.
                <input
                  value={serial}
                  placeholder="Printed on the leaving certificate — also saved on the student's profile"
                  onChange={(event) => { setSerial(event.target.value); setBodyEdited(false); }}
                />
              </label>
            )}

            <label className="control-field full">
              Certificate title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={certificateTypeLabel(type)} />
            </label>

            <label className="control-field full">
              Certificate wording
              <textarea rows={16} value={body} onChange={(event) => { setBody(event.target.value); setBodyEdited(true); }} />
            </label>
          </div>

          {bodyEdited && chosen && (
            <p className="cert-regen-note">
              <AlertCircle size={14} /> The wording has been edited by hand. Rebuild it from the student record to start
              again.
              <button type="button" className="cert-regen-button" onClick={regenerate}>Rebuild wording</button>
            </p>
          )}

          {!chosen && (
            <p className="cert-picker-hint">
              <UserRound size={14} /> Choose a student on the left and their admission and leaving details are written
              into the certificate for you.
            </p>
          )}

          {error && <div className="auth-error"><span>{error}</span></div>}

          <div className="cert-form-actions">
            <AsyncSaveButton
              label="Save & preview certificate"
              disabled={busy || !chosen}
              onSave={() => save(false)}
            />
            <AsyncSaveButton
              className="secondary-button"
              label="Save & release to portals"
              disabled={busy || !chosen}
              onSave={() => save(true)}
            />
            {chosen && (
              <button type="button" className="secondary-button" onClick={clearForm}>Clear form</button>
            )}
          </div>
          <p className="cert-footnote">
            Saving without releasing files the certificate as <strong>Pending Admin Approval</strong>. It stays hidden
            from the parent, student, teacher and accountant portals, and cannot be sent on WhatsApp, until an
            administrator releases it below.
          </p>
        </section>
      </div>

      {/* ---------------------------------------------------- the register */}
      <div className="panel roster-panel cert-register-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={registerQuery}
              onChange={(event) => setRegisterQuery(event.target.value)}
              placeholder="Search by certificate number, student name or type"
            />
          </div>
          <div className="cert-approval-tabs">
            {([
              { value: 'all', label: 'All', count: certificates.length },
              { value: 'pending', label: 'Pending approval', count: pendingCount },
              { value: 'approved', label: 'Released', count: approvedCount },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={`cert-approval-tab${approvalFilter === tab.value ? ' active' : ''} ${tab.value}`}
                onClick={() => setApprovalFilter(tab.value)}
              >
                {tab.value === 'pending' ? <Lock size={13} /> : tab.value === 'approved' ? <ShieldCheck size={13} /> : null}
                {tab.label}<b>{tab.count}</b>
              </button>
            ))}
          </div>
        </div>

        {loading && certificates.length === 0 ? (
          <div className="empty-state large"><Loader2 size={22} className="auth-spinner" /> Loading the register…</div>
        ) : filteredRegister.length === 0 ? (
          <div className="empty-state large">
            {loadError
              ? loadError
              : certificates.length === 0
                ? 'No certificates issued yet. Fill the form above and save the first one.'
                : 'No certificate matches this filter.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Certificate no.</th>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Issue date</th>
                  <th>Approval</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRegister.map((row) => {
                  const student = students.find((item) => item.id === row.student_id);
                  return (
                    <tr key={row.id}>
                      <td><span className="cert-reference">{row.certificate_number ?? '—'}</span></td>
                      <td>
                        <div className="table-student">
                          <PersonAvatar photoUrl={student?.photo_url} name={studentNameFor(row.student_id)} />
                          <div className="cert-staff-cell">
                            <strong>{studentNameFor(row.student_id)}</strong>
                            <small>
                              {row.admission_number ?? student?.admission_number ?? ''}
                              {row.class_name ? ` · ${row.class_name}` : ''}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td><span className={`cert-type-chip cert-type-${row.certificate_type}`}>{certificateTypeShort(row.certificate_type)}</span></td>
                      <td className="muted-cell">{shortDate(row.issued_on)}</td>
                      <td>
                        <span className={`cert-approval-pill ${row.approval_status}`}>
                          {row.approval_status === 'approved' ? <ShieldCheck size={12} /> : <Lock size={12} />}
                          {row.approval_status === 'approved' ? 'Released' : 'Pending approval'}
                        </span>
                      </td>
                      <td>
                        <div className="leave-row-actions">
                          {row.approval_status === 'approved' ? (
                            <button
                              type="button"
                              className="icon-button hold"
                              title="Revoke / hold — hide this certificate from the portals again"
                              disabled={deciding === row.id}
                              onClick={() => void decide(row, 'hold')}
                            >
                              {deciding === row.id ? <Loader2 size={15} className="auth-spinner" /> : <Lock size={15} />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-button approve"
                              title="Approve / release this certificate to the parent and student portals"
                              disabled={deciding === row.id}
                              onClick={() => void decide(row, 'approve')}
                            >
                              {deciding === row.id ? <Loader2 size={15} className="auth-spinner" /> : <Unlock size={15} />}
                            </button>
                          )}
                          <button type="button" className="icon-button" title="View or reprint this certificate" onClick={() => setPreview(row)}>
                            <Printer size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title={`Issue a new verification code — the code printed on this certificate (${row.verification_code ?? 'none'}) stops working`}
                            disabled={reissuing === row.id}
                            onClick={() => void reissueCode(row)}
                          >
                            {reissuing === row.id ? <Loader2 size={15} className="auth-spinner" /> : <QrCode size={15} />}
                          </button>
                          <a
                            className={`icon-button cert-row-wa${row.approval_status === 'approved' ? '' : ' disabled'}`}
                            href={row.approval_status === 'approved'
                              ? whatsappLink(registerPhone(row), certificateMessage(row, studentNameFor(row.student_id), SCHOOL_NAME), 'web')
                              : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-disabled={row.approval_status !== 'approved'}
                            title={row.approval_status === 'approved'
                              ? 'Send this certificate on WhatsApp'
                              : 'Approve the certificate before it can be sent to the family'}
                            onClick={(event) => { if (row.approval_status !== 'approved') event.preventDefault(); }}
                          >
                            <Send size={15} />
                          </a>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Remove this certificate from the register"
                            disabled={removing === row.id}
                            onClick={() => void remove(row)}
                          >
                            {removing === row.id ? <Loader2 size={15} className="auth-spinner" /> : <Trash2 size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="cert-register-footnote">
        Certificates are numbered in the order they are issued and cannot be renumbered. A certificate stays pending,
        and invisible to every portal, until an administrator releases it here.
      </p>

      {preview && (
        <StudentCertificatePreviewModal
          record={preview}
          studentName={preview.student_name ?? studentNameFor(preview.student_id)}
          studentPhoto={students.find((student) => student.id === preview.student_id)?.photo_url ?? null}
          admissionNumber={preview.admission_number ?? students.find((student) => student.id === preview.student_id)?.admission_number ?? null}
          borderStyle={border}
          fontStyle={font}
          onClose={() => setPreview(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function studentStatusFor(student: Student): string {
  return STUDENT_STATUS_LABELS[student.status];
}

function statusTone(status: Student['status']): string {
  if (status === 'active') return 'active';
  if (status === 'promoted') return 'out';
  if (status === 'withdrawn') return 'inactive';
  return 'pending';
}
