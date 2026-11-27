import { useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2, Trash2 } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import {
  deleteSession,
  fetchSessions,
  saveSession,
  setCurrentSession,
  type AcademicSession,
} from '@/lib/systemSetup';
import { useAuth } from '@/lib/auth';

const emptyForm = () => ({ session_name: '', start_date: '', end_date: '', is_current: false });

export function SystemNewSessionTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await fetchSessions();
    setSessions(result.sessions);
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const submit = async (): Promise<boolean | void> => {
    if (!form.session_name.trim()) { onToast('Enter a session name first.'); return false; }
    setSaving(true);
    const error = await saveSession({
      session_name: form.session_name.trim(),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      is_current: form.is_current,
    });
    setSaving(false);
    if (error) { onToast(error); return false; }
    onToast('Session saved.');
    setForm(emptyForm());
    void load();
    return true;
  };

  const markCurrent = async (id: string, isCurrent: boolean) => {
    const error = await setCurrentSession(id, isCurrent);
    if (error) { onToast(error); return; }
    onToast(isCurrent ? 'Session set as current.' : 'Session removed as current.');
    void load();
  };

  const remove = async (id: string) => {
    const error = await deleteSession(id);
    if (error) { onToast(error); return; }
    onToast('Session removed.');
    void load();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">New Session</span>
          <h2>Academic Sessions</h2>
        </div>
      </div>

      {isAdmin && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Session Name
              <input value={form.session_name} onChange={(e) => setForm({ ...form, session_name: e.target.value })} placeholder="e.g. 2027-2028" />
            </label>
            <label className="control-field">Start Date
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </label>
            <label className="control-field">End Date
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </label>
            <label className="control-field util-check-field">
              <span className="util-check-row">
                <input type="checkbox" checked={form.is_current} onChange={(e) => setForm({ ...form, is_current: e.target.checked })} />
                Set as current session
              </span>
            </label>
          </div>
          <div className="util-form-actions">
            <AsyncSaveButton label="Add Session" size={15} disabled={saving} onSave={() => submit()} />
          </div>
        </div>
      )}

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {loading ? (
        <p className="fee-empty">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p className="fee-empty">No sessions recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Session</th><th>Start</th><th>End</th><th>Current</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td><div className="table-student"><CalendarPlus size={14} /><strong>{session.session_name}</strong></div></td>
                  <td className="fee-mono">{session.start_date || '—'}</td>
                  <td className="fee-mono">{session.end_date || '—'}</td>
                  <td>
                    {isAdmin ? (
                      <button
                        className={`fee-status ${session.is_current ? 'paid' : 'neutral'}`}
                        onClick={() => markCurrent(session.id, !session.is_current)}
                        style={{ border: 'none', cursor: 'pointer' }}
                      >
                        {session.is_current ? <CheckCircle2 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} /> : null}
                        {session.is_current ? 'Current' : 'Set current'}
                      </button>
                    ) : (
                      <span className={`fee-status ${session.is_current ? 'paid' : 'neutral'}`}>{session.is_current ? 'Current' : '—'}</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link danger" onClick={() => remove(session.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
