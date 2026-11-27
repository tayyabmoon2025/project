import { useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { CircleAlert as AlertCircle, Check, Copy, KeyRound, MessageCircle, Printer, X } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { isValidWhatsAppNumber, whatsappLink } from '@/lib/whatsapp';
import { staffLoginLink, type SavedStaffMember } from '@/lib/staffProfile';
import { usePrintSheet } from '@/lib/usePrintSheet';

// The login details are shown once, right after the account is created. The slip is a
// half-A4 page so it can be handed to the staff member and kept in a drawer.
export function StaffCredentialsModal({ member, password, phone, onClose, onToast }: {
  member: SavedStaffMember;
  password: string;
  phone: string | null;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = staffLoginLink();
  const message = [
    `${SCHOOL_NAME} — staff portal sign-in`,
    `${member.fullName}`,
    `Login link: ${link}`,
    `Username: ${member.username}`,
    `Password: ${password}`,
    'Please keep these details private.',
  ].join('\n');
  const canWhatsApp = isValidWhatsAppNumber(phone);
  const waHref = whatsappLink(phone, message, 'web');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      onToast('The sign-in details were copied.');
    } catch {
      onToast('Could not copy automatically. Please write the details down.');
    }
  };

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-staff-slip">
      <style>{'@page { size: A5 portrait; margin: 8mm; }'}</style>
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Staff portal sign-in slip</p>
        </div>
      </div>

      <div className="print-slip-body">
        {member.photoUrl && (
          <div className="print-slip-photo">
            <img src={member.photoUrl} alt={member.fullName} />
          </div>
        )}
        <div className="print-row"><span className="print-row-label">Staff member</span><span className="print-row-value">{member.fullName}</span></div>
        <div className="print-row"><span className="print-row-label">Staff ID</span><span className="print-row-value">{member.staffCode || '—'}</span></div>
        <div className="print-row"><span className="print-row-label">Role</span><span className="print-row-value">{member.role}</span></div>
        <div className="print-row"><span className="print-row-label">Login link</span><span className="print-row-value">{link}</span></div>
        <div className="print-row"><span className="print-row-label">Username</span><span className="print-row-value">{member.username}</span></div>
        <div className="print-row"><span className="print-row-label">Password</span><span className="print-row-value">{password}</span></div>
        <div className="print-row"><span className="print-row-label">Issued on</span><span className="print-row-value">{new Date().toLocaleDateString()}</span></div>
      </div>

      <p className="print-slip-note">
        Keep this slip private. Open the login link, enter the username and password above, and change the
        password from the profile menu after the first sign-in.
      </p>

      <div className="print-signatures">
        <div className="print-signature"><span>Issued By</span></div>
        <div className="print-signature"><span>Received By</span></div>
      </div>
    </section>
  ));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal credentials-modal staff-credentials-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><KeyRound size={14} /> Staff portal credentials</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{member.fullName}</h2>
        <p className="payroll-modal-sub">{member.staffCode || 'New staff member'} · {member.role}</p>

        <div className="credentials-list">
          <div className="credential-card">
            <div className="credential-row"><span>Login link</span><code className="credential-link">{link}</code></div>
            <div className="credential-row"><span>Username</span><code>{member.username}</code></div>
            <div className="credential-row"><span>Password</span><code>{password}</code></div>
          </div>
        </div>

        <div className="credentials-note">
          <AlertCircle size={15} />
          <span>The password cannot be looked up again after you close this window. Print the slip, or send it on WhatsApp now.</span>
        </div>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print slip
          </button>
          {canWhatsApp ? (
            <a className="primary-button whatsapp-button" href={waHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={16} /> Send on WhatsApp
            </a>
          ) : (
            <span className="staff-credentials-nophone">
              No mobile number on record, so the details cannot be sent on WhatsApp.
            </span>
          )}
        </div>
      </section>
      {printSheet}
    </div>
  );
}
