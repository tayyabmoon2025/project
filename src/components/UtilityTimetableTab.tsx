import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import {
  WEEKDAY_FULL,
  deleteTimetableEntry,
  fetchTimetable,
  saveTimetableEntry,
  type TimetableDraft,
  type TimetableEntry,
} from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';

type Props = {
  onToast: (message: string) => void;
};

const CLASSES = ['Nursery', 'Prep', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const emptyForm = (classDefault = '', sectionDefault = ''): TimetableDraft => ({
  class_name: classDefault,
  section_name: sectionDefault,
  day_of_week: 1,
  period: 1,
  subject: '',
  teacher_name: '',
  start_time: '',
  end_time: '',
  room: '',
  notes: '',
});

export function UtilityTimetableTab({ onToast }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAdmin || profile?.role === 'office_assistant' || profile?.role === 'teacher';
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<TimetableDraft>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!classFilter) { setLoading(false); return; }
    setLoading(true);
    const result = await fetchTimetable(classFilter, sectionFilter);
    setEntries(result.entries);
    setError(result.error ?? '');
    setLoading(false);
  }, [classFilter, sectionFilter]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const byDay: Record<number, TimetableEntry[]> = {};
    for (let d = 0; d <= 6; d++) byDay[d] = [];
    for (const entry of entries) {
      if (!byDay[entry.day_of_week]) byDay[entry.day_of_week] = [];
      byDay[entry.day_of_week].push(entry);
    }
    for (const d of Object.keys(byDay)) byDay[Number(d)].sort((a, b) => a.period - b.period);
    return byDay;
  }, [entries]);

  const activeDays = Object.keys(grouped).map(Number).filter((d) => grouped[d].length > 0).sort();

  const submit = async () => {
    if (!draft.class_name.trim()) { onToast('Pick a class first.'); return; }
    if (!draft.subject.trim() && !draft.teacher_name.trim()) { onToast('Enter a subject or teacher.'); return; }
    setSaving(true);
    const error = await saveTimetableEntry({
      ...draft,
      class_name: draft.class_name.trim(),
      section_name: draft.section_name.trim(),
      subject: draft.subject.trim(),
      teacher_name: draft.teacher_name.trim(),
      start_time: draft.start_time.trim(),
      end_time: draft.end_time.trim(),
      room: draft.room.trim(),
      notes: draft.notes?.trim() || null,
    });
    setSaving(false);
    if (error) { onToast(error); return; }
    onToast('Timetable entry saved.');
    setDraft(emptyForm(classFilter, sectionFilter));
    setShowForm(false);
    void load();
  };

  const remove = async (id: string) => {
    const error = await deleteTimetableEntry(id);
    if (error) { onToast(error); return; }
    onToast('Entry removed.');
    void load();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Timetable</span>
          <h2>Class Timetable</h2>
        </div>
        {canEdit && classFilter && !showForm && (
          <button className="primary-button" onClick={() => { setDraft(emptyForm(classFilter, sectionFilter)); setShowForm(true); }}>
            <Plus size={16} /> Add Period
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Class
              <select value={draft.class_name} onChange={(e) => setDraft({ ...draft, class_name: e.target.value })}>
                <option value="">Select class</option>
                {CLASSES.map((c) => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </label>
            <label className="control-field">Section
              <input value={draft.section_name} onChange={(e) => setDraft({ ...draft, section_name: e.target.value })} placeholder="A, B, C…" />
            </label>
            <label className="control-field">Day
              <select value={draft.day_of_week} onChange={(e) => setDraft({ ...draft, day_of_week: Number(e.target.value) })}>
                {WEEKDAY_FULL.map((day, i) => <option key={i} value={i}>{day}</option>)}
              </select>
            </label>
            <label className="control-field">Period
              <input type="number" min={1} max={12} value={draft.period} onChange={(e) => setDraft({ ...draft, period: Number(e.target.value) })} />
            </label>
            <label className="control-field">Subject
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Maths, English…" />
            </label>
            <label className="control-field">Teacher
              <input value={draft.teacher_name} onChange={(e) => setDraft({ ...draft, teacher_name: e.target.value })} placeholder="Teacher name" />
            </label>
            <label className="control-field">Start Time
              <input type="time" value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} />
            </label>
            <label className="control-field">End Time
              <input type="time" value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} />
            </label>
            <label className="control-field">Room (optional)
              <input value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} placeholder="Room number" />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              <Plus size={15} /> {saving ? 'Saving…' : 'Save Period'}
            </button>
          </div>
        </div>
      )}

      <div className="fee-filters">
        <label className="control-field">
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">Select class to view</option>
            {CLASSES.map((c) => <option key={c} value={c}>Class {c}</option>)}
          </select>
        </label>
        <label className="control-field">
          <input value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} placeholder="Filter by section (optional)" />
        </label>
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {!classFilter ? (
        <p className="fee-empty">Select a class to view its timetable.</p>
      ) : loading ? (
        <p className="fee-empty">Loading timetable…</p>
      ) : activeDays.length === 0 ? (
        <p className="fee-empty">No timetable entries for this class yet.</p>
      ) : (
        <div className="util-tt-grid">
          {activeDays.map((day) => (
            <div key={day} className="util-tt-day">
              <div className="util-tt-day-head">
                <Clock size={14} />
                <strong>{WEEKDAY_FULL[day]}</strong>
                <span className="fee-mono">{grouped[day].length} period{grouped[day].length !== 1 ? 's' : ''}</span>
              </div>
              <div className="util-tt-periods">
                {grouped[day].map((entry) => (
                  <div key={entry.id} className="util-tt-period">
                    <div className="util-tt-period-info">
                      <span className="util-tt-num">P{entry.period}</span>
                      <div>
                        <strong>{entry.subject || '—'}</strong>
                        <small>{entry.teacher_name || '—'}{entry.start_time ? ` · ${entry.start_time}${entry.end_time ? `–${entry.end_time}` : ''}` : ''}{entry.room ? ` · ${entry.room}` : ''}</small>
                      </div>
                    </div>
                    {canEdit && <button className="fee-link danger" onClick={() => remove(entry.id)}><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
