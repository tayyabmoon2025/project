import { useMemo, useState } from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import {
  JOB_STATUS_LABELS,
  deleteJobApplication,
  saveJobApplication,
  updateJobStatus,
  type JobApplication,
  type JobDraft,
  type JobStatus,
} from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';

type Props = {
  jobs: JobApplication[];
  loading: boolean;
  onReload: () => void;
  onToast: (message: string) => void;
};

const emptyForm = (): JobDraft => ({
  applicant_name: '',
  position_applied: '',
  phone: '',
  email: '',
  applied_date: new Date().toISOString().slice(0, 10),
  status: 'pending',
  notes: '',
});

export function UtilityJobApplicationsTab({ jobs, loading, onReload, onToast }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAdmin || profile?.role === 'office_assistant';
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<JobDraft>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return [job.applicant_name, job.position_applied, job.phone, job.email]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, filter, statusFilter]);

  const submit = async () => {
    if (!draft.applicant_name.trim()) { onToast('Enter the applicant name first.'); return; }
    setSaving(true);
    const error = await saveJobApplication({
      ...draft,
      applicant_name: draft.applicant_name.trim(),
      position_applied: draft.position_applied.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      notes: draft.notes?.trim() || null,
    });
    setSaving(false);
    if (error) { onToast(error); return; }
    onToast('Job application saved.');
    setDraft(emptyForm());
    setShowForm(false);
    onReload();
  };

  const changeStatus = async (id: string, status: JobStatus) => {
    const error = await updateJobStatus(id, status);
    if (error) { onToast(error); return; }
    onToast('Status updated.');
    onReload();
  };

  const remove = async (id: string) => {
    const error = await deleteJobApplication(id);
    if (error) { onToast(error); return; }
    onToast('Application removed.');
    onReload();
  };

  const statusClass = (status: JobStatus) => {
    if (status === 'hired') return 'paid';
    if (status === 'shortlisted') return 'partial';
    if (status === 'rejected') return 'unpaid';
    return 'neutral';
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Job Applications</span>
          <h2>Applications Received</h2>
        </div>
        {canEdit && !showForm && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Application
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Applicant Name
              <input value={draft.applicant_name} onChange={(e) => setDraft({ ...draft, applicant_name: e.target.value })} placeholder="Full name" />
            </label>
            <label className="control-field">Position Applied For
              <input value={draft.position_applied} onChange={(e) => setDraft({ ...draft, position_applied: e.target.value })} placeholder="Teacher, Clerk, Accountant…" />
            </label>
            <label className="control-field">Phone
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Contact number" />
            </label>
            <label className="control-field">Email
              <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="email@example.com" />
            </label>
            <label className="control-field">Applied Date
              <input type="date" value={draft.applied_date} onChange={(e) => setDraft({ ...draft, applied_date: e.target.value })} />
            </label>
            <label className="control-field">Notes (optional)
              <input value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Qualifications, references…" />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => { setShowForm(false); setDraft(emptyForm()); }}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              <Plus size={15} /> {saving ? 'Saving…' : 'Save Application'}
            </button>
          </div>
        </div>
      )}

      <div className="fee-filters">
        <label className="control-field">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name, position, phone…" />
        </label>
        <label className="control-field">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as JobStatus | '')}>
            <option value="">All statuses</option>
            {(Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((s) => (
              <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="fee-empty">Loading applications…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No job applications{filter || statusFilter ? ' match your filters' : ''}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Applicant</th><th>Position</th><th>Phone</th><th>Applied</th><th>Status</th>{canEdit && <th></th>}{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id}>
                  <td><div className="table-student"><Briefcase size={14} /><strong>{job.applicant_name}</strong></div></td>
                  <td>{job.position_applied || '—'}</td>
                  <td className="fee-mono">{job.phone || '—'}</td>
                  <td className="fee-mono">{job.applied_date}</td>
                  <td>
                    {canEdit ? (
                      <select
                        className="util-status-select"
                        value={job.status}
                        onChange={(e) => changeStatus(job.id, e.target.value as JobStatus)}
                      >
                        {(Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((s) => (
                          <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`fee-status ${statusClass(job.status)}`}>{JOB_STATUS_LABELS[job.status]}</span>
                    )}
                  </td>
                  {canEdit && <td></td>}
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link danger" onClick={() => remove(job.id)}><Trash2 size={14} /></button>
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
