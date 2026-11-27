import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Ban, BookOpen, Briefcase, Cake, Calculator, CalendarCheck, CalendarDays, Check, FileBadge, GraduationCap, KeyRound, Landmark, Loader as Loader2, Pencil, Phone, PiggyBank, ScrollText, Search, Shield, Trash2, UserCog, UserPlus, Users, Wallet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, type UserProfile, type UserRole } from '@/lib/auth';
import { setStaffBirthday } from '@/lib/birthdays';
import {
  isStaffActive,
  matchesStaffSearch,
  STAFF_SCOPES,
  STAFF_STATUSES,
  STAFF_STATUS_HINTS,
  STAFF_STATUS_LABELS,
  STAFF_STATUS_TONES,
  staffId,
  type StaffScope,
  type StaffStatus,
} from '@/lib/staffDirectory';
import { ResetPasswordModal, ResetUsernameModal } from '@/components/AdminPanel';
import { StaffFormModal } from '@/components/StaffFormModal';
import { StaffCredentialsModal } from '@/components/StaffCredentialsModal';
import { STAFF_MEMBER_COLUMNS, type SavedStaffMember, type StaffMemberRecord } from '@/lib/staffProfile';
import { StaffAttendanceTab } from '@/components/StaffAttendanceTab';
import { PayPackagesTab } from '@/components/PayPackagesTab';
import { AdvancesAndPfTab } from '@/components/AdvancesAndPfTab';
import { PaySalaryTab } from '@/components/PaySalaryTab';
import { StaffCnicCell } from '@/components/StaffCnicCell';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StaffLeaveTab } from '@/components/StaffLeaveTab';
import { ClassSubjectsTab } from '@/components/StaffStarterTabs';
import { IssueCertificateTab } from '@/components/IssueCertificateTab';
import { StaffReportsTab } from '@/components/StaffReportsTab';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  support_staff: 'Support Staff',
  student: 'Student',
};

// Only roles that belong to the school's own workforce appear on this screen.
// Parents and students are managed through their own records.
const STAFF_ROLES: UserRole[] = ['teacher', 'office_assistant', 'accountant', 'support_staff', 'admin'];

// Staff birthdays, CNIC and mobile number are recorded here so the daily birthday check
// can wish them and the office has the identity number to hand. The full personnel
// record is read by the add / edit form.
type StaffRow = StaffMemberRecord;

// Every section of staff management is its own entry in the tab bar, so a section can be
// opened without first opening the one it used to be grouped under.
type StaffTabKey =
  | 'directory' | 'attendance' | 'classes' | 'leave' | 'packages'
  | 'advances' | 'pf' | 'salary' | 'history' | 'certificate' | 'reports';

const STAFF_TABS: { key: StaffTabKey; label: string; icon: ComponentType<{ size?: number | string; className?: string }> }[] = [
  { key: 'directory', label: 'Staff directory', icon: Users },
  { key: 'attendance', label: 'Daily attendance', icon: CalendarCheck },
  { key: 'classes', label: 'Class & subjects', icon: BookOpen },
  { key: 'leave', label: 'Leave management', icon: CalendarDays },
  { key: 'packages', label: 'Pay packages', icon: Wallet },
  { key: 'advances', label: 'Salary advances', icon: Landmark },
  { key: 'pf', label: 'Provident fund', icon: PiggyBank },
  { key: 'salary', label: 'Pay salary', icon: Calculator },
  { key: 'history', label: 'Paid history', icon: ScrollText },
  { key: 'certificate', label: 'Issue certificate', icon: FileBadge },
  { key: 'reports', label: 'Reports', icon: Briefcase },
];

