import { useEffect, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  CircleAlert as AlertCircle,
  FileBadge2,
  Loader as Loader2,
  Search,
  ShieldQuestion,
  X,
} from 'lucide-react';
import { SchoolLogo } from '@/components/SchoolLogo';
import {
  clearVerificationRequest,
  verifyCertificate,
  type CertificateVerification,
} from '@/lib/certificateVerification';
import { certificateTypeLabel, longDate } from '@/lib/studentCertificates';

type Answer =
  | { kind: 'loading' }
  | { kind: 'verified'; record: CertificateVerification }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

// The page a certificate's QR code opens. It runs before anybody signs in, because the
// person holding the paper — a college clerk, an employer, a board office — has no account
// here. It confirms the certificate and shows the facts the school filed with it, and
// nothing else: no wording, no date of birth, no guardian details.
export function CertificateVerificationPage({ initialNumber, initialCode, onClose }: {
  initialNumber: string;
  initialCode: string;
  onClose: () => void;
}) {
  const [number, setNumber] = useState(initialNumber);
  const [code, setCode] = useState(initialCode);
  const [answer, setAnswer] = useState<Answer>({ kind: 'loading' });

  // A scanned code arrives with both values already filled in, so the answer is looked up
  // straight away. Typing them by hand and pressing the button does the same thing.
  useEffect(() => {
    let active = true;
    setAnswer({ kind: 'loading' });
    void (async () => {
      const result = await verifyCertificate(initialNumber, initialCode);
      if (!active) return;
      if (result.status === 'verified') setAnswer({ kind: 'verified', record: result.record });
      else if (result.status === 'not_found') setAnswer({ kind: 'not_found' });
      else setAnswer({ kind: 'error', message: result.message });
    })();
    return () => { active = false; };
  }, [initialNumber, initialCode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!number.trim() || !code.trim()) return;
    setAnswer({ kind: 'loading' });
    const result = await verifyCertificate(number, code);
    if (result.status === 'verified') setAnswer({ kind: 'verified', record: result.record });
    else if (result.status === 'not_found') setAnswer({ kind: 'not_found' });
    else setAnswer({ kind: 'error', message: result.message });
  };

  const close = () => {
    clearVerificationRequest();
    onClose();
  };

  return (
    <div className="verify-shell">
      <div className="verify-card">
        <header className="verify-head">
          <div className="verify-logo"><SchoolLogo alt="School emblem" /></div>
          <div className="verify-head-copy">
            <span>Certificate verification</span>
            <strong>{answer.kind === 'verified' ? answer.record.school_name : 'SchoolDesk'}</strong>
          </div>
        </header>

        <div className="verify-body">
          {answer.kind === 'loading' && (
            <>
              <div className="verify-badge wait"><Loader2 size={26} className="auth-spinner" /></div>
              <h1 className="verify-title">Checking the certificate…</h1>
              <p className="verify-lede">Reading the school record for certificate {initialNumber}.</p>
            </>
          )}

          {answer.kind === 'verified' && (
            <>
              <div className="verify-badge ok"><BadgeCheck size={30} /></div>
              <h1 className="verify-title">This certificate is genuine</h1>
              <p className="verify-lede">
                It was issued by {answer.record.school_name} and released from the school office. The details below are
                the ones held on the school record.
              </p>

              <div className="verify-rows">
                <div className="verify-row wide">
                  <span>Certificate</span>
                  <strong>{answer.record.title || certificateTypeLabel(answer.record.certificate_type)}</strong>
                  <em>{certificateTypeLabel(answer.record.certificate_type)}</em>
                </div>
                <div className="verify-row">
                  <span>Certificate no.</span>
                  <strong>{answer.record.certificate_number ?? '—'}</strong>
                </div>
                <div className="verify-row">
                  <span>Date of issue</span>
                  <strong>{longDate(answer.record.issued_on) || '—'}</strong>
                </div>
                <div className="verify-row">
                  <span>Issued to</span>
                  <strong>{answer.record.student_name}</strong>
                  {answer.record.admission_number ? <em>Admission no. {answer.record.admission_number}</em> : null}
                </div>
                <div className="verify-row">
                  <span>Class</span>
                  <strong>
                    {answer.record.class_name
                      ? `${answer.record.class_name}${answer.record.section_name ? ` · Section ${answer.record.section_name}` : ''}`
                      : '—'}
                  </strong>
                </div>
              </div>

              <p className="verify-stamp-note">
                <ShieldQuestion size={15} />
                <span>
                  Checked against the school record on {new Date(answer.record.verified_at).toLocaleString()}. A
                  certificate still awaiting the administrator's approval is not confirmed by this page.
                </span>
              </p>
            </>
          )}

          {answer.kind === 'not_found' && (
            <>
              <div className="verify-badge bad"><AlertCircle size={30} /></div>
              <h1 className="verify-title">No certificate matches these details</h1>
              <p className="verify-lede">
                Nothing on the school record matches that certificate number and code. Either one of them was typed
                differently, or the certificate has not been released by the school office. Please check the two values
                printed beside the QR code and try again.
              </p>
            </>
          )}

          {answer.kind === 'error' && (
            <>
              <div className="verify-badge bad"><AlertCircle size={30} /></div>
              <h1 className="verify-title">The school records could not be reached</h1>
              <p className="verify-lede">{answer.message}</p>
            </>
          )}

          <form className="verify-form" onSubmit={(event) => void submit(event)}>
            <div className="verify-form-row">
              <label>
                Certificate number
                <input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  placeholder="TUS-CERT-2026-001"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                Verification code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="verify-actions">
              <button type="submit" className="primary-button" disabled={answer.kind === 'loading' || !number.trim() || !code.trim()}>
                <Search size={16} /> Check the certificate
              </button>
              <button type="button" className="secondary-button" onClick={close}>
                <X size={16} /> Close
              </button>
            </div>
          </form>
        </div>

        <footer className="verify-foot">
          <FileBadge2 size={13} /> Both values are printed beside the QR code at the foot of the certificate. This page
          confirms only that the certificate was issued and released; the school office keeps the full record.
        </footer>
      </div>
    </div>
  );
}
