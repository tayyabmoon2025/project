import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert as AlertCircle,
  FileBadge,
  Loader as Loader2,
  Printer,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StaffPicker } from '@/components/StaffPicker';
import { CertificatePreviewModal } from '@/components/CertificatePreviewModal';
import { fetchPayPackages, type PayPackage, type PayrollStaff } from '@/lib/payroll';
import { STAFF_MEMBER_COLUMNS } from '@/lib/staffProfile';
import { supabase } from '@/lib/supabase';
import { formatCnic } from '@/lib/staffDirectory';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { cleanPhoneNumber, whatsappLink } from '@/lib/whatsapp';
import {
  buildCertificateBody,
  cachedStaffCertificates,
  certificateMessage,
  certificateStaffCode,
  certificateTypeLabel,
  certificateTypeShort,
  CERTIFICATE_TYPES,
  deleteStaffCertificate,
  designationFor,
  fetchNextCertificateReference,
  fetchStaffCertificates,
  isServingStaff,
  issueStaffCertificate,
  shortDate,
  type CertificateStaff,
  type CertificateType,
  type StaffCertificate,
} from '@/lib/staffCertificates';

const today = () => new Date().toISOString().slice(0, 10);

export function IssueCertificateTab({ staff, onToast }: {
  staff: PayrollStaff[];
  onToast: (message: string) => void;
}) {
  const [certificates, setCertificates] = useState<StaffCertificate[]>(() => cachedStaffCertificates());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [members, setMembers] = useState<CertificateStaff[]>([]);
  const [payPackages, setPayPackages] = useState<PayPackage[]>([]);

  const [chosen, setChosen] = useState<CertificateStaff | null>(null);
  const [type, setType] = useState<CertificateType>('experience');
  const [issueDate, setIssueDate] = useState(today());
  const [reference, setReference] = useState('');
  const [purpose, setPurpose] = useState('');
  const [body, setBody] = useState('');
  const [bodyEdited, setBodyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [preview, setPreview] = useState<StaffCertificate | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CertificateType>('all');
  const [removing, setRemoving] = useState<string | null>(null);

  // The certificate wording is written from the staff member's own record, so the
  // personnel fields are read here rather than passed down from the directory screen.
  const loadMembers = useCallback(async () => {
    const { data, error: memberError } = await supabase
      .from('user_profiles')
      .select(STAFF_MEMBER_COLUMNS)
      .in('role', ['teacher', 'office_assistant', 'accountant', 'support_staff', 'admin'])
      .order('full_name');
    if (!memberError && data) setMembers(data as unknown as CertificateStaff[]);
  }, []);

  const loadRegister = useCallback(async () => {
    setLoading(true);
    const { certificates: rows, error: registerError } = await fetchStaffCertificates();
    setCertificates(rows);
    setLoadError(registerError ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { void loadMembers(); void loadRegister(); }, [loadMembers, loadRegister]);

  useEffect(() => {
    void fetchPayPackages().then(setPayPackages);
  }, []);

  // The reference number is shown before saving, so the office can quote it if asked.
  useEffect(() => {
    const year = Number((issueDate || today()).slice(0, 4));
    void fetchNextCertificateReference(year).then(setReference);
  }, [issueDate]);

  const payPackage = useMemo(
    () => (chosen ? payPackages.find((row) => row.staff_user_id === chosen.id) ?? null : null),
    [chosen, payPackages],
  );

  // The wording is rewritten whenever the staff member, the type or the pay package
  // changes, but never after the office has started editing it by hand.
  useEffect(() => {
    if (!chosen || bodyEdited) return;
    setBody(buildCertificateBody({
      type,
      staff: chosen,
      schoolName: SCHOOL_NAME,
      purpose,
      payPackage,
    }));
  }, [chosen, type, purpose, payPackage, bodyEdited]);

  const pickStaff = (member: CertificateStaff) => {
    setChosen(member);
    setBodyEdited(false);
    setError('');
  };

  const changeType = (next: CertificateType) => {
    setType(next);
    setBodyEdited(false);
  };

  const regenerate = () => {
    if (!chosen) return;
    setBodyEdited(false);
    setBody(buildCertificateBody({ type, staff: chosen, schoolName: SCHOOL_NAME, purpose, payPackage }));
    onToast('The wording was rebuilt from the staff record.');
  };

  const save = async () => {
    setError('');
    if (!chosen) { setError('Choose the staff member the certificate is for.'); return; }
    if (!body.trim()) { setError('The certificate wording cannot be empty.'); return; }
    setBusy(true);
    const { certificate, error: saveError } = await issueStaffCertificate({
      staffUserId: chosen.id,
      certificateType: type,
      purpose,
      issueDate,
      body,
    });
    setBusy(false);
    if (saveError || !certificate) { setError(saveError ?? 'The certificate could not be issued.'); return; }
    await loadRegister();
    setPreview(certificate);
    onToast(`${certificateTypeLabel(certificate.certificate_type)} ${certificate.reference_no ?? ''} was issued to ${chosen.full_name}.`);
    // The form is cleared for the next certificate, but the chosen staff member stays so
    // a second certificate for the same person takes one click.
    setBodyEdited(false);
    setPurpose('');
    setBody(buildCertificateBody({ type, staff: chosen, schoolName: SCHOOL_NAME, purpose: '', payPackage }));
  };

  const remove = async (record: StaffCertificate) => {
    setRemoving(record.id);
    const { error: removeError } = await deleteStaffCertificate(record.id);
    setRemoving(null);
    if (removeError) { onToast(removeError); return; }
    setCertificates((prev) => prev.filter((row) => row.id !== record.id));
    onToast(`Certificate ${record.reference_no ?? ''} was removed from the register.`);
  };

  // The number to dial for a certificate: read from the staff member's record now, so a
  // number corrected after the certificate was issued is the one used.
  const registerPhone = (row: StaffCertificate) =>
    cleanPhoneNumber(members.find((member) => member.id === row.staff_user_id)?.mobile_number ?? null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return certificates.filter((row) => {
      if (typeFilter !== 'all' && row.certificate_type !== typeFilter) return false;
      if (!needle) return true;
      return [
        row.reference_no ?? '',
        row.staff_name ?? '',
        row.staff_code ?? '',
        certificateTypeLabel(row.certificate_type),
        shortDate(row.issued_on),
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [certificates, search, typeFilter]);

  const thisYear = new Date().getFullYear();
  const issuedThisYear = certificates.filter((row) => row.issued_on.slice(0, 4) === String(thisYear)).length;
  const servingCount = staff.filter((member) => member.status === 'active').length;

  return (
    <div className="payroll-tab">
      <div className="leave-header">
        <div>
          <span className="eyebrow"><FileBadge size={14} /> Issue certificate</span>
          <h3>Staff certificates, issued and recorded</h3>
          <p>
            Choose the staff member and the kind of certificate, and the wording is written from their own
            record. Every certificate is numbered, printed on the school letterhead and kept in the register
            below.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void loadRegister()}>
          <RefreshCw size={16} /> Refresh register
        </button>
      </div>

      <div className="leave-cards">
        <div className="leave-card approved">
          <span className="leave-card-icon"><FileBadge size={18} /></span>
          <strong>{certificates.length}</strong>
          <span>Certificates issued</span>
          <small>Everything in the register</small>
        </div>
        <div className="leave-card today">
          <span className="leave-card-icon"><BadgeCheck size={18} /></span>
          <strong>{issuedThisYear}</strong>
          <span>Issued in {thisYear}</span>
          <small>This year's numbering series</small>
        </div>
        <div className="leave-card pending">
          <span className="leave-card-icon"><UserRound size={18} /></span>
          <strong>{members.length}</strong>
          <span>Staff on record</span>
          <small>{servingCount} currently serving</small>
        </div>
        <div className="leave-card">
          <span className="leave-card-icon"><AlertCircle size={18} /></span>
          <strong>{reference || '—'}</strong>
          <span>Next reference no.</span>
          <small>Reserved when you save</small>
        </div>
      </div>

      <div className="cert-layout">
        <div className="panel cert-form-panel">
          <div className="cert-panel-head">
            <h4>Certificate details</h4>
            <p>The wording below is a starting point — every word stays editable.</p>
          </div>

          <div className="cert-form-grid">
            <div className="control-field full">
              <span>Staff member</span>
              <StaffPicker staff={members} value={chosen?.id ?? ''} onChange={pickStaff} />
            </div>

            <div className="control-field full">
              <span>Certificate type</span>
              <div className="cert-type-grid">
                {CERTIFICATE_TYPES.map((option) => (
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

            <label className="control-field">
              Reference number
              <input value={reference} readOnly title="Allocated by the school register" />
            </label>

            <label className="control-field">
              Issue date
              <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
            </label>

            <label className="control-field full">
              Purpose of the certificate (optional)
              <input
                value={purpose}
                placeholder="For example: bank loan, visa application, higher studies"
                onChange={(event) => { setPurpose(event.target.value); setBodyEdited(false); }}
              />
            </label>

            <label className="control-field full">
              Certificate wording
              <textarea rows={16} value={body} onChange={(event) => { setBody(event.target.value); setBodyEdited(true); }} />
            </label>
          </div>

          {bodyEdited && chosen && (
            <p className="cert-regen-note">
              <AlertCircle size={14} /> The wording has been edited by hand. Rebuild it from the staff record to
              start again.
              <button type="button" className="cert-regen-button" onClick={regenerate}>Rebuild wording</button>
            </p>
          )}

          {error && <div className="auth-error"><span>{error}</span></div>}

          <div className="cert-form-actions">
            <button type="button" className="primary-button" onClick={() => void save()} disabled={busy || !chosen}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <FileBadge size={16} />} Generate &amp; save certificate
            </button>
            {chosen && (
              <button type="button" className="secondary-button" onClick={() => { setChosen(null); setBody(''); setPurpose(''); setBodyEdited(false); }}>
                Clear form
              </button>
            )}
          </div>
        </div>

        <aside className="panel cert-aside">
          <div className="cert-panel-head">
            <h4>Staff record</h4>
            <p>What the certificate is written from.</p>
          </div>

          {!chosen ? (
            <div className="cert-aside-empty">
              <UserRound size={26} />
              <p>Choose a staff member to see their details and fill the certificate in.</p>
            </div>
          ) : (
            <div className="cert-aside-body">
              <div className="cert-aside-person">
                <PersonAvatar photoUrl={chosen.photo_url} name={chosen.full_name} />
                <div>
                  <strong>{chosen.full_name}</strong>
                  <span>{designationFor(chosen.role)}</span>
                  <small>{isServingStaff(chosen) ? 'Currently serving' : 'Former staff'}</small>
                </div>
              </div>

              <div className="cert-facts">
                <div><span>Staff ID</span><strong>{certificateStaffCode(chosen)}</strong></div>
                <div><span>CNIC</span><strong>{formatCnic(chosen.cnic) || '—'}</strong></div>
                <div><span>Joining date</span><strong>{shortDate(chosen.joining_date)}</strong></div>
                <div><span>Leaving date</span><strong>{shortDate(chosen.leaving_date)}</strong></div>
                <div><span>Mobile</span><strong>{chosen.mobile_number || '—'}</strong></div>
                <div>
                  <span>Gross salary</span>
                  <strong>
                    {payPackage
                      ? `Rs ${Math.round(
                          Number(payPackage.basic_salary)
                          + Number(payPackage.house_rent_allowance)
                          + Number(payPackage.conveyance_allowance)
                          + Number(payPackage.medical_allowance)
                          + Number(payPackage.other_allowance),
                        ).toLocaleString()}`
                      : 'No pay package'}
                  </strong>
                </div>
              </div>

              {!isServingStaff(chosen) && !chosen.leaving_date && (
                <p className="cert-aside-warn">
                  <AlertCircle size={14} /> No leaving date is recorded for this former staff member, so the
                  certificate does not state when the service ended.
                </p>
              )}
              {!payPackage && (type === 'salary') && (
                <p className="cert-aside-warn">
                  <AlertCircle size={14} /> No pay package is set up, so the salary certificate states the figure is
                  held in the payroll register. Fill the exact amount in by hand if needed.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <div className="panel roster-panel leave-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by reference number, staff name, Staff ID or date"
            />
          </div>
          <div className="leave-filters">
            <select
              className="staff-role-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as 'all' | CertificateType)}
            >
              <option value="all">All certificate types</option>
              {CERTIFICATE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className="result-count">{filtered.length} certificate{filtered.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {loading && certificates.length === 0 ? (
          <div className="empty-state large"><Loader2 size={22} className="auth-spinner" /> Loading the register…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state large">
            {loadError
              ? loadError
              : certificates.length === 0
                ? 'No certificates issued yet. Fill the form above and save the first one.'
                : 'No certificate matches this search.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference No.</th>
                  <th>Issue date</th>
                  <th>Staff name</th>
                  <th>Certificate type</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td><span className="cert-reference">{row.reference_no ?? '—'}</span></td>
                    <td className="muted-cell">{shortDate(row.issued_on)}</td>
                    <td>
                      <div className="table-student">
                        <PersonAvatar photoUrl={row.staff_photo_url} name={row.staff_name ?? 'Staff member'} />
                        <div className="cert-staff-cell">
                          <strong>{row.staff_name ?? 'Staff member'}</strong>
                          <small>{row.staff_code ?? ''}{row.staff_role ? ` · ${designationFor(row.staff_role)}` : ''}</small>
                        </div>
                      </div>
                    </td>
                    <td><span className={`cert-type-chip cert-type-${row.certificate_type}`}>{certificateTypeShort(row.certificate_type)}</span></td>
                    <td>
                      <div className="leave-row-actions">
                        <button type="button" className="icon-button" title="View or reprint this certificate" onClick={() => setPreview(row)}>
                          <Printer size={15} />
                        </button>
                        <a
                          className="icon-button cert-row-wa"
                          href={whatsappLink(registerPhone(row), certificateMessage(row, SCHOOL_NAME), 'web')}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Send this certificate on WhatsApp"
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="leave-footnote">
        Certificates are numbered in the order they are issued and cannot be renumbered. Removing one deletes it
        from the register, so keep the printed copy in the staff file.
      </p>

      {preview && (
        <CertificatePreviewModal record={preview} onClose={() => setPreview(null)} onToast={onToast} />
      )}
    </div>
  );
}
