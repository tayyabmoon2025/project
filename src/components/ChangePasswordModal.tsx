import { useState, type FormEvent } from 'react';
import { AlertCircle, KeyRound, Loader2, X } from 'lucide-react';
import { changeOwnPassword } from '@/lib/portalAccounts';
import { PasswordField } from '@/components/PasswordField';

export function ChangePasswordModal({
  onClose,
  onToast,
}: {
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);

    const { error: updateError } = await changeOwnPassword(newPassword);
    if (updateError) { setError(updateError); setBusy(false); return; }

    onToast('Your password has been updated.');
    onClose();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><KeyRound size={14} /> Change password</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Change your password</h2>
        <p className="mt-1 text-sm text-slate-500">Choose a new password to replace the temporary one.</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="control-field">New password
            <PasswordField
              value={newPassword}
              onChange={setNewPassword}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </label>
          <label className="control-field">Confirm new password
            <PasswordField
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter the new password"
              autoComplete="new-password"
            />
          </label>
          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <KeyRound size={16} />} Update password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
