import { useState } from 'react';
import { AlertCircle, Check, Copy, KeyRound, Printer, X } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import type { PortalCredentials } from '@/lib/portalAccounts';

export function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: PortalCredentials[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const asText = () => credentials
    .map((item) => `${item.fullName}\nUsername: ${item.username}\nPassword: ${item.password}`)
    .join('\n\n');

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(`${SCHOOL_NAME} — portal sign-in details\n\n${asText()}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal credentials-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><KeyRound size={14} /> Portal sign-in details</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="mt-3 text-lg font-bold text-slate-800">
          {credentials.length === 1 ? 'Login created' : `${credentials.length} logins created`}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Share these details with the family or teacher. The password is shown only once — write it down now,
          or reset it later from the account list if it is lost.
        </p>

        <div className="credentials-list">
          {credentials.map((item) => (
            <div className="credential-card" key={item.username}>
              <strong>{item.fullName}</strong>
              <div className="credential-row"><span>Username</span><code>{item.username}</code></div>
              <div className="credential-row"><span>Password</span><code>{item.password}</code></div>
              <div className="credential-row"><span>Account type</span><span className="credential-role">{item.role}</span></div>
            </div>
          ))}
        </div>

        <div className="credentials-note">
          <AlertCircle size={15} />
          <span>The password cannot be looked up again after you close this window. Keep this copy somewhere safe.</span>
        </div>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button type="button" className="secondary-button" onClick={() => void copyAll()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            <Check size={16} /> Done
          </button>
        </div>
      </section>
    </div>
  );
}
