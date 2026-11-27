import { useEffect, useState } from 'react';
import { Printer, Receipt, Wallet } from 'lucide-react';
import { ChallanView } from '@/components/FeeDocuments';
import {
  EMPTY_PAYMENT_SETTINGS, challanDisplayNumber, fetchChallansForStudent, fetchPaymentSettings,
  formatDay, formatMoney, monthLabel,
  type ChallanDocument, type FeeChallan, type PaymentSettings,
} from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

// The fee section of the Student Portal: every challan the school has issued to this
// student, with the same printable Student Copy the office hands out. A parent sees the
// same panel for each of their children.
export function StudentFeePanel({ studentId, studentName, admissionNumber = null, student, showHeading = true }: {
  studentId: string;
  studentName?: string;
  admissionNumber?: string | null;
  // The full student record, so the printed challan can show the principal's approval
  // signature line when a concession has been officially approved.
  student?: Student;
  showHeading?: boolean;
}) {
  const [challans, setChallans] = useState<FeeChallan[]>([]);
  const [settings, setSettings] = useState<PaymentSettings>(EMPTY_PAYMENT_SETTINGS);
  const [printing, setPrinting] = useState<ChallanDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const [list, payment] = await Promise.all([
        fetchChallansForStudent(studentId),
        fetchPaymentSettings(),
      ]);
      if (!active) return;
      setChallans(list.challans);
      setError(list.error);
      if (!payment.error) setSettings(payment.settings);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [studentId]);

  // The portal already knows the student's admission number, so the same printable
  // document the office uses can be built here without another lookup. The approval
  // fields are copied from the student record so the printed challan can show the
  // principal's signature line once a concession is approved.
  const documents: ChallanDocument[] = challans.map((challan) => ({
    ...challan,
    admission_number: admissionNumber,
    concession_approval_status: student?.concession_approval_status ?? null,
    concession_approved_by: student?.concession_approved_by ?? null,
    concession_approved_at: student?.concession_approved_at ?? null,
    fee_concession_category: student?.fee_concession_category ?? null,
  }));

  const open = documents.filter((challan) => challan.status !== 'paid');
  const payable = open.reduce((sum, challan) => sum + Number(challan.total), 0);

  return (
    <section className="panel parent-notices-panel student-fee-panel">
      {showHeading && (
        <div className="panel-header">
          <div>
            <span className="eyebrow">Fee challans</span>
            <h2>{studentName ? `${studentName}'s fee challans` : 'Your fee challans'}</h2>
            <p className="panel-subtitle">Every challan the school issues appears here straight away, ready to print and pay.</p>
          </div>
          <Wallet size={20} />
        </div>
      )}

      {loading && <p className="empty-state">Loading your fee challans…</p>}
      {!loading && error && <p className="dmc-warning">{error}</p>}

      {!loading && !error && documents.length === 0 && (
        <p className="empty-state">No fee challan has been issued yet. It will appear here as soon as the school office generates one.</p>
      )}

      {!loading && documents.length > 0 && (
        <>
          <div className="student-fee-summary">
            <div className="student-fee-stat">
              <span>Challans issued</span>
              <strong>{documents.length}</strong>
            </div>
            <div className="student-fee-stat">
              <span>Still to pay</span>
              <strong>{formatMoney(payable)}</strong>
            </div>
            <div className="student-fee-stat">
              <span>Unpaid challans</span>
              <strong>{open.length}</strong>
            </div>
          </div>

          <ul className="student-fee-list">
            {documents.map((challan) => (
              <li className="student-fee-card" key={challan.id}>
                <div className="student-fee-card-head">
                  <div>
                    <strong>{monthLabel(challan.month)}</strong>
                    <span className="student-fee-number">Challan no. {challanDisplayNumber(challan) || '—'}</span>
                  </div>
                  <span className={`fee-status ${challan.status}`}>{challan.status}</span>
                </div>
                <div className="student-fee-rows">
                  <div className="parent-detail-row"><span>Admission no.</span><strong>{challan.admission_number || '—'}</strong></div>
                  <div className="parent-detail-row"><span>Due date</span><strong>{formatDay(challan.due_date)}</strong></div>
                  <div className="parent-detail-row"><span>Payable</span><strong>{formatMoney(challan.total)}</strong></div>
                </div>
                <div className="student-fee-breakdown">
                  <span>Tuition {formatMoney(challan.tuition_fee)}</span>
                  <span>Admission / misc {formatMoney(challan.admission_misc)}</span>
                  <span>Exam / lab {formatMoney(challan.exam_lab)}</span>
                  <span>Transport {formatMoney(challan.transport)}</span>
                  <span>Arrears {formatMoney(challan.arrears)}</span>
                  <span>Late fine {formatMoney(challan.late_fine)}</span>
                  <span>Concession −{formatMoney(challan.concession)}</span>
                </div>
                <button type="button" className="secondary-button" onClick={() => setPrinting([challan])}>
                  <Printer size={15} /> Print challan
                </button>
              </li>
            ))}
          </ul>

          <div className="student-fee-pay">
            <div className="student-fee-pay-head">
              <Receipt size={16} />
              <strong>How to pay</strong>
            </div>
            {settings.easypaisa_account_no.trim() || settings.bank_account_no.trim() || settings.bank_name.trim() || settings.bank_account_name.trim() ? (
              <>
                {settings.easypaisa_account_no.trim() && (
                  <p>Easypaisa account no. <strong>{settings.easypaisa_account_no}</strong>{settings.easypaisa_account_name.trim() ? ` · ${settings.easypaisa_account_name}` : ''}</p>
                )}
                {(settings.bank_account_no.trim() || settings.bank_name.trim() || settings.bank_account_name.trim()) && (
                  <p>
                    {settings.bank_name.trim() ? `${settings.bank_name.trim()} ` : 'Bank '}account / IBAN no. <strong>{settings.bank_account_no.trim() || '—'}</strong>{settings.bank_account_name.trim() ? ` · ${settings.bank_account_name}` : ''}
                  </p>
                )}
              </>
            ) : (
              <p>Pay at the school office counter during working hours.</p>
            )}
          </div>
        </>
      )}

      {printing.length > 0 && <ChallanView challans={printing} settings={settings} onClose={() => setPrinting([])} />}
    </section>
  );
}
