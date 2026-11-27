import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Banknote, CalendarClock, Loader as Loader2, Printer, RefreshCw, Trash2 } from 'lucide-react';
import {
  advanceOutstanding,
  currentMonthKey,
  deleteSalaryPayment,
  fetchPayPackages,
  fetchSalaryPayments,
  fetchStaffAdvances,
  monthLabel,
  monthOptions,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  payStaffSalary,
  previewSalary,
  suggestedAdvanceInstallment,
  type PayPackage,
  type PayrollStaff,
  type SalaryPayment,
  type StaffAdvance,
} from '@/lib/payroll';
import { fetchStaffAttendanceMonth, type StaffAttendanceRecord } from '@/lib/staffAttendance';
import { fetchUnpaidLeaveDays } from '@/lib/staffLeave';
import { SalarySlipModal } from '@/components/SalarySlipModal';
import { PersonAvatar } from '@/components/PersonAvatar';

const money = (value: number) => `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
};

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

// Pay salary and paid history are two separate entries in the staff tab bar, but they
// share one month, one set of packages and one set of payments, so they stay in one
// component and the tab only decides which view it opens on.
export function PaySalaryTab({ staff, onToast, initialView = 'pay' }: {
  staff: PayrollStaff[];
  onToast: (message: string) => void;
  initialView?: 'pay' | 'history';
}) {
  const [subView, setSubView] = useState<'pay' | 'history'>(initialView);
  const [month, setMonth] = useState(() => currentMonthKey());
  const [packages, setPackages] = useState<PayPackage[]>([]);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<StaffAttendanceRecord[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [slip, setSlip] = useState<SalaryPayment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [packageRows, advanceRows, paymentRows] = await Promise.all([
      fetchPayPackages(),
      fetchStaffAdvances(),
      fetchSalaryPayments(),
    ]);
    setPackages(packageRows);
    setAdvances(advanceRows);
    setPayments(paymentRows);
    setLoading(false);
  }, []);

  const loadAttendance = useCallback(async (forMonth: string) => {
    setAttendanceLoading(true);
    const rows = await fetchStaffAttendanceMonth(forMonth);
    setAttendance(rows);
    setAttendanceLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The tab bar drives which of the two views is showing, so a click on "Pay salary"
  // or "Paid history" above has to move this view too, not only on first mount.
  useEffect(() => { setSubView(initialView); }, [initialView]);

  // One query for the whole month, shared by every row, instead of one query per staff member.
  useEffect(() => { void loadAttendance(month); }, [loadAttendance, month]);

  const packageByStaff = useMemo(() => {
    const map = new Map<string, PayPackage>();
    for (const row of packages) map.set(row.staff_user_id, row);
    return map;
  }, [packages]);

  const paidThisMonth = useMemo(
    () => new Set(payments.filter((row) => row.period_month.slice(0, 10) === month).map((row) => row.staff_user_id)),
    [payments, month],
  );

  return (
    <div className="payroll-tab">
      <div className="att-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={subView === 'pay'} className={`att-tab ${subView === 'pay' ? 'active' : ''}`} onClick={() => setSubView('pay')}>
          Pay salary
        </button>
        <button type="button" role="tab" aria-selected={subView === 'history'} className={`att-tab ${subView === 'history' ? 'active' : ''}`} onClick={() => setSubView('history')}>
          Paid history
        </button>
      </div>

      {subView === 'pay' ? (
        <>
          <div className="panel attendance-filters-panel">
            <div className="att-filters">
              <label className="control-field">Salary month
                <select value={month} onChange={(event) => setMonth(event.target.value)}>
                  {monthOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <div className="att-quick-row">
              <p className="att-quick-hint">
                Absent and late days are counted from the staff attendance register for the chosen month. Change them on a row if you need to.
              </p>
              <button type="button" className="secondary-button" onClick={() => { void load(); void loadAttendance(month); }} disabled={loading || attendanceLoading}>
                {loading ? <Loader2 size={15} className="auth-spinner" /> : <RefreshCw size={15} />} Refresh
              </button>
            </div>
          </div>

          <div className="panel roster-panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Staff member</th><th>Basic + allowances</th><th>Absent / late</th><th>Deductions</th><th>Net salary</th><th /></tr>
                </thead>
                <tbody>
                  {staff.filter((member) => member.status === 'active').map((member) => {
                    const pkg = packageByStaff.get(member.id);
                    return (
                      <SalaryRow
                        key={member.id}
                        member={member}
                        pkg={pkg}
                        month={month}
                        alreadyPaid={paidThisMonth.has(member.id)}
                        attendance={attendance}
                        attendanceLoading={attendanceLoading}
                        advances={advances}
                        payments={payments}
                        onToast={onToast}
                        onPaid={(paid) => { setSlip(paid); void load(); }}
                      />
                    );
                  })}
                </tbody>
              </table>
              {staff.filter((member) => member.status === 'active').length === 0 && (
                <div className="empty-state large">No active staff members. Add a staff member first.</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <PaidHistory payments={payments} staff={staff} loading={loading} onToast={onToast} onChanged={() => void load()} onOpenSlip={setSlip} />
      )}

      {slip && <SalarySlipModal slip={slip} onClose={() => setSlip(null)} onToast={onToast} />}
    </div>
  );
}

function SalaryRow({ member, pkg, month, alreadyPaid, attendance, attendanceLoading, advances, payments, onToast, onPaid }: {
  member: PayrollStaff;
  pkg?: PayPackage;
  month: string;
  alreadyPaid: boolean;
  attendance: StaffAttendanceRecord[];
  attendanceLoading: boolean;
  advances: StaffAdvance[];
  payments: SalaryPayment[];
  onToast: (message: string) => void;
  onPaid: (slip: SalaryPayment) => void;
}) {
  const [absentDays, setAbsentDays] = useState('');
  const [unpaidLeaveDays, setUnpaidLeaveDays] = useState(0);
  const [lateDays, setLateDays] = useState('');
  const [advanceDeduction, setAdvanceDeduction] = useState('');
  const [otherDeduction, setOtherDeduction] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [busy, setBusy] = useState(false);

  const outstanding = advanceOutstanding(advances, payments, member.id);
  const suggested = suggestedAdvanceInstallment(advances, member.id, outstanding);

  // Approved unpaid leave is leave without pay, so it counts as an absent day on the
  // salary. The figure comes from the leave register, which means approving the leave in
  // Leave management is the only step the office has to take.
  useEffect(() => {
    let active = true;
    void fetchUnpaidLeaveDays(member.id, month).then((days) => { if (active) setUnpaidLeaveDays(days); });
    return () => { active = false; };
  }, [member.id, month]);

  // The attendance register supplies the absent and late days for the chosen month, so the
  // administrator normally only confirms what is already recorded.
  useEffect(() => {
    if (attendanceLoading) return;
    const mine = attendance.filter((row) => row.staff_user_id === member.id);
    const recorded = mine.filter((row) => row.status === 'absent').length;
    setAbsentDays(String(recorded + unpaidLeaveDays));
    setLateDays(String(mine.filter((row) => row.status === 'late').length));
  }, [attendance, attendanceLoading, member.id, month, unpaidLeaveDays]);

  useEffect(() => { setAdvanceDeduction(suggested ? String(suggested) : ''); }, [suggested]);

  const preview = pkg
    ? previewSalary({
        pkg: {
          basicSalary: Number(pkg.basic_salary),
          houseRent: Number(pkg.house_rent_allowance),
          conveyance: Number(pkg.conveyance_allowance),
          medical: Number(pkg.medical_allowance),
          otherAllowance: Number(pkg.other_allowance),
          pfPercentage: Number(pkg.pf_percentage),
          absentRate: Number(pkg.absent_deduction_rate),
          lateRate: Number(pkg.late_deduction_rate),
        },
        absentDays: toNumber(absentDays),
        lateDays: toNumber(lateDays),
        advanceDeduction: toNumber(advanceDeduction),
        otherDeduction: toNumber(otherDeduction),
      })
    : null;

  const pay = async () => {
    if (!pkg || !preview) return;
    setBusy(true);
    const { error, slip } = await payStaffSalary({
      staffUserId: member.id,
      periodMonth: month,
      absentDays: toNumber(absentDays),
      lateDays: toNumber(lateDays),
      advanceDeduction: toNumber(advanceDeduction),
      otherDeduction: toNumber(otherDeduction),
      paymentMethod,
      note: '',
    });
    setBusy(false);
    if (error) { onToast(error); return; }
    if (slip) {
      onToast(`${member.full_name}'s salary for ${monthLabel(month)} was paid.`);
      onPaid(slip);
    }
  };

  if (!pkg) {
    return (
      <tr>
        <td>
          <div className="table-student">
            <PersonAvatar photoUrl={member.photo_url} name={member.full_name} />
            <div className="payroll-name">
              <strong>{member.full_name}</strong>
              <small>{ROLE_LABELS[member.role] ?? member.role}</small>
            </div>
          </div>
        </td>
        <td className="muted-cell" colSpan={5}><span className="payroll-missing">Set up a pay package for this staff member first</span></td>
      </tr>
    );
  }

  return (
    <tr className={alreadyPaid ? 'payroll-row-paid' : ''}>
      <td>
        <div className="table-student">
          <PersonAvatar photoUrl={member.photo_url} name={member.full_name} />
          <div className="payroll-name">
            <strong>{member.full_name}</strong>
            <small>{ROLE_LABELS[member.role] ?? member.role}{outstanding > 0 ? ` · advance left ${money(outstanding)}` : ''}</small>
          </div>
        </div>
      </td>
      <td>
        <div className="payroll-inline">
          <strong>{money(preview ? preview.gross : 0)}</strong>
          <small>Basic {money(pkg.basic_salary)} + allowances {money(preview ? preview.allowances : 0)}</small>
        </div>
      </td>
      <td>
        <div className="payroll-days">
          <label>Absent
            <input inputMode="numeric" value={absentDays} onChange={(event) => setAbsentDays(event.target.value)} placeholder="0" />
          </label>
          <label>Late
            <input inputMode="numeric" value={lateDays} onChange={(event) => setLateDays(event.target.value)} placeholder="0" />
          </label>
          {attendanceLoading && <Loader2 size={13} className="auth-spinner" />}
        </div>
        {unpaidLeaveDays > 0 && (
          <div className="payroll-leave-note">
            Includes {unpaidLeaveDays} approved unpaid leave day{unpaidLeaveDays === 1 ? '' : 's'}
          </div>
        )}
      </td>
      <td>
        <div className="payroll-days">
          <label>Advance
            <input inputMode="decimal" value={advanceDeduction} onChange={(event) => setAdvanceDeduction(event.target.value)} placeholder="0" disabled={outstanding <= 0} />
          </label>
          <label>Other
            <input inputMode="decimal" value={otherDeduction} onChange={(event) => setOtherDeduction(event.target.value)} placeholder="0" />
          </label>
        </div>
        <div className="payroll-deduction-note">
          PF {money(preview ? preview.pfDeduction : 0)} · total {money(preview ? preview.totalDeductions : 0)}
        </div>
      </td>
      <td>
        <strong className="payroll-net">{money(preview ? preview.net : 0)}</strong>
      </td>
      <td>
        {alreadyPaid ? (
          <span className="status-pill"><BadgeCheck size={13} /> Paid</span>
        ) : (
          <div className="payroll-pay-actions">
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
            </select>
            <button type="button" className="primary-button" onClick={() => void pay()} disabled={busy}>
              {busy ? <Loader2 size={15} className="auth-spinner" /> : <Banknote size={15} />} Mark paid
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function PaidHistory({ payments, staff, loading, onToast, onChanged, onOpenSlip }: {
  payments: SalaryPayment[];
  staff: PayrollStaff[];
  loading: boolean;
  onToast: (message: string) => void;
  onChanged: () => void;
  onOpenSlip: (slip: SalaryPayment) => void;
}) {
  const [monthFilter, setMonthFilter] = useState('all');
  const [staffFilter, setStaffFilter] = useState('all');

  const months = useMemo(() => {
    const seen = new Set(payments.map((row) => row.period_month.slice(0, 10)));
    return [...seen].sort((a, b) => b.localeCompare(a));
  }, [payments]);

  const filtered = payments.filter((row) => {
    if (monthFilter !== 'all' && row.period_month.slice(0, 10) !== monthFilter) return false;
    if (staffFilter !== 'all' && row.staff_user_id !== staffFilter) return false;
    return true;
  });

  const totals = filtered.reduce((summary, row) => ({
    gross: summary.gross + Number(row.gross_salary),
    deductions: summary.deductions + Number(row.total_deductions),
    net: summary.net + Number(row.net_salary),
  }), { gross: 0, deductions: 0, net: 0 });

  const undo = async (row: SalaryPayment) => {
    const { error } = await deleteSalaryPayment(row.id);
    if (error) { onToast(error); return; }
    onToast(`${row.staff_name}'s salary payment for ${monthLabel(row.period_month)} was undone.`);
    onChanged();
  };

  return (
    <>
      <div className="payroll-stats">
        <div className="payroll-stat"><Banknote size={18} /><strong>{filtered.length}</strong><span>Salary payments</span></div>
        <div className="payroll-stat"><CalendarClock size={18} /><strong>{money(totals.deductions)}</strong><span>Total deductions</span></div>
        <div className="payroll-stat wide"><Banknote size={18} /><strong>{money(totals.net)}</strong><span>Net salary paid</span></div>
      </div>

      <div className="panel roster-panel">
        <div className="table-toolbar">
          <div className="att-filters payroll-history-filters">
            <label className="control-field">Month
              <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
                <option value="all">All months</option>
                {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
              </select>
            </label>
            <label className="control-field">Staff member
              <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}>
                <option value="all">All staff</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}
              </select>
            </label>
          </div>
          <span className="result-count">{filtered.length} records</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Month</th><th>Staff member</th><th>Gross</th><th>Deductions</th><th>Net paid</th><th>Paid on</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td><strong>{monthLabel(row.period_month)}</strong></td>
                  <td>
                    <div className="payroll-name">
                      <strong>{row.staff_name}</strong>
                      <small>{ROLE_LABELS[row.staff_role] ?? row.staff_role}</small>
                    </div>
                  </td>
                  <td className="muted-cell">{money(row.gross_salary)}</td>
                  <td className="muted-cell">{money(row.total_deductions)}</td>
                  <td><strong>{money(row.net_salary)}</strong></td>
                  <td className="muted-cell">
                    {new Date(`${row.paid_on.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    <small className="payroll-method">{row.payment_method}</small>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={() => onOpenSlip(row)} title="Open salary slip">
                        <Printer size={15} />
                      </button>
                      <button className="row-action-btn row-action-danger" onClick={() => void undo(row)} title="Undo this payment">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-state large">{loading ? 'Loading paid salaries…' : 'No paid salaries match these filters yet.'}</div>
          )}
        </div>
      </div>
    </>
  );
}