export function StaffManagement({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const [users, setUsers] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [scope, setScope] = useState<StaffScope>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<StaffTabKey>('directory');
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [usernameTarget, setUsernameTarget] = useState<UserProfile | null>(null);
  const [statusTarget, setStatusTarget] = useState<StaffRow | null>(null);
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null);
  const [credentials, setCredentials] = useState<{ member: SavedStaffMember; password: string; phone: string | null } | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select(STAFF_MEMBER_COLUMNS)
      .in('role', STAFF_ROLES)
      .order('full_name');
    if (!error && data) setUsers((data ?? []) as unknown as StaffRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  // A status change can move someone between the two sub-tabs, so the row is patched in
  // place rather than removed from the list the way a deletion is.
  const setStatusLocally = (userId: string, status: StaffStatus) => {
    setUsers((prev) => prev.map((row) => (row.id === userId ? { ...row, status } : row)));
  };

  const filtered = users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    if (scope !== 'all' && isStaffActive(user.status) !== (scope === 'active')) return false;
    return matchesStaffSearch(user, search, (role) => ROLE_LABELS[role]);
  });

  const toggleSuspend = async (user: UserProfile) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.rpc('admin_set_account_status', { p_user_id: user.id, p_status: newStatus });
    if (error) {
      onToast(
        error.message === 'You cannot suspend your own account'
          ? 'You cannot suspend your own account.'
          : error.message === 'The last administrator account cannot be suspended'
            ? 'The last administrator account cannot be suspended.'
            : 'Could not update account status.',
      );
      return;
    }
    setStatusLocally(user.id, newStatus);
    onToast(`${user.full_name} has been ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}.`);
  };

  const removeStaff = async (user: UserProfile) => {
    const { error } = await supabase.rpc('admin_remove_user', { p_user_id: user.id });
    if (error) { onToast(error.message || 'Could not remove this account.'); return; }
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    onToast(`${user.full_name}'s account was removed.`);
  };

  const countOf = (role: UserRole) => users.filter((user) => user.role === role).length;

  const activeCount = users.filter((user) => isStaffActive(user.status)).length;
  const inactiveCount = users.length - activeCount;

  const saveBirthday = async (user: StaffRow, value: string) => {
    const next = value || null;
    setUsers((prev) => prev.map((row) => (row.id === user.id ? { ...row, date_of_birth: next } : row)));
    const { error } = await setStaffBirthday(user.id, next);
    if (error) { onToast(error); void loadStaff(); return; }
    onToast(next ? `${user.full_name}'s date of birth was saved.` : `${user.full_name}'s date of birth was cleared.`);
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Administration</span>
          <h2>Staff management</h2>
          <p>Create and manage the logins for your teachers, office assistants and accountants. Teachers sign in with their mobile number.</p>
        </div>
        <div className="admin-header-actions">
          <button className="primary-button" onClick={() => setShowCreate(true)}>
            <UserPlus size={17} /> Add staff member
          </button>
        </div>
      </div>

      <div className="staff-tabs" role="tablist">
        {STAFF_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`att-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'attendance' ? (
        <StaffAttendanceTab onToast={onToast} staff={users} />
      ) : tab === 'classes' ? (
        <ClassSubjectsTab />
      ) : tab === 'leave' ? (
        <StaffLeaveTab onToast={onToast} staff={users} />
      ) : tab === 'packages' ? (
        <PayPackagesTab staff={users} onToast={onToast} />
      ) : tab === 'advances' ? (
        <AdvancesAndPfTab staff={users} onToast={onToast} initialView="advances" />
      ) : tab === 'pf' ? (
        <AdvancesAndPfTab staff={users} onToast={onToast} initialView="pf" />
      ) : tab === 'salary' ? (
        <PaySalaryTab staff={users} onToast={onToast} initialView="pay" />
      ) : tab === 'history' ? (
        <PaySalaryTab staff={users} onToast={onToast} initialView="history" />
      ) : tab === 'certificate' ? (
        <IssueCertificateTab staff={users} onToast={onToast} />
      ) : tab === 'reports' ? (
        <StaffReportsTab staff={users} onToast={onToast} />
      ) : (
        <>
      <div className="admin-stats">
        <div className="admin-stat"><Briefcase size={20} /><strong>{users.length}</strong><span>Total staff</span></div>
        <div className="admin-stat admin-stat-teacher"><GraduationCap size={20} /><strong>{countOf('teacher')}</strong><span>Teachers</span></div>
        <div className="admin-stat admin-stat-assistant"><Users size={20} /><strong>{countOf('office_assistant')}</strong><span>Office Assistants</span></div>
        <div className="admin-stat admin-stat-accountant"><Calculator size={20} /><strong>{countOf('accountant')}</strong><span>Accountants</span></div>
        <div className="admin-stat admin-stat-assistant"><Users size={20} /><strong>{countOf('support_staff')}</strong><span>Support Staff</span></div>
        <div className="admin-stat admin-stat-admin"><Shield size={20} /><strong>{countOf('admin')}</strong><span>Administrators</span></div>
        <div className="admin-stat admin-stat-suspended"><Ban size={20} /><strong>{users.filter((u) => !isStaffActive(u.status)).length}</strong><span>Inactive</span></div>
      </div>

      <div className="panel roster-panel staff-directory">
        <div className="pending-bar staff-status-tabs">
          <div className="pending-tabs" role="tablist">
            {STAFF_SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={scope === option.value}
                className={`pending-tab ${scope === option.value ? 'active' : ''}`}
                title={option.hint}
                onClick={() => setScope(option.value)}
              >
                {option.label} staff
                <span className="pending-tab-count">
                  {option.value === 'active'
                    ? activeCount
                    : option.value === 'inactive'
                      ? inactiveCount
                      : users.length}
                </span>
              </button>
            ))}
          </div>
          <span className="staff-scope-hint">
            {STAFF_SCOPES.find((option) => option.value === scope)?.hint}
          </span>
        </div>

        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, CNIC, phone, username or role"
            />
          </div>
          <div className="staff-directory-filters">
            <div className="segmented-control compact" role="group" aria-label="Show active, inactive or all staff">
              {STAFF_SCOPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={scope === option.value ? 'selected' : ''}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              className="staff-role-filter"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
            >
              <option value="all">All roles</option>
              {STAFF_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
            <span className="result-count">{filtered.length} staff</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Staff ID</th><th>Username</th><th>Phone</th><th>CNIC</th><th>Role</th><th>Birthday</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="table-student">
                      <PersonAvatar photoUrl={user.photo_url} name={user.full_name} />
                      <strong>{user.full_name}</strong>
                    </div>
                  </td>
                  <td className="muted-cell">{user.staff_code ?? staffId(user.id)}</td>
                  <td className="muted-cell">{user.username}</td>
                  <td className="muted-cell">
                    {user.mobile_number
                      ? <a className="staff-phone" href={`tel:${user.mobile_number}`}><Phone size={13} /> {user.mobile_number}</a>
                      : '—'}
                  </td>
                  <td>
                    <StaffCnicCell
                      userId={user.id}
                      value={user.cnic}
                      onSaved={(cnic) => setUsers((prev) => prev.map((row) => (row.id === user.id ? { ...row, cnic } : row)))}
                      onToast={onToast}
                    />
                  </td>
                  <td><span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span></td>
                  <td>
                    <label className="birthday-cell" title="Used by the daily birthday check">
                      <Cake size={14} />
                      <input
                        type="date"
                        value={user.date_of_birth ?? ''}
                        onChange={(event) => void saveBirthday(user, event.target.value)}
                        aria-label={`Date of birth for ${user.full_name}`}
                      />
                    </label>
                  </td>
                  <td>
                    <span className={`status-pill ${STAFF_STATUS_TONES[user.status as StaffStatus] ?? ''}`}>
                      {STAFF_STATUS_LABELS[user.status as StaffStatus] ?? user.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {user.id !== profile?.id && (
                        <>
                          <button className="row-action-btn" onClick={() => setEditTarget(user)} title="Edit this staff member">
                            <Pencil size={15} />
                          </button>
                          <button className="row-action-btn" onClick={() => setResetTarget(user)} title="Set a new password">
                            <KeyRound size={15} />
                          </button>
                          <button className="row-action-btn" onClick={() => setUsernameTarget(user)} title="Change the username">
                            <UserCog size={15} />
                          </button>
                          <button className="row-action-btn" onClick={() => setStatusTarget(user)} title="Change the staff status">
                            <Ban size={15} />
                          </button>
                          <button
                            className="row-action-btn"
                            onClick={() => void toggleSuspend(user)}
                            title={user.status === 'active' ? 'Suspend' : 'Reactivate'}
                          >
                            {user.status === 'active' ? <Ban size={15} /> : <Check size={15} />}
                          </button>
                          <button className="row-action-btn row-action-danger" onClick={() => void removeStaff(user)} title="Remove account">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                      {user.id === profile?.id && (
                        <button className="row-action-btn" onClick={() => setEditTarget(user)} title="Edit your staff record">
                          <Pencil size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-state large">
              {loading
                ? 'Loading staff…'
                : users.length === 0
                  ? 'No staff members yet. Add the first one with "Add staff member".'
                  : scope === 'inactive'
                    ? 'No inactive or former staff match these filters.'
                    : 'No staff members match your search.'}
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {showCreate && (
        <StaffFormModal
          member={null}
          onClose={() => setShowCreate(false)}
          onSaved={(result) => {
            setShowCreate(false);
            void loadStaff();
            // Every staff role has a portal login, so the details are handed over straight
            // away in a window built for printing or sending them on WhatsApp.
            setCredentials({ member: result.saved, password: result.password, phone: result.phone });
          }}
          onToast={onToast}
        />
      )}
      {editTarget && (
        <StaffFormModal
          member={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(result) => {
            setEditTarget(null);
            void loadStaff();
            if (result.saved.created) setCredentials({ member: result.saved, password: result.password, phone: result.phone });
            else onToast(`${result.saved.fullName}'s record was updated.`);
          }}
          onToast={onToast}
        />
      )}
      {credentials && (
        <StaffCredentialsModal
          member={credentials.member}
          password={credentials.password}
          phone={credentials.phone}
          onClose={() => setCredentials(null)}
          onToast={onToast}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} onToast={onToast} />
      )}
      {usernameTarget && (
        <ResetUsernameModal
          user={usernameTarget}
          onClose={() => setUsernameTarget(null)}
          onSaved={() => { setUsernameTarget(null); void loadStaff(); }}
          onToast={onToast}
        />
      )}
      {statusTarget && (
        <StaffStatusModal
          user={statusTarget}
          isSelf={statusTarget.id === profile?.id}
          onClose={() => setStatusTarget(null)}
          onChanged={(status) => { setStatusLocally(statusTarget.id, status); setStatusTarget(null); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// Changing a staff member's status is a deliberate choice between four states, so it gets a
// small dialog rather than a button that silently cycles through them.
function StaffStatusModal({ user, isSelf, onClose, onChanged, onToast }: {
  user: StaffRow;
  isSelf: boolean;
  onClose: () => void;
  onChanged: (status: StaffStatus) => void;
  onToast: (message: string) => void;
}) {
  const [status, setStatus] = useState<StaffStatus>(user.status as StaffStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (status === user.status) { onClose(); return; }
    setBusy(true);
    const { error: saveError } = await supabase.rpc('admin_set_account_status', {
      p_user_id: user.id,
      p_status: status,
    });
    setBusy(false);
    if (saveError) {
      setError(
        saveError.message === 'You cannot suspend your own account'
          ? 'You cannot change your own account status.'
          : saveError.message === 'The last administrator account cannot be suspended'
            ? 'The last administrator account must stay active.'
            : 'The status could not be saved.',
      );
      return;
    }
    onToast(`${user.full_name} is now marked ${STAFF_STATUS_LABELS[status].toLowerCase()}.`);
    onChanged(status);
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal payroll-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Ban size={14} /> Staff status</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{user.full_name}</h2>
        <p className="payroll-modal-sub">{staffId(user.id)} · {ROLE_LABELS[user.role]}</p>

        <div className="staff-status-options">
          {STAFF_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              className={`staff-status-option${status === option ? ' selected' : ''}`}
              onClick={() => setStatus(option)}
            >
              <strong>{STAFF_STATUS_LABELS[option]}</strong>
              <small>{STAFF_STATUS_HINTS[option]}</small>
            </button>
          ))}
        </div>

        {isSelf && (
          <p className="staff-tab-note">This is your own account, so it has to stay Active.</p>
        )}

        {error && <div className="auth-error"><span>{error}</span></div>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || isSelf}>
            {busy ? <Loader2 size={16} className="auth-spinner" /> : <Check size={16} />} Save status
          </button>
        </div>
      </section>
    </div>
  );
}


