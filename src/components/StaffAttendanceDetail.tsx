import { useState } from 'react';
import { CalendarDays, CalendarPlus, Check, Info, Loader as Loader2, Pencil, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/auth';
import { attendancePercentage, formatPercentage, todayKey } from '@/lib/attendance';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  STAFF_ATTENDANCE_LABELS,
  STAFF_ATTENDANCE_STATUSES,
  saveStaffAttendanceDay,
  type StaffAttendanceRecord,
  type StaffAttendanceStatus,
} from '@/lib/staffAttendance';

export type StaffAttendanceDay = {
  date: string;
  status: StaffAttendanceStatus;
  note: string | null;
  // The whole row travels with the day so an edit of the status or note can put the
  // check-in time and location straight back, instead of wiping them.
  record: StaffAttendanceRecord;
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  student: 'Student',
};

const STATUS_TONE: Record<StaffAttendanceStatus, string> = {
  present: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  absent: 'border-rose-200 bg-rose-50 text-rose-700',
  late: 'border-amber-200 bg-amber-50 text-amber-700',
  leave: 'border-sky-200 bg-sky-50 text-sky-700',
};

const formatDay = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
};

export function StaffAttendanceDetail({ member, periodLabel, periodStart, periodEnd, days, onSaved, onClose }: {
  member: UserProfile;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  days: StaffAttendanceDay[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, StaffAttendanceStatus>>({});
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A custom range can start in the past, so the new-day form opens on today when
  // today falls inside the period and otherwise on its first day.
  const [newDate, setNewDate] = useState(() => {
    const today = todayKey();
    return today < periodStart || today > periodEnd ? periodStart : today;
  });
  const [newStatus, setNewStatus] = useState<StaffAttendanceStatus>('present');
  const [newNote, setNewNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const present = days.filter((day) => day.status === 'present').length;
  const late = days.filter((day) => day.status === 'late').length;
  const absent = days.filter((day) => day.status === 'absent').length;
  const leave = days.filter((day) => day.status === 'leave').length;
  const percentage = attendancePercentage(present + late, days.length);

  const summary = [
    { label: 'Days recorded', value: days.length, tone: 'text-slate-700' },
    { label: 'Present', value: present + late, tone: 'text-emerald-600' },
    { label: 'Absent', value: absent, tone: 'text-rose-600' },
    { label: 'Late', value: late, tone: 'text-amber-600' },
    { label: 'On leave', value: leave, tone: 'text-sky-700' },
    { label: 'Attendance', value: formatPercentage(percentage), tone: 'text-slate-700' },
  ];

  const statusFor = (day: StaffAttendanceDay) => statusDrafts[day.date] ?? day.status;
  const noteFor = (day: StaffAttendanceDay) => noteDrafts[day.date] ?? day.note ?? '';
  const isDirty = (day: StaffAttendanceDay) =>
    statusFor(day) !== day.status || noteFor(day).trim() !== (day.note ?? '').trim();

  const currentUserId = async () => {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  };

  const saveDay = async (day: StaffAttendanceDay) => {
    setError(null);
    setSavingDate(day.date);
    const { error: saveError } = await saveStaffAttendanceDay({
      staffUserId: member.id,
      date: day.date,
      status: statusFor(day),
      note: noteFor(day),
      markedBy: await currentUserId(),
      record: day.record,
    });
    if (saveError) { setError(saveError); setSavingDate(null); return; }
    await onSaved();
    setNoteDrafts((current) => { const next = { ...current }; delete next[day.date]; return next; });
    setStatusDrafts((current) => { const next = { ...current }; delete next[day.date]; return next; });
    setSavingDate(null);
  };

  const addDay = async () => {
    setError(null);
    if (newDate < periodStart || newDate > periodEnd) {
      setError(`Choose a date between ${formatDay(periodStart)} and ${formatDay(periodEnd)}.`);
      return;
    }
    setSavingDate(newDate);
    const { error: saveError } = await saveStaffAttendanceDay({
      staffUserId: member.id,
      date: newDate,
      status: newStatus,
      note: newNote,
      markedBy: await currentUserId(),
      record: days.find((day) => day.date === newDate)?.record ?? null,
    });
    if (saveError) { setError(saveError); setSavingDate(null); return; }
    await onSaved();
    setNewNote('');
    setAdding(false);
    setSavingDate(null);
  };

  const existingDates = new Set(days.map((day) => day.date));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="staff-detail-sheet flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${member.full_name} attendance for ${periodLabel}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <PersonAvatar photoUrl={member.photo_url} name={member.full_name} className="grid h-11 w-11 place-items-center rounded-xl bg-sky-50 text-sm font-bold text-sky-700" />
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Attendance history</span>
              <h2 className="text-lg font-bold leading-tight text-slate-800">{member.full_name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {ROLE_LABELS[member.role] ?? member.role} · {member.username} · {periodLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 sm:grid-cols-6">
          {summary.map((item) => (
            <div key={item.label} className="text-center">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">{item.label}</span>
              <strong className={`mt-1 block text-base font-extrabold ${item.tone}`}>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-2.5">
          <span className="text-[11px] font-semibold text-slate-500">
            Edit a day’s note, change its status, or add a day that was missed in this period.
          </span>
          <button type="button" className="secondary-button" onClick={() => setAdding((current) => !current)}>
            <CalendarPlus size={15} /> {adding ? 'Cancel' : 'Add a day'}
          </button>
        </div>

        {adding && (
          <div className="border-b border-slate-200 bg-sky-50/60 px-5 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="control-field">
                Date
                <input
                  type="date"
                  min={periodStart}
                  max={periodEnd}
                  value={newDate}
                  onChange={(event) => setNewDate(event.target.value)}
                />
              </label>
              <label className="control-field">
                Status
                <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as StaffAttendanceStatus)}>
                  {STAFF_ATTENDANCE_STATUSES.map((status) => (
                    <option key={status} value={status}>{STAFF_ATTENDANCE_LABELS[status]}</option>
                  ))}
                </select>
              </label>
              <label className="control-field min-w-[12rem] flex-1">
                Note
                <input
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                  placeholder="Optional reason, e.g. sick leave"
                  maxLength={300}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={() => void addDay()}
                disabled={savingDate !== null}
              >
                {savingDate !== null ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add day
              </button>
            </div>
            {existingDates.has(newDate) && (
              <p className="mt-2 text-[11px] font-semibold text-amber-600">
                {formatDay(newDate)} is already recorded — adding it will update that day.
              </p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 text-xs font-semibold text-rose-600">{error}</p>}
          {days.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No attendance was recorded for {member.full_name} in {periodLabel}. Use “Add a day” to record one.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {days.map((day) => (
                <li
                  key={day.date}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-slate-300"
                >
                  <span className="flex w-24 shrink-0 items-center gap-2 text-xs font-bold text-slate-600">
                    <CalendarDays size={14} className="text-slate-400" />
                    {formatDay(day.date)}
                  </span>
                  <select
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide outline-none ${STATUS_TONE[statusFor(day)]}`}
                    value={statusFor(day)}
                    onChange={(event) => setStatusDrafts((current) => ({ ...current, [day.date]: event.target.value as StaffAttendanceStatus }))}
                  >
                    {STAFF_ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>{STAFF_ATTENDANCE_LABELS[status]}</option>
                    ))}
                  </select>
                  <input
                    className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 outline-none transition focus:border-sky-400"
                    value={noteFor(day)}
                    onChange={(event) => setNoteDrafts((current) => ({ ...current, [day.date]: event.target.value }))}
                    placeholder="Add a note"
                    maxLength={300}
                  />
                  {isDirty(day) ? (
                    <button
                      type="button"
                      className="primary-button shrink-0"
                      onClick={() => void saveDay(day)}
                      disabled={savingDate !== null}
                    >
                      {savingDate === day.date ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                    </button>
                  ) : (
                    <Pencil size={14} className="shrink-0 text-slate-300" aria-hidden />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Info size={13} /> Late days count as present. Every change is saved to the school record.
          </p>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
