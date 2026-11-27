import { useEffect, useState } from 'react';
import { AlertCircle, Check, KeyRound, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import { PasswordField } from '@/components/PasswordField';
import {
  generatePassword,
  provisionPortalAccount,
  setAccountPassword,
  usernameFromAdmissionNumber,
  type PortalCredentials,
} from '@/lib/portalAccounts';

// A student signs in with their admission number, so the username follows it automatically.
export function StudentLoginModal({
  student,
  existingUsername,
  onClose,
  onCreated,
  onCreatedLogin,
  onToast,
}: {
  student: Student;
  existingUsername: string | null;
  onClose: () => void;
  onCreated: (username: string) => void;
  onCreatedLogin: (items: PortalCredentials[]) => void;
  onToast: (message: string) => void;
}) {
  const suggested = usernameFromAdmissionNumber(student.admission_number);
  const [username, setUsername] = useState(existingUsername ?? suggested);
  const [password, setPassword] = useState(() => generatePassword());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Look up whether this student already has a login, so the same window both
  // creates a new one and resets an existing one.
  useEffect(() => {
    let active = true;
    supabase
      .from('user_profiles')
      .select('id, username')
      .eq('student_id', student.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const row = data as { id: string; username: string };
        setAccountId(row.id);
        setUsername(row.username);
      });
    return () => { active = false; };
  }, [student.id]);

  const save = async () => {
    setError('');
    const clean = username.trim().toLowerCase();
    if (clean.length < 3) { setError('The username must be at least 3 characters.'); return; }
    if (password.length < 6) { setError('The password must be at least 6 characters.'); return; }
    setBusy(true);

    if (accountId) {
      const { error: resetError } = await setAccountPassword(accountId, password);
      if (resetError) { setError(resetError); setBusy(false); return; }
      onToast(`A new password was set for ${student.full_name}.`);
      onCreatedLogin([{ username: clean, password, fullName: student.full_name, role: 'student' }]);
      setBusy(false);
      onClose();
      return;
    }

    const { error: createError } = await provisionPortalAccount({
      username: clean,
      password,
      fullName: student.full_name,
      role: 'student',
      studentId: student.id,
    });
    if (createError) { setError(createError); setBusy(false); return; }

    onCreated(clean);
    onCreatedLogin([{ username: clean, password, fullName: student.full_name, role: 'student' }]);
    setBusy(false);
    onClose();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><KeyRound size={14} /> Student portal login</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="mt-3 text-lg font-bold text-slate-800">
          {accountId ? 'Reset portal password' : 'Create portal login'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {accountId
            ? `${student.full_name} already has a login. Setting a new password replaces the old one straight away.`
            : `${student.full_name} will sign in with their admission number as the username.`}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <label className="control-field">Username (admission number)
            <input value={username} onChange={(e) => setUsername(e.target.value)} disabled={Boolean(accountId)} />
          </label>

          <label className="control-field">{accountId ? 'New password' : 'Password'}
            <PasswordField value={password} onChange={setPassword} autoComplete="off" />
          </label>

          <button type="button" className="secondary-button self-start" onClick={() => setPassword(generatePassword())}>
            <RefreshCw size={15} /> Suggest another password
          </button>

          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}

          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <Check size={16} />}
              {accountId ? 'Reset password' : 'Create login'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
