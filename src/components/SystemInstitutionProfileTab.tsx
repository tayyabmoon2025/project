import { useEffect, useRef, useState } from 'react';
import { Building2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { fetchInstitutionProfile, saveInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { setCachedSchoolLogo, prepareLogoFile } from '@/lib/schoolLogo';
import { setCachedSchoolProfile } from '@/lib/schoolProfile';
import { SchoolLogo } from '@/components/SchoolLogo';
import { useAuth } from '@/lib/auth';

export function SystemInstitutionProfileTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [draft, setDraft] = useState<Omit<InstitutionProfile, 'id' | 'updated_at'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingPsra, setUploadingPsra] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const psraInputRef = useRef<HTMLInputElement>(null);

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    const result = await prepareLogoFile(file);
    setUploading(false);
    if ('error' in result) { onToast(result.error); return; }
    patch('logo_url', result.dataUrl);
    onToast('Logo ready — press Save Profile to keep it.');
  };

  // The authority emblem sits in the top-right corner of every printed letterhead. It is
  // shrunk and embedded the same way as the school logo, so it prints without a network
  // request and travels with the document.
  const handlePsraFile = async (file: File | null) => {
    if (!file) return;
    setUploadingPsra(true);
    const result = await prepareLogoFile(file);
    setUploadingPsra(false);
    if ('error' in result) { onToast(result.error); return; }
    patch('psra_logo_url', result.dataUrl);
    onToast('Authority logo ready — press Save Profile to keep it.');
  };

  const load = async () => {
    setLoading(true);
    const result = await fetchInstitutionProfile();
    if (result.profile) {
      const { id: _id, updated_at: _updated, ...rest } = result.profile;
      void _id; void _updated;
      setDraft(rest);
    }
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const patch = (key: keyof NonNullable<typeof draft>, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const submit = async (): Promise<boolean | void> => {
    if (!draft || !draft.school_name.trim()) { onToast('Enter the school name first.'); return false; }
    setSaving(true);
    const error = await saveInstitutionProfile(draft);
    setSaving(false);
    if (error) { onToast(error); return false; }
    setCachedSchoolLogo(draft.logo_url.trim());
    setCachedSchoolProfile({ id: 'default', ...draft, updated_at: new Date().toISOString() });
    onToast('Institution profile saved.');
    return true;
  };

  if (loading) return <p className="fee-empty">Loading institution profile…</p>;
  if (!draft && error) return <div className="fee-alert"><span>{error}</span></div>;

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Institution Profile</span>
          <h2>School Details</h2>
        </div>
        {isAdmin && draft && (
          <AsyncSaveButton label="Save Profile" size={15} disabled={saving} onSave={() => submit()} />
        )}
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {draft && (
        <div className="util-form">
          <div className="logo-preview-card">
            <span className="logo-preview-label">Current logo</span>
            <div className="logo-preview-box">
              <SchoolLogo alt="School logo" className="logo-preview-img" />
            </div>
            <span className="logo-preview-hint">This is the saved logo shown on the navbar, forms and every printed document.</span>
          </div>
          <div className="logo-preview-card">
            <span className="logo-preview-label">Authority logo</span>
            <div className="logo-preview-box">
              {draft.psra_logo_url.trim()
                ? <img src={draft.psra_logo_url} alt="Registration authority logo" className="logo-preview-img" />
                : <ShieldCheck size={22} className="logo-preview-empty" />}
            </div>
            <span className="logo-preview-hint">
              {draft.psra_logo_url.trim()
                ? 'Printed on the right side of certificates under the caption “Registered with PSRA”.'
                : 'Not uploaded yet — certificates will simply leave the right corner of the letterhead empty.'}
            </span>
            {isAdmin && draft.psra_logo_url.trim() && (
              <button type="button" className="secondary-button logo-clear-button" onClick={() => patch('psra_logo_url', '')}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
          <div className="util-form-grid">
            <label className="control-field">School Name
              <input value={draft.school_name} onChange={(e) => patch('school_name', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">School Name (Urdu)
              <input value={draft.school_name_urdu} onChange={(e) => patch('school_name_urdu', e.target.value)} disabled={!isAdmin} dir="rtl" />
            </label>
            <label className="control-field">Principal Name
              <input value={draft.principal_name} onChange={(e) => patch('principal_name', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Established Year
              <input value={draft.established_year} onChange={(e) => patch('established_year', e.target.value)} disabled={!isAdmin} placeholder="e.g. 1995" />
            </label>
            <label className="control-field">Phone
              <input value={draft.phone} onChange={(e) => patch('phone', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Email
              <input value={draft.email} onChange={(e) => patch('email', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Website
              <input value={draft.website} onChange={(e) => patch('website', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Logo URL
              <div className="logo-field-row">
                <input value={draft.logo_url} onChange={(e) => patch('logo_url', e.target.value)} disabled={!isAdmin} placeholder="/New_LOGO_Final.png" />
                {isAdmin && (
                  <>
                    <button type="button" className="secondary-button logo-upload-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      <Upload size={15} /> {uploading ? 'Preparing…' : 'Upload Logo'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="visually-hidden-input"
                      onChange={(e) => { void handleLogoFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
                    />
                  </>
                )}
              </div>
            </label>
            <label className="control-field util-field-wide">Address
              <input value={draft.address} onChange={(e) => patch('address', e.target.value)} disabled={!isAdmin} placeholder="Street, area" />
            </label>
            <label className="control-field">City
              <input value={draft.city} onChange={(e) => patch('city', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Affiliation No.
              <input value={draft.affiliation_no} onChange={(e) => patch('affiliation_no', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field">Registration No.
              <input value={draft.registration_no} onChange={(e) => patch('registration_no', e.target.value)} disabled={!isAdmin} />
            </label>
            <label className="control-field util-field-wide">Authority Logo (PSRA)
              <div className="logo-field-row">
                <input value={draft.psra_logo_url} onChange={(e) => patch('psra_logo_url', e.target.value)} disabled={!isAdmin} placeholder="Upload an image, or paste an image address" />
                {isAdmin && (
                  <>
                    <button type="button" className="secondary-button logo-upload-button" onClick={() => psraInputRef.current?.click()} disabled={uploadingPsra}>
                      <Upload size={15} /> {uploadingPsra ? 'Preparing…' : 'Upload PSRA Logo'}
                    </button>
                    <input
                      ref={psraInputRef}
                      type="file"
                      accept="image/*"
                      className="visually-hidden-input"
                      onChange={(e) => { void handlePsraFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
                    />
                  </>
                )}
              </div>
            </label>
          </div>

          <div className="util-profile-note">
            <Building2 size={15} />
            <span>This profile is used across printed fee statements and certificates wherever school details appear.</span>
          </div>
        </div>
      )}
    </div>
  );
}
