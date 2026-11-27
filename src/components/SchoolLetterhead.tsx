import type { ReactNode } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME, SCHOOL_NAME_UR } from '@/lib/noticeText';
import { profileContactLine, profileRegistrationLine, useSchoolProfile } from '@/lib/schoolProfile';

type SchoolLetterheadProps = {
  // Dense sheets (report cards, roll number slips) pass 'compact' so the header takes
  // less vertical room and leaves the page to the table underneath.
  variant?: 'document' | 'compact';
  // Most documents print the school's own name, but a few replace it with the document
  // title, so the name is overridable.
  schoolName?: string;
  schoolNameUrdu?: string;
  // The document's own title — "Fee Challan", "Acknowledgment Receipt" — printed under
  // the school's details rather than replacing them.
  title?: string;
  // A document reference at the far right — a receipt number, a due date, a report
  // period. It sits past the authority logo, so the school's own details stay in the
  // middle of the page.
  badge?: ReactNode;
  // Sheets that call the printer as soon as the page is ready need to know the logo has
  // actually loaded, or the receipt comes out with an empty corner.
  onLogoReady?: () => void;
  className?: string;
};

// The official letterhead: the school logo on the left, the school's details in the middle
// and the registration authority's emblem on the right. Every printed document in the app
// uses this one component, so a change made once in School Settings appears on all of them.
export function SchoolLetterhead({
  variant = 'document',
  schoolName,
  schoolNameUrdu,
  title,
  badge,
  onLogoReady,
  className = '',
}: SchoolLetterheadProps) {
  const profile = useSchoolProfile();

  const name = schoolName?.trim() || profile?.school_name?.trim() || SCHOOL_NAME;
  const urduName = schoolNameUrdu?.trim() || profile?.school_name_urdu?.trim() || SCHOOL_NAME_UR;
  const contact = profileContactLine(profile);
  const registration = profileRegistrationLine(profile);
  const authorityLogo = profile?.psra_logo_url?.trim() ?? '';

  const classes = [
    'letterhead',
    variant === 'compact' ? 'letterhead-compact' : '',
    badge ? 'letterhead-has-badge' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <header className={classes}>
      <SchoolLogo alt="" className="letterhead-logo" onLoad={onLogoReady} />

      <div className="letterhead-copy">
        <h1 className="letterhead-name">{name}</h1>
        {urduName ? <p className="letterhead-urdu" dir="rtl">{urduName}</p> : null}
        {contact ? <p className="letterhead-contact">{contact}</p> : null}
        {registration ? <p className="letterhead-registration">{registration}</p> : null}
        {title ? <p className="letterhead-title">{title}</p> : null}
      </div>

      {authorityLogo ? (
        <div className="letterhead-authority">
          <img src={authorityLogo} alt="Registration authority" className="letterhead-authority-logo" />
          <span className="letterhead-authority-caption">Registered with PSRA</span>
        </div>
      ) : (
        <span className="letterhead-slot" aria-hidden="true" />
      )}

      {badge ? <div className="letterhead-badge">{badge}</div> : null}
    </header>
  );
}
