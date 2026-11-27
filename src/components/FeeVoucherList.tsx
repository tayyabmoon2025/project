import { useMemo, useState } from 'react';
import { PencilLine, Printer, Trash2 } from 'lucide-react';
import {
  formatDay, formatMoney, monthKey, monthLabel, monthOptions, paymentsInMonth, totalCollected,
  type FeePayment,
} from '@/lib/fees';

// The submitted vouchers, filtered by fee month and by date, with the money collected
// across the filtered rows added up at the bottom. Every figure comes from the receipts
// actually on file.
export function FeeVoucherList({ payments, loading, onEdit, onDelete, onPrint }: {
  payments: FeePayment[];
  loading: boolean;
  onEdit: (payment: FeePayment) => void;
  onDelete: (payment: FeePayment) => void;
  onPrint: (payment: FeePayment) => void;
}) {
  const [month, setMonth] = useState(monthKey());
  const [day, setDay] = useState('');

  const rows = useMemo(() => {
    const inMonth = paymentsInMonth(payments, month);
    return day ? inMonth.filter((payment) => payment.payment_date === day) : inMonth;
  }, [payments, month, day]);

  const collected = totalCollected(rows);
  const reversed = rows.filter((payment) => payment.voided);
  const reversedAmount = reversed.reduce((total, payment) => total + Number(payment.amount), 0);

  return (
    <section className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Submitted vouchers</span>
          <h2>Fee vouchers · {monthLabel(month)}</h2>
          <p className="fee-sub">Correct a voucher, delete one that should never have been recorded, or reprint its Acknowledgment receipt.</p>
        </div>
        <span className="fee-hint">{rows.length} voucher{rows.length === 1 ? '' : 's'}</span>
      </div>

      <div className="fee-filters">
        <label className="control-field"><span>Fee month</span>
          <select value={month} onChange={(event) => { setMonth(event.target.value); setDay(''); }}>
            {monthOptions().map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </select>
        </label>
        <label className="control-field"><span>Date</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        {day && (
          <div className="fee-filter-reset">
            <button type="button" className="secondary-button" onClick={() => setDay('')}>Show the whole month</button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="fee-empty">Loading vouchers…</p>
      ) : rows.length === 0 ? (
        <p className="fee-empty">
          {day ? 'No vouchers were issued on this date.' : 'No vouchers have been submitted in this fee month yet.'}
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Receipt</th><th>Date</th><th>Student</th><th>Class</th>
                  <th className="text-right">Payable</th><th className="text-right">Paid</th>
                  <th className="text-right">Balance</th><th>Status</th><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => (
                  <tr key={payment.id} className={payment.voided ? 'acct-void-row' : ''}>
                    <td className="fee-mono">
                      {payment.receipt_number}
                      {payment.edit_count > 0 && <small className="fee-sub">Corrected {payment.edit_count}×</small>}
                    </td>
                    <td>{formatDay(payment.payment_date)}</td>
                    <td>
                      <strong>{payment.student_name}</strong>
                      <small className="fee-sub">{payment.admission_number ?? '—'}</small>
                    </td>
                    <td>{payment.class_name ?? '—'} · {payment.section_name ?? '—'}</td>
                    <td className="text-right tabular-nums">{payment.payable_fee === null ? '—' : formatMoney(payment.payable_fee)}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                    <td className="text-right tabular-nums">{formatMoney(payment.balance_after)}</td>
                    <td>{payment.voided ? <span className="fee-status unpaid">Reversed</span> : <span className="fee-status paid">Recorded</span>}</td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => onEdit(payment)} disabled={payment.voided}>
                          <PencilLine size={14} /> Edit
                        </button>
                        <button type="button" className="fee-link" onClick={() => onPrint(payment)}><Printer size={14} /> Print</button>
                        <button type="button" className="fee-link danger" onClick={() => onDelete(payment)}>
                          <Trash2 size={14} /> Del
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fee-total-row">
                  <td colSpan={5}>Total collected ({rows.length} voucher{rows.length === 1 ? '' : 's'})</td>
                  <td className="text-right tabular-nums">{formatMoney(collected)}</td>
                  <td colSpan={3} />
                </tr>
                {reversed.length > 0 && (
                  <tr className="fee-total-row muted">
                    <td colSpan={5}>Reversed vouchers excluded from the total ({reversed.length})</td>
                    <td className="text-right tabular-nums">{formatMoney(reversedAmount)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
