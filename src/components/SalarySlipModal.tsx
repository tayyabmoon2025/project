import { useEffect, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Check, Copy, Printer, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { cleanPhoneNumber, whatsappLink } from '@/lib/whatsapp';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { allowanceTotal, monthLabel, salarySlipMessage, type SalaryPayment } from '@/lib/payroll';

const money = (value: number) => `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
};

// The monthly slip: printable on A4 and ready to send over WhatsApp in one click.
export function SalarySlipModal({ slip, onClose, onToast }: {
  slip: SalaryPayment;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    void fetchInstitutionProfile().then(({ profile }) => setInstitution(profile));
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('mobile_number')
        .eq('id', slip.staff_user_id)
        .maybeSingle();
      setPhone(cleanPhoneNumber((data as { mobile_number: string | null } | null)?.mobile_number));
    })();
  }, [slip.staff_user_id]);

  const schoolName = institution?.school_name?.trim() || SCHOOL_NAME;
  const message = salarySlipMessage(slip, schoolName);
  const waLink = whatsappLink(phone || null, message, 'web');

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      onToast('Salary slip copied — paste it into any chat.');
    } catch {
      onToast('The slip could not be copied. Please select the text and copy it manually.');
    }
  };

  usePrintSheet(true, (
    <section className="print-only salary-slip">
      <header className="salary-slip-head">
        <SchoolLogo alt="" />
        <div>
          <h1>{schoolName}</h1>
          {institution?.address ? <p>{[institution.address, institution.city].filter(Boolean).join(', ')}</p> : null}
          {institution?.phone ? <p>Phone: {institution.phone}</p> : null}
        </div>
        <div className="salary-slip-head-right">
          <strong>Salary Slip</strong>
          <span>{monthLabel(slip.period_month)}</span>
        </div>
      </header>

      <div className="salary-slip-facts">
        <div><span>Employee</span><strong>{slip.staff_name}</strong></div>
        <div><span>Designation</span><strong>{ROLE_LABELS[slip.staff_role] ?? slip.staff_role}</strong></div>
        <div><span>Month</span><strong>{monthLabel(slip.period_month)}</strong></div>
        <div><span>Paid on</span><strong>{new Date(`${slip.paid_on.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
        <div><span>Payment method</span><strong>{slip.payment_method}</strong></div>
        <div><span>Absent / Late days</span><strong>{slip.absent_days} / {slip.late_days}</strong></div>
      </div>

      <div className="salary-slip-columns">
        <div className="salary-slip-block">
          <h2>Earnings</h2>
          <div className="salary-slip-row"><span>Basic salary</span><b>{money(slip.basic_salary)}</b></div>
          <div className="salary-slip-row"><span>House rent allowance</span><b>{money(slip.house_rent_allowance)}</b></div>
          <div className="salary-slip-row"><span>Conveyance allowance</span><b>{money(slip.conveyance_allowance)}</b></div>
          <div className="salary-slip-row"><span>Medical allowance</span><b>{money(slip.medical_allowance)}</b></div>
          <div className="salary-slip-row"><span>Other allowance</span><b>{money(slip.other_allowance)}</b></div>
          <div className="salary-slip-row total"><span>Gross salary</span><b>{money(slip.gross_salary)}</b></div>
        </div>

        <div className="salary-slip-block">
          <h2>Deductions</h2>
          <div className="salary-slip-row"><span>Absent ({slip.absent_days} day{slip.absent_days === 1 ? '' : 's'})</span><b>{money(slip.absent_deduction)}</b></div>
          <div className="salary-slip-row"><span>Late ({slip.late_days} day{slip.late_days === 1 ? '' : 's'})</span><b>{money(slip.late_deduction)}</b></div>
          <div className="salary-slip-row"><span>Advance instalment</span><b>{money(slip.advance_deduction)}</b></div>
          <div className="salary-slip-row"><span>Provident fund</span><b>{money(slip.pf_deduction)}</b></div>
          <div className="salary-slip-row"><span>Other deduction</span><b>{money(slip.other_deduction)}</b></div>
          <div className="salary-slip-row total"><span>Total deductions</span><b>{money(slip.total_deductions)}</b></div>
        </div>
      </div>

      <div className="salary-slip-net">
        <span>Net salary paid</span>
        <strong>{money(slip.net_salary)}</strong>
      </div>

      <div className="salary-slip-signatures">
        <div>Employee signature</div>
        <div>Accountant</div>
        <div>Principal</div>
      </div>
    </section>
  ));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal salary-slip-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Check size={14} /> Salary paid</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="salary-slip-title">{slip.staff_name}</h2>
        <p className="salary-slip-subtitle">{monthLabel(slip.period_month)} · {ROLE_LABELS[slip.staff_role] ?? slip.staff_role}</p>

        <div className="salary-slip-net inline">
          <span>Net salary paid</span>
          <strong>{money(slip.net_salary)}</strong>
        </div>

        <div className="salary-slip-preview-grid">
          <div>
            <span className="salary-slip-preview-label">Gross salary</span>
            <strong>{money(slip.gross_salary)}</strong>
            <small>Basic {money(slip.basic_salary)} + allowances {money(allowanceTotal(slip))}</small>
          </div>
          <div>
            <span className="salary-slip-preview-label">Total deductions</span>
            <strong>{money(slip.total_deductions)}</strong>
            <small>Absent {money(slip.absent_deduction)} · Late {money(slip.late_deduction)} · Advance {money(slip.advance_deduction)} · PF {money(slip.pf_deduction)}</small>
          </div>
        </div>

        <div className="salary-slip-actions">
          <a
            className="primary-button whatsapp-send"
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            title={phone ? 'Open a WhatsApp chat with this staff member' : 'Open WhatsApp — no number saved, choose the recipient in WhatsApp'}
          >
            <Send size={16} /> Send on WhatsApp
          </a>
          <button type="button" className="secondary-button" onClick={() => void copyMessage()}><Copy size={16} /> Copy slip text</button>
          <button type="button" className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Print slip</button>
        </div>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
