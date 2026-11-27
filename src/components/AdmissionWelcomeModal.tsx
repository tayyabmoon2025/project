import { useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { CircleAlert as AlertCircle, Check, Copy, KeyRound, MessageCircle, PartyPopper, Printer, Send, X } from 'lucide-react';
import { whatsappLink } from '@/lib/whatsapp';
import { ADMISSION_SCHOOL_NAME, admissionWelcomeMessage, portalLoginUrl, type AdmissionWelcome } from '@/lib/admissionWelcome';
import { usePrintSheet } from '@/lib/usePrintSheet';

// The popup that follows an admission or a password reset. It shows the message the
// family will receive, with the login details inside it, and lets the office send it on
// WhatsApp, copy it, or print it.
export function AdmissionWelcomeModal({
  welcome,
  noticeError,
  onClose,
  onToast,
}: {
  welcome: AdmissionWelcome;
  noticeError: string | null;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [copied, setCopied] = useState<'message' | 'login' | null>(null);
  const message = admissionWelcomeMessage(welcome);
  const isReset = welcome.credentials?.isReset === true;

  const copyText = async (text: string, what: 'message' | 'login', confirmation: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      onToast(confirmation);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      onToast('Nothing could be copied. Please select the text and copy it manually.');
    }
  };

  const copyMessage = () => copyText(message, 'message', 'The message has been copied');

  // A plain link rather than a click handler, so the browser and any embedded preview
  // treat "Send via WhatsApp" as an ordinary navigation and never block it as a pop-up.
  const waLink = whatsappLink(welcome.whatsappNumber || null, message, 'web');

  const loginBlock = welcome.credentials
    ? [
        `Parent Portal: ${portalLoginUrl()}`,
        `Username: ${welcome.credentials.username}`,
        `Password: ${welcome.credentials.password}`,
      ].join('\n')
    : '';

  // The printed slip is built on its own so only the letterhead, the student facts and the
  // login box reach the printer — never the message preview, the warning banner or the
  // buttons. It is kept short enough to print on half an A4 page.
  const printSheet = usePrintSheet(true, (
    <section className="print-only credentials-slip">
      <header className="credentials-slip-head">
        <SchoolLogo alt="" />
        <div>
          <h1>THE UJALA SCHOOL</h1>
          <p>Parent Portal Credentials</p>
        </div>
      </header>

      <h2 className="credentials-slip-title">
        {isReset ? 'Parent Password Reset — New Login Details' : 'Parent Portal Login Details'}
      </h2>

      <div className="credentials-slip-facts">
        <div><span>Student</span><strong>{welcome.studentName}</strong></div>
        <div><span>Admission No.</span><strong>{welcome.admissionNumber || '—'}</strong></div>
        <div><span>Class</span><strong>Class {welcome.admittedClass}</strong></div>
        <div><span>Guardian</span><strong>{welcome.guardianName}</strong></div>
      </div>

      <div className="credentials-slip-login">
        <strong>Parent Portal login</strong>
        {welcome.credentials ? (
          <>
            <div className="credentials-slip-row"><span>Link</span><code>{portalLoginUrl()}</code></div>
            <div className="credentials-slip-row"><span>Username</span><code>{welcome.credentials.username}</code></div>
            <div className="credentials-slip-row"><span>Password</span><code>{welcome.credentials.password}</code></div>
          </>
        ) : (
          <p className="credentials-slip-empty">
            {welcome.loginNote ?? 'The parent portal login details are not available for this admission.'}
          </p>
        )}
      </div>

      <p className="credentials-slip-foot">
        Issued by the school office on {new Date().toLocaleDateString()}
        {welcome.whatsappDisplay ? ` • WhatsApp ${welcome.whatsappDisplay}` : ''}
      </p>
    </section>
  ));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal admission-welcome-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow">
            {isReset ? <KeyRound size={14} /> : <PartyPopper size={14} />}
            {isReset ? 'Parent password reset' : 'Admission saved'}
          </span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="admission-welcome-title">
          {isReset ? 'Parent Password Reset — Send New Details' : 'Admission Saved — Send Welcome Message'}
        </h2>
        <p className="admission-welcome-intro">
          {isReset
            ? `A new password has been set for the ${welcome.guardianName} portal account of ${welcome.studentName}. Send it to the family, or print a copy for the office.`
            : `${welcome.studentName} has been added to Class ${welcome.admittedClass}. A congratulations notice is already waiting in the parent portal. Send the family their welcome message and sign-in details below.`}
        </p>

        <div className="admission-welcome-facts">
          <div><span>Student</span><strong>{welcome.studentName}</strong></div>
          <div><span>Admission No.</span><strong>{welcome.admissionNumber || '—'}</strong></div>
          <div><span>{isReset ? 'Class' : 'Admitted class'}</span><strong>Class {welcome.admittedClass}</strong></div>
          <div>
            <span>WhatsApp number</span>
            <strong>{welcome.whatsappDisplay || 'Not saved'}</strong>
          </div>
        </div>

        <div className="admission-welcome-login">
          <div className="admission-welcome-login-head">
            <strong>Parent Portal login</strong>
            {welcome.credentials && (
              <button
                type="button"
                className="admission-welcome-copy"
                onClick={() => void copyText(loginBlock, 'login', 'The login details have been copied')}
              >
                {copied === 'login' ? <Check size={13} /> : <Copy size={13} />}
                {copied === 'login' ? 'Copied' : 'Copy details'}
              </button>
            )}
          </div>
          {welcome.credentials ? (
            <>
              <div className="credential-row"><span>Link</span><code>{portalLoginUrl()}</code></div>
              <div className="credential-row"><span>Username</span><code>{welcome.credentials.username}</code></div>
              <div className="credential-row"><span>Password</span><code>{welcome.credentials.password}</code></div>
            </>
          ) : (
            <p className="admission-welcome-empty">
              {welcome.loginNote ?? 'The parent portal login details are not available for this admission.'}
            </p>
          )}
        </div>

        <div className="admission-welcome-preview">
          <span className="admission-welcome-preview-label"><MessageCircle size={13} /> Message preview</span>
          <pre>{message}</pre>
        </div>

        <div className="credentials-note">
          <AlertCircle size={15} />
          <span>
            {isReset
              ? 'The old password stops working straight away, so send this message before closing the window. '
              : noticeError
                ? `The portal notice could not be created (${noticeError}). The admission itself is saved. `
                : `A congratulations notice has been logged in the parent portal for ${welcome.studentName}. `}
            The password is shown only now — copy it before closing this window.
          </span>
        </div>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button type="button" className="secondary-button" onClick={() => void copyMessage()}>
            {copied === 'message' ? <Check size={16} /> : <Copy size={16} />} {copied === 'message' ? 'Copied' : 'Copy Message'}
          </button>
          <a
            className="primary-button whatsapp-send"
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            title={welcome.whatsappNumber ? `Open WhatsApp chat with ${welcome.whatsappDisplay}` : 'Open WhatsApp — no number saved, choose the recipient in WhatsApp'}
          >
            <Send size={16} /> Send via WhatsApp
          </a>
        </div>

        <p className="admission-welcome-school">{ADMISSION_SCHOOL_NAME}</p>
      </section>
      {printSheet}
    </div>
  );
}
