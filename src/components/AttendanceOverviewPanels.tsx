import { useEffect, useMemo, useState } from 'react';
import {
  CalendarX2, CheckCircle2, ClipboardCheck, Clock, Info, Search, TrendingDown, XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import { StudentPhoto } from '@/components/StudentPhoto';
import { CalendarDayGrid } from '@/components/SchoolCalendarSettings';
import {
  CALENDAR_DAY_LABELS, MONTH_NAMES, formatPercentage, isLowAttendance, isClosedDayType,
  monthRange, summariseAttendance,
  type AttendanceRecord, type CalendarDay, type CalendarPolicy,
} from '@/lib/attendance';

export type ClassSubmission = {
  key: string;
  class_name: string;
  section_name: string;
  total: number;
  marked: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  complete: boolean;
};

type Filter = 'all' | 'submitted' | 'pending';

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

type OverviewProps = {
  date: string;
  onDateChange: (value: string) => void;
  submissions: ClassSubmission[];
  calendarDays: CalendarDay[];
  workingDays: number[];
  onPickClass: (className: string, sectionName: string) => void;
  onToggleCalendarDate: (value: string) => void;
};

export function DailyOverviewPanel({
  date, onDateChange, submissions, calendarDays, workingDays, onPickClass, onToggleCalendarDate,
}: OverviewProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const totals = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let leave = 0;
    for (const item of submissions) {
      present += item.present;
      absent += item.absent;
      late += item.late;
      leave += item.leave;
    }
    return { present, absent, late, leave };
  }, [submissions]);

  const submittedCount = submissions.filter((item) => item.complete).length;
  const pendingCount = submissions.length - submittedCount;
  const shown = submissions.filter((item) => (
    filter === 'all' ? true : filter === 'submitted' ? item.complete : !item.complete
  ));

  const entry = calendarDays.find((day) => day.day_date.slice(0, 10) === date);
  const closedEntry = entry && isClosedDayType(entry.day_type) ? entry : null;
  const isWeeklyOff = !closedEntry && !workingDays.includes(new Date(`${date}T00:00:00`).getDay());

  return (
    <div className="att-overview">
      <div className="panel att-overview-panel">
        <div className="att-overview-head">
          <div className="cal-panel-copy">
            <span className="eyebrow">Today at a glance</span>
            <h2>Daily Class Attendance Overview</h2>
            <p>{formatDate(date)} · {submissions.length} class group{submissions.length === 1 ? '' : 's'} in the school.</p>
          </div>
          <label className="control-field att-overview-date">Attendance Date
            <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
          </label>
        </div>

        <div className="att-stat-grid">
          <div className="att-stat">
            <span className="att-stat-icon sky"><ClipboardCheck size={18} /></span>
            <span className="att-stat-label">Classes Submitted</span>
            <strong>{submittedCount}<small> / {submissions.length}</small></strong>
            <span className="att-stat-foot">{pendingCount === 0 ? 'Every class is done' : `${pendingCount} still pending`}</span>
          </div>
          <div className="att-stat present">
            <span className="att-stat-icon green"><CheckCircle2 size={18} /></span>
            <span className="att-stat-label">Total Present</span>
            <strong>{totals.present}</strong>
            <span className="att-stat-foot">Marked in the register today</span>
          </div>
          <div className="att-stat absent">
            <span className="att-stat-icon coral"><XCircle size={18} /></span>
            <span className="att-stat-label">Total Absent</span>
            <strong>{totals.absent}</strong>
            <span className="att-stat-foot">Guardians can be alerted</span>
          </div>
          <div className="att-stat late">
            <span className="att-stat-icon amber"><Clock size={18} /></span>
            <span className="att-stat-label">Late &amp; Leaves</span>
            <strong>{totals.late + totals.leave}</strong>
            <span className="att-stat-foot">{totals.late} late · {totals.leave} on leave</span>
          </div>
        </div>

        {(closedEntry || isWeeklyOff) && (
          <div className="att-offday-banner">
            <CalendarX2 size={18} />
            <div>
              <strong>
                {closedEntry
                  ? `${formatDate(date)} is marked as ${CALENDAR_DAY_LABELS[closedEntry.day_type].toLowerCase()}${closedEntry.title ? ` — ${closedEntry.title}` : ''}.`
                  : `${formatDate(date)} is a weekly off, so the school is closed.`}
              </strong>
              <small>Marks saved on a closed day are kept for the record but left out of every attendance total. Tap the date in the calendar below to reopen the school.</small>
            </div>
          </div>
        )}

        <div className="att-submissions">
          <div className="att-submissions-head">
            <div>
              <strong>Class Submissions</strong>
              <small>Who has finished the register for this date.</small>
            </div>
            <div className="att-pills" role="group" aria-label="Filter class submissions">
              {([['all', `All ${submissions.length}`], ['submitted', `Submitted ${submittedCount}`], ['pending', `Pending ${pendingCount}`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`att-pill ${filter === value ? 'on' : ''}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="cal-empty">
              {submissions.length === 0
                ? 'There are no class groups to show yet. Add students first.'
                : filter === 'pending' ? 'Every class has been marked for this date.' : 'No class has been marked yet for this date.'}
            </p>
          ) : (
            <div className="att-submission-list">
              {shown.map((item) => (
                <button
                  type="button"
                  className={`att-submission ${item.complete ? 'done' : 'pending'}`}
                  key={item.key}
                  onClick={() => onPickClass(item.class_name, item.section_name)}
                  title={`Open ${item.class_name} · Section ${item.section_name} in the register`}
                >
                  <span className="att-submission-name">
                    <strong>{item.class_name}</strong>
                    <small>Section {item.section_name}</small>
                  </span>
                  <span className="att-submission-marks">
                    <em className="present">{item.present}</em>
                    <em className="absent">{item.absent}</em>
                    <em className="late">{item.late}</em>
                    <em className="leave">{item.leave}</em>
                  </span>
                  <span className={`att-submission-state ${item.complete ? 'done' : 'pending'}`}>
                    {item.complete ? 'Submitted' : `Pending · ${item.marked}/${item.total}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <CalendarDayGrid
        month={date.slice(0, 7)}
        days={calendarDays}
        workingDays={workingDays}
        onToggle={onToggleCalendarDate}
      />
    </div>
  );
}

type MonthlyProps = {
  students: Student[];
  policy: CalendarPolicy;
  calendarDays: CalendarDay[];
};

const yearOptions = () => {
  const current = new Date().getFullYear();
  return [current - 2, current - 1, current, current + 1];
};

export function MonthlyReportPanel({ students, policy, calendarDays }: MonthlyProps) {
  const [className, setClassName] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [monthIndex, setMonthIndex] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [lowOnly, setLowOnly] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(String(policy.low_attendance_threshold));
  const [appliedThreshold, setAppliedThreshold] = useState(policy.low_attendance_threshold);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { start, end } = monthRange(year, monthIndex);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('school_attendance')
          .select('student_id, attendance_date, status')
          .gte('attendance_date', start)
          .lte('attendance_date', end);
        if (cancelled) return;
        setRecords(error ? [] : ((data ?? []) as AttendanceRecord[]));
        setLoadError(error ? 'The register for this month could not be loaded.' : null);
      } catch {
        if (!cancelled) { setRecords([]); setLoadError('The register for this month could not be loaded.'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [start, end]);

  // Follows the saved policy, so the box is right even when the policy finishes
  // loading after this tab is already open.
  useEffect(() => {
    setThresholdDraft(String(policy.low_attendance_threshold));
    setAppliedThreshold(policy.low_attendance_threshold);
  }, [policy.low_attendance_threshold]);

  const classes = useMemo(
    () => Array.from(new Set(students.map((student) => student.class_name))).sort((a, b) => a.localeCompare(b)),
    [students],
  );
  const sections = useMemo(
    () => Array.from(new Set(students.filter((student) => !className || student.class_name === className).map((student) => student.section_name))).sort(),
    [students, className],
  );

  const byStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const record of records) {
      const date = record.attendance_date.slice(0, 10);
      if (date < start || date > end) continue;
      const list = map.get(record.student_id);
      if (list) list.push(record);
      else map.set(record.student_id, [record]);
    }
    return map;
  }, [records, start, end]);

  // Every student who matches the class, section and search filters, before the
  // low-attendance filter is applied, so the counts stay honest when it is on.
  const matched = useMemo(() => {
    const term = query.trim().toLowerCase();
    return students
      .filter((student) => student.status === 'active')
      .filter((student) => (!className || student.class_name === className) && (!sectionName || student.section_name === sectionName))
      .filter((student) => !term || student.full_name.toLowerCase().includes(term) || student.admission_number.toLowerCase().includes(term))
      .map((student) => ({
        student,
        summary: summariseAttendance(byStudent.get(student.id) ?? [], start, end, policy, calendarDays),
      }))
      .sort((a, b) => a.student.class_name.localeCompare(b.student.class_name)
        || a.student.section_name.localeCompare(b.student.section_name)
        || a.student.full_name.localeCompare(b.student.full_name));
  }, [students, className, sectionName, query, byStudent, start, end, policy, calendarDays]);

  const belowCount = matched.filter((row) => isLowAttendance(row.summary.percentage, appliedThreshold)).length;
  const rows = lowOnly
    ? matched.filter((row) => isLowAttendance(row.summary.percentage, appliedThreshold))
    : matched;

  const average = rows.length === 0
    ? 0
    : Math.round((rows.reduce((sum, row) => sum + row.summary.percentage, 0) / rows.length) * 10) / 10;

  const applyThreshold = () => {
    const parsed = Number(thresholdDraft);
    if (thresholdDraft.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setThresholdDraft(String(appliedThreshold));
      return;
    }
    setAppliedThreshold(parsed);
  };

  return (
    <div className="panel att-monthly">
      <div className="cal-panel-header">
        <div className="cal-panel-copy">
          <span className="eyebrow">Monthly report</span>
          <h2>Attendance for {MONTH_NAMES[monthIndex]} {year}</h2>
          <p>Every figure is worked out from the register using the saved working week and school calendar.</p>
        </div>
        <div className="att-monthly-totals">
          <span><b>{loading ? '—' : rows.length}</b> students shown</span>
          <span><b>{loading ? '—' : formatPercentage(average)}</b> average attendance</span>
          <span className={belowCount > 0 ? 'warn' : ''}><b>{loading ? '—' : belowCount}</b> below {formatPercentage(appliedThreshold)}</span>
        </div>
      </div>

      <div className="att-filters att-monthly-filters">
        <label className="control-field">Class
          <select value={className} onChange={(event) => { setClassName(event.target.value); setSectionName(''); }}>
            <option value="">All classes</option>
            {classes.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="control-field">Section
          <select value={sectionName} onChange={(event) => setSectionName(event.target.value)}>
            <option value="">All sections</option>
            {sections.map((option) => <option key={option} value={option}>Section {option}</option>)}
          </select>
        </label>
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
      </div>

      <div className="att-monthly-search">
        <div className="search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by student name or admission number"
          />
        </div>
        <span className="result-count">Period {start} → {end}</span>
      </div>

      <div className="table-wrap att-monthly-table">
        {loadError && <p className="dmc-warning">{loadError}</p>}
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>Total Class</th>
              <th>Present</th>
              <th>Absent</th>
              <th>Late</th>
              <th>Leave</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="muted-cell">Loading this month’s register…</td></tr>
            )}
            {rows.map(({ student, summary }) => {
              const low = isLowAttendance(summary.percentage, appliedThreshold);
              return (
                <tr key={student.id} className={low ? 'absent-row' : undefined}>
                  <td>
                    <div className="att-monthly-student">
                      <StudentPhoto src={student.photo_url} name={student.full_name} className="h-8 w-8 rounded-lg" />
                      <span>
                        <strong>{student.full_name}</strong>
                        <small>{student.admission_number}</small>
                      </span>
                    </div>
                  </td>
                  <td className="muted-cell">{student.class_name} · {student.section_name}</td>
                  <td><strong>{summary.total}</strong></td>
                  <td className="att-cell present">{summary.present}</td>
                  <td className="att-cell absent">{summary.absent}</td>
                  <td className="att-cell late">{summary.late}</td>
                  <td className="att-cell leave">{summary.leave}</td>
                  <td>
                    <span className={`att-percentage ${low ? 'low' : 'ok'}`}>
                      {formatPercentage(summary.percentage)}
                      {low && <small><TrendingDown size={12} /> Low</small>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !loading && (
          <div className="empty-state large">
            {lowOnly
              ? `No student is below ${formatPercentage(appliedThreshold)} for this month.`
              : 'No students match these filters for this month.'}
          </div>
        )}
      </div>

      <p className="cal-hint">
        <Info size={14} />
        Total Class is the number of days the school actually opened that month. Late arrivals count as present, and leave days are
        reported separately unless the school policy leaves them out of the total.
      </p>
    </div>
  );
}
