import { useMemo } from 'react';
import {
  AlertCircle, BadgeDollarSign, BellRing, CalendarClock, Coins, FileSpreadsheet,
  Printer, Search, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { formatDay, formatMoney, monthLabel, paymentsOn, type FeePayment } from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';
import type { AccountantView } from '@/components/AccountantPortal';

export type DashboardStats = {
  totalStudents: number;
  collectedToday: number;
  collectedMonth: number;
  outstanding: number;
  paidStudents: number;
  unpaidStudents: number;
  partialStudents: number;
  transactionsToday: number;
};

function Kpi({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`fee-kpi ${tone}`}>
      <div className="fee-kpi-icon">{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  );
}

// The accountant's landing page. Every figure is worked out from the records that were
// actually loaded — the student list and the payment receipts — so nothing here is a
// placeholder. Voided receipts are left out of every collection total.
export function AccountantDashboard({ students, payments, loading, error, today, month, onNavigate, onCollect }: {
  students: Student[];
  payments: FeePayment[];
  loading: boolean;
  error: string;
  today: string;
  month: string;
  onNavigate: (view: AccountantView) => void;
  onCollect: (studentId: string) => void;
}) {
  const stats = useMemo<DashboardStats>(() => {
    const active = students.filter((student) => student.status === 'active');
    const activePayments = payments.filter((payment) => !payment.voided);
    const todayPayments = paymentsOn(payments, today);
    const monthPayments = activePayments.filter((payment) => (payment.payment_date ?? '').slice(0, 7) === month);
    const paidThisMonth = new Set(monthPayments.map((payment) => payment.student_id));

    const outstanding = active.reduce((total, student) => total + Math.max(0, Number(student.fee_balance ?? 0)), 0);
    const paidStudents = active.filter((student) => Number(student.fee_balance ?? 0) <= 0).length;
    const unpaidStudents = active.filter((student) => Number(student.fee_balance ?? 0) > 0 && !paidThisMonth.has(student.id)).length;
    const partialStudents = active.filter((student) => Number(student.fee_balance ?? 0) > 0 && paidThisMonth.has(student.id)).length;

    return {
      totalStudents: active.length,
      collectedToday: todayPayments.reduce((total, payment) => total + Number(payment.amount), 0),
      collectedMonth: monthPayments.reduce((total, payment) => total + Number(payment.amount), 0),
      outstanding,
      paidStudents,
      unpaidStudents,
      partialStudents,
      transactionsToday: todayPayments.length,
    };
  }, [students, payments, today, month]);

  const recent = payments.filter((payment) => !payment.voided).slice(0, 8);
  const upcomingDues = useMemo(() => students
    .filter((student) => student.status === 'active' && Number(student.fee_balance ?? 0) > 0)
    .sort((a, b) => Number(b.fee_balance ?? 0) - Number(a.fee_balance ?? 0))
    .slice(0, 6), [students]);

  return (
    <div className="fee-section">
      {error && (
        <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>
      )}

      <div className="fee-kpi-grid">
        <Kpi label="Enrolled students" value={loading ? '—' : String(stats.totalStudents)} detail="Active on the roster" tone="sky" icon={<Users size={20} />} />
        <Kpi label="Collected today" value={loading ? '—' : formatMoney(stats.collectedToday)} detail={`${stats.transactionsToday} receipt${stats.transactionsToday === 1 ? '' : 's'} today`} tone="mint" icon={<Coins size={20} />} />
        <Kpi label="Collected this month" value={loading ? '—' : formatMoney(stats.collectedMonth)} detail={monthLabel(month)} tone="sky" icon={<TrendingUp size={20} />} />
        <Kpi label="Outstanding balance" value={loading ? '—' : formatMoney(stats.outstanding)} detail="Still to be collected" tone="sun" icon={<FileSpreadsheet size={20} />} />
      </div>

      <div className="fee-kpi-grid fee-kpi-grid-4">
        <Kpi label="Paid students" value={loading ? '—' : String(stats.paidStudents)} detail="Balance cleared" tone="mint" icon={<BadgeDollarSign size={20} />} />
        <Kpi label="Partial payment" value={loading ? '—' : String(stats.partialStudents)} detail="Paid something this month" tone="sun" icon={<Wallet size={20} />} />
        <Kpi label="Unpaid students" value={loading ? '—' : String(stats.unpaidStudents)} detail="No payment this month" tone="coral" icon={<BellRing size={20} />} />
        <Kpi label="Today's receipts" value={loading ? '—' : String(stats.transactionsToday)} detail="Ready for daily closing" tone="sky" icon={<CalendarClock size={20} />} />
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Quick actions</span><h2>What would you like to do?</h2></div>
        </div>
        <div className="acct-quick-actions">
          <button className="acct-action mint" onClick={() => onNavigate('receive')}><Coins size={22} /><strong>Receive Fee</strong><span>Record a payment and print a receipt</span></button>
          <button className="acct-action sky" onClick={() => onNavigate('search')}><Search size={22} /><strong>Student Fee Search</strong><span>Look up a student and their balance</span></button>
          <button className="acct-action sun" onClick={() => onNavigate('reports')}><FileSpreadsheet size={22} /><strong>Fee Reports</strong><span>Class, date and monthly collection</span></button>
          <button className="acct-action coral" onClick={() => onNavigate('closing')}><Printer size={22} /><strong>Daily Closing</strong><span>Count the day and print the summary</span></button>
        </div>
      </section>

      <div className="acct-dashboard-grid">
        <section className="fee-card">
          <div className="fee-card-head">
            <div><span className="eyebrow">Latest activity</span><h2>Recent payment transactions</h2></div>
            <button className="fee-link" onClick={() => onNavigate('receive')}>Open collection</button>
          </div>
          {loading ? <p className="fee-empty">Loading transactions…</p> : recent.length === 0 ? (
            <p className="fee-empty">No payments have been recorded yet. Use Receive Fee to issue the first receipt.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Receipt</th><th>Student</th><th>Method</th><th className="text-right">Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {recent.map((payment) => (
                    <tr key={payment.id}>
                      <td className="fee-mono">{payment.receipt_number}</td>
                      <td><strong>{payment.student_name}</strong><small className="fee-sub">{payment.class_name ?? '—'} · {payment.section_name ?? '—'}</small></td>
                      <td className="capitalize">{payment.method}</td>
                      <td className="text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                      <td>{formatDay(payment.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="fee-card">
          <div className="fee-card-head">
            <div><span className="eyebrow">Follow-up</span><h2>Upcoming fee dues</h2></div>
            <button className="fee-link" onClick={() => onNavigate('defaulters')}>All defaulters</button>
          </div>
          {loading ? <p className="fee-empty">Loading dues…</p> : upcomingDues.length === 0 ? (
            <p className="fee-empty">Every active student has cleared their dues.</p>
          ) : (
            <ul className="acct-due-list">
              {upcomingDues.map((student) => (
                <li key={student.id}>
                  <div>
                    <strong>{student.full_name}</strong>
                    <span>{student.class_name} · Section {student.section_name} · {student.admission_number}</span>
                  </div>
                  <div className="acct-due-right">
                    <b>{formatMoney(Number(student.fee_balance ?? 0))}</b>
                    <button className="fee-link" onClick={() => onCollect(student.id)}>Collect</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
