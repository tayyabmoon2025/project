import { useEffect, useState } from 'react';
import { CertificateQrCode } from '@/components/CertificateQrCode';
import { SchoolLogo } from '@/components/SchoolLogo';
import { CircleAlert as AlertCircle, Copy, Lock, MessageCircle, Printer, ShieldCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { certificateVerificationUrl } from '@/lib/certificateVerification';
import type { InstitutionProfile } from '@/lib/systemSetup';
import { useSchoolProfile } from '@/lib/schoolProfile';
import { SchoolLetterhead } from '@/components/SchoolLetterhead';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { isValidWhatsAppNumber, whatsappLink } from '@/lib/whatsapp';
import {
  CERTIFICATE_BORDER_STYLES,
  CERTIFICATE_FONT_STYLES,
  certificateBorderStyle,
  certificateFontStyle,
  certificateMessage,
  certificateTypeLabel,
  longDate,
  shortDate,
  type CertificateBorderStyle,
  type CertificateFontStyle,
  type StudentCertificate,
} from '@/lib/studentCertificates';

// The letterhead: school name, address and phone at the top, the certificate number and
// date on the right, the wording in the middle, and the signature, stamp and verification
// area at the foot. The frame and the typography are chosen when the certificate is issued
// and stored with it, so the preview and the printout always agree. The same markup is
// shown in the preview and sent to the printer, so what the office sees is exactly what
// comes out of the printer.
//
// Two marks are drawn behind and beneath the wording: a very faint school emblem across
// the centre, and a verification code a scanner can read. Both are chosen so they survive
// the printer — the emblem is a real image rather than a CSS background, which the print
// dialog drops when "Background graphics" is switched off, and the code is an SVG.
export function StudentCertificateLetterhead({ record, institution, studentName, studentPhoto, admissionNumber, borderStyle, fontStyle }: {
  record: StudentCertificate;
  institution: InstitutionProfile | null;
  studentName: string;
  studentPhoto?: string | null;
  admissionNumber?: string | null;
  borderStyle?: CertificateBorderStyle;
  fontStyle?: CertificateFontStyle;
}) {
  const border = borderStyle ?? certificateBorderStyle(record.border_style);
  const font = fontStyle ?? certificateFontStyle(record.font_style);
  const paragraphs = (record.body ?? '').split(/\n{2,}/).filter((block) => block.trim());
  const verificationUrl = certificateVerificationUrl(record.certificate_number, record.verification_code);

  return (
    <article className={`cert-sheet student-cert-sheet border-${border} font-${font}`}>
      {border !== 'plain' && (
        <span className="cert-frame" aria-hidden="true"><i /><i /><i /><i /></span>
      )}

      {/* The inner container carries the padding, so the logo, header, number, date and
          wording keep generous whitespace inside the border on screen and on A4 paper. */}
      <div className="cert-sheet-inner" style={{ padding: '32px 38px', boxSizing: 'border-box' }}>

      {/* The watermark sits behind the wording at very low opacity. It is drawn from the
          same image as the letterhead logo, so a school that uploads its own emblem gets
          its own watermark without a second setting. */}
      <SchoolLogo alt="" className="cert-watermark" aria-hidden="true" />

      <SchoolLetterhead />

      <div className="cert-sheet-meta">
        <span><b>Certificate No.</b> {record.certificate_number ?? '—'}</span>
        <span><b>Date of issue</b> {longDate(record.issued_on)}</span>
      </div>

      <h2 className="cert-sheet-title">{record.title || certificateTypeLabel(record.certificate_type)}</h2>

      <div className="cert-sheet-body">
        {studentPhoto ? (
          <figure className="cert-sheet-photo">
            <img src={studentPhoto} alt={studentName} />
            <figcaption>
              <strong>{studentName}</strong>
              <span>{admissionNumber ?? ''}</span>
            </figcaption>
          </figure>
        ) : null}
        {paragraphs.map((block, index) => (
          <p key={index} className={index === 0 && block.trim().toUpperCase() === block.trim() ? 'cert-sheet-salutation' : ''}>
            {block}
          </p>
        ))}
      </div>

      <footer className="cert-sheet-foot">
        <div className="cert-sheet-stamp">
          <span>School stamp</span>
        </div>
        {verificationUrl ? (
          <CertificateQrCode
            url={verificationUrl}
            number={record.certificate_number}
            code={record.verification_code ?? null}
          />
        ) : (
          <p className="cert-qr-empty">
            <ShieldCheck size={13} /> The verification code is added when the certificate is filed.
          </p>
        )}
        <div className="cert-sheet-signature">
          <strong>{institution?.principal_name?.trim() || 'Principal / Director'}</strong>
          <span>Signature &amp; stamp</span>
        </div>
      </footer>
      </div>
    </article>
  );
}

// The Border Style bar and the Font Style dropdown. Changing either redraws the preview
// straight away and is carried into the printout.
export function StudentCertificateStylePicker({ border, font, onBorder, onFont }: {
  border: CertificateBorderStyle;
  font: CertificateFontStyle;
  onBorder: (value: CertificateBorderStyle) => void;
  onFont: (value: CertificateFontStyle) => void;
}) {
  return (
    <div className="cert-style-bar">
      <div className="cert-style-block">
        <span className="cert-style-label">Border style</span>
        <div className="cert-border-options">
          {CERTIFICATE_BORDER_STYLES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`cert-border-option border-${option.value}${border === option.value ? ' selected' : ''}`}
              onClick={() => onBorder(option.value)}
              title={option.hint}
            >
              <span className="cert-border-swatch" aria-hidden="true">
                <span className="cert-frame"><i /><i /><i /><i /></span>
              </span>
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
      </div>

      <label className="cert-style-block cert-font-block">
        <span className="cert-style-label">Font style</span>
        <select value={font} onChange={(event) => onFont(event.target.value as CertificateFontStyle)}>
          {CERTIFICATE_FONT_STYLES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <small>{CERTIFICATE_FONT_STYLES.find((option) => option.value === font)?.hint}</small>
      </label>
    </div>
  );
}

// The window shown straight after a certificate is issued, and again from the register
// whenever it is reprinted. Print is always available to the office; the WhatsApp button
// appears only once the certificate has been released, so a certificate that is still
// awaiting approval cannot reach a family through this screen.
export function StudentCertificatePreviewModal({
  record,
  studentName,
  studentPhoto,
  admissionNumber,
  showWhatsApp = true,
  borderStyle,
  fontStyle,
  onClose,
  onToast,
}: {
  record: StudentCertificate;
  studentName: string;
  studentPhoto?: string | null;
  admissionNumber?: string | null;
  // The office shares a certificate on WhatsApp; a family opening their own copy only
  // needs to read and print it.
  showWhatsApp?: boolean;
  // The frame and typography chosen on the issuing screen. A reprint from the register and
  // a family's own copy fall back to what was saved with the certificate.
  borderStyle?: CertificateBorderStyle;
  fontStyle?: CertificateFontStyle;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const institution = useSchoolProfile();
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!showWhatsApp || !record.student_id) { setPhone(''); return; }
    void (async () => {
      const { data } = await supabase
        .from('school_students')
        .select('guardian_phone, whatsapp_number, father_contact_number, messaging_number, mother_number')
        .eq('id', record.student_id)
        .maybeSingle();
      const row = data as Record<string, string | null> | null;
      const candidates = [
        row?.whatsapp_number, row?.guardian_phone, row?.father_contact_number,
        row?.messaging_number, row?.mother_number,
      ];
      setPhone((candidates.find((value) => isValidWhatsAppNumber(value)) ?? candidates[0] ?? '') || '');
    })();
  }, [record.student_id, showWhatsApp]);

  const schoolName = institution?.school_name?.trim() || SCHOOL_NAME;
  const message = certificateMessage(record, studentName, schoolName);
  const waLink = whatsappLink(phone || null, message, 'web');
  const released = record.approval_status === 'approved';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      onToast('The certificate summary was copied.');
    } catch {
      onToast('The summary could not be copied. Please select the text and copy it manually.');
    }
  };

  const letterhead = (
    <StudentCertificateLetterhead
      record={record}
      institution={institution}
      studentName={studentName}
      studentPhoto={studentPhoto}
      admissionNumber={admissionNumber}
      borderStyle={borderStyle}
      fontStyle={fontStyle}
    />
  );

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-certificate-sheet">
      <style>{'@page { size: A4 portrait; margin: 12mm 14mm; }'}</style>
      {letterhead}
    </section>
  ));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal cert-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Printer size={14} /> Certificate ready on the letterhead</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{studentName}</h2>
        <p className="payroll-modal-sub">
          {record.title || certificateTypeLabel(record.certificate_type)} · {record.certificate_number ?? '—'} · issued {shortDate(record.issued_on)}
        </p>

        {released ? (
          <p className="cert-release-note released">
            <ShieldCheck size={15} /> Released to the family portals. Parents and students can see and download this certificate.
          </p>
        ) : (
          <p className="cert-release-note pending">
            <Lock size={15} /> Awaiting admin approval. This certificate is hidden from the parent, student, teacher and
            accountant portals until an administrator releases it.
          </p>
        )}

        <div className="cert-preview-scroll">
          {letterhead}
        </div>

        <div className="cert-preview-actions">
          {showWhatsApp && (released ? (
            <a
              className="primary-button whatsapp-send"
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              title={isValidWhatsAppNumber(phone)
                ? 'Open a WhatsApp chat with the parent or guardian'
                : 'Open WhatsApp — no number saved, choose the recipient in WhatsApp'}
            >
              <MessageCircle size={16} /> Send via WhatsApp
            </a>
          ) : (
            <button
              type="button"
              className="primary-button whatsapp-send"
              disabled
              title="Approve the certificate before sending it to the family"
            >
              <Lock size={16} /> WhatsApp locked until approved
            </button>
          ))}
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print A4
          </button>
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            <Copy size={16} /> Copy summary
          </button>
        </div>

        {showWhatsApp && released && !isValidWhatsAppNumber(phone) && (
          <p className="cert-preview-note">
            <AlertCircle size={14} /> No usable mobile number is on this student's record, so WhatsApp will ask you to
            choose the recipient.
          </p>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        </div>
      </section>
      {printSheet}
    </div>
  );
}
