import { useMemo, useState } from 'react';
import { Coins, Printer, RefreshCw, RotateCcw, Search, Wallet, X } from 'lucide-react';
import { FeeReceiptView } from '@/components/FeeDocuments';
import { VoidPaymentModal } from '@/components/VoidPaymentModal';
import { formatDay, formatMoney, monthlyChargeFor, type FeePayment, type FeeStructure } from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';
import { useFamilyDiscounts } from '@/lib/useFamilyDiscounts';

type StatusFilter = 'all' | 'paid' | 'partial' | 'unpaid';

type LedgerRow = {
  student: Student;
  monthlyFee: number;
  paidThisMonth: number;
  balance: number;
  status: Exclude<StatusFilter, 'all'>;
  lastPayment: string | null;
};

// The student fee ledger: every active student with what they owe, what they have paid
// this month and a full payment history they can be handed a receipt for. Reversing a
// payment is done from here too, always with a reason, and never by deleting anything.
export function AccountantLedger({ students, structures, payments, loading, error, month, onToast, onChanged, onCollect }: {
  students: Student[];
  structures: FeeStructure[];
  payments: FeePayment[];
  loading: boolean;
  error: string;
  month: string;
  onToast: (message: string) => void;
  onChanged: () => Promise<void>;
  onCollect: (studentId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [openStudent, setOpenStudent] = useState<Student | null>(null);

  const classList = useMemo(() => Array.from(new Set(students.map((student) => student.class_name))).sort(), [students]);
  // The family discount comes from the Fee Structure "Brothers and sisters" rules, so the
  // ledger shows the same reduction the challan was raised with.
  const familyDiscounts = useFamilyDiscounts(students);
  const sectionList = useMemo(() => Array.from(new Set(
    students.filter((student) => !classFilter || student.class_name === classFilter).map((student) => student.section_name),
  )).sort(), [students, classFilter]);

  const rows = useMemo<LedgerRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return students
      .map((student) => {
        const structure = structures.find((row) => row.class_name === student.class_name);
        const { currentMonthlyFee } = monthlyChargeFor(student, structure, familyDiscounts.percentageFor(student));
        const own = payments.filter((payment) => payment.student_id === student.id && !payment.voided);
        const paidThisMonth = own
          .filter((payment) => (payment.payment_date ?? '').slice(0, 7) === month)
          .reduce((total, payment) => total + Number(payment.amount), 0);
        const balance = Math.max(0, Number(student.fee_balance ?? 0));
        const lastPayment = own.reduce<string | null>((latest, payment) => (!latest || payment.payment_date > latest ? payment.payment_date : latest), null);
        return {
          student,
          monthlyFee: currentMonthlyFee,
          paidThisMonth,
          balance,
          status: (balance <= 0 ? 'paid' : paidThisMonth > 0 ? 'partial' : 'unpaid') as LedgerRow['status'],
          lastPayment,
        };
      })
      .filter((row) => {
        if (classFilter && row.student.class_name !== classFilter) return false;
        if (sectionFilter && row.student.section_name !== sectionFilter) return false;
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (!needle) return true;
        return [row.student.full_name, row.student.admission_number, row.student.guardian_name, row.student.guardian_phone]
          .some((value) => (value ?? '').toLowerCase().includes(needle));
      })
      .sort((a, b) => b.balance - a.balance);
  }, [students, structures, payments, month, search, classFilter, sectionFilter, statusFilter]);

  const totals = rows.reduce((acc, row) => ({
    fee: acc.fee + row.monthlyFee,
    paid: acc.paid + row.paidThisMonth,
    balance: acc.balance + row.balance,
  }), { fee: 0, paid: 0, balance: 0 });

  const counts = {
    paid: rows.filter((row) => row.status === 'paid').length,
    partial: rows.filter((row) => row.status === 'partial').length,
    unpaid: rows.filter((row) => row.status === 'unpaid').length,
  };

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Student fee ledger</span><h2>{rows.length} students · {formatMoney(totals.balance)} outstanding</h2></div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, admission no., guardian or phone" />
          </label>
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter(''); }}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Section</span>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="">All sections</option>
              {sectionList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Payment status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All students</option>
              <option value="paid">Fully paid</option>
              <option value="partial">Partial payment</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
        </div>
        <div className="acct-mini-stats">
          <div><span>Fully paid</span><strong className="text-emerald-700">{counts.paid}</strong></div>
          <div><span>Partial</span><strong className="text-amber-600">{counts.partial}</strong></div>
          <div><span>Unpaid</span><strong className="text-rose-600">{counts.unpaid}</strong></div>
          <div><span>Monthly fee</span><strong>{formatMoney(totals.fee)}</strong></div>
          <div><span>Collected this month</span><strong className="text-emerald-700">{formatMoney(totals.paid)}</strong></div>
        </div>
      </section>

      <section className="fee-card">
        {error && <p className="fee-error">{error}</p>}
        {loading ? <p className="fee-empty">Loading the ledger…</p> : rows.length === 0 ? (
          <p className="fee-empty">No students match these filters. Try clearing the search or choosing another class.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Class</th><th>Guardian</th>
                  <th className="text-right">Monthly fee</th><th className="text-right">Paid this month</th>
                  <th className="text-right">Balance</th><th>Status</th><th>Last payment</th><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.student.id}>
                    <td><strong>{row.student.full_name}</strong><small className="fee-sub">{row.student.admission_number}</small></td>
                    <td>{row.student.class_name} · {row.student.section_name}</td>
                    <td>{row.student.guardian_name || row.student.fathers_name || '—'}<small className="fee-sub">{row.student.guardian_phone || '—'}</small></td>
                    <td className="text-right tabular-nums">{formatMoney(row.monthlyFee)}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.paidThisMonth)}</td>
                    <td className={`text-right font-semibold tabular-nums ${row.balance > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(row.balance)}</td>
                    <td><span className={`fee-status ${row.status}`}>{row.status === 'paid' ? 'Paid' : row.status === 'partial' ? 'Partial' : 'Unpaid'}</span></td>
                    <td>{row.lastPayment ? formatDay(row.lastPayment) : 'No payment yet'}</td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => setOpenStudent(row.student)}><Search size={14} /> History</button>
                        <button type="button" className="fee-link" onClick={() => onCollect(row.student.id)}><Wallet size={14} /> Collect</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="fee-quick no-print">
        <button className="secondary-button" onClick={() => void onChanged()}><RefreshCw size={15} /> Refresh ledger</button>
        <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print ledger</button>
      </div>

      {openStudent && (
        <StudentLedgerModal
          student={openStudent}
          payments={payments.filter((payment) => payment.student_id === openStudent.id)}
          onClose={() => setOpenStudent(null)}
          onToast={onToast}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

// One student's complete payment history, with a reprint for any receipt and a
// reversal (with reason) for a payment that was recorded in error.
function StudentLedgerModal({ student, payments, onClose, onToast, onChanged }: {
  student: Student;
  payments: FeePayment[];
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [printing, setPrinting] = useState<FeePayment | null>(null);
  const [voiding, setVoiding] = useState<FeePayment | null>(null);
  const sorted = [...payments].sort((a, b) => (b.payment_date + (b.created_at ?? '')).localeCompare(a.payment_date + (a.created_at ?? '')));
  const paidTotal = sorted.filter((payment) => !payment.voided).reduce((total, payment) => total + Number(payment.amount), 0);
  const reversedTotal = sorted.filter((payment) => payment.voided).reduce((total, payment) => total + Number(payment.amount), 0);

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal acct-ledger-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Fee ledger</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{student.full_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{student.admission_number} · {student.class_name} · Section {student.section_name}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <dl className="fee-summary mt-4">
          <div className="strong"><dt>Current balance</dt><dd>{formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</dd></div>
          <div><dt>Total paid</dt><dd className="credit">{formatMoney(paidTotal)}</dd></div>
          <div><dt>Reversed</dt><dd>{formatMoney(reversedTotal)}</dd></div>
        </dl>

        {sorted.length === 0 ? (
          <p className="fee-empty">No payments have been recorded for this student yet.</p>
        ) : (
          <div className="table-wrap mt-4">
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="text-right">Amount</th><th>Recorded by</th><th className="no-print" /></tr></thead>
              <tbody>
                {sorted.map((payment) => (
                  <tr key={payment.id} className={payment.voided ? 'acct-void-row' : ''}>
                    <td className="fee-mono">{payment.receipt_number}</td>
                    <td>{formatDay(payment.payment_date)}</td>
                    <td className="capitalize">{payment.method}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                    <td>{payment.voided ? <span className="fee-status unpaid">Reversed{payment.void_reason ? ` · ${payment.void_reason}` : ''}</span> : <span className="fee-status paid">Recorded</span>}</td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => setPrinting(payment)}><Printer size={14} /> Receipt</button>
                        {!payment.voided && <button type="button" className="fee-link danger" onClick={() => setVoiding(payment)}><RotateCcw size={14} /> Reverse</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="fee-hint mt-4"><Coins size={14} /> A reversed payment is never deleted. It stays on this list, marked with its reason.</p>
      </section>

      {printing && <FeeReceiptView payment={printing} student={student} summary={null} onClose={() => setPrinting(null)} />}
      {voiding && (
        <VoidPaymentModal
          payment={voiding}
          onClose={() => setVoiding(null)}
          onDone={async (message) => { onToast(message); await onChanged(); }}
        />
      )}
    </div>
  );
}
