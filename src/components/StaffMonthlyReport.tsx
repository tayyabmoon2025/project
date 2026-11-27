import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronRight, Info, Search, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/auth';
import {
  MONTH_NAMES,
  attendancePercentage,
  formatDayRange,
  formatPercentage,
  isLowAttendance,
  monthRange,
} from '@/lib/attendance';
import { StaffAttendanceDetail, type StaffAttendanceDay } from '@/components/StaffAttendanceDetail';
import { PersonAvatar } from '@/components/PersonAvatar';

import { STAFF_ATTENDANCE_GEO_COLUMNS, type StaffAttendanceRecord } from '@/lib/staffAttendance';

type StaffAttendanceRow = StaffAttendanceRecord;

type Tally = { total: number; present: number; absent: number; late: number; leave: number };

type RangeMode = 'month' | 'custom';

const EMPTY_TALLY: Tally = { total: 0, present: 0, absent: 0, late: 0, leave: 0 };

// A custom range is answered by one query over the register, so it is kept to a
// sensible width. Anything wider is almost always a mistyped year.
const MAX_RANGE_DAYS = 731;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent',
  office_assistant: 'Office Assistant',
  accountant: 'Accountant',
  student: 'Student',
};

const REPORT_ROLES = ['teacher', 'office_assistant', 'accountant', 'support_staff', 'admin'];

const yearOptions = () => {
  const current = new Date().getFullYear();
  return [current - 2, current - 1, current, current + 1];
};

