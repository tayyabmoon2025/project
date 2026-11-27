import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarOff, Info, Loader as Loader2, Plus, Printer, Trash2 } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { supabase } from '@/lib/supabase';
import {
  fetchAllDatesheets,
  fetchDatesheet,
  OFF_LABEL,
  saveDatesheet,
  weekdayFor,
  type DatesheetDraft,
  type DatesheetEntry,
} from '@/lib/examExtras';
import { fetchExamSubjects, type ExamSubject, type ExamType } from '@/lib/exams';
import { toDateKey, type CalendarDay } from '@/lib/attendance';
import { loadSchoolCalendar } from '@/lib/schoolCalendar';
import { expandClosedDays, holidayOn } from '@/lib/schoolHolidays';
import { admissionLabel, compareRoster, rollLabel } from '@/lib/studentRoll';
import { SchoolLogo } from '@/components/SchoolLogo';
import { StudentPhoto } from '@/components/StudentPhoto';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { usePrintSheet } from '@/lib/usePrintSheet';
import type { Student } from '@/lib/schoolTypes';

const formatDay = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

const fmtTime = (value: string | null) => {
  if (!value) return '';
  const [hourRaw, minuteRaw] = value.split(':');
  const hours = Number(hourRaw);
  if (!Number.isFinite(hours)) return value;
  const minutes = minuteRaw ?? '00';
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(display).padStart(2, '0')}:${minutes.padStart(2, '0')} ${suffix}`;
};

const timing = (entry: { start_time: string | null; end_time: string | null }) =>
  [fmtTime(entry.start_time), fmtTime(entry.end_time)].filter(Boolean).join(' — ');

// Moves a paper on to the next day the school is open: Sundays are skipped, and so is
// every date the school calendar marks as a holiday or vacation, so a paper is never
// scheduled on a day the school is shut.
const nextExamDate = (date: string, isClosed: (dayKey: string) => boolean) => {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  for (let guard = 0; guard < 45; guard += 1) {
    parsed.setDate(parsed.getDate() + 1);
    const key = toDateKey(parsed);
    if (parsed.getDay() !== 0 && !isClosed(key)) break;
  }
  return toDateKey(parsed);
};

const isOffRow = (draft: DatesheetDraft) => draft.subject_name.trim().toUpperCase() === OFF_LABEL.toUpperCase();

const emptyRow = (): DatesheetDraft & { id: string | null } => ({
  id: null, exam_date: '', subject_name: '', start_time: '', end_time: '', room_number: '',
});

export function DateSheetTab({ students, onToast }: { students: Student[]; onToast: (message: string) => void }) {
  const [exams, setExams] = useState<ExamType[]>([]);
  const [examId, setExamId] = useState('');
  const [className, setClassName] = useState('');
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [entries, setEntries] = useState<DatesheetEntry[]>([]);
  const [allEntries, setAllEntries] = useState<DatesheetEntry[]>([]);
  const [drafts, setDrafts] = useState<(DatesheetDraft & { id: string | null })[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<'none' | 'sheet' | 'master' | 'slips'>('none');
  const [printScope, setPrintScope] = useState<'class' | 'all'>('class');
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);

  // The date sheet shares the school calendar with the attendance register, so a paper
  // cannot be dated on a day the school is closed.
  const closedDays = useMemo(() => expandClosedDays(calendarDays), [calendarDays]);
  const isCalendarClosed = (dayKey: string) => closedDays.has(dayKey.slice(0, 10));
  const holidayFor = (dayKey: string) => (dayKey ? holidayOn(dayKey, calendarDays) : null);

  const classes = useMemo(
    () => Array.from(new Set(students.filter((student) => student.status === 'active').map((student) => student.class_name))).sort(),
    [students],
  );

  useEffect(() => {
    setClassName((current) => (current && classes.includes(current) ? current : classes[0] ?? ''));
  }, [classes]);

  useEffect(() => {
    void (async () => {
      const { data, error: loadError } = await supabase
        .from('school_exam_types')
        .select('id, name, period_start, period_end, sort_order, is_active, min_pass_percentage, passing_rule')
        .order('sort_order')
        .order('name');
      if (loadError) { setError('The exam list could not be loaded.'); return; }
      const rows = (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        period_start: row.period_start ?? null,
        period_end: row.period_end ?? null,
        sort_order: Number(row.sort_order) || 0,
        is_active: row.is_active !== false,
        min_pass_percentage: Number(row.min_pass_percentage) || 40,
        passing_rule: row.passing_rule === 'aggregate' || row.passing_rule === 'compulsory' || row.passing_rule === 'both' ? row.passing_rule : 'both',
      }));
      setExams(rows);
      setExamId((current) => current || rows[0]?.id || '');
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const { days } = await loadSchoolCalendar();
      setCalendarDays(days);
    })();
  }, []);

  useEffect(() => {
    if (!examId) { setSubjects([]); return; }
    void (async () => {
      const { subjects: rows } = await fetchExamSubjects(examId);
      setSubjects(rows);
    })();
  }, [examId]);

  const load = useCallback(async (id: string, klass: string) => {
    if (!id || !klass) { setEntries([]); setAllEntries([]); setDrafts([emptyRow()]); return; }
    setSaving(true);
    const [{ entries: rows, error: loadError }, all] = await Promise.all([fetchDatesheet(id, klass), fetchAllDatesheets(id)]);
    setEntries(rows);
    setAllEntries(all.entries);
    setError(loadError);
    setDrafts(rows.length > 0
      ? rows.map((row) => ({
        id: row.id,
        exam_date: row.exam_date,
        subject_name: row.subject_name,
        start_time: row.start_time ?? '',
        end_time: row.end_time ?? '',
        room_number: row.room_number ?? '',
      }))
      : [emptyRow()]);
    setSaving(false);
  }, []);

  useEffect(() => { void load(examId, className); }, [examId, className, load]);

  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;
  const roster = useMemo(
    () => students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .sort(compareRoster),
    [students, className],
  );

  const sortedDrafts = useMemo(
    () => [...drafts].sort((a, b) => (a.exam_date || '9999').localeCompare(b.exam_date || '9999')),
    [drafts],
  );

  const masterClasses = useMemo(
    () => Array.from(new Set(allEntries.map((entry) => entry.class_name))).sort(),
    [allEntries],
  );
  const masterDates = useMemo(
    () => Array.from(new Set(allEntries.map((entry) => entry.exam_date))).sort(),
    [allEntries],
  );
  const masterCell = (date: string, klass: string) =>
    allEntries.find((entry) => entry.exam_date === date && entry.class_name === klass) ?? null;

  const setDraft = (index: number, patch: Partial<DatesheetDraft>) => {
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  };

  // Smart auto-fill: the new row continues from the last one — the date moves one
  // day on (never landing on a Sunday), the timing and room carry over, and the
  // next subject of the class that is not already on the sheet is pre-selected.
  const addPaper = () => {
    setDrafts((current) => {
      const last = current[current.length - 1] ?? null;
      if (!last || (!last.exam_date && !last.subject_name.trim() && !last.start_time)) return [...current, { ...emptyRow(), start_time: '08:30', end_time: '11:30' }];
      const used = new Set(current.map((draft) => draft.subject_name.trim().toUpperCase()).filter(Boolean));
      const classSubjects = subjects
        .filter((subject) => subject.class_name === className)
        .map((subject) => subject.subject_name);
      const nextSubject = classSubjects.find((name) => !used.has(name.trim().toUpperCase())) ?? '';
      return [...current, {
        id: null,
        exam_date: last.exam_date ? nextExamDate(last.exam_date, isCalendarClosed) : '',
        subject_name: nextSubject,
        start_time: last.start_time || '08:30',
        end_time: last.end_time || '11:30',
        room_number: last.room_number,
      }];
    });
  };

  // A holiday row carries the date forward but blocks the whole day — no paper,
  // no timing, no room. Timing and room stay editable on every other row.
  const addOffRow = () => {
    setDrafts((current) => {
      const last = current[current.length - 1] ?? null;
      return [...current, {
        id: null,
        exam_date: last?.exam_date ? nextExamDate(last.exam_date, isCalendarClosed) : '',
        subject_name: OFF_LABEL,
        start_time: '',
        end_time: '',
        room_number: '',
      }];
    });
  };

  // Every holiday the office already put on the school calendar becomes an OFF row on the
  // date sheet in one action, so the two screens never disagree about a closed day.
  const importCalendarHolidays = () => {
    const dated = drafts.map((draft) => draft.exam_date).filter(Boolean).sort();
    if (dated.length === 0) { onToast('Add at least one dated row first, so the exam window is known.'); return; }
    const from = dated[0];
    const to = dated[dated.length - 1];
    const onSheet = new Set(drafts.map((draft) => draft.exam_date).filter(Boolean));
    const missing = calendarDays.filter((day) => {
      if (!isCalendarClosed(day.day_date.slice(0, 10))) return false;
      const start = day.day_date.slice(0, 10) < from ? from : day.day_date.slice(0, 10);
      const end = (day.end_date || day.day_date).slice(0, 10) > to ? to : (day.end_date || day.day_date).slice(0, 10);
      for (let cursor = start; cursor <= end; cursor = nextExamDate(cursor, () => false)) {
        if (!onSheet.has(cursor)) return true;
      }
      return false;
    });
    if (missing.length === 0) { onToast('No school holiday falls inside this date sheet.'); return; }
    setDrafts((current) => {
      const added = missing.flatMap((day) => {
        const start = day.day_date.slice(0, 10) < from ? from : day.day_date.slice(0, 10);
        const last = (day.end_date || day.day_date).slice(0, 10) > to ? to : (day.end_date || day.day_date).slice(0, 10);
        const rows: (DatesheetDraft & { id: string | null })[] = [];
        for (let cursor = start; cursor <= last; cursor = nextExamDate(cursor, () => false)) {
          if (drafts.some((draft) => draft.exam_date === cursor)) continue;
          rows.push({ id: null, exam_date: cursor, subject_name: OFF_LABEL, start_time: '', end_time: '', room_number: '' });
        }
        return rows;
      });
      return [...current, ...added];
    });
    onToast(`${missing.length} holiday${missing.length === 1 ? '' : 's'} from the school calendar were added as OFF rows.`);
  };

  const save = async (): Promise<boolean | void> => {
    if (!examId || !className) { onToast('Choose an exam and a class first.'); return false; }
    const filled = drafts.filter((draft) => draft.subject_name.trim() !== '' || draft.exam_date !== '');
    if (filled.length === 0) { onToast('Add at least one paper with a date and subject.'); return false; }
    const incomplete = filled.find((draft) => draft.subject_name.trim() === '' || draft.exam_date === '');
    if (incomplete) { setError('Every paper needs both a date and a subject. Clear the row if it is not needed.'); return false; }
    const invalidTime = filled.find((draft) => !isOffRow(draft) && (!draft.start_time || !draft.end_time));
    if (invalidTime) { setError('A paper is missing its start or end time. OFF / Holiday rows are the only rows that may have no timing.'); return false; }
    setSaving(true);
    setError(null);
    const { error: saveError } = await saveDatesheet(examId, className, drafts);
    if (saveError) { setError(saveError); onToast(saveError); setSaving(false); return false; }
    await load(examId, className);
    setSaving(false);
    onToast(`Date sheet saved for ${className}.`);
    return true;
  };

  const hasClassSheet = sortedDrafts.some((draft) => draft.exam_date && draft.subject_name);
  const printSheet = usePrintSheet(printMode === 'sheet', printMode === 'sheet' && selectedExam ? (
    <section className="print-only print-dmc-sheet print-datesheet" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Date Sheet — {selectedExam?.name}</p>
        </div>
        <div className="print-header-admitted">
          <span>Class</span>
          <strong>{className}</strong>
        </div>
      </div>
      <div className="print-fee-section print-dmc-marks">
        <h2>Paper schedule</h2>
        <table className="print-dmc-table">
          <thead>
            <tr><th>Date</th><th>Day</th><th>Subject</th><th>Timing</th><th>Room No.</th></tr>
          </thead>
          <tbody>
            {sortedDrafts.filter((draft) => draft.exam_date && draft.subject_name).map((draft) => (
              <tr key={`${draft.id ?? draft.exam_date}-${draft.subject_name}`}>
                <td>{formatDay(draft.exam_date)}</td>
                <td>{weekdayFor(draft.exam_date)}</td>
                <td><strong>{draft.subject_name}</strong></td>
                <td>{isOffRow(draft) ? 'OFF / Holiday' : timing(draft) || '—'}</td>
                <td>{isOffRow(draft) || !draft.room_number ? '' : draft.room_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Controller of Examinations</span></div>
        <div className="print-signature"><span>Principal</span></div>
      </div>
    </section>
  ) : null);

  const printMaster = usePrintSheet(printMode === 'master', printMode === 'master' && selectedExam ? (
    <section className="print-only print-dmc-sheet print-datesheet print-datesheet-master" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Master Date Sheet — {selectedExam?.name}</p>
        </div>
        <div className="print-header-admitted">
          <span>Classes</span>
          <strong>{masterClasses.length}</strong>
        </div>
      </div>
      <div className="print-fee-section print-dmc-marks">
        <h2>All classes combined</h2>
        <table className="print-dmc-table print-master-table">
          <thead>
            <tr><th>Date</th><th>Day</th>{masterClasses.map((klass) => <th key={klass}>{klass}</th>)}</tr>
          </thead>
          <tbody>
            {masterDates.map((date) => (
              <tr key={date}>
                <td>{formatDay(date)}</td>
                <td>{weekdayFor(date)}</td>
                {masterClasses.map((klass) => {
                  const entry = masterCell(date, klass);
                  if (!entry) return <td key={klass} />;
                  const off = entry.subject_name.toUpperCase() === OFF_LABEL.toUpperCase();
                  return (
                    <td key={klass}>
                      <strong>{entry.subject_name}</strong>
                      {!off && <small>{[timing(entry), entry.room_number].filter(Boolean).join(' · ')}</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="print-signatures">
        <div className="print-signature"><span>Controller of Examinations</span></div>
        <div className="print-signature"><span>Principal</span></div>
      </div>
    </section>
  ) : null);

  const printSlips = usePrintSheet(printMode === 'slips', printMode === 'slips' && selectedExam ? (
    <section className="print-only print-datesheet-slips" aria-hidden="true">
      {roster.map((student) => (
        <article key={student.id} className="print-slip-card">
          <header className="print-slip-head">
            <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="print-slip-logo" />
            <div>
              <strong>{SCHOOL_NAME}</strong>
              <span>Roll Number Slip — {selectedExam?.name}</span>
            </div>
          </header>
          <div className="print-slip-body">
            <StudentPhoto src={student.photo_url} name={student.full_name} className="print-slip-photo" />
            <dl>
              <div><dt>Student</dt><dd>{student.full_name}</dd></div>
              <div><dt>Class</dt><dd>{student.class_name} · Section {student.section_name}</dd></div>
              <div><dt>Roll No.</dt><dd>{rollLabel(student)}</dd></div>
              <div><dt>Admission No.</dt><dd>{admissionLabel(student)}</dd></div>
              <div><dt>Father / Guardian</dt><dd>{student.fathers_name || student.guardian_name || '—'}</dd></div>
            </dl>
          </div>
          <table className="print-dmc-table print-slip-table">
            <thead>
              <tr><th>Date</th><th>Day</th><th>Subject</th><th>Timing</th><th>Room No.</th></tr>
            </thead>
            <tbody>
              {sortedDrafts.filter((draft) => draft.exam_date && draft.subject_name).map((draft) => (
                <tr key={`${student.id}-${draft.id ?? draft.exam_date}-${draft.subject_name}`}>
                  <td>{formatDay(draft.exam_date)}</td>
                  <td>{weekdayFor(draft.exam_date)}</td>
                  <td>{draft.subject_name}</td>
                  <td>{isOffRow(draft) ? 'OFF / Holiday' : timing(draft) || '—'}</td>
                  <td>{isOffRow(draft) || !draft.room_number ? '' : draft.room_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </section>
  ) : null);

  const doPrint = (mode: 'sheet' | 'master' | 'slips') => {
    if (printMode === 'none') setPrintMode(mode);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => setPrintMode('none'), 300);
    }, 60);
  };

  return (
    <div className="exam-datesheet">
      <div className="panel attendance-filters-panel">
        <div className="att-filters">
          <label className="control-field">Exam
            <select value={examId} onChange={(event) => setExamId(event.target.value)}>
              <option value="">Select an exam</option>
              {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
          <label className="control-field">Class
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">Select a class</option>
              {classes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="panel exam-marks-head">
        <div className="exam-marks-copy">
          <span className="eyebrow">{selectedExam?.name ?? 'Date sheet'}</span>
          <h2>{className || 'Date Sheet'} — paper schedule</h2>
          <p>{roster.length} students will get a roll number slip from this schedule.</p>
        </div>
        <div className="exam-marks-actions">
          <label className="control-field datesheet-scope-field">Print scope
            <select value={printScope} onChange={(event) => setPrintScope(event.target.value === 'all' ? 'all' : 'class')}>
              <option value="class">Selected class only</option>
              <option value="all">All classes combined</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => doPrint(printScope === 'all' ? 'master' : 'sheet')}
            disabled={!selectedExam || (printScope === 'all' ? masterDates.length === 0 : !hasClassSheet)}
          >
            <Printer size={15} /> {printScope === 'all' ? 'Print master date sheet' : 'Print class date sheet'}
          </button>
          <button type="button" className="primary-button" onClick={() => doPrint('slips')} disabled={!selectedExam || roster.length === 0 || !hasClassSheet}>
            <Printer size={15} /> Print student roll no. slips
          </button>
        </div>
      </div>

      {error && <p className="dmc-warning">{error}</p>}

      <div className="panel roster-panel">
        <div className="table-toolbar">
          <span className="result-count">Papers, oldest first</span>
          <div className="exam-marks-actions">
            <button type="button" className="secondary-button" onClick={addPaper}>
              <Plus size={15} /> Add paper
            </button>
            <button type="button" className="secondary-button" onClick={addOffRow}>
              <Plus size={15} /> Add Off / Holiday
            </button>
            <button type="button" className="secondary-button" onClick={importCalendarHolidays} disabled={calendarDays.length === 0}>
              <CalendarOff size={15} /> Import school holidays
            </button>
            <AsyncSaveButton
              className="secondary-button"
              label="Save date sheet"
              disabled={saving}
              onSave={() => save()}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table className="exam-marks-table datesheet-table">
            <thead>
              <tr><th>Date</th><th>Day</th><th>Subject</th><th>Starts</th><th>Ends</th><th>Room No.</th><th /></tr>
            </thead>
            <tbody>
              {sortedDrafts.map((draft) => {
                const index = drafts.indexOf(draft);
                const clash = !isOffRow(draft) ? holidayFor(draft.exam_date) : null;
                return (
                  <tr key={draft.id ?? `new-${index}`} className={clash ? 'datesheet-clash' : ''}>
                    <td>
                      <input
                        type="date"
                        className="exam-mark-input datesheet-date"
                        value={draft.exam_date}
                        onChange={(event) => setDraft(index, { exam_date: event.target.value })}
                      />
                    </td>
                    <td className={isOffRow(draft) ? 'muted-cell datesheet-off-day' : 'muted-cell'}>
                      {draft.exam_date ? weekdayFor(draft.exam_date) : '—'}
                      {clash && <span className="datesheet-clash-flag" title={`School closed: ${clash.title}`}>Holiday — {clash.title}</span>}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="exam-mark-input datesheet-subject"
                        value={draft.subject_name}
                        placeholder="Subject"
                        list="datesheet-subject-options"
                        onChange={(event) => setDraft(index, { subject_name: event.target.value })}
                      />
                    </td>
                    {isOffRow(draft) ? (
                      <>
                        <td className="muted-cell datesheet-off-span" colSpan={2}>Holiday — no paper</td>
                        <td className="muted-cell">—</td>
                      </>
                    ) : (
                      <>
                        <td><input type="time" className="exam-mark-input" value={draft.start_time} onChange={(event) => setDraft(index, { start_time: event.target.value })} /></td>
                        <td><input type="time" className="exam-mark-input" value={draft.end_time} onChange={(event) => setDraft(index, { end_time: event.target.value })} /></td>
                        <td><input type="text" className="exam-mark-input datesheet-room" value={draft.room_number} placeholder="Optional" onChange={(event) => setDraft(index, { room_number: event.target.value })} /></td>
                      </>
                    )}
                    <td>
                      <button
                        type="button"
                        className="row-action-btn"
                        title="Remove this paper"
                        onClick={() => setDrafts((current) => (current.length === 1 ? [emptyRow()] : current.filter((_, position) => position !== index)))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="datesheet-subject-options">
            <option key="off-holiday" value={OFF_LABEL} />
            {subjects.filter((subject) => subject.class_name === className).map((subject) => (
              <option key={subject.id} value={subject.subject_name} />
            ))}
          </datalist>
        </div>
        <p className="cal-hint">
          <Info size={14} />
          Add one row per paper and press Save date sheet — new rows continue from the last one: the date moves forward a day
          (skipping Sundays and every day the school calendar marks as a holiday), the timing and room carry over, and the
          next subject of the class is pre-filled; everything stays editable. "Import school holidays" pulls the closed days
          from the school calendar onto the sheet in one go. Switch Print scope to "All classes combined" to preview and
          print one master sheet for the whole school. Roll number slips print two to a page on A4.
        </p>
      </div>

      {printSheet}
      {printMaster}
      {printSlips}
      {saving && entries.length === 0 && <div className="empty-state large"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
    </div>
  );
}
