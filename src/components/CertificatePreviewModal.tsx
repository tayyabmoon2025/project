import { useEffect, useState } from 'react';
import { CircleAlert as AlertCircle, Copy, MessageCircle, Printer, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { InstitutionProfile } from '@/lib/systemSetup';
import { useSchoolProfile } from '@/lib/schoolProfile';
import { SchoolLetterhead } from '@/components/SchoolLetterhead';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { cleanPhoneNumber, isValidWhatsAppNumber, whatsappLink } from '@/lib/whatsapp';
import {
  certificateMessage,
  certificateTypeLabel,
  longDate,
  shortDate,
  type StaffCertificate,
} from '@/lib/staffCertificates';

// The letterhead: school name, address and phone at the top, the reference number and
// date on the right, the wording in the middle, and the signature and stamp area at the
// foot. The same markup is shown in the preview and sent to the printer, so what the
// office sees is exactly what comes out of the printer.
function CertificateLetterhead({ record, institution }: { record: StaffCertificate; institution: InstitutionProfile | null }) {
  const paragraphs = (record.body ?? '').split(/\n{2,}/).filter((block) => block.trim());

  return (
    <article className="cert-sheet">
      <SchoolLetterhead />

      <div className="cert-sheet-meta">
        <span><b>Reference No.</b> {record.reference_no ?? '—'}</span>
        <span><b>Date of issue</b> {longDate(record.issued_on)}</span>
      </div>

      <h2 className="cert-sheet-title">{certificateTypeLabel(record.certificate_type)}</h2>

      <div className="cert-sheet-body">
        {record.staff_photo_url ? (
          <figure className="cert-sheet-photo">
            <img src={record.staff_photo_url} alt={record.staff_name ?? 'Staff member'} />
            <figcaption>
              <strong>{record.staff_name ?? 'Staff member'}</strong>
              <span>{record.staff_code ?? ''}</span>
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
        <div className="cert-sheet-signature">
          <strong>{institution?.principal_name?.trim() || 'Principal / Director'}</strong>
          <span>Signature &amp; stamp</span>
        </div>
      </footer>
    </article>
  );
}

// The window shown straight after a certificate is issued, and again from the register
// whenever it is reprinted. It carries the print and WhatsApp actions.
export function CertificatePreviewModal({ record, onClose, onToast }: {
  record: StaffCertificate;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const institution = useSchoolProfile();
  const [phone, setPhone] = useState('');

  // The number is read from the staff record when the certificate is opened, so a number
  // that was corrected after issue is still the one used.
  useEffect(() => {
    if (!record.staff_user_id) { setPhone(''); return; }
    void (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('mobile_number')
        .eq('id', record.staff_user_id)
        .maybeSingle();
      setPhone(cleanPhoneNumber((data as { mobile_number: string | null } | null)?.mobile_number));
    })();
  }, [record.staff_user_id]);

  const schoolName = institution?.school_name?.trim() || SCHOOL_NAME;
  const message = certificateMessage(record, schoolName);
  const waLink = whatsappLink(phone || null, message, 'web');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      onToast('The certificate summary was copied.');
    } catch {
      onToast('The summary could not be copied. Please select the text and copy it manually.');
    }
  };

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-certificate-sheet">
      <style>{'@page { size: A4 portrait; margin: 14mm 16mm; }'}</style>
      <CertificateLetterhead record={record} institution={institution} />
    </section>
  ));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal cert-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Printer size={14} /> Certificate ready on the letterhead</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{record.staff_name ?? 'Staff member'}</h2>
        <p className="payroll-modal-sub">
          {certificateTypeLabel(record.certificate_type)} · {record.reference_no ?? '—'} · issued {shortDate(record.issued_on)}
        </p>

        <div className="cert-preview-scroll">
          <CertificateLetterhead record={record} institution={institution} />
        </div>

        <div className="cert-preview-actions">
          <a
            className="primary-button whatsapp-send"
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            title={isValidWhatsAppNumber(phone)
              ? 'Open a WhatsApp chat with this staff member'
              : 'Open WhatsApp — no number saved, choose the recipient in WhatsApp'}
          >
            <MessageCircle size={16} /> Send via WhatsApp
          </a>
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print certificate
          </button>
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            <Copy size={16} /> Copy summary
          </button>
        </div>

        {!isValidWhatsAppNumber(phone) && (
          <p className="cert-preview-note">
            <AlertCircle size={14} /> No usable mobile number is on this staff member's record, so WhatsApp will ask you
            to choose the recipient.
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
