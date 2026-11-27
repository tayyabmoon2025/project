import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CircleAlert as AlertCircle, Ban, Check, KeyRound, Loader as Loader2, Plus, RefreshCw, Search, Shield, Trash2, UserCog, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, type UserProfile, type UserRole } from '@/lib/auth';
import type { Student } from '@/lib/schoolTypes';
import { PasswordField } from '@/components/PasswordField';
import { CredentialsModal } from '@/components/CredentialsModal';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import {
  fetchPasswordRequests,
  generatePassword,
  provisionPortalAccount,
  resolvePasswordRequest,
  setAccountPassword,
  setAccountUsername,
  usernameFromMobile,
  type PasswordRequest,
  type PortalCredentials,
} from '@/lib/portalAccounts';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  support_staff: 'Support Staff',
  student: 'Student',
};

export function AdminPanel({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [studentUsernames, setStudentUsernames] = useState<Record<string, string>>({});
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [usernameTarget, setUsernameTarget] = useState<UserProfile | null>(null);
  const [credentials, setCredentials] = useState<PortalCredentials[] | null>(null);
  const [requests, setRequests] = useState<PasswordRequest[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, username, full_name, role, status, student_id, created_at, photo_url')
      .order('created_at', { ascending: false });
    if (!error && data) {
      const rows = data as (UserProfile & { student_id: string | null })[];
      setUsers(rows);
      const map: Record<string, string> = {};
      for (const row of rows) if (row.student_id) map[row.student_id] = row.username;
      setStudentUsernames(map);
    }
    setLoading(false);
  }, []);

  const loadStudents = async () => {
    const { data } = await supabase
      .from('school_students')
      .select('id, admission_number, full_name, class_name, section_name')
      .order('full_name');
    if (data) setStudents(data as Student[]);
  };

  const loadLinks = async () => {
    const { data } = await supabase
      .from('parent_student_links')
      .select('parent_user_id, student_id');
    if (data) {
      const map: Record<string, string[]> = {};
      for (const row of data as { parent_user_id: string; student_id: string }[]) {
        if (!map[row.parent_user_id]) map[row.parent_user_id] = [];
        map[row.parent_user_id].push(row.student_id);
      }
      setLinks(map);
    }
  };

  const loadRequests = useCallback(async () => {
    setRequests(await fetchPasswordRequests());
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadStudents();
    void loadLinks();
    void loadRequests();
  }, [loadUsers, loadRequests]);

  const filtered = users.filter((u) =>
    `${u.full_name} ${u.username} ${ROLE_LABELS[u.role]}`.toLowerCase().includes(search.toLowerCase()),
  );

  const pendingRequests = requests.filter((request) => request.status === 'pending');

  const toggleSuspend = async (user: UserProfile) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.rpc('admin_set_account_status', {
      p_user_id: user.id,
      p_status: newStatus,
    });
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
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u)));
    onToast(`${user.full_name} has been ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}.`);
  };

  const removeUser = async (user: UserProfile) => {
    const { error } = await supabase.rpc('admin_remove_user', { p_user_id: user.id });
    if (error) { onToast(error.message || 'Could not remove this account.'); return; }
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    onToast(`${user.full_name}'s account was removed.`);
  };

  const dismissRequest = async (request: PasswordRequest) => {
    if (!profile) return;
    const { error } = await resolvePasswordRequest(request.id, profile.id);
    if (error) { onToast(error); return; }
    setRequests((prev) => prev.map((item) => (item.id === request.id ? { ...item, status: 'resolved' } : item)));
    onToast(`Request from ${request.username} marked as handled.`);
  };

  const accountsWithoutLogin = students.filter((student) => !studentUsernames[student.id]);

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Administration</span>
          <h2>User accounts</h2>
          <p>Create, suspend, or remove portal accounts. Students and teachers receive their logins automatically.</p>
        </div>
        <div className="admin-header-actions">
          <button className="secondary-button" onClick={() => setShowLink(true)}>
            <Plus size={16} /> Link parent to student
          </button>
          <button className="secondary-button" onClick={() => setShowPassword(true)}>
            <KeyRound size={16} /> Change my password
          </button>
          <button className="primary-button" onClick={() => setShowCreate(true)}>
            <UserPlus size={17} /> New account
          </button>
        </div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat"><Users size={20} /><strong>{users.length}</strong><span>Total accounts</span></div>
        <div className="admin-stat admin-stat-admin"><Shield size={20} /><strong>{users.filter((u) => u.role === 'admin').length}</strong><span>Administrators</span></div>
        <div className="admin-stat admin-stat-teacher"><strong>{users.filter((u) => u.role === 'teacher').length}</strong><span>Teachers</span></div>
        <div className="admin-stat admin-stat-parent"><strong>{users.filter((u) => u.role === 'parent').length}</strong><span>Parents</span></div>
        <div className="admin-stat admin-stat-student"><strong>{users.filter((u) => u.role === 'student').length}</strong><span>Students</span></div>
        <div className="admin-stat admin-stat-assistant"><strong>{users.filter((u) => u.role === 'office_assistant').length}</strong><span>Office Assistants</span></div>
        <div className="admin-stat admin-stat-accountant"><strong>{users.filter((u) => u.role === 'accountant').length}</strong><span>Accountants</span></div>
        <div className="admin-stat admin-stat-suspended"><Ban size={20} /><strong>{users.filter((u) => u.status === 'suspended').length}</strong><span>Suspended</span></div>
      </div>

      {pendingRequests.length > 0 && (
        <section className="panel reset-requests">
          <div className="reset-requests-heading">
            <div>
              <span className="eyebrow"><KeyRound size={14} /> Password help</span>
              <h2>{pendingRequests.length} password reset {pendingRequests.length === 1 ? 'request' : 'requests'}</h2>
              <p>These people could not sign in and asked for help. Reset their password, then mark the request handled.</p>
            </div>
          </div>
          <div className="reset-request-list">
            {pendingRequests.map((request) => {
              const match = users.find((user) => user.username === request.username);
              return (
                <div className="reset-request-row" key={request.id}>
                  <div className="reset-request-who">
                    <strong>{match?.full_name ?? request.username}</strong>
                    <span>
                      Username: {request.username}
                      {match ? ` · ${ROLE_LABELS[match.role]}` : ' · no matching account'}
                    </span>
                    {request.note && <small>{request.note}</small>}
                  </div>
                  <div className="reset-request-actions">
                    {match && (
                      <button className="secondary-button" onClick={() => setResetTarget(match)}>
                        <KeyRound size={15} /> Set new password
                      </button>
                    )}
                    <button className="secondary-button" onClick={() => void dismissRequest(request)}>
                      <Check size={15} /> Mark handled
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="panel roster-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, username or role" />
          </div>
          <span className="result-count">{filtered.length} accounts</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Linked children</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="table-student">
                      <PersonAvatar photoUrl={u.photo_url} name={u.full_name} />
                      <strong>{u.full_name}</strong>
                    </div>
                  </td>
                  <td className="muted-cell">{u.username}</td>
                  <td><span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role]}</span></td>
                  <td>
                    <span className={`status-pill ${u.status === 'suspended' ? 'status-suspended' : ''}`}>
                      {u.status === 'active' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="muted-cell">
                    {u.role === 'parent' ? `${(links[u.id] ?? []).length} linked` : '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      {u.id !== profile?.id && (
                        <>
                          {u.role !== 'admin' && (
                            <>
                              <button
                                className="row-action-btn"
                                onClick={() => setResetTarget(u)}
                                title="Set a new password"
                              >
                                <KeyRound size={15} />
                              </button>
                              <button
                                className="row-action-btn"
                                onClick={() => setUsernameTarget(u)}
                                title="Change the username"
                              >
                                <UserCog size={15} />
                              </button>
                            </>
                          )}
                          <button
                            className="row-action-btn"
                            onClick={() => void toggleSuspend(u)}
                            title={u.status === 'active' ? 'Suspend' : 'Reactivate'}
                          >
                            {u.status === 'active' ? <Ban size={15} /> : <Check size={15} />}
                          </button>
                          <button
                            className="row-action-btn row-action-danger"
                            onClick={() => void removeUser(u)}
                            title="Remove account"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                      {u.id === profile?.id && (
                        <button
                          className="row-action-btn"
                          onClick={() => setShowPassword(true)}
                          title="Change your password"
                        >
                          <KeyRound size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty-state large">{loading ? 'Loading accounts…' : 'No accounts match your search.'}</div>}
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          students={accountsWithoutLogin}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => { setShowCreate(false); void loadUsers(); setCredentials(created); }}
          onToast={onToast}
        />
      )}
      {showPassword && (
        <ChangePasswordModal onClose={() => setShowPassword(false)} onToast={onToast} />
      )}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onToast={onToast}
        />
      )}
      {usernameTarget && (
        <ResetUsernameModal
          user={usernameTarget}
          onClose={() => setUsernameTarget(null)}
          onSaved={() => { setUsernameTarget(null); void loadUsers(); }}
          onToast={onToast}
        />
      )}
      {credentials && (
        <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
      )}
      {showLink && (
        <LinkParentModal
          users={users}
          students={students}
          existingLinks={links}
          onClose={() => setShowLink(false)}
          onLinked={() => { setShowLink(false); void loadLinks(); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function CreateUserModal({ students, onClose, onCreated, onToast }: {
  students: Student[];
  onClose: () => void;
  onCreated: (credentials: PortalCredentials[]) => void;
  onToast: (message: string) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<UserRole>('teacher');
  const [studentId, setStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const effectiveUsername = role === 'teacher' && mobile ? usernameFromMobile(mobile) : username;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (fullName.trim().length < 2) { setError('Please enter the full name.'); return; }
    if (effectiveUsername.trim().length < 3) {
      setError(role === 'teacher' ? 'Enter a mobile number with at least 3 digits.' : 'Username must be at least 3 characters.');
      return;
    }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (role === 'student' && !studentId) { setError('Choose the student this login belongs to.'); return; }
    setBusy(true);

    const { error: createError } = await provisionPortalAccount({
      username: effectiveUsername.trim().toLowerCase(),
      password,
      fullName: fullName.trim(),
      role,
      studentId: role === 'student' ? studentId : null,
      mobile: role === 'teacher' ? mobile.trim() : null,
    });

    if (createError) {
      setError(createError);
      setBusy(false);
      return;
    }

    onToast(`${fullName.trim()} was created. Share the sign-in details shown next.`);
    onCreated([{ username: effectiveUsername.trim().toLowerCase(), password, fullName: fullName.trim(), role }]);
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><UserPlus size={14} /> New account</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Create a new account</h2>
        <p className="mt-1 text-sm text-slate-500">The new user signs in with the username and password below.</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="control-field">Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Enter full name" />
          </label>

          <label className="control-field">Account type
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="teacher">Teacher</option>
              <option value="student">Student</option>
              <option value="parent">Parent</option>
              <option value="admin">Administrator</option>
              <option value="office_assistant">Office Assistant</option>
              <option value="accountant">Accountant</option>
            </select>
          </label>

          {role === 'teacher' ? (
            <label className="control-field">Mobile number (used as the username)
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="e.g. 03001234567" inputMode="tel" />
            </label>
          ) : null}

          {role === 'student' ? (
            <label className="control-field">Student record
              <select value={studentId} onChange={(e) => {
                setStudentId(e.target.value);
                const picked = students.find((s) => s.id === e.target.value);
                if (picked) setUsername(picked.admission_number.toLowerCase());
              }}>
                <option value="">Select the student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name} · {student.admission_number} · {student.class_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="control-field">
            {role === 'teacher' ? 'Username (from mobile number)' : role === 'student' ? 'Username (admission number)' : 'Username'}
            <input
              value={effectiveUsername}
              onChange={(e) => setUsername(e.target.value)}
              required
              readOnly={role === 'teacher' && Boolean(mobile)}
              placeholder="e.g. teacher1, parent.john"
            />
          </label>

          <label className="control-field">Password
            <PasswordField value={password} onChange={setPassword} autoComplete="off" />
          </label>

          <button type="button" className="secondary-button self-start" onClick={() => setPassword(generatePassword())}>
            <RefreshCw size={15} /> Generate a password
          </button>

          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}

          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <UserPlus size={16} />} Create account
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ResetPasswordModal({ user, onClose, onToast }: {
  user: UserProfile;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);

    const { error: resetError } = await setAccountPassword(user.id, password);
    if (resetError) { setError(resetError); setBusy(false); return; }

    onToast(`A new password was set for ${user.full_name}.`);
    onClose();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><KeyRound size={14} /> Reset password</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Set a new password</h2>
        <p className="mt-1 text-sm text-slate-500">
          {user.full_name} signs in with the username <strong>{user.username}</strong>. Setting a new password takes effect
          immediately and replaces the old one.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="control-field">New password
            <PasswordField value={password} onChange={setPassword} autoComplete="off" />
          </label>
          <button type="button" className="secondary-button self-start" onClick={() => setPassword(generatePassword())}>
            <RefreshCw size={15} /> Generate a password
          </button>
          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <KeyRound size={16} />} Set password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ResetUsernameModal({ user, onClose, onSaved, onToast }: {
  user: UserProfile;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cleanUsername = username.trim().toLowerCase();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (cleanUsername.length < 3) { setError('The username must be at least 3 characters.'); return; }
    if (cleanUsername === user.username) { setError('That is already this account\'s username.'); return; }
    setBusy(true);

    const { error: renameError } = await setAccountUsername(user.id, cleanUsername);
    if (renameError) { setError(renameError); setBusy(false); return; }

    onToast(`${user.full_name} now signs in as ${cleanUsername}.`);
    onSaved();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><UserCog size={14} /> Change username</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Change the sign-in username</h2>
        <p className="mt-1 text-sm text-slate-500">
          {user.full_name} currently signs in as <strong>{user.username}</strong>. The new username replaces it straight
          away; the password stays the same.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="control-field">New username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus maxLength={40} />
          </label>
          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
          <div className="notice-preview-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 size={16} className="auth-spinner" /> : <UserCog size={16} />} Save username
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function LinkParentModal({ users, students, existingLinks, onClose, onLinked, onToast }: {
  users: UserProfile[];
  students: Student[];
  existingLinks: Record<string, string[]>;
  onClose: () => void;
  onLinked: () => void;
  onToast: (message: string) => void;
}) {
  const parents = users.filter((u) => u.role === 'parent');
  const [parentId, setParentId] = useState(parents[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>(existingLinks[parentId] ?? []);
  const [busy, setBusy] = useState(false);

  const onSelectParent = (id: string) => {
    setParentId(id);
    setSelected(existingLinks[id] ?? []);
  };

  const toggleStudent = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const save = async () => {
    if (!parentId) { onToast('Select a parent first.'); return; }
    setBusy(true);
    const existing = existingLinks[parentId] ?? [];
    const toAdd = selected.filter((id) => !existing.includes(id));
    const toRemove = existing.filter((id) => !selected.includes(id));

    if (toAdd.length) {
      await supabase.from('parent_student_links').insert(toAdd.map((student_id) => ({ parent_user_id: parentId, student_id })));
    }
    if (toRemove.length) {
      await supabase.from('parent_student_links').delete().eq('parent_user_id', parentId).in('student_id', toRemove);
    }

    setBusy(false);
    onToast(`Parent links updated — ${selected.length} student${selected.length === 1 ? '' : 's'} linked.`);
    onLinked();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Plus size={14} /> Link parent to student</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-800">Manage parent-student links</h2>
        <p className="mt-1 text-sm text-slate-500">Select a parent, then check which students are their children. Parents will only see linked students.</p>

        {parents.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No parent accounts exist yet. Create one first.</p>
        ) : (
          <>
            <label className="control-field mt-4">Parent account
              <select value={parentId} onChange={(e) => onSelectParent(e.target.value)}>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
            <div className="link-student-list">
              {students.map((s) => (
                <button
                  key={s.id}
                  className={`selectable-row ${selected.includes(s.id) ? 'selected' : ''}`}
                  onClick={() => toggleStudent(s.id)}
                  type="button"
                >
                  <span className="check-box">{selected.includes(s.id) && <Check size={15} />}</span>
                  <div className="selectable-name">
                    <strong>{s.full_name}</strong>
                    <span>{s.admission_number} · {s.class_name} · Section {s.section_name}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="notice-preview-actions mt-4">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={() => void save()} disabled={busy || parents.length === 0}>
            {busy ? <Loader2 size={16} className="auth-spinner" /> : <Check size={16} />} Save links
          </button>
        </div>
      </section>
    </div>
  );
}
