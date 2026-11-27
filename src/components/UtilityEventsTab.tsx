import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  deleteEvent,
  saveEvent,
  updateEventStatus,
  type EventDraft,
  type EventStatus,
  type EventType,
  type SchoolEvent,
} from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';

type Props = {
  events: SchoolEvent[];
  loading: boolean;
  onReload: () => void;
  onToast: (message: string) => void;
};

const emptyForm = (): EventDraft => ({
  title: '',
  event_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  location: '',
  description: '',
  event_type: 'other',
  status: 'upcoming',
});

export function UtilityEventsTab({ events, loading, onReload, onToast }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAdmin || profile?.role === 'office_assistant';
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<EventType | ''>('');

  const filtered = useMemo(() => {
    return events.filter((event) => {
      if (typeFilter && event.event_type !== typeFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return [event.title, event.location, event.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [events, filter, typeFilter]);

  const submit = async () => {
    if (!draft.title.trim()) { onToast('Enter the event title first.'); return; }
    setSaving(true);
    const error = await saveEvent({
      ...draft,
      title: draft.title.trim(),
      location: draft.location.trim(),
      description: draft.description?.trim() || null,
      end_date: draft.end_date && draft.end_date < draft.event_date ? null : draft.end_date,
    });
    setSaving(false);
    if (error) { onToast(error); return; }
    onToast('Event saved.');
    setDraft(emptyForm());
    setShowForm(false);
    onReload();
  };

  const changeStatus = async (id: string, status: EventStatus) => {
    const error = await updateEventStatus(id, status);
    if (error) { onToast(error); return; }
    onToast('Status updated.');
    onReload();
  };

  const remove = async (id: string) => {
    const error = await deleteEvent(id);
    if (error) { onToast(error); return; }
    onToast('Event removed.');
    onReload();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Events</span>
          <h2>School Events</h2>
        </div>
        {canEdit && !showForm && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Event
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Event Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Annual function, Sports day…" />
            </label>
            <label className="control-field">Event Type
              <select value={draft.event_type} onChange={(e) => setDraft({ ...draft, event_type: e.target.value as EventType })}>
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                  <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="control-field">Start Date
              <input type="date" value={draft.event_date} onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} />
            </label>
            <label className="control-field">End Date (optional)
              <input type="date" value={draft.end_date ?? ''} min={draft.event_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value || null })} />
            </label>
            <label className="control-field">Location
              <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="School hall, playground…" />
            </label>
            <label className="control-field">Description (optional)
              <input value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Details about the event" />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => { setShowForm(false); setDraft(emptyForm()); }}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              <Plus size={15} /> {saving ? 'Saving…' : 'Save Event'}
            </button>
          </div>
        </div>
      )}

      <div className="fee-filters">
        <label className="control-field">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by title, location…" />
        </label>
        <label className="control-field">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EventType | '')}>
            <option value="">All types</option>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="fee-empty">Loading events…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No events{filter || typeFilter ? ' match your filters' : ''}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Event</th><th>Type</th><th>Date</th><th>Location</th><th>Status</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td><div className="table-student"><CalendarDays size={14} /><strong>{event.title}</strong></div></td>
                  <td><span className="fee-status neutral">{EVENT_TYPE_LABELS[event.event_type]}</span></td>
                  <td className="fee-mono">{event.event_date}{event.end_date && event.end_date !== event.event_date ? ` → ${event.end_date}` : ''}</td>
                  <td>{event.location || '—'}</td>
                  <td>
                    {canEdit ? (
                      <select
                        className="util-status-select"
                        value={event.status}
                        onChange={(e) => changeStatus(event.id, e.target.value as EventStatus)}
                      >
                        {(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((s) => (
                          <option key={s} value={s}>{EVENT_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`fee-status ${event.status === 'completed' ? 'paid' : event.status === 'cancelled' ? 'unpaid' : 'partial'}`}>
                        {EVENT_STATUS_LABELS[event.status]}
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link danger" onClick={() => remove(event.id)}><Trash2 size={14} /></button>
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
