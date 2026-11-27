import { useMemo, useState } from 'react';
import { Megaphone, Plus, Power, Trash2 } from 'lucide-react';
import {
  AUDIENCE_LABELS,
  PRIORITY_LABELS,
  deleteAnnouncement,
  saveAnnouncement,
  toggleAnnouncementActive,
  type Announcement,
  type AnnouncementDraft,
  type Audience,
  type Priority,
} from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';

type Props = {
  announcements: Announcement[];
  loading: boolean;
  onReload: () => void;
  onToast: (message: string) => void;
};

const emptyForm = (): AnnouncementDraft => ({
  title: '',
  body: '',
  audience: 'all',
  priority: 'normal',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  is_active: true,
});

export function UtilityAnnouncementsTab({ announcements, loading, onReload, onToast }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAdmin || profile?.role === 'office_assistant';
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<AnnouncementDraft>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return announcements;
    const q = filter.toLowerCase();
    return announcements.filter((a) => [a.title, a.body].join(' ').toLowerCase().includes(q));
  }, [announcements, filter]);

  const submit = async () => {
    if (!draft.title.trim()) { onToast('Enter the announcement title first.'); return; }
    setSaving(true);
    const error = await saveAnnouncement({
      ...draft,
      title: draft.title.trim(),
      body: draft.body.trim(),
      end_date: draft.end_date && draft.end_date < draft.start_date ? null : draft.end_date,
    });
    setSaving(false);
    if (error) { onToast(error); return; }
    onToast('Announcement saved.');
    setDraft(emptyForm());
    setShowForm(false);
    onReload();
  };

  const toggle = async (id: string, isActive: boolean) => {
    const error = await toggleAnnouncementActive(id, isActive);
    if (error) { onToast(error); return; }
    onToast(isActive ? 'Announcement activated.' : 'Announcement deactivated.');
    onReload();
  };

  const remove = async (id: string) => {
    const error = await deleteAnnouncement(id);
    if (error) { onToast(error); return; }
    onToast('Announcement removed.');
    onReload();
  };

  const priorityClass = (priority: Priority) => {
    if (priority === 'urgent') return 'unpaid';
    if (priority === 'important') return 'partial';
    return 'neutral';
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Announcements</span>
          <h2>School Announcements</h2>
        </div>
        {canEdit && !showForm && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Announcement
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="School closed tomorrow, Exam schedule…" />
            </label>
            <label className="control-field">Body
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Full text of the announcement" rows={3} />
            </label>
            <label className="control-field">Audience
              <select value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value as Audience })}>
                {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
                  <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
                ))}
              </select>
            </label>
            <label className="control-field">Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label className="control-field">Start Date
              <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
            </label>
            <label className="control-field">End Date (optional)
              <input type="date" value={draft.end_date ?? ''} min={draft.start_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value || null })} />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => { setShowForm(false); setDraft(emptyForm()); }}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              <Plus size={15} /> {saving ? 'Saving…' : 'Save Announcement'}
            </button>
          </div>
        </div>
      )}

      <div className="fee-filters">
        <label className="control-field">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search announcements…" />
        </label>
      </div>

      {loading ? (
        <p className="fee-empty">Loading announcements…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No announcements{filter ? ' match your search' : ''}.</p>
      ) : (
        <div className="util-ann-list">
          {filtered.map((ann) => (
            <div key={ann.id} className={`util-ann-card ${ann.is_active ? '' : 'inactive'}`}>
              <div className="util-ann-head">
                <div className="util-ann-title-row">
                  <Megaphone size={16} />
                  <strong>{ann.title}</strong>
                  <span className={`fee-status ${priorityClass(ann.priority)}`}>{PRIORITY_LABELS[ann.priority]}</span>
                  <span className="fee-status neutral">{AUDIENCE_LABELS[ann.audience]}</span>
                  {!ann.is_active && <span className="fee-status unpaid">Inactive</span>}
                </div>
                {canEdit && (
                  <div className="fee-row-actions">
                    <button className="fee-link" onClick={() => toggle(ann.id, !ann.is_active)}>
                      <Power size={14} /> {ann.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    {isAdmin && <button className="fee-link danger" onClick={() => remove(ann.id)}><Trash2 size={14} /></button>}
                  </div>
                )}
              </div>
              {ann.body && <p className="util-ann-body">{ann.body}</p>}
              <div className="util-ann-meta">
                <span className="fee-mono">From {ann.start_date}{ann.end_date ? ` to ${ann.end_date}` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
