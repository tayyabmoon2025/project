import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader as Loader2, Pencil, Plus, RefreshCw, Search, Wallet, X } from 'lucide-react';
import {
  allowanceTotal,
  fetchPayPackages,
  packageGross,
  packagePf,
  saveStaffPayPackage,
  type PayPackage,
  type PayrollStaff,
} from '@/lib/payroll';
import { PersonAvatar } from '@/components/PersonAvatar';

const money = (value: number) => `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
};

type Draft = {
  basicSalary: string;
  houseRent: string;
  conveyance: string;
  medical: string;
  otherAllowance: string;
  pfPercentage: string;
  absentRate: string;
  lateRate: string;
  effectiveFrom: string;
  notes: string;
};

const emptyDraft = (row?: PayPackage): Draft => ({
  basicSalary: row ? String(row.basic_salary) : '',
  houseRent: row ? String(row.house_rent_allowance) : '',
  conveyance: row ? String(row.conveyance_allowance) : '',
  medical: row ? String(row.medical_allowance) : '',
  otherAllowance: row ? String(row.other_allowance) : '',
  pfPercentage: row ? String(row.pf_percentage) : '0',
  absentRate: row ? String(row.absent_deduction_rate) : '0',
  lateRate: row ? String(row.late_deduction_rate) : '0',
  effectiveFrom: row?.effective_from ? row.effective_from.slice(0, 10) : '',
  notes: row?.notes ?? '',
});

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function PayPackagesTab({ staff, onToast }: { staff: PayrollStaff[]; onToast: (message: string) => void }) {
  const [packages, setPackages] = useState<PayPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ member: PayrollStaff; row?: PayPackage } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPackages(await fetchPayPackages());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byStaff = useMemo(() => {
    const map = new Map<string, PayPackage>();
    for (const row of packages) map.set(row.staff_user_id, row);
    return map;
  }, [packages]);

  const activeStaff = useMemo(() => staff.filter((member) => member.status === 'active'), [staff]);

  const filtered = activeStaff.filter((member) => {
    if (!search.trim()) return true;
    return `${member.full_name} ${member.username} ${ROLE_LABELS[member.role] ?? ''}`.toLowerCase().includes(search.toLowerCase());
  });

  const configuredCount = activeStaff.filter((member) => byStaff.has(member.id)).length;
  const monthlyTotal = activeStaff.reduce((sum, member) => {
    const row = byStaff.get(member.id);
    return row ? sum + packageGross(row) : sum;
  }, 0);

  return (
    <div className="payroll-tab">
      <div className="payroll-stats">
        <div className="payroll-stat"><Wallet size={18} /><strong>{configuredCount}</strong><span>Pay packages set</span></div>
        <div className="payroll-stat"><Wallet size={18} /><strong>{activeStaff.length - configuredCount}</strong><span>Still to configure</span></div>
        <div className="payroll-stat wide"><Wallet size={18} /><strong>{money(monthlyTotal)}</strong><span>Gross salary bill each month</span></div>
      </div>

      <div className="panel roster-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, username or role" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={15} className="auth-spinner" /> : <RefreshCw size={15} />} Refresh
            </button>
            <span className="result-count">{filtered.length} staff</span>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Basic salary</th>
                <th>Allowances</th>
                <th>Gross</th>
                <th>PF %</th>
                <th>Absent / late rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => {
                const row = byStaff.get(member.id);
                return (
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
                    {row ? (
                      <>
                        <td className="muted-cell">{money(row.basic_salary)}</td>
                        <td className="muted-cell">{money(allowanceTotal(row))}</td>
                        <td><strong>{money(packageGross(row))}</strong></td>
                        <td className="muted-cell">{row.pf_percentage}% <small>({money(packagePf(row))})</small></td>
                        <td className="muted-cell">{money(row.absent_deduction_rate)} / {money(row.late_deduction_rate)}</td>
                      </>
                    ) : (
                      <>
                        <td className="muted-cell" colSpan={5}><span className="payroll-missing">No pay package set up yet</span></td>
                      </>
                    )}
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn" onClick={() => setEditing({ member, row })} title={row ? 'Edit pay package' : 'Set up pay package'}>
                          {row ? <Pencil size={15} /> : <Plus size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-state large">{loading ? 'Loading pay packages…' : 'No staff members match your search.'}</div>
          )}
        </div>
      </div>

      {editing && (
        <PayPackageModal
          member={editing.member}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function PayPackageModal({ member, row, onClose, onSaved, onToast }: {
  member: PayrollStaff;
  row?: PayPackage;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const numbers = {
    basicSalary: toNumber(draft.basicSalary),
    houseRent: toNumber(draft.houseRent),
    conveyance: toNumber(draft.conveyance),
    medical: toNumber(draft.medical),
    otherAllowance: toNumber(draft.otherAllowance),
    pfPercentage: toNumber(draft.pfPercentage),
    absentRate: toNumber(draft.absentRate),
    lateRate: toNumber(draft.lateRate),
  };

  const allowances = numbers.houseRent + numbers.conveyance + numbers.medical + numbers.otherAllowance;
  const gross = numbers.basicSalary + allowances;
  const pfAmount = Math.round(numbers.basicSalary * numbers.pfPercentage) / 100;

  const submit = async () => {
    setError('');
    if (numbers.basicSalary <= 0) { setError('Enter the monthly basic salary.'); return; }
    if (numbers.pfPercentage > 100) { setError('The provident fund percentage cannot be more than 100.'); return; }
    setBusy(true);
    const { error: saveError } = await saveStaffPayPackage(member.id, numbers, draft.effectiveFrom, draft.notes);
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    onToast(`${member.full_name}'s pay package was saved.`);
    onSaved();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal payroll-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Wallet size={14} /> {row ? 'Edit pay package' : 'New pay package'}</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{member.full_name}</h2>
        <p className="payroll-modal-sub">{ROLE_LABELS[member.role] ?? member.role}</p>

        <div className="payroll-form-grid">
          <label className="control-field full">Basic salary (monthly)
            <input inputMode="decimal" value={draft.basicSalary} onChange={(event) => update('basicSalary', event.target.value)} placeholder="e.g. 35000" />
          </label>

          <label className="control-field">House rent allowance
            <input inputMode="decimal" value={draft.houseRent} onChange={(event) => update('houseRent', event.target.value)} placeholder="0" />
          </label>
          <label className="control-field">Conveyance allowance
            <input inputMode="decimal" value={draft.conveyance} onChange={(event) => update('conveyance', event.target.value)} placeholder="0" />
          </label>
          <label className="control-field">Medical allowance
            <input inputMode="decimal" value={draft.medical} onChange={(event) => update('medical', event.target.value)} placeholder="0" />
          </label>
          <label className="control-field">Other allowance
            <input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => update('otherAllowance', event.target.value)} placeholder="0" />
          </label>

          <label className="control-field">Provident fund (% of basic)
            <input inputMode="decimal" value={draft.pfPercentage} onChange={(event) => update('pfPercentage', event.target.value)} placeholder="e.g. 8" />
          </label>
          <label className="control-field">Absent deduction (per day)
            <input inputMode="decimal" value={draft.absentRate} onChange={(event) => update('absentRate', event.target.value)} placeholder="0" />
          </label>
          <label className="control-field">Late deduction (per day)
            <input inputMode="decimal" value={draft.lateRate} onChange={(event) => update('lateRate', event.target.value)} placeholder="0" />
          </label>
          <label className="control-field">Effective from
            <input type="date" value={draft.effectiveFrom} onChange={(event) => update('effectiveFrom', event.target.value)} />
          </label>

          <label className="control-field full">Notes
            <input value={draft.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Optional remarks" maxLength={300} />
          </label>
        </div>

        <div className="payroll-summary">
          <div><span>Allowances</span><strong>{money(allowances)}</strong></div>
          <div><span>Gross salary</span><strong>{money(gross)}</strong></div>
          <div><span>Provident fund</span><strong>{money(pfAmount)}</strong></div>
        </div>

        {error && <div className="auth-error"><span>{error}</span></div>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={16} className="auth-spinner" /> : <Plus size={16} />} Save pay package
          </button>
        </div>
      </section>
    </div>
  );
}
