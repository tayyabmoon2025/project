import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Download, Loader as Loader2, Printer, UserRound, Users, X } from 'lucide-react';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { useClassOptions, useSectionOptions, withCurrent } from '@/lib/classSections';
import { useSchoolLogo } from '@/lib/schoolLogo';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { compareRoster } from '@/lib/studentRoll';
import {
  formatCardDate,
  rememberCardSettings,
  storedAcademicSession,
  storedCardExpiry,
  storedCardTemplate,
  templateByKey,
  type CardOrientation,
} from '@/lib/studentIdCards';
import { StudentIdCardPair, StudentIdGallery, type CardContext } from '@/components/StudentIdCard';
import type { Student } from '@/lib/schoolTypes';

// The printable batch of student ID cards. Cards are drawn at the exact CR80 size, two
// to a row, so a class set prints on A4 and cuts down to standard PVC holders.
export function StudentIdCardGenerator({ students, onClose, onToast }: { students: Student[]; onClose: () => void; onToast: (message: string) => void }) {
  const classNames = useClassOptions();
  const sectionNames = useSectionOptions();

  const [className, setClassName] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [singleId, setSingleId] = useState('');
  const [templateKey, setTemplateKey] = useState(storedCardTemplate);
  const [orientationFilter, setOrientationFilter] = useState<'all' | CardOrientation>('all');
  const [session, setSession] = useState(storedAcademicSession);
  const [expiry, setExpiry] = useState(storedCardExpiry);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // The logo is warmed here so it is already decoded by the time the sheet is printed;
  // the print sheet itself reads the shared cached copy.
  useSchoolLogo();

  useEffect(() => {
    let cancelled = false;
    void fetchInstitutionProfile().then((result) => {
      if (cancelled) return;
      setInstitution(result.profile);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    rememberCardSettings({ session, expiry, templateKey });
  }, [session, expiry, templateKey]);

  const classOptions = useMemo(() => withCurrent(classNames, className), [classNames, className]);
  const sectionOptions = useMemo(() => ['All sections', ...withCurrent(sectionNames, sectionName)], [sectionNames, sectionName]);

  // Only children on the current roll get a card.
  const roster = useMemo(
    () => students.filter((student) => student.status === 'active').sort(compareRoster),
    [students],
  );

  const scoped = useMemo(() => {
    if (singleId) return roster.filter((student) => student.id === singleId);
    return roster.filter((student) => (
      (!className || student.class_name === className)
      && (!sectionName || student.section_name === sectionName)
    ));
  }, [roster, singleId, className, sectionName]);

  const schoolName = institution?.school_name?.trim() || SCHOOL_NAME;
  const context: CardContext = {
    schoolName,
    principalName: institution?.principal_name?.trim() ?? '',
    session: session.trim() || '—',
    expiry,
    templateKey,
  };
  const template = templateByKey(templateKey);

  // Only the cards actually on screen are laid out for printing, so a preview of one
  // child never prints the whole class.
  const printSheet = usePrintSheet(scoped.length > 0, (
    <section className="print-only print-student-id-sheet">
      <style>{`@page { size: A4 portrait; margin: 8mm; }`}</style>
      <header className="sic-print-head">
        <h1>{schoolName} — Student ID Cards</h1>
        <p>
          Academic Session {context.session} · Valid until {formatCardDate(context.expiry)} · {scoped.length} card{scoped.length === 1 ? '' : 's'} · {template.name}
        </p>
      </header>
      <div className="sic-sheet">
        {scoped.map((student) => <StudentIdCardPair key={student.id} student={student} context={context} />)}
      </div>
    </section>
  ));

  const printCards = () => {
    if (scoped.length === 0) { onToast('No student is selected, so there is nothing to print.'); return; }
    window.print();
  };

  const exportPdf = () => {
    if (scoped.length === 0) { onToast('No student is selected, so there is nothing to export.'); return; }
    onToast('In the print window, choose "Save as PDF" as the destination to download the cards');
    window.print();
  };

  return (
    <div className="notice-overlay">
      <section className="notice-modal sic-modal">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow"><CreditCard size={14} /> Students · ID cards</span>
            <h2 className="mt-2 text-lg font-bold text-slate-800">Printable student ID card generator</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cards are drawn at the international CR80 size — 85.6 mm × 54 mm horizontal, 54 mm × 85.6 mm vertical —
              so a printed card fits a PVC holder or lamination pouch without trimming.
            </p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close ID card generator"><X size={18} /></button>
        </div>

        <div className="sic-controls">
          <label className="control-field">Academic session
            <input value={session} onChange={(event) => setSession(event.target.value)} placeholder="2026-2027" />
          </label>
          <label className="control-field">Valid until / expiry date
            <input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </label>
          <label className="control-field">Class
            <select value={className} onChange={(event) => { setClassName(event.target.value); setSingleId(''); }}>
              <option value="">All classes</option>
              {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Section
            <select
              value={sectionName || 'All sections'}
              onChange={(event) => { setSectionName(event.target.value === 'All sections' ? '' : event.target.value); setSingleId(''); }}
            >
              {sectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Single student
            <select value={singleId} onChange={(event) => setSingleId(event.target.value)}>
              <option value="">Entire class batch</option>
              {roster.map((student) => (
                <option key={student.id} value={student.id}>{student.full_name} — {student.class_name} {student.section_name}</option>
              ))}
            </select>
          </label>
        </div>

        <StudentIdGallery
          value={templateKey}
          onChange={setTemplateKey}
          filter={orientationFilter}
          onFilterChange={setOrientationFilter}
        />

        <div className="sic-summary">
          <span><Users size={14} /> {scoped.length} card{scoped.length === 1 ? '' : 's'} ready</span>
          <span><CreditCard size={14} /> {template.name} · {template.orientation === 'portrait' ? 'vertical' : 'horizontal'}</span>
        </div>

        {loading ? (
          <div className="empty-state large"><Loader2 size={18} className="animate-spin" /> Preparing the cards…</div>
        ) : scoped.length === 0 ? (
          <div className="empty-state large">
            {className || singleId ? 'No active student matches this choice. Try another class or section.' : 'Choose a class, a section or a single student to build the cards.'}
          </div>
        ) : (
          <div className="sic-preview-scroll">
            <div className="sic-sheet">
              {scoped.map((student) => <StudentIdCardPair key={student.id} student={student} context={context} />)}
            </div>
          </div>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
          <button type="button" className="secondary-button" onClick={exportPdf} disabled={loading || scoped.length === 0}>
            <Download size={15} /> Export / Download PDF
          </button>
          <button type="button" className="primary-button" onClick={printCards} disabled={loading || scoped.length === 0}>
            <Printer size={15} /> Print ID Cards
          </button>
        </div>

        <p className="sic-hint">
          <UserRound size={13} />
          Front and back are printed side by side. Cut along the card border — the size is exact, so no trimming to fit.
        </p>
      </section>

      {printSheet}
    </div>
  );
}
