import { SchoolLetterhead } from '@/components/SchoolLetterhead';
import { SCHOOL_NAME, SCHOOL_NAME_UR } from '@/lib/noticeText';
import { profileContactLine, useSchoolProfile } from '@/lib/schoolProfile';
import type { NoticeCategory, NoticeLanguage, Student } from '@/lib/schoolTypes';

export type NoticeSlipData = {
  student: Student | null;
  title: string;
  category: NoticeCategory;
  language: NoticeLanguage;
  // Already filled in: the slip never re-renders the placeholders, so what the office
  // read on screen is exactly what the parent receives.
  english: string;
  urdu: string;
  reference: string;
  dateLabel: string;
  senderName: string;
};

const CATEGORY_LABEL: Record<NoticeCategory, string> = {
  NOTICE: 'Notice',
  REMINDER: 'Reminder',
  WARNING: 'Warning',
  ATTENDANCE: 'Attendance',
  FEE: 'Fee',
  HOMEWORK: 'Homework',
  EXAM: 'Examination',
  GENERAL: 'General',
};

// The slip that goes home with the student: half an A4 sheet on the official letterhead,
// the notice itself in the middle, and a signature line for the principal at the foot.
export function NoticeSlip({ data }: { data: NoticeSlipData }) {
  const profile = useSchoolProfile();
  const schoolName = profile?.school_name?.trim() || SCHOOL_NAME;
  const schoolNameUrdu = profile?.school_name_urdu?.trim() || SCHOOL_NAME_UR;
  const principal = profile?.principal_name?.trim() || 'Principal';
  const contact = profileContactLine(profile);
  const isUrdu = data.language === 'Urdu';
  const showEnglish = (data.language === 'English' || data.language === 'Bilingual') && data.english.trim();
  const showUrdu = (data.language === 'Urdu' || data.language === 'Bilingual') && data.urdu.trim();

  return (
    <div className="notice-slip" dir={isUrdu ? 'rtl' : 'ltr'}>
      <SchoolLetterhead variant="compact" title={`${CATEGORY_LABEL[data.category]} — Official Notice`} />

      <div className="notice-slip-meta">
        <span><b>Reference</b> {data.reference}</span>
        <span><b>Date</b> {data.dateLabel}</span>
      </div>

      {data.student ? (
        <div className="notice-slip-student">
          <div><b>Student</b><span>{data.student.full_name}</span></div>
          <div><b>Father / Guardian</b><span>{data.student.fathers_name || data.student.guardian_name || '—'}</span></div>
          <div><b>Class</b><span>{[data.student.class_name, data.student.section_name].filter(Boolean).join(' · ') || '—'}</span></div>
          <div><b>Roll No.</b><span>{data.student.roll_number || '—'}</span></div>
          <div><b>Admission No.</b><span>{data.student.admission_number}</span></div>
        </div>
      ) : null}

      <h2 className="notice-slip-title">{data.title || `${CATEGORY_LABEL[data.category]} from the school`}</h2>

      <div className="notice-slip-body">
        {showEnglish ? <p className="notice-slip-english">{data.english}</p> : null}
        {showUrdu ? <p className="notice-slip-urdu urdu-text" dir="rtl">{data.urdu}</p> : null}
        {!showEnglish && !showUrdu ? <p className="notice-slip-placeholder">Write the notice wording in the app to print it here.</p> : null}
      </div>

      <div className="notice-slip-foot">
        <div className="notice-slip-note">
          <span>Issued by</span>
          <strong>{data.senderName || 'School office'}</strong>
          <small>{schoolName}</small>
          {contact ? <small>{contact}</small> : null}
        </div>
        <div className="notice-slip-sign">
          <span className="notice-slip-sign-line" />
          <strong>{principal}</strong>
          <small>Principal · {schoolNameUrdu}</small>
        </div>
      </div>

      <p className="notice-slip-return">Please sign and return this slip to the class teacher.</p>
    </div>
  );
}
