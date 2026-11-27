import { useEffect, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Printer, X } from 'lucide-react';
import type { Student } from '@/lib/schoolTypes';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { FeeHistory } from '@/components/FeeHistory';
import { useFeeTransactions } from '@/lib/useFeeTransactions';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { StudentPhoto } from '@/components/StudentPhoto';

export function StudentRecordModal({ student, autoPrint, onClose }: { student: Student; autoPrint: boolean; onClose: () => void }) {
  const { entries, loading, error } = useFeeTransactions(student.id);
  const [logoSettled, setLogoSettled] = useState(false);

  const details: { label: string; value: string | null | undefined }[] = [
    { label: 'Admission no.', value: student.admission_number },
    { label: 'Admission date', value: new Date(student.admission_date).toLocaleDateString() },
    { label: 'Class', value: `${student.class_name} · Section ${student.section_name}` },
    { label: 'Roll number', value: student.roll_number },
    { label: 'Gender', value: student.gender },
    { label: 'Student name (Urdu)', value: student.full_name_urdu },
    { label: 'Father’s name', value: student.fathers_name },
    { label: 'Father’s name (Urdu)', value: student.fathers_name_urdu },
    { label: 'Mother’s name (Urdu)', value: student.mother_name_urdu },
    { label: 'Father’s CNIC', value: student.fathers_cnic },
    { label: 'Guardian name', value: student.guardian_name },
    { label: 'Contact no.', value: student.guardian_phone },
    { label: 'Mother’s number', value: student.mother_number },
    { label: 'Religion', value: student.religion },
    { label: 'Nationality', value: student.nationality },
    { label: 'Area', value: student.area },
    { label: 'Fee balance', value: `Rs ${Number(student.fee_balance).toLocaleString()}` },
  ];

  // The single printable copy of this record. It lives outside the app chrome,
  // so printing never picks up the modal, the sidebar or a second copy.
  const printSheet = usePrintSheet(true, (
    <section className="print-only print-student-record">
      <div className="print-header">
        <SchoolLogo
          alt={`${SCHOOL_NAME} logo`}
          onLoad={() => setLogoSettled(true)}
        />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Student Record</p>
        </div>
        <div className="print-header-admitted">
          <span>Class</span>
          <strong>{student.class_name} · {student.section_name}</strong>
        </div>
      </div>
      <div className="print-layout">
        <div className="print-photo">
          <StudentPhoto src={student.photo_url} name={student.full_name} className="print-photo-img" />
          <strong>{student.full_name}</strong>
        </div>
        <div className="print-columns">
          <div>
            <h2>Student Details</h2>
            {details.slice(0, 9).map((detail) => <div className="print-row" key={detail.label}><span className="print-row-label">{detail.label}</span><span className="print-row-value">{detail.value || '—'}</span></div>)}
          </div>
          <div>
            <h2>Family and Other Info</h2>
            {details.slice(9).map((detail) => <div className="print-row" key={detail.label}><span className="print-row-label">{detail.label}</span><span className="print-row-value">{detail.value || '—'}</span></div>)}
          </div>
        </div>
      </div>
      <div className="print-fee-section">
        <h2>Fee History</h2>
        {entries.length ? entries.map((entry) => (
          <div className="print-row" key={entry.id}>
            <span className="print-row-label">{new Date(entry.created_at).toLocaleDateString()} · {entry.kind === 'payment' ? 'Payment' : 'Charge'}</span>
            <span className="print-row-value">Rs {Number(entry.amount).toLocaleString()} · Balance Rs {Number(entry.balance_after).toLocaleString()}</span>
          </div>
        )) : <div className="print-row"><span className="print-row-value">No fee entries recorded</span></div>}
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Parent Signature</span></div>
        <div className="print-signature"><span>Principal Signature</span></div>
      </div>
    </section>
  ));

  useEffect(() => {
    if (autoPrint && logoSettled) window.print();
  }, [autoPrint, logoSettled]);

  return (
    <div className="notice-overlay">
      <section className="notice-modal">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Student record</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{student.full_name}</h2>
          </div>
          <button className="close-button no-print" onClick={onClose} aria-label="Close record"><X size={18} /></button>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <StudentPhoto src={student.photo_url} name={student.full_name} className="h-24 w-24 rounded-xl border border-slate-200" />
          <div className="text-sm text-slate-600">
            <p className="font-semibold text-slate-800">{student.admission_number}</p>
            <p>{student.class_name} · Section {student.section_name}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {details.map((detail) => (
            <div key={detail.label} className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{detail.label}</dt>
              <dd className="mt-1 text-sm text-slate-800">{detail.value || '—'}</dd>
            </div>
          ))}
        </dl>
        <FeeHistory student={student} entries={entries} loading={loading} error={error} />
      <div className="notice-preview-actions no-print">
        <button className="secondary-button" onClick={onClose}>Close</button>
        <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print record</button>
      </div>
      </section>
      {printSheet}
    </div>
  );
}
