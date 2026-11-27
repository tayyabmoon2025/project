import { SchoolLogo } from '@/components/SchoolLogo';
import { StudentPhoto } from '@/components/StudentPhoto';
import { formatWhatsAppNumber, pickWhatsAppContact } from '@/lib/whatsapp';
import {
  CARD_FILTERS,
  STUDENT_ID_TEMPLATES,
  cardRollNumber,
  formatCardDate,
  templateByKey,
  type CardOrientation,
  type StudentIdTemplate,
} from '@/lib/studentIdCards';
import type { Student } from '@/lib/schoolTypes';

// What every card needs beyond the student record itself. The session and expiry are
// typed once in the toolbar and stamped onto every card in the batch.
export type CardContext = {
  schoolName: string;
  principalName: string;
  session: string;
  expiry: string;
  templateKey: string;
};

const dash = (value: string | null | undefined): string => (value ?? '').trim() || '—';

const fatherName = (student: Student): string => dash(student.fathers_name || student.guardian_name);

const emergencyContact = (student: Student): string => {
  const contact = pickWhatsAppContact(student);
  return dash(contact.number ? formatWhatsAppNumber(contact.raw ?? contact.number) : '');
};

const homeAddress = (student: Student): string => dash(student.current_address || student.permanent_address);

// One card face. The wrapper carries the template key and the orientation, and every
// design restyles this same markup — so a new design is CSS only, never a second copy
// of the card.
function CardFace({ student, context, side }: { student: Student; context: CardContext; side: 'front' | 'back' }) {
  const classLine = `${dash(student.class_name)} · Section ${dash(student.section_name)}`;

  if (side === 'back') {
    return (
      <div className="sic-card sic-back">
        <div className="sic-band sic-band-back">
          <span className="sic-band-copy">
            <strong>{context.schoolName}</strong>
            <small>Student ID Card</small>
          </span>
          <span className="sic-role">Back</span>
        </div>
        <div className="sic-back-rows">
          <p><b>Father&rsquo;s Name</b>{fatherName(student)}</p>
          <p><b>B-Form No.</b>{dash(student.student_form_b)}</p>
          <p><b>Blood Group</b>{dash(student.blood_group)}</p>
          <p><b>Emergency contact</b>{emergencyContact(student)}</p>
          <p><b>Home address</b>{homeAddress(student)}</p>
        </div>
        <div className="sic-back-foot">
          <span className="sic-return">If found, please return to {context.schoolName}.</span>
          <span className="sic-sign">
            <i>{context.principalName || 'Principal'}</i>
            <em>Principal Signature</em>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="sic-card sic-front">
      <div className="sic-band">
        <span className="sic-logo-badge"><SchoolLogo alt={`${context.schoolName} logo`} className="sic-logo" /></span>
        <span className="sic-band-copy">
          <strong>{context.schoolName}</strong>
          <small>Academic Session {context.session}</small>
        </span>
        <span className="sic-role">Student ID</span>
      </div>
      <div className="sic-main">
        <div className="sic-photo-wrap">
          <StudentPhoto src={student.photo_url} name={student.full_name} className="sic-photo" />
        </div>
        <div className="sic-fields">
          <strong className="sic-name">{student.full_name}</strong>
          <span className="sic-class">{classLine}</span>
          <div className="sic-codes">
            <span className="sic-chip">Roll <b>{cardRollNumber(student)}</b></span>
            <span className="sic-chip">Adm <b>{dash(student.admission_number)}</b></span>
          </div>
        </div>
      </div>
      <div className="sic-strip">
        <span className="sic-valid">Valid until <b>{formatCardDate(context.expiry)}</b></span>
        <span className="sic-session">{context.session}</span>
      </div>
    </div>
  );
}

// Front and back as one printable unit. In landscape the two sit side by side; in
// portrait they stack, because two portrait cards will not fit across an A4 column.
export function StudentIdCardPair({ student, context }: { student: Student; context: CardContext }) {
  const template = templateByKey(context.templateKey);
  return (
    <div className={`sic-pair sic-${template.key} sic-${template.orientation}`}>
      <CardFace student={student} context={context} side="front" />
      <CardFace student={student} context={context} side="back" />
    </div>
  );
}

// The click-to-apply gallery. Each thumbnail carries the template's own colours, so the
// six designs can be told apart at a glance before anything is printed.
export function StudentIdGallery({
  value,
  onChange,
  filter,
  onFilterChange,
}: {
  value: string;
  onChange: (key: string) => void;
  filter: 'all' | CardOrientation;
  onFilterChange: (next: 'all' | CardOrientation) => void;
}) {
  const shown = STUDENT_ID_TEMPLATES.filter((template) => filter === 'all' || template.orientation === filter);
  return (
    <div className="sic-gallery-block">
      <div className="segmented-control compact sic-gallery-tabs" role="group" aria-label="Card orientation">
        {CARD_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? 'selected' : ''}
            aria-pressed={filter === option.id}
            onClick={() => onFilterChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="sic-gallery" role="listbox" aria-label="ID card design">
        {shown.map((template) => (
          <button
            key={template.key}
            type="button"
            role="option"
            aria-selected={value === template.key}
            className={`sic-thumb sic-${template.key}${value === template.key ? ' selected' : ''}`}
            onClick={() => onChange(template.key)}
            title={`${template.name} — ${template.blurb}`}
          >
            <span className={`sic-thumb-card sic-thumb-${template.orientation}`}>
              <span className="sic-thumb-band" />
              <span className="sic-thumb-body">
                <span className="sic-thumb-photo" />
                <span className="sic-thumb-lines">
                  <span className="sic-thumb-line" />
                  <span className="sic-thumb-line short" />
                </span>
              </span>
              <span className="sic-thumb-accent" />
            </span>
            <span className="sic-thumb-copy">
              <strong>{template.name}</strong>
              <small>{template.blurb}</small>
            </span>
            <span className="sic-thumb-orient">{template.orientation === 'portrait' ? 'Vertical / Portrait' : 'Horizontal / Landscape'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export type { StudentIdTemplate };
