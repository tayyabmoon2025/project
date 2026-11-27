import { useEffect, useState, type FormEvent } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Lock, User as UserIcon, AlertCircle, Loader2, Shield, Check, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { PasswordField } from '@/components/PasswordField';
import { requestPasswordReset } from '@/lib/portalAccounts';

type Panel = 'signin' | 'bootstrap' | 'forgot';

export function AuthPage() {
  const { signIn, bootstrapAdmin } = useAuth();
  const [panel, setPanel] = useState<Panel>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Bootstrap admin state
  const [bsUsername, setBsUsername] = useState('');
  const [bsPassword, setBsPassword] = useState('');
  const [bsFullName, setBsFullName] = useState('');
  const [bsError, setBsError] = useState('');
  const [bsBusy, setBsBusy] = useState(false);

  // Forgot password state
  const [fpUsername, setFpUsername] = useState('');
  const [fpNote, setFpNote] = useState('');
  const [fpError, setFpError] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpSent, setFpSent] = useState(false);

  // Check whether any administrator exists yet; the setup form only appears when none does.
  useEffect(() => {
    supabase.rpc('bootstrap_check').then(({ data }) => {
      if (data === true) setPanel((current) => (current === 'signin' ? 'bootstrap' : current));
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const { error: err } = await signIn(username.trim(), password);
    if (err) setError(err);
    setBusy(false);
  };

  const bootstrapSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBsError('');
    if (bsPassword.length < 6) { setBsError('Password must be at least 6 characters.'); return; }
    if (bsUsername.trim().length < 3) { setBsError('Username must be at least 3 characters.'); return; }
    setBsBusy(true);

    const { error: createError } = await bootstrapAdmin(
      bsUsername.trim().toLowerCase(),
      bsPassword,
      bsFullName.trim(),
    );

    if (createError) {
      setBsError(createError);
      setBsBusy(false);
      return;
    }

    const { error: signInError } = await signIn(bsUsername.trim(), bsPassword);
    if (signInError) {
      setBsError('Admin account created. Please sign in with your username and password.');
      setPanel('signin');
    }
    setBsBusy(false);
  };

  const forgotSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFpError('');
    if (fpUsername.trim().length < 3) { setFpError('Please enter the username you sign in with.'); return; }
    setFpBusy(true);
    const { error: sendError } = await requestPasswordReset(fpUsername, fpNote);
    setFpBusy(false);
    if (sendError) { setFpError(sendError); return; }
    setFpSent(true);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark"><SchoolLogo alt="SchoolDesk logo" /></div>
          <h1>{SCHOOL_NAME}</h1>
          <p>School management portal</p>
        </div>

        {panel === 'signin' && (
          <>
            <form onSubmit={submit} className="auth-form">
              <label className="auth-field">
                <span>Username</span>
                <div className="auth-input-wrap">
                  <UserIcon size={17} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    required
                    autoComplete="username"
                  />
                </div>
              </label>

              <label className="auth-field">
                <span>Password</span>
                <div className="auth-input-wrap">
                  <Lock size={17} />
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                </div>
              </label>

              {error && (
                <div className="auth-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? <Loader2 size={18} className="auth-spinner" /> : null}
                Sign in
              </button>

              <button
                type="button"
                className="auth-switch auth-switch-inline"
                onClick={() => { setPanel('forgot'); setFpUsername(username); setFpError(''); setFpSent(false); }}
              >
                Forgot your password?
              </button>
            </form>

            <p className="auth-hint">
              Teachers, parents and students: ask the school office if you have not received your login yet.
            </p>
          </>
        )}

        {panel === 'forgot' && (
          <form onSubmit={forgotSubmit} className="auth-form">
            <div className="auth-bootstrap-header">
              <Lock size={18} />
              <span>Forgot your password</span>
            </div>

            {fpSent ? (
              <div className="auth-success">
                <Check size={16} />
                <span>
                  Your request has been sent to the school office. Someone will set a new password for you and tell you
                  what it is.
                </span>
              </div>
            ) : (
              <>
                <p className="auth-panel-note">
                  Enter your username and the office will set a new password for you. Passwords are never shown to
                  anyone else.
                </p>
                <label className="auth-field">
                  <span>Username</span>
                  <div className="auth-input-wrap">
                    <UserIcon size={17} />
                    <input
                      type="text"
                      value={fpUsername}
                      onChange={(e) => setFpUsername(e.target.value)}
                      placeholder="Enter your username"
                      required
                      autoComplete="username"
                    />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Message for the office (optional)</span>
                  <div className="auth-input-wrap">
                    <input
                      type="text"
                      value={fpNote}
                      onChange={(e) => setFpNote(e.target.value)}
                      placeholder="e.g. I am the parent of Class 5-B student"
                    />
                  </div>
                </label>
                {fpError && <div className="auth-error"><AlertCircle size={16} /><span>{fpError}</span></div>}
                <button type="submit" className="auth-submit" disabled={fpBusy}>
                  {fpBusy ? <Loader2 size={18} className="auth-spinner" /> : null}
                  Send reset request
                </button>
              </>
            )}

            <button type="button" className="auth-switch" onClick={() => setPanel('signin')}>
              <ArrowLeft size={14} /> Back to sign in
            </button>
          </form>
        )}

        {panel === 'bootstrap' && (
          <form onSubmit={bootstrapSubmit} className="auth-form">
            <div className="auth-bootstrap-header">
              <Shield size={18} />
              <span>Create the first administrator</span>
            </div>
            <label className="auth-field">
              <span>Admin username</span>
              <div className="auth-input-wrap">
                <UserIcon size={17} />
                <input
                  type="text"
                  value={bsUsername}
                  onChange={(e) => setBsUsername(e.target.value)}
                  placeholder="e.g. admin"
                  required
                  autoComplete="username"
                />
              </div>
            </label>
            <label className="auth-field">
              <span>Full name</span>
              <div className="auth-input-wrap">
                <UserIcon size={17} />
                <input
                  type="text"
                  value={bsFullName}
                  onChange={(e) => setBsFullName(e.target.value)}
                  placeholder="Administrator full name"
                  required
                />
              </div>
            </label>
            <label className="auth-field">
              <span>Password</span>
              <div className="auth-input-wrap">
                <Lock size={17} />
                <PasswordField
                  value={bsPassword}
                  onChange={setBsPassword}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
              </div>
            </label>
            {bsError && (
              <div className="auth-error"><AlertCircle size={16} /><span>{bsError}</span></div>
            )}
            <button type="submit" className="auth-submit" disabled={bsBusy}>
              {bsBusy ? <Loader2 size={18} className="auth-spinner" /> : <Shield size={16} />} Create admin account
            </button>
            <button type="button" className="auth-switch" onClick={() => { setPanel('signin'); setBsError(''); }}>
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
