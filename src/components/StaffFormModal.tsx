import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { CircleAlert as AlertCircle, BadgeCheck, Camera, Eye, FileText, ImagePlus, KeyRound, Loader as Loader2, RefreshCw, ShieldCheck, Trash2, Upload, User, UserRound, X } from 'lucide-react';
import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { PasswordField } from '@/components/PasswordField';
import { generatePassword, usernameFromMobile } from '@/lib/portalAccounts';
import { cleanPhoneNumber, formatWhatsAppNumber, isValidWhatsAppNumber } from '@/lib/whatsapp';
import { cnicDigits } from '@/lib/staffDirectory';
import { maskCnic } from '@/lib/formatters';
import { SaveButton, useSaveState } from '@/components/SaveButton';
import { photoDataUrlFromFile } from '@/lib/photoImage';
import {
  DOC_ACCEPT,
  documentError,
  emptyStaffForm,
  fetchStaffDocuments,
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  RELATION_OPTIONS,
  STAFF_DOC_GROUPS,
  STAFF_ROLE_OPTIONS,
  staffFormFrom,
  staffFormProblem,
  deleteStaffDocument,
  saveStaffMember,
  uploadStaffDocument,
  uploadStaffDocuments,
  type PendingStaffDocument,
  type SavedStaffMember,
  type StaffDocType,
  type StaffDocument,
  type StaffFormState,
  type StaffMemberRecord,
} from '@/lib/staffProfile';
import type { UserRole } from '@/lib/auth';

type TabKey = 'profile' | 'documents' | 'login';

const TABS: { key: TabKey; label: string; icon: ComponentType<{ size?: number | string; className?: string }> }[] = [
  { key: 'profile', label: 'Profile & job info', icon: UserRound },
  { key: 'documents', label: 'Documents & agreement', icon: FileText },
  { key: 'login', label: 'Portal login', icon: KeyRound },
];

const formatSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// One form for both adding a new staff member and editing an existing one. The three
// tabs keep the personnel record, the paperwork and the login details apart, so the
// office is never asked to fill in everything at once.
export function StaffFormModal({ member, onClose, onSaved, onToast }: {
  member: StaffMemberRecord | null;
  onClose: () => void;
  onSaved: (result: { saved: SavedStaffMember; password: string; phone: string | null }) => void;
  onToast: (message: string) => void;
}) {
  const [form, setForm] = useState<StaffFormState>(() => (member ? staffFormFrom(member) : emptyStaffForm()));
  const [tab, setTab] = useState<TabKey>('profile');
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  // Files picked but not yet filed against a staff record. They are uploaded as soon as
  // the record has an id, so a new staff member can be given their paperwork in the same
  // sitting as their profile.
  const [pending, setPending] = useState<PendingStaffDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(Boolean(member));
  const [busy, setBusy] = useState(false);
  const saveButton = useSaveState();
  const [uploading, setUploading] = useState<StaffDocType | null>(null);
  const [error, setError] = useState('');
  const [docsError, setDocsError] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string; isImage: boolean } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [createdMember, setCreatedMember] = useState<SavedStaffMember | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInputs = useRef<Partial<Record<StaffDocType, HTMLInputElement | null>>>({});

  const isEdit = Boolean(member);
  // A new staff member has no id until the record is created, so the documents tab works
  // off whichever id is available.
  const staffUserId = member?.id ?? form.userId;

  const patch = (values: Partial<StaffFormState>) => setForm((current) => ({ ...current, ...values }));

  // The documents already on file are read for an existing staff member straight away,
  // so the edit form shows what has been attached instead of claiming the tab is empty.
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setDocsLoading(true);
    void fetchStaffDocuments(member.id).then((result) => {
      if (cancelled) return;
      setDocuments(result.documents);
      setDocsError(result.error ?? '');
      setDocsLoading(false);
    });
    return () => { cancelled = true; };
  }, [member]);

  // Object URLs for the files still waiting to be uploaded are released when the form
  // closes, so a long office session does not hold on to every page that was scanned.
  const pendingRef = useRef<PendingStaffDocument[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  // A held file still counts towards the signed agreement, so the office is never told
  // the agreement is missing when they have just attached it.
  const hasAgreement = documents.some((document) => document.doc_type === 'agreement')
    || pending.some((item) => item.docType === 'agreement');

  const isPreviewableImage = (file: File) => file.type.startsWith('image/');

  // Teachers and support staff sign in with their mobile number, so the username is
  // filled in from it and kept in step until the office types their own.
  const usesMobile = form.role !== 'admin';
  const suggestedUsername = usesMobile ? usernameFromMobile(form.mobileNumber) : '';
  // The username is only auto-filled while the account is still being created, so a
  // username the office has already chosen is never overwritten by a later edit.
  const autoUsername = !form.userId;

  const onMobileChange = (value: string) => {
    const next: Partial<StaffFormState> = { mobileNumber: value };
    if (autoUsername && usesMobile) next.username = usernameFromMobile(value);
    patch(next);
  };

  const onRoleChange = (role: UserRole) => {
    const next: Partial<StaffFormState> = { role };
    if (autoUsername && role !== 'admin') next.username = usernameFromMobile(form.mobileNumber);
    patch(next);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onToast('Please choose an image file for the photo.'); return; }
    setPhotoBusy(true);
    try {
      patch({ photoUrl: await photoDataUrlFromFile(file) });
      onToast('The photo is ready. It is saved with the staff record.');
    } catch {
      onToast('Could not read that image. Please try another.');
    } finally {
      setPhotoBusy(false);
    }
  };

  // A picture taken with the camera arrives in exactly the same shape as one chosen from
  // the device, so it goes into the same field and is saved with the record.
  const takePhoto = (dataUrl: string) => {
    patch({ photoUrl: dataUrl });
    onToast('The photo is ready. It is saved with the staff record.');
  };

  // Picking a file works straight away. If the staff record already exists the file is
  // stored immediately; if not it is held here until the record is created, so nothing
  // has to be saved first.
  const attach = async (docType: StaffDocType, fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setDocsError('');

    const invalid = files.map((file) => documentError(file)).find((message) => message !== null);
    if (invalid) { setDocsError(invalid); return; }

    if (!staffUserId) {
      setPending((current) => [
        ...current,
        ...files.map((file, index) => ({
          key: `${Date.now()}-${index}-${file.name}`,
          docType,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
      onToast(files.length === 1 ? `${files[0].name} is ready to be saved.` : `${files.length} files are ready to be saved.`);
      return;
    }

    setUploading(docType);
    const result = await uploadStaffDocuments(staffUserId, docType, files);
    setUploading(null);
    if (result.documents.length > 0) setDocuments((current) => [...current, ...result.documents]);
    if (result.failed.length > 0) {
      const names = result.failed.join(', ');
      setDocsError(`${names} could not be attached. ${result.error ?? ''}`.trim());
    } else {
      onToast(files.length === 1 ? `${files[0].name} was attached.` : `${files.length} files were attached.`);
    }
  };

  const removePending = (item: PendingStaffDocument) => {
    URL.revokeObjectURL(item.previewUrl);
    setPending((current) => current.filter((entry) => entry.key !== item.key));
  };

  // Sends every held file to the school once the record has an id. Files that fail stay
  // on the list with an explanation, so nothing is lost without the office knowing.
  const flushPending = async (userId: string) => {
    const queued = pending;
    if (queued.length === 0) return;
    setUploading(queued[0].docType);
    const groups = new Map<StaffDocType, PendingStaffDocument[]>();
    queued.forEach((item) => groups.set(item.docType, [...(groups.get(item.docType) ?? []), item]));

    const stored: StaffDocument[] = [];
    const leftover: PendingStaffDocument[] = [];
    const failures: string[] = [];
    let firstError: string | null = null;

    for (const [docType, items] of groups) {
      // A single failure must not discard the pages that did upload, so each file is
      // filed on its own and the ones that failed are reported by name.
      const results = await Promise.all(items.map((item) => uploadStaffDocument(userId, docType, item.file)));
      items.forEach((item, index) => {
        const result = results[index];
        if (result.document) stored.push(result.document);
        else {
          leftover.push(item);
          failures.push(item.file.name);
          if (!firstError && result.error) firstError = result.error;
        }
      });
    }

    setUploading(null);
    setDocuments((current) => [...current, ...stored]);
    setPending(leftover);
    leftover.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    if (failures.length > 0) setDocsError(`${failures.join(', ')} could not be attached. ${firstError ?? ''}`.trim());
  };

  const removeDocument = async (document: StaffDocument) => {
    setDocsError('');
    const result = await deleteStaffDocument(document);
    if (result.error) { setDocsError(result.error); return; }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    onToast(`${document.file_name} was removed.`);
  };

  const goTo = (next: TabKey) => {
    setError('');
    setTab(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = staffFormProblem(form, hasAgreement || isEdit);
    if (problem) {
      setError(problem);
      setTab(problem.includes('agreement') ? 'documents' : 'profile');
      return;
    }
    setBusy(true);
    const { member: saved, error: saveError } = await saveStaffMember(form);
    if (saveError || !saved) {
      setBusy(false);
      saveButton.run(async () => false);
      setError(saveError ?? 'The staff record could not be saved.');
      return;
    }

    // A new record has just been given an id, so the files held in the form are filed
    // against it before the window closes. One save therefore stores the profile, the
    // signed agreement and the rest of the paperwork together.
    if (!form.userId) {
      setForm((current) => ({ ...current, userId: saved.userId }));
      setCreatedMember(saved);
      await flushPending(saved.userId);
    }

    setBusy(false);
    onSaved({
      saved: { ...saved, created: saved.created || Boolean(createdMember) },
      password: form.password,
      phone: cleanPhoneNumber(form.mobileNumber) || null,
    });
  };

  const problem = staffFormProblem(form, hasAgreement || isEdit);
  const phoneProblem = form.mobileNumber.trim() && !isValidWhatsAppNumber(form.mobileNumber)
    ? 'Enter a full number, for example 0300 1234567.'
    : '';
  const cnicTyped = cnicDigits(form.cnic).length;
  const staffCode = member?.staff_code ?? createdMember?.staffCode ?? 'Assigned when saved';

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal staff-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><UserRound size={14} /> {isEdit ? 'Edit staff member' : 'New staff member'}</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{form.userId ? form.fullName || 'Staff member' : 'Add a staff member'}</h2>
        <p className="payroll-modal-sub">
          {form.userId
            ? `${createdMember?.staffCode || member?.staff_code || 'New record'} · ${form.username || 'no username'}`
            : 'Fill in the profile, attach the signed agreement, then set the portal login.'}
        </p>

        <div className="staff-form-tabs" role="tablist">
          {TABS.map(({ key, label, icon: Icon }, index) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`staff-form-tab ${tab === key ? 'active' : ''}`}
              onClick={() => goTo(key)}
            >
              <span className="staff-form-tab-index">{index + 1}</span>
              <Icon size={15} /> {label}
              {key === 'documents' && !hasAgreement && <span className="staff-form-tab-dot" title="Signed agreement not attached" />}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="staff-form-body">
          {tab === 'profile' && (
            <>
              <div className="staff-photo-row">
                <div className="staff-photo-preview">
                  {form.photoUrl
                    ? <img src={form.photoUrl} alt={form.fullName || 'Staff photo'} />
                    : <span>{form.fullName.trim() ? form.fullName.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() : <User size={26} />}</span>}
                </div>
                <div className="staff-photo-actions">
                  <span className="staff-photo-caption">Profile photo</span>
                  <small>Choose a photo from the device, or take one with the camera. It is squared off and shrunk before it is saved.</small>
                  <div className="staff-photo-buttons">
                    <button type="button" className="secondary-button" onClick={() => photoInput.current?.click()} disabled={photoBusy}>
                      {photoBusy
                        ? <><Loader2 size={15} className="auth-spinner" /> Reading…</>
                        : <><ImagePlus size={15} /> Upload photo</>}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setCameraOpen(true)} disabled={photoBusy}>
                      <Camera size={15} /> Use camera
                    </button>
                    {form.photoUrl && (
                      <button type="button" className="secondary-button" onClick={() => patch({ photoUrl: '' })}>
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = ''; }}
                />
                {cameraOpen && (
                  <CameraCaptureModal
                    onCapture={takePhoto}
                    onClose={() => setCameraOpen(false)}
                    onToast={onToast}
                  />
                )}
              </div>

              <div className="staff-form-grid">
                <label className="control-field">
                  Staff ID
                  <input value={staffCode} readOnly disabled />
                </label>
                <label className="control-field">
                  Joining date
                  <input type="date" value={form.joiningDate} onChange={(event) => patch({ joiningDate: event.target.value })} />
                </label>

                <label className="control-field">
                  Full name (English)
                  <input
                    value={form.fullName}
                    onChange={(event) => patch({ fullName: event.target.value })}
                    placeholder="e.g. Ayesha Khan"
                  />
                </label>
                <label className="control-field">
                  Full name (Urdu)
                  <input
                    className="urdu-input"
                    dir="rtl"
                    lang="ur"
                    value={form.fullNameUrdu}
                    onChange={(event) => patch({ fullNameUrdu: event.target.value })}
                    placeholder="مکمل نام"
                  />
                </label>

                <label className="control-field">
                  Marital status
                  <select value={form.maritalStatus} onChange={(event) => patch({ maritalStatus: event.target.value })}>
                    <option value="">Not recorded</option>
                    {MARITAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="control-field">
                  Gender
                  <select value={form.gender} onChange={(event) => patch({ gender: event.target.value })}>
                    <option value="">Not recorded</option>
                    {GENDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>

                <label className="control-field">
                  Relation
                  <select value={form.relationType} onChange={(event) => patch({ relationType: event.target.value })}>
                    {RELATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="control-field">
                  {form.relationType === 'wife' ? 'Husband name' : 'Father name'}
                  <input
                    value={form.fatherName}
                    onChange={(event) => patch({ fatherName: event.target.value })}
                    placeholder="As written on the CNIC"
                  />
                </label>

                <label className="control-field">
                  CNIC no.
                  <input
                    value={form.cnic}
                    onChange={(event) => patch({ cnic: maskCnic(event.target.value) })}
                    placeholder="14301-1234567-1"
                    inputMode="numeric"
                  />
                  {cnicTyped > 0 && cnicTyped !== 13 && <small className="staff-field-hint bad">{cnicTyped}/13 digits</small>}
                </label>
                <label className="control-field">
                  Date of birth
                  <input type="date" value={form.dateOfBirth} onChange={(event) => patch({ dateOfBirth: event.target.value })} />
                </label>

                <label className="control-field">
                  Role
                  <select value={form.role} onChange={(event) => onRoleChange(event.target.value as UserRole)}>
                    {STAFF_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="control-field">
                  Mobile / WhatsApp number
                  <input
                    value={form.mobileNumber}
                    onChange={(event) => onMobileChange(event.target.value)}
                    placeholder="0300 1234567"
                    inputMode="tel"
                  />
                  {phoneProblem
                    ? <small className="staff-field-hint bad">{phoneProblem}</small>
                    : form.mobileNumber.trim() && <small className="staff-field-hint">{formatWhatsAppNumber(form.mobileNumber)} on WhatsApp</small>}
                </label>

                <label className="control-field">
                  Qualification
                  <input
                    value={form.qualification}
                    onChange={(event) => patch({ qualification: event.target.value })}
                    placeholder="e.g. M.A. English, B.Ed."
                  />
                </label>
                <label className="control-field">
                  Previous experience
                  <input
                    value={form.previousExperience}
                    onChange={(event) => patch({ previousExperience: event.target.value })}
                    placeholder="e.g. 4 years at City School"
                  />
                </label>

                <label className="control-field full">
                  Home address
                  <textarea
                    rows={2}
                    value={form.homeAddress}
                    onChange={(event) => patch({ homeAddress: event.target.value })}
                    placeholder="House, street, area, city"
                  />
                </label>
              </div>

              <div className="staff-status-block">
                <span className="staff-status-label">Status</span>
                <div className="segmented-control compact" role="group" aria-label="Staff status">
                  <button type="button" className={form.status === 'active' ? 'selected' : ''} onClick={() => patch({ status: 'active' })}>
                    Active
                  </button>
                  <button
                    type="button"
                    className={form.status !== 'active' ? 'selected' : ''}
                    onClick={() => patch({ status: 'inactive' })}
                  >
                    Inactive
                  </button>
                </div>
                <small className="staff-field-hint">
                  {form.status === 'active'
                    ? 'Working at the school and able to sign in.'
                    : 'Not working at the moment. The record is kept and the sign-in is blocked.'}
                </small>

                {form.status !== 'active' && (
                  <div className="staff-leaving-fields">
                    <label className="control-field">
                      Leaving date
                      <input
                        type="date"
                        value={form.leavingDate}
                        onChange={(event) => patch({ leavingDate: event.target.value })}
                      />
                    </label>
                    <label className="control-field">
                      Leaving reason
                      <input
                        value={form.leavingReason}
                        onChange={(event) => patch({ leavingReason: event.target.value })}
                        placeholder="e.g. Relocated, resigned, contract ended"
                      />
                    </label>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'documents' && (
            <>
              {!staffUserId && (
                <div className="staff-docs-note">
                  <AlertCircle size={15} />
                  <span>Files can be attached right away. They are kept here and filed against the record as soon as the staff member is saved.</span>
                </div>
              )}
              {docsError && <div className="auth-error"><AlertCircle size={16} /><span>{docsError}</span></div>}
              <div className="staff-doc-list">
                {STAFF_DOC_GROUPS.map((group) => {
                  const files = documents.filter((document) => document.doc_type === group.value);
                  const held = pending.filter((item) => item.docType === group.value);
                  const isBusy = uploading === group.value;
                  return (
                    <div className={`staff-doc-row${group.required ? ' required' : ''}`} key={group.value}>
                      <div className="staff-doc-copy">
                        <strong>
                          {group.label}
                          {group.required && <span className="staff-doc-badge">Required</span>}
                        </strong>
                        <small>{group.hint}</small>
                      </div>

                      <div className="staff-doc-files">
                        {docsLoading && <span className="staff-doc-empty">Loading the files on record…</span>}
                        {!docsLoading && files.length === 0 && held.length === 0 && (
                          <span className="staff-doc-empty">Nothing attached yet</span>
                        )}
                        {files.map((document) => (
                          <div className="staff-doc-file" key={document.id}>
                            <FileText size={14} />
                            <span className="staff-doc-name" title={document.file_name}>{document.file_name}</span>
                            <span className="staff-doc-size">{formatSize(document.file_size)}</span>
                            <button
                              type="button"
                              title="View / Preview"
                              onClick={() => setPreview({
                                name: document.file_name,
                                url: document.file_url,
                                isImage: Boolean(document.mime_type?.startsWith('image/')),
                              })}
                            >
                              <Eye size={14} />
                            </button>
                            <button type="button" onClick={() => void removeDocument(document)} title="Remove">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        {held.map((item) => (
                          <div className="staff-doc-file pending" key={item.key}>
                            <FileText size={14} />
                            <span className="staff-doc-name" title={item.file.name}>{item.file.name}</span>
                            <span className="staff-doc-size">{formatSize(item.file.size)}</span>
                            <span className="staff-doc-pending">Saves with the profile</span>
                            <button
                              type="button"
                              title="View / Preview"
                              onClick={() => setPreview({
                                name: item.file.name,
                                url: item.previewUrl,
                                isImage: isPreviewableImage(item.file),
                              })}
                            >
                              <Eye size={14} />
                            </button>
                            <button type="button" onClick={() => removePending(item)} title="Remove">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        className={`staff-doc-upload${isBusy ? ' busy' : ''}`}
                        disabled={isBusy}
                        onClick={() => fileInputs.current[group.value]?.click()}
                      >
                        {isBusy
                          ? <><Loader2 size={15} className="auth-spinner" /> Uploading…</>
                          : <><Upload size={15} /> {files.length + held.length === 0 ? 'Attach file' : 'Attach another'}</>}
                      </button>
                      <input
                        ref={(node) => { fileInputs.current[group.value] = node; }}
                        type="file"
                        accept={DOC_ACCEPT}
                        multiple
                        hidden
                        onChange={(event) => { void attach(group.value, event.target.files); event.target.value = ''; }}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'login' && (
            <>
              <div className="staff-login-grid">
                <label className="control-field">
                  Username
                  <input
                    value={form.username}
                    onChange={(event) => patch({ username: event.target.value })}
                    placeholder="e.g. 03001234567"
                    autoComplete="off"
                  />
                  {usesMobile && suggestedUsername && form.username !== suggestedUsername && (
                    <button type="button" className="staff-inline-link" onClick={() => patch({ username: suggestedUsername })}>
                      Use the mobile number ({suggestedUsername})
                    </button>
                  )}
                </label>
                <label className="control-field">
                  Password
                  <PasswordField
                    value={form.password}
                    onChange={(value) => patch({ password: value })}
                    autoComplete="new-password"
                  />
                  {isEdit && <small className="staff-field-hint">Leave blank to keep the current password.</small>}
                  {!isEdit && form.userId && <small className="staff-field-hint">Leave blank to keep the password set when the record was created.</small>}
                </label>
              </div>

              <button type="button" className="secondary-button self-start" onClick={() => patch({ password: generatePassword() })}>
                <RefreshCw size={15} /> Generate a password
              </button>

              <div className="staff-login-note">
                <ShieldCheck size={15} />
                <span>
                  {usesMobile
                    ? 'This staff member signs in with the mobile number above as their username.'
                    : 'An administrator signs in with a username of their own choosing.'}
                </span>
              </div>

              {isEdit && (
                <p className="staff-tab-note">
                  Changing the password here signs them out of any device they are using, so let them know.
                </p>
              )}
            </>
          )}

          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}

          <div className="notice-preview-actions staff-form-actions">
            <span className={`staff-form-problem${problem ? '' : ' ok'}`}>
              {problem
                ? <><AlertCircle size={14} /> {problem}</>
                : <><BadgeCheck size={14} /> {pending.length > 0 ? `${pending.length} file${pending.length === 1 ? '' : 's'} ready to save` : 'Ready to save'}</>}
            </span>
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            {tab !== 'login' && (
              <button type="button" className="secondary-button" onClick={() => goTo(tab === 'profile' ? 'documents' : 'login')}>
                Next
              </button>
            )}
            <SaveButton
              state={busy ? 'saving' : saveButton.state === 'saved' ? 'saved' : 'idle'}
              label={form.userId ? 'Save changes' : 'Add staff member'}
              disabled={uploading !== null}
            />
          </div>
        </form>
      </section>

      {preview && (
        <div className="staff-preview-overlay" onClick={(event) => { event.stopPropagation(); setPreview(null); }}>
          <div className="staff-preview" onClick={(event) => event.stopPropagation()}>
            <div className="staff-preview-head">
              <strong title={preview.name}>{preview.name}</strong>
              <div className="staff-preview-actions">
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="secondary-button">
                  Open in a new tab
                </a>
                <button type="button" className="close-button" onClick={() => setPreview(null)} aria-label="Close preview">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="staff-preview-body">
              {preview.isImage
                ? <img src={preview.url} alt={preview.name} />
                : <iframe src={preview.url} title={preview.name} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
