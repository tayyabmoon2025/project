import { useEffect, useState } from 'react';
import { CalendarPlus, CalendarRange, Info, MousePointerClick, Percent, Plus, ShieldCheck } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import {
  ALL_WEEKDAYS, CALENDAR_DAY_LABELS, MONTH_NAMES, WEEKDAY_LABELS, WEEKDAY_SHORT,
  formatDayRange, isClosedDayType, toDateKey, todayKey,
  type CalendarDay, type CalendarDayType, type CalendarPolicy,
} from '@/lib/attendance';
import { CalendarHistoryList } from '@/components/CalendarHistory';

type CalendarForm = { start: string; end: string; title: string; notes: string };

const emptyForm = (): CalendarForm => ({ start: '', end: '', title: '', notes: '' });

type Props = {
  policy: CalendarPolicy;
  days: CalendarDay[];
  saving: boolean;
  onPolicyChange: (policy: CalendarPolicy) => void;
  onSavePolicy: () => Promise<boolean | void>;
  onAddDay: (entry: { day_date: string; end_date: string; day_type: CalendarDayType; title: string; notes?: string | null }) => void;
  onRemoveDay: (dayDate: string) => void;
  onToast: (message: string) => void;
};

export function SchoolCalendarSettings({
  policy, days, saving, onPolicyChange, onSavePolicy, onAddDay, onRemoveDay, onToast,
}: Props) {
  const [holidayForm, setHolidayForm] = useState<CalendarForm>(emptyForm);
  const [specialForm, setSpecialForm] = useState<CalendarForm>(emptyForm);
  const [thresholdDraft, setThresholdDraft] = useState(String(policy.low_attendance_threshold));
  const [showAllWeekdays, setShowAllWeekdays] = useState(false);

  // Follows the saved policy, so the box is right even when the policy finishes
  // loading after this tab is already open.
  useEffect(() => { setThresholdDraft(String(policy.low_attendance_threshold)); }, [policy.low_attendance_threshold]);

  const holidays = days.filter((day) => isClosedDayType(day.day_type));
  const specials = days.filter((day) => day.day_type === 'special_working');

  const threshold = Number(thresholdDraft);
  const thresholdValid = thresholdDraft.trim() !== '' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 100;

  const applyThreshold = () => {
    if (!thresholdValid) { setThresholdDraft(String(policy.low_attendance_threshold)); return; }
    onPolicyChange({ ...policy, low_attendance_threshold: threshold });
  };

  const toggleWeekday = (weekday: number) => {
    const next = policy.working_days.includes(weekday)
      ? policy.working_days.filter((day) => day !== weekday)
      : [...policy.working_days, weekday].sort((a, b) => a - b);
    if (next.length === 0) { onToast('A school week needs at least one working day.'); return; }
    onPolicyChange({ ...policy, working_days: next });
  };

  const addDay = (type: CalendarDayType, form: CalendarForm, reset: () => void, label: string) => {
    if (!form.start) { onToast(`Choose the start date for the ${label.toLowerCase()} first.`); return; }
    const end = form.end || form.start;
    if (end < form.start) { onToast('The end date cannot be before the start date.'); return; }
    if (form.start < todayKey()) { onToast('Choose today or a future date.'); return; }
    onAddDay({ day_date: form.start, end_date: end, day_type: type, title: form.title, notes: form.notes });
    reset();
  };

  const weekdayTiles = showAllWeekdays ? ALL_WEEKDAYS : policy.working_days;

  const renderForm = (type: CalendarDayType, form: CalendarForm, setForm: (next: CalendarForm) => void, label: string, buttonLabel: string) => {
    const span = form.start && form.end && form.end !== form.start;
    return (
      <div className="cal-form">
        <label className="control-field">Start Date
          <input type="date" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value, end: form.end && form.end < event.target.value ? event.target.value : form.end })} />
        </label>
        <label className="control-field">End Date
          <input type="date" value={form.end || form.start} min={form.start || undefined} onChange={(event) => setForm({ ...form, end: event.target.value })} />
        </label>
        <label className="control-field">Title
          <input
            value={form.title}
            placeholder={type === 'holiday' ? 'Eid holidays, Independence Day…' : 'Sports day, make-up class…'}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label className="control-field">Notes (optional)
          <input
            value={form.notes}
            placeholder={type === 'holiday' ? 'Office open for staff only' : 'Half day, exams only'}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>
        <div className="cal-form-foot">
          <span className="cal-form-hint">
            {form.start
              ? (span
                ? <><CalendarRange size={13} /> One saved entry covering {formatDayRange(form.start, form.end)}</>
                : <><Info size={13} /> Leave the end date as it is for a single day.</>)
              : <><Info size={13} /> Pick a start date. Set an end date for a multi-day span.</>}
          </span>
          <button
            type="button"
            className="secondary-button cal-add-button"
            onClick={() => addDay(type, form, () => setForm(emptyForm()), label)}
          >
            {type === 'holiday' ? <CalendarPlus size={16} /> : <Plus size={16} />} {buttonLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="cal-settings">
      <div className="panel cal-panel">
        <div className="cal-panel-header">
          <div className="cal-panel-copy">
            <span className="eyebrow">Attendance policy</span>
            <h2>School Working Schedule &amp; Policy</h2>
            <p>These settings decide which days count towards attendance and when a student is flagged for low attendance.</p>
          </div>
          <AsyncSaveButton label="Save Policy" size={16} disabled={saving || !thresholdValid} onSave={onSavePolicy} />
        </div>

        <div className="cal-block">
          <div className="cal-block-head">
            <strong>Working days</strong>
            <span>Tap a day to switch it between a working day and a weekly off. Off days are shown in yellow.</span>
          </div>
          <div className="cal-week">
            {weekdayTiles.map((weekday) => {
              const working = policy.working_days.includes(weekday);
              return (
                <button
                  key={weekday}
                  type="button"
                  className={`cal-day-pill ${working ? 'working' : 'off'}`}
                  aria-pressed={!working}
                  onClick={() => toggleWeekday(weekday)}
                >
                  <span className="cal-day-short">{WEEKDAY_SHORT[weekday]}</span>
                  <span className="cal-day-full">{WEEKDAY_LABELS[weekday]}</span>
                  <span className="cal-day-state">{working ? 'Working' : 'Weekly off'}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="cal-week-toggle" onClick={() => setShowAllWeekdays((current) => !current)}>
            {showAllWeekdays ? 'Show only working days' : 'Show all seven days'}
          </button>
        </div>

        <div className="cal-policy-grid">
          <div className="cal-policy-card">
            <span className="cal-policy-icon"><Percent size={17} /></span>
            <div className="cal-policy-body">
              <strong>Low Attendance Warning Threshold (%)</strong>
              <small>Students below this attendance percentage are highlighted in the monthly report.</small>
              <div className="cal-threshold-row">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={thresholdDraft}
                  onChange={(event) => setThresholdDraft(event.target.value)}
                  onBlur={applyThreshold}
                  aria-label="Low attendance warning threshold percentage"
                />
                <span className="cal-threshold-unit">%</span>
              </div>
              {!thresholdValid && <span className="cal-inline-error">Enter a number between 0 and 100.</span>}
            </div>
          </div>

          <label className="cal-policy-card checkable">
            <span className="cal-policy-icon"><ShieldCheck size={17} /></span>
            <div className="cal-policy-body">
              <strong>Exclude approved leave days from attendance denominator</strong>
              <small>When on, a day a student was on approved leave is left out of the total instead of counting against them.</small>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-sky-600"
              checked={policy.exclude_leave_from_denominator}
              onChange={(event) => onPolicyChange({ ...policy, exclude_leave_from_denominator: event.target.checked })}
            />
          </label>
        </div>

        <p className="cal-hint">
          <Info size={14} />
          Sundays are treated as a weekly off by default. Everything you change here takes effect as soon as you save the policy.
        </p>
      </div>

      <div className="cal-grid">
        <div className="panel cal-panel">
          <div className="cal-panel-header">
            <div className="cal-panel-copy">
              <span className="eyebrow">Closed days</span>
              <h2>School Vacations &amp; Public Holidays</h2>
              <p>Add every closed day so it is left out of the attendance count instead of being treated as an absence. One entry can cover a whole break.</p>
            </div>
            <span className="cal-count">{holidays.length}</span>
          </div>

          {renderForm('holiday', holidayForm, setHolidayForm, 'Holiday', 'Add Vacation / Holiday')}

          <div className="cal-history">
            <span className="cal-history-title">Saved history</span>
            <CalendarHistoryList
              days={holidays}
              emptyText="No vacations or public holidays added yet."
              onRemove={onRemoveDay}
            />
          </div>
        </div>

        <div className="panel cal-panel">
          <div className="cal-panel-header">
            <div className="cal-panel-copy">
              <span className="eyebrow">Open days</span>
              <h2>Special Working Day Overrides</h2>
              <p>Add a day the school opens even though the working week would normally keep it closed.</p>
            </div>
            <span className="cal-count special">{specials.length}</span>
          </div>

          {renderForm('special_working', specialForm, setSpecialForm, 'Special working day', 'Add Special Working Day')}

          <div className="cal-history">
            <span className="cal-history-title">Saved history</span>
            <CalendarHistoryList
              days={specials}
              emptyText="No special working days added yet."
              onRemove={onRemoveDay}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// A month laid out as a clickable grid: tap a date to treat it as an off day,
// tap the same date again to reopen it.
type DayGridProps = {
  month: string;
  days: CalendarDay[];
  workingDays: number[];
  onToggle: (date: string) => void;
};

export function CalendarDayGrid({ month, days, workingDays, onToggle }: DayGridProps) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return null;

  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const totalDays = new Date(year, monthNumber, 0).getDate();
  const today = todayKey();

  // A date can sit inside a multi-day entry, so every covered date is expanded
  // and the most recent entry wins when spans overlap.
  const byDate = new Map<string, CalendarDay>();
  for (const day of days) {
    const cursor = new Date(`${day.day_date.slice(0, 10)}T00:00:00`);
    const last = new Date(`${(day.end_date || day.day_date).slice(0, 10)}T00:00:00`);
    let guard = 0;
    while (cursor <= last && guard < 400) {
      byDate.set(toDateKey(cursor), day);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }

  const cells: (string | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => toDateKey(new Date(year, monthNumber - 1, index + 1))),
  ];

  return (
    <div className="panel cal-grid-panel">
      <div className="cal-grid-head">
        <div>
          <span className="eyebrow">Tap to change</span>
          <strong>{MONTH_NAMES[monthNumber - 1]} {year}</strong>
        </div>
        <span className="cal-grid-note"><MousePointerClick size={15} /> Tap a date to mark it as an off day, or tap an off day again to reopen the school.</span>
      </div>
      <div className="cal-grid-weekdays">
        {WEEKDAY_SHORT.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="cal-grid-cells">
        {cells.map((date, index) => {
          if (!date) return <span className="cal-cell blank" key={`blank-${index}`} />;
          const entry = byDate.get(date);
          const state = entry
            ? (entry.day_type === 'special_working' ? 'special' : 'off')
            : (workingDays.includes(new Date(`${date}T00:00:00`).getDay()) ? 'working' : 'off');
          return (
            <button
              type="button"
              key={date}
              className={`cal-cell ${state}${date === today ? ' today' : ''}`}
              title={entry ? `${entry.title} — ${CALENDAR_DAY_LABELS[entry.day_type]} (${formatDayRange(entry.day_date, entry.end_date)})` : 'Tap to mark this date as an off day'}
              onClick={() => onToggle(date)}
            >
              <span>{Number(date.slice(8, 10))}</span>
              {entry && <i className="cal-cell-dot" />}
            </button>
          );
        })}
      </div>
      <div className="cal-grid-legend">
        <span><i className="swatch working" /> School open</span>
        <span><i className="swatch off" /> Off day</span>
        <span><i className="swatch special" /> Special working day</span>
      </div>
    </div>
  );
}
