import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck2, CalendarDays, Check, CheckCheck, Clock, FileBadge2, FileText, Filter, MessageCircle, Printer, RotateCcw, Save,
  Search, Trash2, UserX, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { NoticeContext } from '@/lib/sentNotices';
import type { Student } from '@/lib/schoolTypes';
import { StudentPhoto } from '@/components/StudentPhoto';
import { SmsReport } from '@/components/SmsReport';
import { DmcSheet } from '@/components/DmcSheet';
import { DailyOverviewPanel, MonthlyReportPanel, type ClassSubmission } from '@/components/AttendanceOverviewPanels';
import { SchoolCalendarSettings } from '@/components/SchoolCalendarSettings';
import { createDmcDraft, createMarksRows, type DmcDraft, type DmcMarksRow } from '@/lib/dmc';
import { loadSchoolCalendar, removeCalendarDay, saveCalendarDay, saveCalendarPolicy } from '@/lib/schoolCalendar';
import { syncAbsenteesForDate } from '@/lib/absenteeAlerts';
import { useAuth } from '@/lib/auth';
import { useClassOptions, withCurrent } from '@/lib/classSections';
import {
  DEFAULT_CALENDAR_POLICY, attendancePercentage, countByStatus, formatPercentage, monthStart, summariseAttendance, todayKey,
  type AttendanceRecord, type AttendanceStatus, type AttendanceSummary, type CalendarDay, type CalendarDayType, type CalendarPolicy,
} from '@/lib/attendance';
import { schoolDaysInPeriod } from '@/lib/reportCardAttendance';
type SectionKey = { class_name: string; section_name: string };
type Tab = 'register' | 'calendar' | 'monthly' | 'dmc' | 'sms';

const statusMeta: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'leave', label: 'Leave' },
];

const tabs: { value: Tab; label: string; icon: typeof CalendarCheck2 }[] = [
  { value: 'register', label: 'Daily Attendance', icon: CalendarCheck2 },
  { value: 'calendar', label: 'Calendar & Policy', icon: CalendarDays },
  { value: 'monthly', label: 'Monthly Report', icon: Filter },
  { value: 'dmc', label: 'DMC', icon: FileBadge2 },
  { value: 'sms', label: 'WhatsApp SMS Report', icon: MessageCircle },
];

const parseCount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
};

const formatLongDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const formatWeekday = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });

const dayKey = (value: string) => value.slice(0, 10);

type PendingDayChange = {
  date: string;
  entry: { day_date: string; end_date: string; day_type: CalendarDayType; title: string; notes?: string | null } | null;
};

