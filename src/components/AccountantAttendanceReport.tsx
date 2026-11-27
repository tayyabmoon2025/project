import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, Printer, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayKey } from '@/lib/attendance';
import { formatDay } from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

type AttendanceRow = { student_id: string; attendance_date: string; status: string };

// The accountant's read-only attendance report: the same records the class teacher
// marks, shown by class, section and date. Nothing on this screen writes.
export function AccountantAttendanceReport({ students, onToast }: {
  students: Student[];
  onToast: (message: string) => void;
}) {
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [fromDate, setFromDate] = useState(todayKey());
  const [toDate, setToDate] = useState(todayKey());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeStudents = useMemo(() => students.filter((student) => student.status === 'active'), [students]);
  const classList = useMemo(() => Array.from(new Set(activeStudents.map((student) => student.class_name))).sort(), [activeStudents]);
  const sectionList = useMemo(() => Array.from(new Set(
    activeStudents.filter((student) => !classFilter || student.class_name === classFilter).map((student) => student.section_name),
  )).sort(), [activeStudents, classFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('school_attendance')
      .select('student_id, attendance_date, status')
      .gte('attendance_date', fromDate)
      .lte('attendance_date', toDate);
    setLoading(false);
    if (queryError) { setError('The attendance records could not be loaded.'); return; }
    setRows((data ?? []) as AttendanceRow[]);
  }, [fromDate, toDate]);

  useEffect(() => { void load(); }, [load]);

  const visibleStudents = activeStudents.filter((student) => {
    if (classFilter && student.class_name !== classFilter) return false;
    if (sectionFilter && student.section_name !== sectionFilter) return false;
    return true;
  });
  const visibleIds = new Set(visibleStudents.map((student) => student.id));

  const counts = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const row of rows) {
    if (!visibleIds.has(row.student_id)) continue;
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }
  const total = counts.present + counts.absent + counts.late + counts.leave;
  const percentage = total ? Math.round((counts.present / total) * 1000) / 10 : 0;

  // One line per student so the report reads like a register, not a raw dump.
  const perStudent = visibleStudents.map((student) => {
    const own = rows.filter((row) => row.student_id === student.id);
    const present = own.filter((row) => row.status === 'present').length;
    const absent = own.filter((row) => row.status === 'absent').length;
    const late = own.filter((row) => row.status === 'late').length;
    const leave = own.filter((row) => row.status === 'leave').length;
    const marked = present + absent + late + leave;
    return { student, present, absent, late, leave, marked, percent: marked ? Math.round((present / marked) * 100) : 0 };
  }).filter((row) => row.marked > 0);

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Read-only</span><h2>Attendance report</h2></div>
          <div className="fee-quick">
            <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print report</button>
            <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter(''); }}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Section</span>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="">All sections</option>
              {sectionList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>From</span>
            <input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="control-field"><span>To</span>
            <input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
        {error && <p className="fee-error">{error}</p>}
        <div className="acct-mini-stats">
          <div><span>Present</span><strong className="text-emerald-700">{counts.present}</strong></div>
          <div><span>Absent</span><strong className="text-rose-600">{counts.absent}</strong></div>
          <div><span>Late</span><strong className="text-amber-600">{counts.late}</strong></div>
          <div><span>Leave</span><strong>{counts.leave}</strong></div>
          <div><span>Attendance</span><strong>{percentage}%</strong></div>
        </div>
      </section>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Register</span><h2>{visibleStudents.length} students · {formatDay(fromDate)} to {formatDay(toDate)}</h2></div>
        </div>
        {loading ? <p className="fee-empty">Loading attendance…</p> : perStudent.length === 0 ? (
          <p className="fee-empty">No attendance has been marked for these filters. Try another class, section or date range.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Class</th><th className="text-right">Present</th><th className="text-right">Absent</th><th className="text-right">Late</th><th className="text-right">Leave</th><th className="text-right">Attendance</th></tr></thead>
              <tbody>
                {perStudent.map((row) => (
                  <tr key={row.student.id}>
                    <td><strong>{row.student.full_name}</strong><small className="fee-sub">{row.student.admission_number}</small></td>
                    <td>{row.student.class_name} · {row.student.section_name}</td>
                    <td className="text-right tabular-nums">{row.present}</td>
                    <td className="text-right tabular-nums">{row.absent}</td>
                    <td className="text-right tabular-nums">{row.late}</td>
                    <td className="text-right tabular-nums">{row.leave}</td>
                    <td className="text-right font-semibold tabular-nums">{row.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="fee-hint"><CalendarCheck2 size={14} /> Attendance is recorded by teachers. This report is read-only for the fee office.</p>
      <button className="secondary-button no-print" onClick={() => onToast('Attendance reports are read-only for the accountant.')}>About this report</button>
    </div>
  );
}
