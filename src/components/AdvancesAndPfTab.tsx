import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Landmark, Loader as Loader2, PiggyBank, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import {
  advanceOutstanding,
  closeStaffAdvance,
  deleteStaffAdvance,
  fetchPfContributions,
  fetchSalaryPayments,
  fetchStaffAdvances,
  monthLabel,
  pfTotals,
  saveStaffAdvance,
  type PfContribution,
  type PayrollStaff,
  type SalaryPayment,
  type StaffAdvance,
} from '@/lib/payroll';
import { todayKey } from '@/lib/attendance';
import { PersonAvatar } from '@/components/PersonAvatar';

const money = (value: number) => `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
};

// Salary advances and the provident fund live side by side because the office works on
// them together: one is money lent to a staff member, the other is money saved for them.
// Salary advances and the provident fund are two entries in the staff tab bar but they
// read the same advances, contributions and payments, so they stay in one component and
// the tab only decides which view it opens on.
export function AdvancesAndPfTab({ staff, onToast, initialView = 'advances' }: {
  staff: PayrollStaff[];
  onToast: (message: string) => void;
  initialView?: 'advances' | 'pf';
}) {
  const [subView, setSubView] = useState<'advances' | 'pf'>(initialView);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [contributions, setContributions] = useState<PfContribution[]>([]);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdvance, setShowAdvance] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [advanceRows, pfRows, paymentRows] = await Promise.all([
      fetchStaffAdvances(),
      fetchPfContributions(),
      fetchSalaryPayments(),
    ]);
    setAdvances(advanceRows);
    setContributions(pfRows);
    setPayments(paymentRows);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The tab bar drives which of the two views is showing, so switching tabs above has to
  // move this view too. The search box is cleared because the two views search different
  // things, so a term typed for one would silently hide rows in the other.
  useEffect(() => { setSubView(initialView); setSearch(''); }, [initialView]);

  const staffById = useMemo(() => {
    const map = new Map<string, PayrollStaff>();
    for (const member of staff) map.set(member.id, member);
    return map;
  }, [staff]);

  const filteredAdvances = advances.filter((row) => {
    if (!search.trim()) return true;
    const member = staffById.get(row.staff_user_id);
    return `${member?.full_name ?? ''} ${row.purpose ?? ''}`.toLowerCase().includes(search.toLowerCase());
  });

  const activeAdvances = advances.filter((row) => row.status === 'active');
  const totalOutstanding = activeAdvances.reduce((sum, row) => sum + advanceOutstanding([row], payments, row.staff_user_id), 0);

  const settleAdvance = async (row: StaffAdvance) => {
    const { error } = await closeStaffAdvance(row.id);
    if (error) { onToast(error); return; }
    onToast('The advance was marked as settled.');
    void load();
  };

  const removeAdvance = async (row: StaffAdvance) => {
    const { error } = await deleteStaffAdvance(row.id);
    if (error) { onToast(error); return; }
    onToast('The advance was removed.');
    void load();
  };

  const pfRows = useMemo(() => {
    return staff
      .map((member) => ({ member, totals: pfTotals(contributions, member.id) }))
      .filter((row) => row.totals.months > 0)
      .filter((row) => !search.trim() || `${row.member.full_name} ${ROLE_LABELS[row.member.role] ?? ''}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.member.full_name.localeCompare(b.member.full_name));
  }, [staff, contributions, search]);

  const fundBalance = contributions.reduce((sum, row) => sum + Number(row.employee_contribution) + Number(row.school_contribution), 0);

  return (
    <div className="payroll-tab">
      {subView === 'advances' ? (
        <>
          <div className="payroll-stats">
            <div className="payroll-stat"><Landmark size={18} /><strong>{activeAdvances.length}</strong><span>Advances running</span></div>
            <div className="payroll-stat wide"><Landmark size={18} /><strong>{money(totalOutstanding)}</strong><span>Still to recover</span></div>
          </div>

          <div className="panel roster-panel">
            <div className="table-toolbar">
              <div className="search-field">
                <Search size={18} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or purpose" />
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
                  {loading ? <Loader2 size={15} className="auth-spinner" /> : <RefreshCw size={15} />} Refresh
                </button>
                <button type="button" className="primary-button" onClick={() => setShowAdvance(true)}><Plus size={16} /> New advance</button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Staff member</th><th>Date given</th><th>Amount</th><th>Monthly instalment</th><th>Recovered</th><th>Outstanding</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {filteredAdvances.map((row) => {
                    const member = staffById.get(row.staff_user_id);
                    const outstanding = advanceOutstanding([row], payments, row.staff_user_id);
                    const recovered = Math.max(Number(row.amount) - outstanding, 0);
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="table-student">
                            <PersonAvatar photoUrl={member?.photo_url} name={member?.full_name ?? '?'} />
                            <div className="payroll-name">
                              <strong>{member?.full_name ?? 'Removed staff member'}</strong>
                              {row.purpose ? <small>{row.purpose}</small> : null}
                            </div>
                          </div>
                        </td>
                        <td className="muted-cell">{new Date(`${row.advance_date.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td><strong>{money(row.amount)}</strong></td>
                        <td className="muted-cell">{money(row.monthly_installment)}</td>
                        <td className="muted-cell">{money(recovered)}</td>
                        <td><strong>{money(outstanding)}</strong></td>
                        <td>
                          <span className={`status-pill ${row.status === 'closed' ? '' : 'status-pending'}`}>
                            {row.status === 'closed' ? 'Settled' : 'Running'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            {row.status === 'active' && (
                              <button className="row-action-btn" onClick={() => void settleAdvance(row)} title="Mark as settled">
                                <BadgeCheck size={15} />
                              </button>
                            )}
                            {recovered === 0 && (
                              <button className="row-action-btn row-action-danger" onClick={() => void removeAdvance(row)} title="Remove this advance">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAdvances.length === 0 && (
                <div className="empty-state large">{loading ? 'Loading advances…' : 'No salary advances recorded yet.'}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="payroll-stats">
            <div className="payroll-stat"><PiggyBank size={18} /><strong>{money(fundBalance)}</strong><span>Total fund balance</span></div>
            <div className="payroll-stat"><PiggyBank size={18} /><strong>{contributions.length}</strong><span>Monthly contributions</span></div>
          </div>

          <div className="panel roster-panel">
            <div className="table-toolbar">
              <div className="search-field">
                <Search size={18} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or role" />
              </div>
              <span className="result-count">{pfRows.length} staff</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Staff member</th><th>Months</th><th>Employee share</th><th>School share</th><th>Accumulated balance</th></tr>
                </thead>
                <tbody>
                  {pfRows.map(({ member, totals }) => (
                    <tr key={member.id}>
                      <td>
                        <div className="table-student">
                          <PersonAvatar photoUrl={member.photo_url} name={member.full_name} />
                          <div className="payroll-name">
                            <strong>{member.full_name}</strong>
                            <small>{ROLE_LABELS[member.role] ?? member.role}</small>
                          </div>
                        </div>
                      </td>
                      <td className="muted-cell">{totals.months}</td>
                      <td className="muted-cell">{money(totals.employee)}</td>
                      <td className="muted-cell">{money(totals.school)}</td>
                      <td><strong>{money(totals.balance)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pfRows.length === 0 && (
                <div className="empty-state large">
                  {loading ? 'Loading provident fund…' : 'No provident fund contributions yet. They appear automatically each time a salary with PF is paid.'}
                </div>
              )}
            </div>
          </div>

          {pfRows.length > 0 && (
            <div className="panel roster-panel payroll-ledger">
              <div className="attendance-toolbar">
                <div>
                  <strong>Contribution ledger</strong>
                  <span>Every month recorded, newest first</span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Month</th><th>Staff member</th><th>Basic salary</th><th>Employee</th><th>School</th></tr>
                  </thead>
                  <tbody>
                    {contributions.slice(0, 60).map((row) => (
                      <tr key={row.id}>
                        <td><strong>{monthLabel(row.period_month)}</strong></td>
                        <td>{staffById.get(row.staff_user_id)?.full_name ?? 'Removed staff member'}</td>
                        <td className="muted-cell">{money(row.basic_salary)}</td>
                        <td className="muted-cell">{money(row.employee_contribution)}</td>
                        <td className="muted-cell">{money(row.school_contribution)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showAdvance && (
        <AdvanceModal
          staff={staff.filter((member) => member.status === 'active')}
          onClose={() => setShowAdvance(false)}
          onSaved={() => { setShowAdvance(false); void load(); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function AdvanceModal({ staff, onClose, onSaved, onToast }: {
  staff: PayrollStaff[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [staffUserId, setStaffUserId] = useState('');
  const [advanceDate, setAdvanceDate] = useState(() => todayKey());
  const [amount, setAmount] = useState('');
  const [installment, setInstallment] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!staffUserId) { setError('Choose the staff member.'); return; }
    if (!(Number(amount) > 0)) { setError('Enter the advance amount.'); return; }
    if (Number(installment) > Number(amount)) { setError('The monthly instalment cannot be more than the advance amount.'); return; }
    setBusy(true);
    const { error: saveError } = await saveStaffAdvance({
      staffUserId,
      advanceDate,
      amount: Number(amount),
      monthlyInstallment: Number(installment) || 0,
      purpose,
    });
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    onToast('The salary advance was recorded.');
    onSaved();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal payroll-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Landmark size={14} /> New salary advance</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">Record an advance</h2>
        <p className="payroll-modal-sub">The monthly instalment is recovered automatically when that month's salary is paid.</p>

        <div className="payroll-form-grid">
          <label className="control-field full">Staff member
            <select value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)}>
              <option value="">Choose a staff member</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>{member.full_name} — {ROLE_LABELS[member.role] ?? member.role}</option>
              ))}
            </select>
          </label>
          <label className="control-field">Date given
            <input type="date" value={advanceDate} onChange={(event) => setAdvanceDate(event.target.value)} />
          </label>
          <label className="control-field">Advance amount
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 20000" />
          </label>
          <label className="control-field">Monthly instalment
            <input inputMode="decimal" value={installment} onChange={(event) => setInstallment(event.target.value)} placeholder="e.g. 5000" />
          </label>
          <label className="control-field full">Purpose
            <input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Optional, e.g. medical" maxLength={200} />
          </label>
        </div>

        {error && <div className="auth-error"><span>{error}</span></div>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={16} className="auth-spinner" /> : <Plus size={16} />} Record advance
          </button>
        </div>
      </section>
    </div>
  );
}
