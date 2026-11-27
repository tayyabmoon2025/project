import { useEffect, useMemo, useRef, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { SchoolLetterhead } from '@/components/SchoolLetterhead';
import { useSchoolProfile } from '@/lib/schoolProfile';
import { Printer, ShieldCheck, X } from 'lucide-react';
import { FeeBarcode } from '@/components/FeeBarcode';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { usePrintSheet } from '@/lib/usePrintSheet';
import type { Student } from '@/lib/schoolTypes';
import {
  EMPTY_PAYMENT_SETTINGS, HEAD_LABELS, challanDisplayNumber, challanScanCode, formatDay, formatMoney, formatStamp, monthLabel,
  payableFee, type ChallanDocument, type FeeHeads, type FeePayment, type FeeSummary, type PaymentSettings,
} from '@/lib/fees';
import { concessionCategoryLabel } from '@/lib/concessionCategories';

const headKeys: (keyof FeeHeads)[] = ['tuition_fee', 'admission_misc', 'exam_lab', 'transport', 'arrears', 'late_fine', 'concession'];

// Every printable sheet waits for the school logo before calling the printer, so a
// receipt never comes out with a missing header.
function useAutoPrint(ready: boolean) {
  const printedRef = useRef(false);
  useEffect(() => {
    if (!ready || printedRef.current) return;
    printedRef.current = true;
    window.print();
  }, [ready]);
}

export type ReceiptLayout = 'a5' | 'thermal';

function ReceiptSheet({ payment, student, summary, layout, onLogo }: {
  payment: FeePayment;
  student: Student | null;
  summary: FeeSummary | null;
  layout: ReceiptLayout;
  onLogo: () => void;
}) {
  const details: { label: string; value: string }[] = [
    { label: 'Adm. No.', value: student?.admission_number ?? payment.admission_number ?? '—' },
    { label: 'Dated', value: formatDay(payment.payment_date) },
    { label: 'Student Name', value: student?.full_name ?? payment.student_name },
    { label: 'Father Name', value: student?.fathers_name || payment.fathers_name || '—' },
    { label: 'Class / Section', value: student ? `${student.class_name} / ${student.section_name}` : `${payment.class_name ?? '—'} / ${payment.section_name ?? '—'}` },
  ];
  const due = payment.due_fee ?? summary?.totalPayable ?? Number(payment.amount) + Number(payment.balance_after);
  const payable = payableFee(due, payment.fine_amount, payment.concession, payment.discount);
  const balance = Math.max(0, payable - Number(payment.amount));

  return (
    <section className={`print-only print-fee-receipt ${layout === 'a5' ? 'ack-a5' : 'ack-roll'}`}>
      {/* An 80mm roll needs the page itself narrowed, not just the layout. Only one print
          sheet is ever mounted at a time, so this cannot leak onto another document. */}
      {layout === 'thermal' && <style>{'@page { size: 80mm auto; margin: 3mm; }'}</style>}
      <SchoolLetterhead
        title="Acknowledgment Receipt"
        onLogoReady={onLogo}
        badge={<div className="print-header-admitted">
          <span>Receipt No.</span>
          <strong>{payment.receipt_number}</strong>
        </div>}
      />
      <div className="print-columns">
        <div>
          <h2>Student Details</h2>
          {details.map((detail) => (
            <div className="print-row" key={detail.label}>
              <span className="print-row-label">{detail.label}</span>
              <span className="print-row-value">{detail.value}</span>
            </div>
          ))}
          <div className="print-row"><span className="print-row-label">Payment method</span><span className="print-row-value capitalize">{payment.method}</span></div>
        </div>
        <div>
          <h2>Fee Breakdown</h2>
          <div className="print-row"><span className="print-row-label">Due Fee</span><span className="print-row-value">{formatMoney(due)}</span></div>
          <div className="print-row"><span className="print-row-label">Fine / Late Fee</span><span className="print-row-value">{formatMoney(payment.fine_amount)}</span></div>
          <div className="print-row"><span className="print-row-label">Fee Concession</span><span className="print-row-value">−{formatMoney(payment.concession)}</span></div>
          {payment.discount > 0 && <div className="print-row"><span className="print-row-label">Discount</span><span className="print-row-value">−{formatMoney(payment.discount)}</span></div>}
          <div className="print-row total"><span className="print-row-label">Total Fee Payable</span><span className="print-row-value">{formatMoney(payable)}</span></div>
          <div className="print-row"><span className="print-row-label">Fee Paid</span><span className="print-row-value">{formatMoney(payment.amount)}</span></div>
          <div className="print-row total"><span className="print-row-label">Balance</span><span className="print-row-value">{formatMoney(balance)}</span></div>
        </div>
      </div>
      <div className="print-remarks">
        <span>Remarks</span>
        <p>{payment.remarks || '—'}</p>
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Received By</span></div>
        <div className="print-signature"><span>Authorised Signature</span></div>
      </div>
      <p className="print-timestamp">
        Printed on {formatStamp(new Date().toISOString())}
        {payment.edit_count > 0 ? ` · Last corrected ${formatStamp(payment.updated_at ?? payment.created_at)}` : ''}
      </p>
    </section>
  );
}

export function FeeReceiptView({ payment, student, summary, onClose }: {
  payment: FeePayment;
  student: Student | null;
  summary: FeeSummary | null;
  onClose: () => void;
}) {
  const [logoSettled, setLogoSettled] = useState(false);
  const [layout, setLayout] = useState<ReceiptLayout>('a5');
  const profile = useSchoolProfile();
  const schoolName = profile?.school_name?.trim() || SCHOOL_NAME;
  useAutoPrint(logoSettled);
  const printSheet = usePrintSheet(true, (
    <ReceiptSheet payment={payment} student={student} summary={summary} layout={layout} onLogo={() => setLogoSettled(true)} />
  ));

  const due = payment.due_fee ?? summary?.totalPayable ?? Number(payment.amount) + Number(payment.balance_after);
  const payable = payableFee(due, payment.fine_amount, payment.concession, payment.discount);
  const balance = Math.max(0, payable - Number(payment.amount));
  const lines: { label: string; value: string; tone?: string }[] = [
    { label: 'Due Fee', value: formatMoney(due) },
    { label: 'Fine / Late Fee', value: formatMoney(payment.fine_amount) },
    { label: 'Fee Concession', value: `−${formatMoney(payment.concession)}` },
    ...(payment.discount > 0 ? [{ label: 'Discount', value: `−${formatMoney(payment.discount)}` }] : []),
    { label: 'Total Fee Payable', value: formatMoney(payable), tone: 'strong' },
    { label: 'Fee Paid', value: formatMoney(payment.amount), tone: 'credit' },
    { label: 'Balance', value: formatMoney(balance), tone: 'strong' },
  ];
  const identity: [string, string][] = [
    ['Adm. No.', student?.admission_number ?? payment.admission_number ?? '—'],
    ['Dated', formatDay(payment.payment_date)],
    ['Student Name', student?.full_name ?? payment.student_name],
    ['Father Name', student?.fathers_name || payment.fathers_name || '—'],
    ['Class / Section', student ? `${student.class_name} / ${student.section_name}` : `${payment.class_name ?? '—'} / ${payment.section_name ?? '—'}`],
  ];

  return (
    <div className="notice-overlay">
      <section className="notice-modal ack-modal">
        <div className="notice-preview-top no-print">
          <div className="flex items-center gap-4">
            <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="h-14 w-14 object-contain" />
            <div>
              <span className="eyebrow">Acknowledgment receipt</span>
              <h2 className="mt-1 text-xl font-bold text-slate-800">{schoolName}</h2>
            </div>
          </div>
          <button className="close-button no-print" onClick={onClose} aria-label="Close receipt"><X size={18} /></button>
        </div>

        <div className="ack-layout-picker no-print" role="tablist" aria-label="Receipt paper size">
          {([['a5', 'A5 sheet'], ['thermal', '80mm roll']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={layout === value}
              className={`ack-layout-tab ${layout === value ? 'on' : ''}`}
              onClick={() => setLayout(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={`ack-paper ${layout}`}>
          <div className="ack-head">
            <SchoolLogo alt="" />
            <div>
              <h2>{schoolName}</h2>
              <span className="ack-title">Acknowledgment Receipt</span>
            </div>
          </div>

          <div className="ack-identity">
            {identity.map(([label, value]) => (
              <div key={label}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>

          <table className="ack-table">
            <tbody>
              {lines.map((line) => (
                <tr key={line.label} className={line.tone ? `ack-${line.tone}` : undefined}>
                  <th>{line.label}</th>
                  <td>{line.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ack-remarks">
            <span>Remarks</span>
            <p>{payment.remarks || '—'}</p>
          </div>

          <div className="ack-foot">
            <div className="ack-meta">
              <span>Receipt No. <strong>{payment.receipt_number}</strong></span>
              <span>Received by <strong>{payment.method}</strong></span>
              {payment.edit_count > 0 && <span>Last corrected <strong>{formatStamp(payment.updated_at ?? payment.created_at)}</strong></span>}
              <span>Printed on <strong>{formatStamp(new Date().toISOString())}</strong></span>
            </div>
            <div className="ack-sign">
              <span>Received By</span>
            </div>
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

function ChallanSheet({ challan, settings }: { challan: ChallanDocument; settings: PaymentSettings }) {
  const copyLabel = 'Student Copy';
  const scanCode = challanScanCode(challan);
  const hasEasypaisa = Boolean(settings.easypaisa_account_no.trim());
  const hasBank = Boolean(settings.bank_account_no.trim() || settings.bank_name.trim() || settings.bank_account_name.trim());
  // A concession that needed the principal's sign-off shows the approval line only after
  // it has been officially approved, so a pending or rejected concession never appears as
  // signed off on a printed challan.
  const approvalApproved = challan.concession_approval_status === 'approved';
  const approverName = challan.concession_approved_by?.trim() ?? '';
  const approvalDate = challan.concession_approved_at ? formatDay(challan.concession_approved_at.slice(0, 10)) : '';
  const approvalCategory = challan.fee_concession_category
    ? concessionCategoryLabel(challan.fee_concession_category)
    : 'Concession';

  return (
    <section className="print-only print-challan">
      <SchoolLetterhead
        title="Fee Challan"
        badge={<>
          <div className="print-header-copy challan-copy-label"><span>{copyLabel}</span></div>
          <div className="print-header-admitted">
            <span>Due date</span>
            <strong>{formatDay(challan.due_date)}</strong>
          </div>
        </>}
      />

      <div className="print-columns">
        <div>
          <h2>Student Details</h2>
          <div className="print-row"><span className="print-row-label">Student</span><span className="print-row-value">{challan.student_name}</span></div>
          <div className="print-row"><span className="print-row-label">Admission no.</span><span className="print-row-value">{challan.admission_number || '—'}</span></div>
          <div className="print-row"><span className="print-row-label">Class</span><span className="print-row-value">{challan.class_name ?? '—'} · Section {challan.section_name ?? '—'}</span></div>
          <div className="print-row"><span className="print-row-label">Fee month</span><span className="print-row-value">{monthLabel(challan.month)}</span></div>
          <div className="print-row"><span className="print-row-label">Challan no.</span><span className="print-row-value">{challanDisplayNumber(challan) || '—'}</span></div>
          <div className="print-row"><span className="print-row-label">Due date</span><span className="print-row-value">{formatDay(challan.due_date)}</span></div>
          <div className="print-row"><span className="print-row-label">Status</span><span className="print-row-value">{challan.status}</span></div>
        </div>
        <div className="challan-fee-heads">
          <h2>Fee Heads</h2>
          {headKeys.map((key) => (
            <div className="print-row" key={key}>
              <span className="print-row-label">{HEAD_LABELS[key]}</span>
              <span className="print-row-value">{key === 'concession' ? '−' : ''}{formatMoney(challan[key])}</span>
            </div>
          ))}
          <div className="print-row total"><span className="print-row-label">Total payable</span><span className="print-row-value">{formatMoney(challan.total)}</span></div>
        </div>
      </div>

      <div className="challan-pay-block">
        <div className="challan-pay-copy">
          <h2>How to Pay</h2>
          {hasEasypaisa || hasBank ? (
            <div className="challan-pay-groups">
              <div className="challan-pay-group">
                <span className="challan-pay-group-title">Easypaisa</span>
                {hasEasypaisa ? (
                  <>
                    <div className="print-row"><span className="print-row-label">Account no.</span><span className="print-row-value">{settings.easypaisa_account_no}</span></div>
                    {settings.easypaisa_account_name.trim() && (
                      <div className="print-row"><span className="print-row-label">Account title</span><span className="print-row-value">{settings.easypaisa_account_name}</span></div>
                    )}
                  </>
                ) : (
                  <p className="challan-pay-note">Not set. Ask the office for the Easypaisa account.</p>
                )}
              </div>
              <div className="challan-pay-group">
                <span className="challan-pay-group-title">Bank transfer</span>
                {hasBank ? (
                  <>
                    <div className="print-row"><span className="print-row-label">Bank name</span><span className="print-row-value">{settings.bank_name.trim() || '—'}</span></div>
                    <div className="print-row"><span className="print-row-label">Account title</span><span className="print-row-value">{settings.bank_account_name.trim() || '—'}</span></div>
                    <div className="print-row"><span className="print-row-label">Account / IBAN no.</span><span className="print-row-value">{settings.bank_account_no.trim() || '—'}</span></div>
                  </>
                ) : (
                  <p className="challan-pay-note">Not set. Ask the office for the bank account.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="challan-pay-note">Pay at the school office counter during working hours.</p>
          )}
          <p className="challan-pay-note">Keep this Student Copy and bring it, or the barcode below, when depositing the fee.</p>
        </div>
        <div className="challan-barcode-block">
          <FeeBarcode value={scanCode} caption={`Challan ${challan.challan_number || scanCode}`} />
        </div>
      </div>

      <div className="print-signatures">
        <div className="print-signature"><span>Depositor Signature</span></div>
        <div className="print-signature"><span>Authorised Signature</span></div>
      </div>

      {approvalApproved && (
        <div className="challan-approval-stamp">
          <div className="challan-approval-line">
            <ShieldCheck size={16} />
            <span>Principal&rsquo;s Approval</span>
          </div>
          <p>
            The {approvalCategory.toLowerCase()} on this challan has been approved
            {approverName ? ` by ${approverName}` : ''}{approvalDate ? ` on ${approvalDate}` : ''}.
          </p>
          <div className="challan-approval-sign">
            <span>Principal&rsquo;s Signature</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function ChallanView({ challans, settings = EMPTY_PAYMENT_SETTINGS, students, onClose }: {
  challans: ChallanDocument[];
  settings?: PaymentSettings;
  // The student records for the challans, keyed by id, so the approval status and
  // approver name can be read onto the printed sheet. When omitted the challan's own
  // optional approval fields are used (the Student Portal passes them directly).
  students?: Student[];
  onClose: () => void;
}) {
  const first = challans[0];
  const studentMap = useMemo(() => {
    if (!students) return null;
    const map = new Map<string, Student>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  // Enrich each challan with the approval fields from its student record, so the
  // printed sheet can show the principal's sign-off line for an approved concession.
  const enriched: ChallanDocument[] = useMemo(() => {
    if (!studentMap) return challans;
    return challans.map((challan) => {
      const student = studentMap.get(challan.student_id);
      if (!student) return challan;
      return {
        ...challan,
        concession_approval_status: student.concession_approval_status ?? null,
        concession_approved_by: student.concession_approved_by ?? null,
        concession_approved_at: student.concession_approved_at ?? null,
        fee_concession_category: student.fee_concession_category ?? null,
      };
    });
  }, [challans, studentMap]);

  const printSheet = usePrintSheet(challans.length > 0, (
    <>
      {enriched.map((challan) => (
        <ChallanSheet key={challan.id} challan={challan} settings={settings} />
      ))}
    </>
  ));

  if (!first) return null;

  const firstCode = challanScanCode(first);
  // The barcode carries the formatted challan number so a scanned Student Copy resolves
  // to the student and month even before the challan itself has been saved.
  const firstNumber = challanDisplayNumber(first) || firstCode;

  return (
    <div className="notice-overlay">
      <section className="notice-modal notice-modal-wide">
        <div className="notice-preview-top">
          <div className="flex items-center gap-4">
            <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="h-14 w-14 object-contain" />
            <div>
              <span className="eyebrow">Fee challan · Student Copy</span>
              <h2 className="mt-1 text-xl font-bold text-slate-800">
                {challans.length === 1 ? first.student_name : `${challans.length} challans`}
              </h2>
            </div>
          </div>
          <button className="close-button no-print" onClick={onClose} aria-label="Close challan"><X size={18} /></button>
        </div>

        <div className="challan-preview-head">
          <span>Challan no. <strong>{firstNumber}</strong></span>
          <span>Admission no. <strong>{first.admission_number || '—'}</strong></span>
          <span>Fee month <strong>{monthLabel(first.month)}</strong></span>
          <span>Due date <strong>{formatDay(first.due_date)}</strong></span>
        </div>

        <div className="challan-pay-preview">
          <div>
            <span className="eyebrow">How to pay</span>
            {settings.easypaisa_account_no.trim() && (
              <p>Easypaisa account no. <strong>{settings.easypaisa_account_no}</strong>{settings.easypaisa_account_name.trim() ? ` · ${settings.easypaisa_account_name}` : ''}</p>
            )}
            {(settings.bank_account_no.trim() || settings.bank_name.trim() || settings.bank_account_name.trim()) && (
              <p>
                {settings.bank_name.trim() ? `${settings.bank_name.trim()} ` : 'Bank '}account / IBAN no. <strong>{settings.bank_account_no.trim() || '—'}</strong>{settings.bank_account_name.trim() ? ` · ${settings.bank_account_name}` : ''}
              </p>
            )}
            {!settings.easypaisa_account_no.trim() && !settings.bank_account_no.trim() && !settings.bank_name.trim() && !settings.bank_account_name.trim() && (
              <p>No payment details are saved yet. An administrator can add them under Fee Structure.</p>
            )}
          </div>
          <FeeBarcode value={firstNumber} caption={challans.length === 1 ? 'Scan to pay' : 'First challan shown'} height={54} module={2} />
        </div>

        <div className="table-wrap challan-preview-table">
          <table className="min-w-[820px]">
            <thead>
              <tr>
                <th>Challan no.</th>
                <th>Student</th>
                <th>Admission no.</th>
                <th>Class</th>
                {headKeys.map((key) => <th key={key} className="text-right">{HEAD_LABELS[key]}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {challans.map((challan) => (
                <tr key={challan.id}>
                  <td className="fee-mono">{challanDisplayNumber(challan) || '—'}</td>
                  <td><strong>{challan.student_name}</strong></td>
                  <td>{challan.admission_number || '—'}</td>
                  <td>{challan.class_name ?? '—'} · {challan.section_name ?? '—'}</td>
                  {headKeys.map((key) => (
                    <td key={key} className="text-right tabular-nums">
                      {key === 'concession' ? '−' : ''}{Math.round(challan[key]).toLocaleString()}
                    </td>
                  ))}
                  <td className="text-right font-semibold tabular-nums">{formatMoney(challan.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="notice-preview-actions mt-6 no-print">
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print {challans.length === 1 ? 'challan' : `${challans.length} challans`}</button>
        </div>
      </section>
      {printSheet}
    </div>
  );
}
