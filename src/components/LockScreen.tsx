import { useEffect, useState, type FormEvent } from 'react';
import { Lock, Unlock } from 'lucide-react';

const PIN_KEY = 'schooldesk_screen_pin';

async function hashPin(pin: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const data = new TextEncoder().encode(`schooldesk:${pin}`);
      const buffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fall through to the plain fallback when the API is unavailable.
  }
  return `plain:${pin}`;
}

function getStoredPin(): string | null {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function setStoredPin(hash: string) {
  try {
    localStorage.setItem(PIN_KEY, hash);
  } catch {
    // Locking still works for this session if storage is unavailable.
  }
}

function clearStoredPin() {
  try {
    localStorage.removeItem(PIN_KEY);
  } catch {
    // Ignore.
  }
}

export function LockScreen({
  fullName,
  onUnlock,
  onSignOut,
}: {
  fullName: string;
  onUnlock: () => void;
  onSignOut: () => void;
}) {
  const [mode, setMode] = useState<'create' | 'confirm' | 'unlock'>('unlock');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(getStoredPin() ? 'unlock' : 'create');
  }, []);

  const isUnlock = mode === 'unlock';
  const title = isUnlock ? 'Screen locked' : mode === 'create' ? 'Set a screen PIN' : 'Confirm your PIN';
  const description = isUnlock
    ? 'Enter your PIN to return to your work.'
    : mode === 'create'
      ? 'Choose a 4 to 8 digit PIN. You’ll use it to unlock this screen.'
      : 'Enter the same PIN once more to confirm.';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (mode === 'create') {
      if (pin.length < 4) {
        setError('Use at least 4 digits for your PIN.');
        return;
      }
      setConfirmPin('');
      setMode('confirm');
      return;
    }

    if (mode === 'confirm') {
      if (confirmPin !== pin) {
        setError('The PINs do not match. Start again.');
        setPin('');
        setConfirmPin('');
        setMode('create');
        return;
      }
      setBusy(true);
      setStoredPin(await hashPin(pin));
      setBusy(false);
      setPin('');
      setConfirmPin('');
      onUnlock();
      return;
    }

    if (!pin) {
      setError('Enter your PIN to continue.');
      return;
    }

    setBusy(true);
    const hash = await hashPin(pin);
    const stored = getStoredPin();
    setBusy(false);

    if (stored && stored === hash) {
      setPin('');
      onUnlock();
      return;
    }

    setError('Incorrect PIN. Please try again.');
    setPin('');
  }

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 8);

  return (
    <div className="screen-lock" role="dialog" aria-modal="true" aria-label={title}>
      <div className="screen-lock-card">
        <div className="screen-lock-icon" aria-hidden="true">
          {isUnlock ? <Lock size={22} /> : <Unlock size={22} />}
        </div>
        <h2>{title}</h2>
        {fullName ? <p className="screen-lock-greeting">{fullName}</p> : null}
        <p className="screen-lock-desc">{description}</p>
        <form onSubmit={handleSubmit}>
          <input
            className="screen-lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            autoFocus
            placeholder="••••"
            aria-label="PIN"
            value={isUnlock || mode === 'create' ? pin : confirmPin}
            onChange={(event) => {
              const value = digits(event.target.value);
              if (isUnlock || mode === 'create') setPin(value);
              else setConfirmPin(value);
            }}
          />
          {error ? <p className="screen-lock-error">{error}</p> : null}
          <button className="screen-lock-submit" type="submit" disabled={busy}>
            {busy ? 'Checking…' : isUnlock ? 'Unlock' : mode === 'create' ? 'Continue' : 'Confirm'}
          </button>
        </form>
        {isUnlock ? (
          <button
            className="screen-lock-forgot"
            type="button"
            onClick={() => {
              clearStoredPin();
              onSignOut();
            }}
          >
            Forgot your PIN? Sign out
          </button>
        ) : null}
      </div>
    </div>
  );
}
