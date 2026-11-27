import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { classCollection } from '@/lib/accountant';
import {
  dailyTotals, downloadCsv, formatDay, formatMoney, methodTotals, monthLabel,
  monthOptions, toCsv, type FeePayment,
} from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

// Fee reports for the accountant: date-wise, method-wise, class-wise and a monthly
// summary, plus the outstanding balance by class. Every figure comes from the loaded
// receipts; reversed receipts are excluded throughout.
export function AccountantReports({ students, payments, month, setMonth, onToast }: {
  students: Student[];
  payments: FeePayment[];
  month: string;
  setMonth: (month: string) => void;
  onToast: (message: string) => void;
}) {
  const [classFilter, setClassFilter] = useState('');
  const classList = useMemo(() => Array.from(new Set(students.map((student) => student.class_name))).sort(), [students]);

  const monthPayments = useMemo(() => payments.filter((payment) => !payment.voided && (payment.payment_date ?? '').slice(0, 7) === month), [payments, month]);
  const monthTotal = monthPayments.reduce((total, payment) => total + Number(payment.amount), 0);
  const monthCount = monthPayments.length;
  const days = dailyTotals(payments, month);
  const methods = methodTotals(payments, month);
  const classes = classCollection(payments, month);

  const outstandingByClass = useMemo(() => {
    const map = new Map<string, { balance: number; students: number }>();
    for (const student of students) {
      if (student.status !== 'active') continue;
      if (classFilter && student.class_name !== classFilter) continue;
      const balance = Math.max(0, Number(student.fee_balance ?? 0));
      const current = map.get(student.class_name) ?? { balance: 0, students: 0 };
      map.set(student.class_name, { balance: current.balance + balance, students: current.students + (balance > 0 ? 1 : 0) });
    }
    return Array.from(map.entries()).map(([className, value]) => ({ className, ...value })).sort((a, b) => a.className.localeCompare(b.className));
  }, [students, classFilter]);

  const totalOutstanding = outstandingByClass.reduce((total, row) => total + row.balance, 0);

  const exportMonth = () => {
    const rows: (string | number | null)[][] = [
      ['Receipt', 'Date', 'Student', 'Class', 'Section', 'Method', 'Amount', 'Balance after'],
      ...monthPayments.map((payment) => [
        payment.receipt_number, payment.payment_date, payment.student_name,
        payment.class_name, payment.section_name, payment.method, payment.amount, payment.balance_after,
      ]),
    ];
    downloadCsv(`fee-collection-${month}.csv`, toCsv(rows));
    onToast(`${monthPayments.length} receipts exported`);
  };

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Fee reports</span><h2>Collection for {monthLabel(month)}</h2></div>
          <div className="fee-quick">
            <button className="secondary-button" onClick={exportMonth}><Download size={15} /> Export CSV</button>
            <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print</button>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Fee month</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {monthOptions().map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        <div className="acct-mini-stats">
          <div><span>Month total</span><strong className="text-emerald-700">{formatMoney(monthTotal)}</strong></div>
          <div><span>Receipts</span><strong>{monthCount}</strong></div>
          <div><span>Outstanding</span><strong className="text-rose-600">{formatMoney(totalOutstanding)}</strong></div>
        </div>
      </section>

      <div className="acct-dashboard-grid">
        <section className="fee-card">
          <div className="fee-card-head"><div><span className="eyebrow">Method</span><h2>Collection by payment method</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Method</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {methods.map((row) => (
                  <tr key={row.value}>
                    <td>{row.label}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
                <tr className="acct-total-row"><td>Total</td><td className="text-right font-bold tabular-nums">{formatMoney(monthTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="fee-card">
          <div className="fee-card-head"><div><span className="eyebrow">Class-wise</span><h2>Collection by class</h2></div></div>
          {classes.length === 0 ? <p className="fee-empty">No collections recorded for this month yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th className="text-right">Receipts</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {classes.map((row) => (
                    <tr key={row.className}>
                      <td>{row.className}</td>
                      <td className="text-right tabular-nums">{row.count}</td>
                      <td className="text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="fee-card">
        <div className="fee-card-head"><div><span className="eyebrow">Date-wise</span><h2>Daily collection this month</h2></div></div>
        {days.length === 0 ? <p className="fee-empty">No collections recorded for this month yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th className="text-right">Receipts</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {days.map((row) => (
                  <tr key={row.day}>
                    <td>{formatDay(row.day)}</td>
                    <td className="text-right tabular-nums">{row.count}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Outstanding</span><h2>Balance by class</h2></div>
          <span className="fee-hint"><FileSpreadsheet size={14} /> {formatMoney(totalOutstanding)} outstanding</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Class</th><th className="text-right">Students with dues</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>
              {outstandingByClass.map((row) => (
                <tr key={row.className}>
                  <td>{row.className}</td>
                  <td className="text-right tabular-nums">{row.students}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(row.balance)}</td>
                </tr>
              ))}
              <tr className="acct-total-row"><td>Total</td><td /><td className="text-right font-bold tabular-nums">{formatMoney(totalOutstanding)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