const daySpan = (from: string, to: string) => {
  const first = new Date(`${from}T00:00:00`);
  const last = new Date(`${to}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 0;
  return Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
};

// Staff attendance is only ever written on a day the register was actually taken, so
// the honest denominator is the number of days recorded for that person rather than
// every calendar day. A day nobody marked is left out entirely instead of being
// counted against whoever the missing record belonged to.
function tallyFor(rows: StaffAttendanceRow[]): Tally {
  const tally: Tally = { ...EMPTY_TALLY };
  for (const row of rows) {
    tally.total += 1;
    if (row.status === 'present') tally.present += 1;
    else if (row.status === 'late') tally.late += 1;
    else if (row.status === 'leave') tally.leave += 1;
    else tally.absent += 1;
  }
  return tally;
}

export function StaffMonthlyReport({ staff, onToast }: { staff: UserProfile[]; onToast: (message: string) => void }) {
  const [roleFilter, setRoleFilter] = useState('all');
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [monthIndex, setMonthIndex] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [lowOnly, setLowOnly] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState('75');
  const [appliedThreshold, setAppliedThreshold] = useState(75);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<StaffAttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<UserProfile | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const monthBounds = useMemo(() => monthRange(year, monthIndex), [year, monthIndex]);
  const [customStart, setCustomStart] = useState(() => monthBounds.start);
  const [customEnd, setCustomEnd] = useState(() => monthBounds.end);

  const rangeError = (() => {
    if (rangeMode !== 'custom') return null;
    if (!customStart || !customEnd) return 'Choose both a start date and an end date.';
    if (customStart > customEnd) return 'The start date must be on or before the end date.';
    if (daySpan(customStart, customEnd) > MAX_RANGE_DAYS) return `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`;
    return null;
  })();

  const customRange = rangeMode === 'custom' && !rangeError;
  const { start, end } = customRange ? { start: customStart, end: customEnd } : monthBounds;
  const periodLabel = customRange ? formatDayRange(start, end) : `${MONTH_NAMES[monthIndex]} ${year}`;
  const periodDays = daySpan(start, end);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('school_staff_attendance')
          .select(`staff_user_id, attendance_date, status, note, ${STAFF_ATTENDANCE_GEO_COLUMNS}`)
          .gte('attendance_date', start)
          .lte('attendance_date', end);
        if (cancelled) return;
        setRecords(error ? [] : ((data ?? []) as StaffAttendanceRow[]));
        setLoadError(error ? 'The staff register for this period could not be loaded.' : null);
      } catch {
        if (!cancelled) { setRecords([]); setLoadError('The staff register for this period could not be loaded.'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [start, end, reloadToken]);

  const byStaff = useMemo(() => {
    const map = new Map<string, StaffAttendanceRow[]>();
    for (const record of records) {
      const date = record.attendance_date.slice(0, 10);
      if (date < start || date > end) continue;
      const list = map.get(record.staff_user_id);
      if (list) list.push(record);
      else map.set(record.staff_user_id, [record]);
    }
    return map;
  }, [records, start, end]);

  // Every staff member matching the role and search filters, before the low-attendance
  // filter is applied, so the totals stay honest when it is switched on.
  const matched = useMemo(() => {
    const term = query.trim().toLowerCase();
    return staff
      .filter((member) => member.status === 'active')
      .filter((member) => roleFilter === 'all' || member.role === roleFilter)
      .filter((member) => !term || member.full_name.toLowerCase().includes(term) || member.username.toLowerCase().includes(term))
      .map((member) => {
        const tally = tallyFor(byStaff.get(member.id) ?? []);
        const presentTotal = tally.present + tally.late;
        return { member, tally, presentTotal, percentage: attendancePercentage(presentTotal, tally.total) };
      })
      .sort((a, b) => a.member.full_name.localeCompare(b.member.full_name));
  }, [staff, roleFilter, query, byStaff]);

  const belowCount = matched.filter((row) => isLowAttendance(row.percentage, appliedThreshold)).length;
  const rows = lowOnly ? matched.filter((row) => isLowAttendance(row.percentage, appliedThreshold)) : matched;

  // Every recorded day for one person inside the selected period, newest first.
  const daysFor = (staffId: string): StaffAttendanceDay[] =>
    (byStaff.get(staffId) ?? [])
      .map((record) => ({
        date: record.attendance_date.slice(0, 10),
        status: record.status,
        note: record.note,
        record,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

  const average = rows.length === 0
    ? 0
    : Math.round((rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length) * 10) / 10;

  const applyThreshold = () => {
    const parsed = Number(thresholdDraft);
    if (thresholdDraft.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setThresholdDraft(String(appliedThreshold));
      return;
    }
    setAppliedThreshold(parsed);
  };

  const openCustomRange = () => {
    setCustomStart(monthBounds.start);
    setCustomEnd(monthBounds.end);
    setRangeMode('custom');
  };

  return (
    <div className="panel att-monthly">
      <div className="cal-panel-header">
        <div className="cal-panel-copy">
          <span className="eyebrow">{customRange ? 'Custom period report' : 'Monthly report'}</span>
          <h2>Staff attendance for {periodLabel}</h2>
          <p>Total present and absent days for each staff member, worked out from the days the register was taken in the selected period.</p>
        </div>
        <div className="att-monthly-totals">
          <span><b>{loading ? '—' : rows.length}</b> staff shown</span>
          <span><b>{loading ? '—' : formatPercentage(average)}</b> average attendance</span>
          <span className={belowCount > 0 ? 'warn' : ''}><b>{loading ? '—' : belowCount}</b> below {formatPercentage(appliedThreshold)}</span>
        </div>
      </div>

      <div className="att-filters att-monthly-filters">
        <div className="att-range-toggle" role="group" aria-label="Report period">
          <button
            type="button"
            className={rangeMode === 'month' ? 'on' : ''}
            onClick={() => setRangeMode('month')}
          >
            Whole month
          </button>
          <button
            type="button"
            className={rangeMode === 'custom' ? 'on' : ''}
            onClick={openCustomRange}
          >
            <CalendarRange size={13} /> Custom range
          </button>
        </div>

        {rangeMode === 'month' ? (
          <>
            <label className="control-field">Month
              <select value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))}>
                {MONTH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>
            <label className="control-field">Year
              <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {yearOptions().map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="control-field">From
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(event) => setCustomStart(event.target.value)}
              />
            </label>
            <label className="control-field">To
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(event) => setCustomEnd(event.target.value)}
              />
            </label>
          </>
        )}

        <label className="control-field">Role
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All roles</option>
            {REPORT_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </label>
        <label className="att-filter-check">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-600"
            checked={lowOnly}
            onChange={(event) => setLowOnly(event.target.checked)}
          />
          <TrendingDown size={15} />
          <span>Show Low Attendance Only</span>
        </label>
        <label className="control-field att-threshold-field">Threshold %
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={thresholdDraft}
            onChange={(event) => setThresholdDraft(event.target.value)}
            onBlur={applyThreshold}
          />
        </label>

        {rangeError && <p className="att-range-error">{rangeError}</p>}
      </div>

      <div className="att-monthly-search">
        <div className="search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by staff name or username"
          />
        </div>
        <span className="result-count">
          Period {start} → {end} · {periodDays} {periodDays === 1 ? 'day' : 'days'}
        </span>
      </div>

      <div className="table-wrap att-monthly-table">
        {loadError && <p className="dmc-warning">{loadError}</p>}
        <table>
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Role</th>
              <th>Days recorded</th>
              <th>Present</th>
              <th>Absent</th>
              <th>Late</th>
              <th>Leave</th>
              <th>Attendance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="muted-cell">Loading the staff register for this period…</td></tr>
            )}
            {rows.map(({ member, tally, presentTotal, percentage }) => {
              const low = isLowAttendance(percentage, appliedThreshold);
              return (
                <tr
                  key={member.id}
                  className={`clickable-row ${low ? 'absent-row' : ''}`}
                  onClick={() => setDetailFor(member)}
                  title={`View ${member.full_name}'s attendance history for ${periodLabel}`}
                >
                  <td>
                    <div className="att-monthly-student">
                      <PersonAvatar photoUrl={member.photo_url} name={member.full_name} />
                      <span>
                        <strong>{member.full_name}</strong>
                        <small>{member.username}</small>
                      </span>
                    </div>
                  </td>
                  <td className="muted-cell">{ROLE_LABELS[member.role] ?? member.role}</td>
                  <td><strong>{tally.total}</strong></td>
                  <td className="att-cell present">{presentTotal}</td>
                  <td className="att-cell absent">{tally.absent}</td>
                  <td className="att-cell late">{tally.late}</td>
                  <td className="att-cell leave">{tally.leave}</td>
                  <td>
                    <span className={`att-percentage ${low ? 'low' : 'ok'}`}>
                      {formatPercentage(percentage)}
                      {low && <small><TrendingDown size={12} /> Low</small>}
                    </span>
                  </td>
                  <td className="text-right">
                    <ChevronRight size={16} className="ml-auto text-slate-300" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !loading && (
          <div className="empty-state large">
            {lowOnly
              ? `No staff member is below ${formatPercentage(appliedThreshold)} for this period.`
              : 'No staff attendance has been recorded for this period yet.'}
          </div>
        )}
      </div>

      <p className="cal-hint">
        <Info size={14} />
        Days recorded is the number of days this person was marked in the register for the selected period. Late arrivals count as
        present, and leave days are reported separately. A day nobody marked is left out, so it is never counted against anyone.
        Click any row to see that person’s day-by-day history and notes.
      </p>

      {detailFor && (
        <StaffAttendanceDetail
          member={detailFor}
          periodLabel={periodLabel}
          periodStart={start}
          periodEnd={end}
          days={daysFor(detailFor.id)}
          onSaved={async () => {
            setReloadToken((token) => token + 1);
            onToast(`Attendance for ${detailFor.full_name} was updated.`);
          }}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}