export function AttendanceManager({ students, onToast, onSendNotice }: { students: Student[]; onToast: (message: string) => void; onSendNotice?: (student: Student, context: NoticeContext) => void }) {
  const { user } = useAuth();
  const classNames = useClassOptions();
  const [tab, setTab] = useState<Tab>('register');
  const today = todayKey();
  const [date, setDate] = useState(today);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [filterNotTaken, setFilterNotTaken] = useState(false);
  const [absenteesOnly, setAbsenteesOnly] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [storedMarks, setStoredMarks] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);

  const [policy, setPolicy] = useState<CalendarPolicy>(DEFAULT_CALENDAR_POLICY);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [pendingDays, setPendingDays] = useState<PendingDayChange[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadSchoolCalendar();
      if (cancelled) return;
      setPolicy(loaded.policy);
      setCalendarDays(loaded.days);
      setCalendarError(loaded.error);
    })();
    return () => { cancelled = true; };
  }, []);

  const distinctSections = useMemo(() => {
    const map = new Map<string, SectionKey>();
    for (const student of students) {
      const key = `${student.class_name}|||${student.section_name}`;
      if (!map.has(key)) map.set(key, { class_name: student.class_name, section_name: student.section_name });
    }
    return Array.from(map.values()).sort((a, b) => a.class_name.localeCompare(b.class_name) || a.section_name.localeCompare(b.section_name));
  }, [students]);

  // The school's own class list decides the order, so classes appear the way the school
  // has arranged them. A class that only exists on a student's record is added at the end.
  const distinctClasses = useMemo(
    () => withCurrent(classNames, null).filter((option) => distinctSections.some((section) => section.class_name === option)),
    [classNames, distinctSections],
  );

  const loadAttendance = useCallback(async (forDate: string) => {
    try {
      const { data } = await supabase.from('school_attendance').select('student_id, status').eq('attendance_date', forDate);
      setStoredMarks(new Map(((data ?? []) as { student_id: string; status: string }[]).map((row) => [row.student_id, row.status])));
    } catch {
      setStoredMarks(new Map());
    }
  }, []);

  useEffect(() => { setDraft({}); void loadAttendance(date); }, [date, loadAttendance]);

  const isComplete = (key: SectionKey) => {
    const list = students.filter((s) => s.class_name === key.class_name && s.section_name === key.section_name);
    return list.length > 0 && list.every((s) => storedMarks.has(s.id));
  };

  const visibleClasses = filterNotTaken
    ? distinctClasses.filter((c) => distinctSections.some((s) => s.class_name === c && !isComplete(s)))
    : distinctClasses;

  const activeClass = visibleClasses.includes(selectedClass) ? selectedClass : (visibleClasses[0] ?? '');
  const sectionsInClass = distinctSections.filter((s) => s.class_name === activeClass);

  const visibleSections = filterNotTaken ? sectionsInClass.filter((s) => !isComplete(s)) : sectionsInClass;
  const shownSection = visibleSections.some((s) => s.section_name === selectedSection) ? selectedSection : (visibleSections[0]?.section_name ?? '');

  const sectionStudents = useMemo(
    () => students
      .filter((s) => s.class_name === activeClass && s.section_name === shownSection)
      .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [students, activeClass, shownSection],
  );

  const statusOf = useCallback(
    (id: string): AttendanceStatus | undefined => draft[id] ?? (storedMarks.get(id) as AttendanceStatus | undefined),
    [draft, storedMarks],
  );

  const absentees = useMemo(
    () => sectionStudents.filter((student) => statusOf(student.id) === 'absent'),
    [sectionStudents, statusOf],
  );

  const counts = useMemo(() => {
    const marked = countByStatus(
      sectionStudents.map((student) => statusOf(student.id)).filter(Boolean) as string[],
      policy.exclude_leave_from_denominator,
    );
    // Late arrivals are reported on their own card, so Present here is exclusive
    // of late: the five cards then add up to the class total.
    return {
      total: sectionStudents.length,
      marked: marked.marked,
      present: marked.present,
      absent: marked.absent,
      late: marked.late,
      leave: marked.leave,
      remaining: sectionStudents.length - marked.marked,
    };
  }, [sectionStudents, statusOf, policy.exclude_leave_from_denominator]);

  // One row per class group for the selected date, used by the overview panel.
  const submissions = useMemo<ClassSubmission[]>(() => distinctSections.map((section) => {
    const list = students.filter((s) => s.class_name === section.class_name && s.section_name === section.section_name);
    const marks = list.map((student) => storedMarks.get(student.id)).filter(Boolean) as string[];
    const tally = countByStatus(marks, policy.exclude_leave_from_denominator);
    return {
      key: `${section.class_name}|||${section.section_name}`,
      class_name: section.class_name,
      section_name: section.section_name,
      total: list.length,
      marked: tally.marked,
      present: tally.present,
      absent: tally.absent,
      late: tally.late,
      leave: tally.leave,
      complete: list.length > 0 && tally.marked === list.length,
    };
  }), [distinctSections, students, storedMarks, policy.exclude_leave_from_denominator]);

  const term = rosterQuery.trim().toLowerCase();
  const shownStudents = (absenteesOnly ? absentees : sectionStudents)
    .filter((student) => !term
      || student.full_name.toLowerCase().includes(term)
      || student.admission_number.toLowerCase().includes(term));

  // Drives the wording of the save confirmation: a date that already has records
  // will be updated rather than created.
  const hasSavedRecords = storedMarks.size > 0;
  const marksSaved = [
    { key: 'present', label: 'Present', value: counts.present, Icon: CheckCheck },
    { key: 'absent', label: 'Absent', value: counts.absent, Icon: UserX },
    { key: 'late', label: 'Late', value: counts.late, Icon: Clock },
    { key: 'leave', label: 'Leave', value: counts.leave, Icon: CalendarCheck2 },
  ].filter((item) => item.value > 0);

  const setMark = (id: string, status: AttendanceStatus) => setDraft((current) => ({ ...current, [id]: status }));

  const markAllPresent = () => {
    if (shownStudents.length === 0) { onToast('There are no students to mark in this view.'); return; }
    setDraft((current) => {
      const next = { ...current };
      for (const student of shownStudents) next[student.id] = 'present';
      return next;
    });
    onToast(`${shownStudents.length} students marked present. Tap Absent, Late or Leave on anyone who is away, then save.`);
  };

  const resetDraft = () => {
    if (shownStudents.length === 0) return;
    setDraft((current) => {
      const next = { ...current };
      for (const student of shownStudents) delete next[student.id];
      return next;
    });
    onToast('Unsaved marks cleared for this view.');
  };

  const saveAttendance = async () => {
    const entries = Object.entries(draft)
      .filter(([id]) => sectionStudents.some((s) => s.id === id))
      .map(([student_id, status]) => ({ student_id, attendance_date: date, status }));
    setSaving(true);
    const { error } = await supabase.from('school_attendance').upsert(entries, { onConflict: 'student_id,attendance_date' });
    setSaving(false);
    setConfirm(null);
    if (error) { onToast('Attendance could not be saved. Please try again.'); return; }
    setDraft({});
    await loadAttendance(date);
    // Saved absences flow straight into the absentee alert list, which in turn raises
    // the parent portal absence notice.
    const syncError = await syncAbsenteesForDate(date);
    onToast(syncError
      ? `Attendance saved for ${activeClass} · Section ${shownSection}. The absentee list could not be refreshed.`
      : `Attendance saved for ${activeClass} · Section ${shownSection}. Parents have been notified in the portal for absences, leave and late arrivals.`);
  };

  const deleteAttendance = async () => {
    const ids = sectionStudents.map((s) => s.id);
    setSaving(true);
    const { error } = await supabase.from('school_attendance').delete().eq('attendance_date', date).in('student_id', ids);
    setSaving(false);
    setConfirm(null);
    if (error) { onToast('Attendance could not be cleared. Please try again.'); return; }
    onToast(`Attendance cleared for ${activeClass} · Section ${shownSection}`);
    setDraft({});
    await loadAttendance(date);
  };

  const pickClass = (className: string, sectionName: string) => {
    setSelectedClass(className);
    setSelectedSection(sectionName);
    setAbsenteesOnly(false);
    setFilterNotTaken(false);
    onToast(`Register opened for ${className} · Section ${sectionName}.`);
  };

  // Calendar edits are held locally and written when the policy is saved, so a
  // stray tap never changes how attendance is counted until it is confirmed.
  const toggleCalendarDate = (value: string) => {
    const existing = calendarDays.find((day) => dayKey(day.day_date) === value);
    if (existing) {
      setCalendarDays((current) => current.filter((day) => dayKey(day.day_date) !== value));
      setPendingDays((current) => [...current.filter((item) => item.date !== value), { date: value, entry: null }]);
      onToast(`${value} reopened as a school day. Save the policy to keep this.`);
      return;
    }
    const entry = { day_date: value, end_date: value, day_type: 'holiday' as const, title: 'School off', notes: null };
    setCalendarDays((current) => [...current, { id: `pending-${value}`, ...entry }]);
    setPendingDays((current) => [...current.filter((item) => item.date !== value), { date: value, entry }]);
    onToast(`${value} marked as an off day. Save the policy to keep this.`);
  };

  const addCalendarEntry = (entry: { day_date: string; end_date: string; day_type: CalendarDayType; title: string; notes?: string | null }) => {
    setCalendarDays((current) => [
      ...current.filter((day) => dayKey(day.day_date) !== entry.day_date),
      {
        id: `pending-${entry.day_date}`,
        day_date: entry.day_date,
        end_date: entry.end_date,
        day_type: entry.day_type,
        title: entry.title.trim() || 'School closed',
        notes: entry.notes?.trim() ? entry.notes.trim() : null,
      },
    ]);
    setPendingDays((current) => [...current.filter((item) => item.date !== entry.day_date), { date: entry.day_date, entry }]);
    onToast(`${entry.title.trim() || 'Date'} added to the calendar. Save the policy to keep this.`);
  };

  const removeCalendarEntry = (value: string) => {
    setCalendarDays((current) => current.filter((day) => dayKey(day.day_date) !== value));
    setPendingDays((current) => [...current.filter((item) => item.date !== value), { date: value, entry: null }]);
    onToast('Date removed from the calendar. Save the policy to keep this.');
  };

  const savePolicy = async (): Promise<boolean | void> => {
    if (calendarError) {
      onToast('The saved calendar could not be loaded, so nothing was saved. Reload the page and try again.');
      return false;
    }
    setSavingPolicy(true);
    const policyError = await saveCalendarPolicy(policy, user?.id ?? null);
    if (policyError) { setSavingPolicy(false); onToast(policyError); return false; }

    for (const change of pendingDays) {
      const dayError = change.entry
        ? await saveCalendarDay(change.entry, user?.id ?? null)
        : await removeCalendarDay(change.date);
      if (dayError) { setSavingPolicy(false); onToast(dayError); return false; }
    }
    setPendingDays([]);

    const reloaded = await loadSchoolCalendar();
    if (!reloaded.error) {
      setPolicy(reloaded.policy);
      setCalendarDays(reloaded.days);
    }
    setSavingPolicy(false);
    onToast('School working schedule and calendar saved.');
    return true;
  };

  return (
    <div className="attendance-manager">
      <div className="att-tabs" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              className={`att-tab ${tab === item.value ? 'active' : ''}`}
              onClick={() => setTab(item.value)}
            >
              <Icon size={16} /> {item.label}
              {item.value === 'register' && counts.absent > 0 && <span className="att-tab-count">{counts.absent}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'register' && (
        <>
          <DailyOverviewPanel
            date={date}
            onDateChange={setDate}
            submissions={submissions}
            calendarDays={calendarDays}
            workingDays={policy.working_days}
            onPickClass={pickClass}
            onToggleCalendarDate={toggleCalendarDate}
          />

          <div className="panel attendance-filters-panel">
            <div className="att-filters">
              <label className="control-field">Attendance Date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="control-field">Class
                <select value={activeClass} onChange={(e) => { setSelectedClass(e.target.value); setSelectedSection(''); }} disabled={visibleClasses.length === 0}>
                  {visibleClasses.length === 0 && <option value="">All marked</option>}
                  {visibleClasses.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="control-field">Section
                <select value={shownSection} onChange={(e) => setSelectedSection(e.target.value)} disabled={visibleSections.length === 0}>
                  {visibleSections.length === 0 && <option value="">No section</option>}
                  {visibleSections.map((section) => <option key={section.section_name} value={section.section_name}>Section {section.section_name}</option>)}
                </select>
              </label>
              <label className="att-filter-check">
                <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={filterNotTaken} onChange={(e) => setFilterNotTaken(e.target.checked)} />
                <Filter size={15} />
                <span>Filter Not Taken</span>
              </label>
              <button
                type="button"
                className={`att-filter-toggle ${absenteesOnly ? 'on' : ''}`}
                onClick={() => setAbsenteesOnly((current) => !current)}
                aria-pressed={absenteesOnly}
              >
                <UserX size={15} />
                <span>Absentees Only</span>
                <b className="att-absent-badge">{absentees.length}</b>
              </button>
            </div>

            <div className="att-quick-row">
              <div className="att-quick-actions">
                <button type="button" className="att-quick present" onClick={markAllPresent} disabled={shownStudents.length === 0}>
                  <CheckCheck size={16} /> Mark All Present
                </button>
                <button type="button" className="att-quick" onClick={resetDraft} disabled={shownStudents.length === 0}>
                  <RotateCcw size={15} /> Reset marks
                </button>
              </div>
              <p className="att-quick-hint">Mark everyone present in one tap, then click Absent, Late or Leave on the students who are away before saving.</p>
            </div>
          </div>

          <div className="panel roster-panel section-students-panel">
            <div className="att-roster-head">
              <div className="att-roster-stats">
                <div className="att-roster-stat">
                  <span>Total Class</span>
                  <strong>{counts.total}</strong>
                </div>
                <div className="att-roster-stat present">
                  <span>Present</span>
                  <strong>{counts.present}</strong>
                </div>
                <div className="att-roster-stat absent">
                  <span>Absent</span>
                  <strong>{counts.absent}</strong>
                </div>
                <div className="att-roster-stat late">
                  <span>Late</span>
                  <strong>{counts.late}</strong>
                </div>
                <div className="att-roster-stat leave">
                  <span>Leave</span>
                  <strong>{counts.leave}</strong>
                </div>
              </div>
              <div className="att-roster-actions">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={rosterQuery}
                    onChange={(event) => setRosterQuery(event.target.value)}
                    placeholder="Search student in this section"
                  />
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setConfirm('save')}
                  disabled={saving || counts.marked === 0}
                >
                  <Save size={16} /> Save &amp; Update Attendance
                </button>
              </div>
            </div>

            <div className="att-summary">
              <span className="result-count">
                Marked <b>{counts.marked}</b> of <b>{counts.total}</b> · Remaining <b>{counts.remaining}</b>
                {rosterQuery.trim() && <> · Showing <b>{shownStudents.length}</b></>}
              </span>
              <div className="att-actions">
                <button className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Print</button>
                <button className="secondary-button danger" onClick={() => setConfirm('delete')} disabled={sectionStudents.length === 0}><Trash2 size={16} /> Delete</button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Admission No.</th>
                    <th>Student Name</th>
                    <th>Parent Details</th>
                    <th>Area</th>
                    <th>Contact Number</th>
                    <th>Mark Attendance</th>
                    <th className="no-print">Notice</th>
                  </tr>
                </thead>
                <tbody>
                  {shownStudents.map((student) => (
                    <tr key={student.id} className={statusOf(student.id) === 'absent' ? 'absent-row' : undefined}>
                      <td><StudentPhoto src={student.photo_url} name={student.full_name} className="h-9 w-9 rounded-lg" /></td>
                      <td className="muted-cell">{student.admission_number}</td>
                      <td>
                        <strong>{student.full_name}</strong>
                      </td>
                      <td><span>{student.fathers_name || student.guardian_name}</span><small>{student.fathers_name ? student.guardian_name : ''}</small></td>
                      <td>{student.area || '—'}</td>
                      <td><span>{student.guardian_phone}</span><small>{student.messaging_number || student.father_contact_number || ''}</small></td>
                      <td>
                        <div className="attendance-actions">
                          {statusMeta.map((meta) => (
                            <button
                              key={meta.value}
                              type="button"
                              className={`att-mark ${meta.value} ${statusOf(student.id) === meta.value ? 'on' : ''}`}
                              onClick={() => setMark(student.id, meta.value)}
                            >
                              {meta.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="no-print">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => onSendNotice?.(student, 'attendance')}
                          title={`Send a notice or warning to ${student.full_name}'s parents`}
                        >
                          <FileText size={14} /> Send Notice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownStudents.length === 0 && (
                <div className="empty-state large">
                  {term
                    ? 'No student in this section matches that search.'
                    : absenteesOnly
                      ? 'No absentees in this section for this date. Everyone is present.'
                      : visibleSections.length === 0
                        ? 'All sections have been marked for this date.'
                        : 'No students in this section yet.'}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'calendar' && (
        <SchoolCalendarSettings
          policy={policy}
          days={calendarDays}
          saving={savingPolicy}
          onPolicyChange={setPolicy}
          onSavePolicy={() => savePolicy()}
          onAddDay={addCalendarEntry}
          onRemoveDay={removeCalendarEntry}
          onToast={onToast}
        />
      )}

      {tab === 'monthly' && (
        <MonthlyReportPanel
          students={students}
          policy={policy}
          calendarDays={calendarDays}
        />
      )}

      {tab === 'dmc' && (
        <DmcPanel students={students} policy={policy} calendarDays={calendarDays} onToast={onToast} />
      )}

      {tab === 'sms' && <SmsReport onToast={onToast} />}

      {confirm && (
        <div className="notice-overlay" onClick={() => setConfirm(null)}>
          <form
            className="notice-modal att-save-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (confirm === 'save') void saveAttendance(); else void deleteAttendance(); }}
          >
            <div className="notice-preview-top">
              <div>
                <span className="eyebrow">{confirm === 'save' ? 'Save attendance' : 'Clear attendance'}</span>
                <h2>{activeClass} · Section {shownSection}</h2>
                <small>
                  {confirm === 'save'
                    ? `${counts.marked} of ${counts.total} students marked`
                    : `All ${counts.total} students in this section`}
                </small>
              </div>
              <button type="button" className="close-button" onClick={() => setConfirm(null)} aria-label="Close"><X size={18} /></button>
            </div>

            <div className="att-save-date">
              <span className="att-save-date-icon"><CalendarCheck2 size={19} /></span>
              <div>
                <span className="att-save-date-label">Attendance date</span>
                <strong>{formatLongDate(date)}</strong>
                <small>{formatWeekday(date)}</small>
              </div>
            </div>

            {confirm === 'save' ? (
              <>
                <div className="att-save-marks">
                  {marksSaved.map(({ key, label, value, Icon }) => (
                    <span key={key} className={key}>
                      <Icon size={14} /> {value} {label}
                    </span>
                  ))}
                </div>
                <p className="att-save-note">
                  You are saving <b>{counts.marked}</b> marked {counts.marked === 1 ? 'student' : 'students'} out of <b>{counts.total}</b> in this section.
                  {hasSavedRecords
                    ? ' Any previously saved record for this date will be updated.'
                    : ' Nothing has been saved for this date yet.'}
                </p>
                {counts.remaining > 0 && (
                  <p className="att-save-note warn">
                    {counts.remaining} {counts.remaining === 1 ? 'student is' : 'students are'} still unmarked and will be left out of this save.
                  </p>
                )}
              </>
            ) : (
              <p className="att-save-note">
                This removes the attendance record for all <b>{counts.total}</b> students in this section on this date. This cannot be undone.
              </p>
            )}

            <div className="notice-preview-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="submit" className={confirm === 'delete' ? 'danger-button' : 'primary-button'} disabled={saving}>
                {confirm === 'delete' ? <Trash2 size={16} /> : <Check size={16} />}
                {saving ? 'Working…' : confirm === 'save' ? 'Confirm save' : 'Confirm delete'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DmcPanel({ students, policy, calendarDays, onToast }: {
  students: Student[];
  policy: CalendarPolicy;
  calendarDays: CalendarDay[];
  onToast: (message: string) => void;
}) {
  const today = todayKey();
  const [studentId, setStudentId] = useState('');
  const [range, setRange] = useState({ start: monthStart(today), end: today });
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [manual, setManual] = useState({ total: '', present: '', absent: '' });
  const [draft, setDraft] = useState<DmcDraft>(() => createDmcDraft(monthStart(today), today));
  const [marks, setMarks] = useState<DmcMarksRow[]>(() => createMarksRows());
  const [savingDmc, setSavingDmc] = useState(false);

  const roster = useMemo(
    () => students.filter((student) => student.status === 'active').sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [students],
  );
  const selectedStudent = roster.find((student) => student.id === studentId) ?? null;

  useEffect(() => {
    if (!studentId || !range.start || !range.end) { setRecords([]); setLoadError(null); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('school_attendance')
          .select('student_id, attendance_date, status')
          .eq('student_id', studentId)
          .gte('attendance_date', range.start)
          .lte('attendance_date', range.end);
        if (cancelled) return;
        setRecords(error ? [] : ((data ?? []) as AttendanceRecord[]));
        setLoadError(error ? 'Attendance for this period could not be loaded.' : null);
      } catch {
        if (!cancelled) { setRecords([]); setLoadError('Attendance for this period could not be loaded.'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [studentId, range.start, range.end]);

  const autoSummary = useMemo(
    () => summariseAttendance(records, range.start, range.end, policy, calendarDays),
    [records, range.start, range.end, policy, calendarDays],
  );

  // The days the school actually opened in this period, read from the saved calendar,
  // so the printed sheet shows both the school's own day count and the student's
  // attendance percentage over it.
  const schoolDays = useMemo(
    () => schoolDaysInPeriod(range.start, range.end, policy, calendarDays),
    [range.start, range.end, policy, calendarDays],
  );

  // Manual figures are optional: they only take over when a staff member turns
  // the override on, otherwise the register drives every number on the sheet.
  const summary: AttendanceSummary = override
    ? {
      total: parseCount(manual.total),
      present: parseCount(manual.present),
      absent: parseCount(manual.absent),
      late: autoSummary.late,
      leave: autoSummary.leave,
      half_day: autoSummary.half_day,
      percentage: attendancePercentage(parseCount(manual.present), parseCount(manual.total)),
    }
    : autoSummary;

  const enableOverride = () => {
    setManual({ total: String(autoSummary.total), present: String(autoSummary.present), absent: String(autoSummary.absent) });
    setOverride(true);
  };

  const saveDmc = async () => {
    if (!selectedStudent) { onToast('Choose a student first.'); return; }
    setSavingDmc(true);
    const { error } = await supabase.from('school_dmc_records').upsert({
      student_id: selectedStudent.id,
      term: draft.term,
      session: draft.session,
      period_start: range.start,
      period_end: range.end,
      attendance_total: summary.total,
      attendance_present: summary.present,
      attendance_absent: summary.absent,
      attendance_percentage: summary.percentage,
      attendance_manual: override,
      remarks: draft.remarks,
      issued_date: today,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,period_start,period_end' });
    setSavingDmc(false);
    if (error) { onToast('The DMC could not be saved. Please try again.'); return; }
    onToast(`DMC saved for ${selectedStudent.full_name}`);
  };

  return (
    <div className="dmc-panel">
      <div className="panel attendance-filters-panel">
        <div className="att-filters">
          <label className="control-field">Student
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
              <option value="">Select a student</option>
              {roster.map((student) => <option key={student.id} value={student.id}>{student.full_name} — {student.class_name} · {student.section_name}</option>)}
            </select>
          </label>
          <label className="control-field">Period from
            <input type="date" value={range.start} onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))} />
          </label>
          <label className="control-field">Period to
            <input type="date" value={range.end} onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))} />
          </label>
          <label className="control-field">Term
            <input value={draft.term} onChange={(event) => setDraft((current) => ({ ...current, term: event.target.value }))} placeholder="Annual, First term…" />
          </label>
          <label className="control-field">Session
            <input value={draft.session} onChange={(event) => setDraft((current) => ({ ...current, session: event.target.value }))} placeholder="2026-2027" />
          </label>
        </div>
      </div>

      {!selectedStudent ? (
        <div className="panel roster-panel">
          <div className="empty-state large"><FileBadge2 size={20} /> Choose a student to build their Detailed Marks Certificate.</div>
        </div>
      ) : (
        <>
          <div className="panel dmc-summary-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Calculated from the register</span>
                <h2>Attendance summary</h2>
              </div>
              <span className="dmc-period-note">{range.start} → {range.end} · school calendar applied</span>
            </div>

            <div className="dmc-stat-row">
              <div className="dmc-stat"><span>School days</span><strong>{loading ? '—' : schoolDays}</strong></div>
              <div className="dmc-stat"><span>Total days</span><strong>{loading ? '—' : summary.total}</strong></div>
              <div className="dmc-stat present"><span>Present days</span><strong>{loading ? '—' : summary.present}</strong></div>
              <div className="dmc-stat absent"><span>Absent days</span><strong>{loading ? '—' : summary.absent}</strong></div>
              <div className="dmc-stat"><span>Late arrivals</span><strong>{loading ? '—' : summary.late}</strong></div>
              <div className="dmc-stat percentage"><span>Attendance</span><strong>{loading ? '—' : formatPercentage(summary.percentage)}</strong></div>
            </div>

            {loadError && <p className="dmc-warning">{loadError}</p>}

            <div className="dmc-override">
              <label className="att-filter-check">
                <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={override} onChange={(event) => event.target.checked ? enableOverride() : setOverride(false)} />
                <span>Adjust attendance manually</span>
              </label>
              {override ? (
                <div className="dmc-override-fields">
                  <label className="control-field">Total days
                    <input type="number" min="0" value={manual.total} onChange={(event) => setManual((current) => ({ ...current, total: event.target.value }))} />
                  </label>
                  <label className="control-field">Present days
                    <input type="number" min="0" value={manual.present} onChange={(event) => setManual((current) => ({ ...current, present: event.target.value }))} />
                  </label>
                  <label className="control-field">Absent days
                    <input type="number" min="0" value={manual.absent} onChange={(event) => setManual((current) => ({ ...current, absent: event.target.value }))} />
                  </label>
                  <span className="dmc-override-note">Attendance works out to <b>{formatPercentage(summary.percentage)}</b> from these figures.</span>
                </div>
              ) : (
                <p className="dmc-override-note">Figures come straight from the daily register. Tick the box only if you need to correct them.</p>
              )}
            </div>
          </div>

          <div className="panel dmc-marks-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Printed on the certificate</span>
                <h2>Marks obtained</h2>
              </div>
              <button type="button" className="secondary-button" onClick={() => setMarks((current) => [...current, ...createMarksRows().slice(0, 1)])}><Check size={15} /> Add subject row</button>
            </div>
            <div className="dmc-marks-grid">
              <span className="dmc-marks-head">Subject</span>
              <span className="dmc-marks-head">Total marks</span>
              <span className="dmc-marks-head">Obtained</span>
              <span />
              {marks.map((row, index) => (
                <div className="dmc-marks-row" key={index}>
                  <input value={row.subject} placeholder="e.g. Mathematics" onChange={(event) => setMarks((current) => current.map((item, i) => i === index ? { ...item, subject: event.target.value } : item))} />
                  <input type="number" min="0" value={row.total_marks} onChange={(event) => setMarks((current) => current.map((item, i) => i === index ? { ...item, total_marks: event.target.value } : item))} />
                  <input type="number" min="0" value={row.obtained_marks} onChange={(event) => setMarks((current) => current.map((item, i) => i === index ? { ...item, obtained_marks: event.target.value } : item))} />
                  <button type="button" className="dmc-marks-remove" aria-label="Remove subject" onClick={() => setMarks((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <label className="control-field dmc-remarks">Remarks
              <textarea rows={3} value={draft.remarks} onChange={(event) => setDraft((current) => ({ ...current, remarks: event.target.value }))} placeholder="Result, conduct or any note to print on the certificate" />
            </label>
          </div>

          <div className="panel dmc-actions-panel">
            <div className="dmc-actions-copy">
              <strong>{selectedStudent.full_name}</strong>
              <small>{selectedStudent.admission_number} · {selectedStudent.class_name} · Section {selectedStudent.section_name}</small>
            </div>
            <div className="dmc-actions-buttons">
              <button type="button" className="secondary-button" onClick={() => void saveDmc()} disabled={savingDmc}>{savingDmc ? 'Saving…' : 'Save DMC'}</button>
              <DmcSheet
                student={selectedStudent}
                draft={{ ...draft, period_start: range.start, period_end: range.end }}
                summary={summary}
                schoolDays={schoolDays}
                marks={marks}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
