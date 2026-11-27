import { useEffect, useMemo, useState } from 'react';
import { CalendarOff, CalendarPlus, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { fetchHolidays, type HolidayRow } from '@/lib/utilityTools';
import { CALENDAR_DAY_LABELS, todayKey, type CalendarDayType } from '@/lib/attendance';
import { removeCalendarDay, saveCalendarDay } from '@/lib/schoolCalendar';
import { useAuth } from '@/lib/auth';
import {
  formatHolidayDays,
  HOLIDAY_DAY_TYPES,
  LUNAR_HOLIDAYS,
  missingGazettedHolidays,
  PAKISTAN_GAZETTED_HOLIDAYS,
  suggestedHolidayDraft,
  type HolidayDraft,
} from '@/lib/schoolHolidays';

type Props = {
  onToast: (message: string) => void;
};

const EMPTY_DRAFT: HolidayDraft = {
  dayDate: '',
  endDate: '',
  dayType: 'holiday',
  title: '',
  notes: '',
};

export function UtilityHolidaysTab({ onToast }: Props) {
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [draft, setDraft] = useState<HolidayDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await fetchHolidays();
    setHolidays(result.holidays);
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const today = todayKey();
  const filtered = useMemo(() => holidays.filter((holiday) => {
    if (typeFilter && holiday.day_type !== typeFilter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return [holiday.title, holiday.notes ?? '', holiday.day_date, holiday.end_date].join(' ').toLowerCase().includes(needle);
  }), [holidays, search, typeFilter]);

  const upcoming = filtered.filter((holiday) => (holiday.end_date || holiday.day_date) >= today).length;
  const dayLabel = (type: string) => CALENDAR_DAY_LABELS[type as CalendarDayType] ?? type;

  const openAdd = (seed?: Partial<HolidayDraft>) => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, dayDate: today, endDate: today, ...seed });
    setError('');
  };

  const openEdit = (holiday: HolidayRow) => {
    setEditingId(holiday.id);
    setDraft({
      dayDate: holiday.day_date,
      endDate: holiday.end_date || holiday.day_date,
      dayType: holiday.day_type as CalendarDayType,
      title: holiday.title,
      notes: holiday.notes ?? '',
    });
    setError('');
  };

  const closeEditor = () => { setDraft(null); setEditingId(null); };

  const save = async (): Promise<boolean | void> => {
    if (!draft) return false;
    if (!draft.dayDate) { setError('Choose the first date of this holiday.'); return false; }
    if (!draft.title.trim()) { setError('Give this holiday a title, for example "Independence Day".'); return false; }
    if (draft.endDate && draft.endDate < draft.dayDate) { setError('The last date cannot be before the first date.'); return false; }
    setBusy(true);
    const problem = await saveCalendarDay(
      {
        day_date: draft.dayDate,
        end_date: draft.endDate || draft.dayDate,
        day_type: draft.dayType,
        title: draft.title,
        notes: draft.notes,
      },
      user?.id ?? null,
    );
    setBusy(false);
    if (problem) { setError(problem); return false; }
    // An edited row whose date was moved is saved under the new date, so the old date has
    // to go or the same holiday would sit on the calendar twice.
    if (editingId) {
      const previous = holidays.find((holiday) => holiday.id === editingId);
      if (previous && previous.day_date !== draft.dayDate) await removeCalendarDay(previous.day_date);
    }
    closeEditor();
    await load();
    onToast(`"${draft.title.trim()}" was saved on the school calendar.`);
    return true;
  };

  const remove = async (holiday: HolidayRow) => {
    setBusy(true);
    const problem = await removeCalendarDay(holiday.day_date);
    setBusy(false);
    if (problem) { setError(problem); return; }
    await load();
    onToast(`"${holiday.title}" was removed from the school calendar.`);
  };

  // A closed day can be switched to a special working day and back, which is how a
  // holiday that turns out to be a working Saturday is handled without retyping it.
  const toggleClosed = async (holiday: HolidayRow) => {
    const nextType: CalendarDayType = holiday.day_type === 'special_working' ? 'holiday' : 'special_working';
    setBusy(true);
    const problem = await saveCalendarDay(
      {
        day_date: holiday.day_date,
        end_date: holiday.end_date || holiday.day_date,
        day_type: nextType,
        title: holiday.title,
        notes: holiday.notes,
      },
      user?.id ?? null,
    );
    setBusy(false);
    if (problem) { setError(problem); return; }
    await load();
    onToast(nextType === 'special_working'
      ? `"${holiday.title}" is now a working day.`
      : `"${holiday.title}" is now a closed day.`);
  };

  const seedGazetted = async () => {
    const wanted = missingGazettedHolidays(holidays.map((holiday) => holiday.day_date), today);
    if (wanted.length === 0) { setSeedOpen(false); onToast('Every Pakistan public holiday for this year and next is already on the calendar.'); return; }
    setBusy(true);
    let failed = '';
    for (const entry of wanted) {
      const problem = await saveCalendarDay(
        { day_date: entry.dayDate, end_date: entry.dayDate, day_type: 'holiday', title: entry.title, notes: 'Pakistan gazetted public holiday.' },
        user?.id ?? null,
      );
      if (problem) { failed = problem; break; }
    }
    setBusy(false);
    setSeedOpen(false);
    if (failed) { setError(failed); return; }
    await load();
    onToast(`${wanted.length} Pakistan public holiday${wanted.length === 1 ? '' : 's'} added to the calendar.`);
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Holidays</span>
          <h2>School Holidays &amp; Closed Days</h2>
          <p className="holiday-head-copy">
            These are the same closed days the Daily Attendance register and the Exam Date Sheet use. Everyone is
            alerted the day before a holiday, and a notice is placed in every portal automatically.
          </p>
        </div>
        {isAdmin && (
          <div className="holiday-head-actions">
            <button type="button" className="secondary-button" onClick={() => setSeedOpen(true)} disabled={busy}>
              <Sparkles size={15} /> Add Pakistan public holidays
            </button>
            <button type="button" className="primary-button" onClick={() => openAdd()} disabled={busy}>
              <Plus size={15} /> Add Holiday
            </button>
          </div>
        )}
      </div>

      <div className="fee-filters">
        <label className="control-field holiday-search">
          <span className="control-label">Search</span>
          <span className="control-input-icon">
            <Search size={16} />
            <input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title…" />
          </span>
        </label>
        <label className="control-field">
          Type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All types</option>
            {Object.entries(CALENDAR_DAY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {seedOpen && (
        <div className="holiday-seed-panel">
          <div>
            <strong>Pakistan gazetted public holidays</strong>
            <p>
              The six holidays notified on the same date every year — Kashmir Day, Pakistan Day, Labour Day,
              Independence Day, Iqbal Day and Quaid-e-Azam Day — for this year and next.
            </p>
            <div className="holiday-seed-list">
              {PAKISTAN_GAZETTED_HOLIDAYS.map((holiday) => (
                <span key={holiday.title}>{holiday.title}</span>
              ))}
            </div>
          </div>
          <div className="holiday-seed-actions">
            <button type="button" className="secondary-button" onClick={() => setSeedOpen(false)}>Cancel</button>
            <button type="button" className="primary-button" onClick={() => void seedGazetted()} disabled={busy}>
              <CalendarPlus size={15} /> Add them
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="holiday-editor">
          <div className="holiday-editor-head">
            <strong>{editingId ? 'Edit this holiday' : 'Add a holiday'}</strong>
            <button type="button" className="close-button" onClick={closeEditor} aria-label="Close"><X size={17} /></button>
          </div>
          <div className="holiday-editor-grid">
            <label className="control-field">Title
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Independence Day" />
            </label>
            <label className="control-field">Type
              <select value={draft.dayType} onChange={(event) => setDraft({ ...draft, dayType: event.target.value as CalendarDayType })}>
                {HOLIDAY_DAY_TYPES.map((type) => (
                  <option key={type} value={type}>{CALENDAR_DAY_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label className="control-field">First date
              <input type="date" value={draft.dayDate} onChange={(event) => setDraft({
                ...draft,
                dayDate: event.target.value,
                endDate: !draft.endDate || draft.endDate < event.target.value ? event.target.value : draft.endDate,
              })} />
            </label>
            <label className="control-field">Last date
              <input type="date" min={draft.dayDate || undefined} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
            </label>
            <label className="control-field full">Notes (optional)
              <input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Anything the notice should mention" />
            </label>
          </div>
          <p className="holiday-editor-hint">
            A closure covering several days only needs one row: set the first and last date. Leave the last date the
            same as the first for a single day.
          </p>
          <div className="holiday-editor-actions">
            <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
            <AsyncSaveButton
              label={editingId ? 'Save changes' : 'Add to calendar'}
              size={15}
              disabled={busy}
              onSave={() => save()}
            />
          </div>
        </div>
      )}

      {loading ? (
        <p className="fee-empty">Loading holidays…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No holidays{search || typeFilter ? ' match your filters' : ''}.</p>
      ) : (
        <>
          <div className="fee-kpi-grid compact" style={{ marginBottom: 16 }}>
            <div className="fee-kpi sky">
              <span className="fee-kpi-icon"><CalendarOff size={20} /></span>
              <div><span>Total holidays</span><strong>{filtered.length}</strong></div>
            </div>
            <div className="fee-kpi mint">
              <span className="fee-kpi-icon"><CalendarOff size={20} /></span>
              <div><span>Upcoming</span><strong>{upcoming}</strong></div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th><th>Type</th><th>Dates</th><th>Notes</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((holiday) => (
                  <tr key={holiday.id} className={(holiday.end_date || holiday.day_date) < today ? 'holiday-past' : ''}>
                    <td><strong>{holiday.title}</strong></td>
                    <td><span className="fee-status neutral">{dayLabel(holiday.day_type)}</span></td>
                    <td className="fee-mono">{formatHolidayDays(holiday.day_date, holiday.end_date)}</td>
                    <td>{holiday.notes || '—'}</td>
                    {isAdmin && (
                      <td>
                        <div className="holiday-row-actions">
                          <button type="button" className="row-action-btn" title="Edit this holiday" onClick={() => openEdit(holiday)} disabled={busy}>
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="row-action-btn"
                            title={holiday.day_type === 'special_working' ? 'Make this a closed day' : 'Make this a working day'}
                            onClick={() => void toggleClosed(holiday)}
                            disabled={busy}
                          >
                            {holiday.day_type === 'special_working' ? <CalendarOff size={14} /> : <CalendarPlus size={14} />}
                          </button>
                          <button type="button" className="row-action-btn danger" title="Remove this holiday" onClick={() => void remove(holiday)} disabled={busy}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isAdmin && (
        <div className="holiday-suggestions">
          <div className="holiday-suggestions-head">
            <strong>Islamic and vacation entries</strong>
            <p>These move every year, so add one and set the dates once the announcement is made.</p>
          </div>
          <div className="holiday-suggestion-list">
            {LUNAR_HOLIDAYS.map((entry) => (
              <button
                key={entry.title}
                type="button"
                className="holiday-suggestion"
                disabled={busy}
                onClick={() => openAdd(suggestedHolidayDraft(entry, today, holidays))}
              >
                <Plus size={13} /> {entry.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="fin-hint">
        Holidays saved here feed the Daily Attendance register, the attendance percentage on report cards and the Exam
        Date Sheet. A closed day is never counted as an absent day.
      </p>
    </div>
  );
}
