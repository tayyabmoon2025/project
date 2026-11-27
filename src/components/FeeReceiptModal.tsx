import { useEffect, useRef, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Printer, X } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { usePrintSheet } from '@/lib/usePrintSheet';
import type { FeeTransaction, Student } from '@/lib/schoolTypes';

const formatAmount = (value: number) => `Rs ${Number(value).toLocaleString()}`;

export function FeeReceiptModal({ student, entry, onClose }: { student: Student; entry: FeeTransaction; onClose: () => void }) {
  const printedRef = useRef(false);
  const [logoSettled, setLogoSettled] = useState(false);

  const receiptNumber = `RCPT-${entry.id.slice(0, 8).toUpperCase()}`;
  const isPayment = entry.kind === 'payment';
  const details: { label: string; value: string }[] = [
    { label: 'Receipt no.', value: receiptNumber },
    { label: 'Date', value: new Date(entry.created_at).toLocaleString() },
    { label: 'Student', value: student.full_name },
    { label: 'Admission no.', value: student.admission_number },
    { label: 'Class', value: `${student.class_name} · Section ${student.section_name}` },
    { label: 'Father’s name', value: student.fathers_name || '—' },
  ];

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-fee-receipt">
      <div className="print-header">
        <SchoolLogo
          alt={`${SCHOOL_NAME} logo`}
          onLoad={() => setLogoSettled(true)}
        />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Fee Receipt</p>
        </div>
        <div className="print-header-admitted">
          <span>Receipt No.</span>
          <strong>{receiptNumber}</strong>
        </div>
      </div>
      <div className="print-columns">
        <div>
          <h2>Receipt Details</h2>
          {details.map((detail) => <div className="print-row" key={detail.label}><span className="print-row-label">{detail.label}</span><span className="print-row-value">{detail.value}</span></div>)}
        </div>
        <div>
          <h2>Amount</h2>
          <div className="print-row"><span className="print-row-label">{isPayment ? 'Amount received' : 'Amount charged'}</span><span className="print-row-value">{isPayment ? '−' : '+'}{formatAmount(entry.amount)}</span></div>
          <div className="print-row"><span className="print-row-label">Balance after this entry</span><span className="print-row-value">{formatAmount(entry.balance_after)}</span></div>
        </div>
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Received By</span></div>
        <div className="print-signature"><span>Authorised Signature</span></div>
      </div>
    </section>
  ));

  useEffect(() => {
    if (!logoSettled || printedRef.current) return;
    printedRef.current = true;
    window.print();
  }, [logoSettled]);

  return (
    <div className="notice-overlay">
      <section className="notice-modal">
        <div className="notice-preview-top">
          <div className="flex items-center gap-4">
            <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="h-14 w-14 object-contain" />
            <div>
              <span className="eyebrow">Fee receipt</span>
              <h2 className="mt-1 text-xl font-bold text-slate-800">{SCHOOL_NAME}</h2>
            </div>
          </div>
          <button className="close-button no-print" onClick={onClose} aria-label="Close receipt"><X size={18} /></button>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {details.map((detail) => (
            <div key={detail.label} className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{detail.label}</dt>
              <dd className="mt-1 text-sm text-slate-800">{detail.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 rounded-xl bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600">{isPayment ? 'Amount received' : 'Amount charged'}</span>
            <span className={`text-xl font-bold ${isPayment ? 'text-emerald-700' : 'text-amber-700'}`}>
              {isPayment ? '−' : '+'}{formatAmount(entry.amount)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm font-semibold text-slate-600">Balance after this entry</span>
            <span className="text-base font-bold text-slate-800">{formatAmount(entry.balance_after)}</span>
          </div>
        </div>
        <div className="notice-preview-actions mt-6 no-print">
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print receipt</button>
        </div>
      </section>
      {printSheet}
    </div>
  );
}
