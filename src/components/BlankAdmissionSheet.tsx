import { useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { DECLARATION_ENGLISH, DECLARATION_URDU, type ConsentLanguage } from '@/lib/declaration';
import type { InstitutionProfile } from '@/lib/systemSetup';

// The ruled line a hand fills in. Wide enough to write on, short enough that two fit
// side by side in a printed column.
const BLANK = '_____________________';

// A shorter rule for the two header boxes, where the column is narrow.
const BLANK_SHORT = '___________';

const ADMISSION_ROWS: string[] = [
  'Admission No.', 'Admission Date', 'Admitted in Class', 'Current Class',
  'Section', 'Date of Birth', 'Gender', 'Student Name',
  'Father Name', 'Mother Name', 'Guardian Name', 'Guardian Phone',
  'Student B-Form No.', 'Father CNIC', 'Blood Group', 'Previous School',
  'Last Class', 'TC / SLC No.',
];

const OTHER_ROWS: string[] = [
  'Father Contact No.', 'Messaging Number', 'WhatsApp Number', 'Current Address',
  'Permanent Address', 'Father’s Profession', 'Mother Tongue', 'Nationality',
  'Religion', 'Place of Birth', 'Monthly Tuition Fee', 'Concession',
  'Sibling Discount', 'Actual / Net Tuition Fee',
];

const DOCUMENTS: string[] = ['B-Form', 'Father CNIC', 'Photos', 'SLC'];

// A ready-to-write copy of the admission form: every value is a ruled line, the photo
// is an empty frame, and the school header, labels, document list, consent and
// signatures print exactly as they do on a filled form.
export function BlankAdmissionSheet({ institution, onClose }: { institution: InstitutionProfile | null; onClose: () => void }) {
  const [language, setLanguage] = useState<ConsentLanguage>('English');
  const contactLine = [institution?.address?.trim(), institution?.city?.trim(), institution?.phone?.trim() ? `Phone: ${institution.phone.trim()}` : ''].filter(Boolean).join(' • ');

  const blankRows = (labels: string[]) => labels.map((label) => (
    <div className="print-row" key={label}>
      <span className="print-row-label">{label}</span>
      <span className="print-row-value print-row-blank">{BLANK}</span>
    </div>
  ));

  const sheet = usePrintSheet(true, <section className="print-only print-admission-sheet print-admission-blank" aria-hidden="true">
    <div className="print-sheet-page">
      <header className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          {contactLine && <p className="print-header-contact">{contactLine}</p>}
          <p className="print-header-form">Student Admission Form</p>
        </div>
        <div className="print-header-badge">
          <div>
            <span>Admitted Class</span>
            <strong>{BLANK_SHORT}</strong>
          </div>
          <div>
            <span>Admission No.</span>
            <strong>{BLANK_SHORT}</strong>
          </div>
        </div>
      </header>

      <div className="print-top">
        <div className="print-photo">
          <div className="print-photo-blank">Paste Student Photo</div>
        </div>
        <section className="print-card print-card-admission">
          <h2>Admission Info</h2>
          {blankRows(ADMISSION_ROWS)}
        </section>
      </div>

      <section className="print-card print-card-other">
        <h2>Other Info</h2>
        <div className="print-other-grid">{blankRows(OTHER_ROWS)}</div>
      </section>

      <section className="print-docs">
        <strong className="print-docs-title">Submitted Documents</strong>
        <div className="print-docs-list">
          {DOCUMENTS.map((label) => (
            <div className="print-doc" key={label}>
              <span className="print-doc-box" aria-hidden="true" />
              <span className="print-doc-label">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={`print-foot${language === 'English' ? '' : ' print-foot-wide'}`}>
        <section className="print-declaration">
          <h2>{language === 'Urdu' ? 'Declaration / اقرار نامہ' : 'Declaration'}</h2>
          {language !== 'Urdu' && <p className="print-declaration-en">{DECLARATION_ENGLISH}</p>}
          {language !== 'English' && <p className="print-declaration-ur" dir="rtl" lang="ur">{DECLARATION_URDU}</p>}
        </section>
        <section className="print-office-use">
          <h2>Office Use Only</h2>
          <div className="print-office-grid">
            <div className="print-office-line"><span>Verified By</span></div>
            <div className="print-office-line"><span>Date</span></div>
            <div className="print-office-line"><span>Fee Received</span></div>
            <div className="print-office-line"><span>School Stamp</span></div>
          </div>
        </section>
      </div>

      <div className="print-sign-space" aria-hidden="true" />

      <div className="print-signatures">
        <div className="print-signature"><span>Parent / Guardian Signature</span></div>
        <div className="print-signature"><span>Principal Signature</span></div>
      </div>
    </div>
  </section>);

  return (
    <div className="notice-overlay">
      <section className="notice-preview blank-form-preview">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Blank admission form</span>
            <h2 className="mt-1 text-lg font-bold text-slate-800">Ready-to-write copy</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close blank admission form">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Every answer line is left empty, so a family can complete this copy by hand. The school header, labels, submitted-document boxes, consent and signature lines all print exactly as they do on a filled form, on one A4 page.
        </p>
        <div className="blank-form-language">
          <span className="text-xs font-bold text-slate-600">Declaration language</span>
          <div className="segmented-control compact" role="group" aria-label="Declaration language">
            {(['English', 'Urdu', 'Both'] as const).map((option) => (
              <button key={option} type="button" className={language === option ? 'selected' : ''} aria-pressed={language === option} onClick={() => setLanguage(option)}>{option}</button>
            ))}
          </div>
        </div>
        <div className="notice-preview-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => window.print()}>Print</button>
        </div>
      </section>
      {sheet}
    </div>
  );
}
