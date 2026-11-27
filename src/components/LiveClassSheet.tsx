import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME } from '@/lib/noticeText';
import {
  classStartMoment,
  formatClassDate,
  formatClassTime,
  formatDuration,
  joinTimeLabel,
  modeLabel,
  type LiveClass,
  type LiveClassAttendance,
  type LiveClassStudent,
} from '@/lib/liveClasses';

// The A4 summary an administrator or a teacher can print after an online class. It
// shows who was in the room and exactly when they joined and left, which is the
// record the school keeps when a class is held outside normal hours.
export function LiveClassSheet({
  liveClass,
  roster,
  entries,
  audience,
}: {
  liveClass: LiveClass;
  roster: LiveClassStudent[];
  entries: LiveClassAttendance[];
  audience: 'admin' | 'teacher';
}) {
  const presentIds = new Set(entries.map((entry) => entry.student_id));
  const absent = roster.filter((student) => !presentIds.has(student.id));
  const started = liveClass.started_at ? new Date(liveClass.started_at) : classStartMoment(liveClass);

  return (
    <section className="print-only print-live-sheet" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={SCHOOL_NAME} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Online live class attendance</p>
        </div>
        <div className="print-header-admitted">
          <span>Date</span>
          <strong>{formatClassDate(liveClass.class_date)}</strong>
        </div>
      </div>

      <div className="print-layout">
        <div className="print-columns">
          <div className="print-column">
            <div className="print-row"><span className="print-row-label">Class</span><span className="print-row-value">{liveClass.class_name} · Section {liveClass.section_name}</span></div>
            <div className="print-row"><span className="print-row-label">Subject</span><span className="print-row-value">{liveClass.subject_name}</span></div>
            <div className="print-row"><span className="print-row-label">Teacher</span><span className="print-row-value">{liveClass.teacher_name}</span></div>
          </div>
          <div className="print-column">
            <div className="print-row"><span className="print-row-label">Topic</span><span className="print-row-value">{liveClass.lesson_topic}</span></div>
            <div className="print-row"><span className="print-row-label">Start time</span><span className="print-row-value">{formatClassTime(liveClass.start_time)} · {formatDuration(liveClass.duration_minutes)}</span></div>
            <div className="print-row"><span className="print-row-label">Mode</span><span className="print-row-value">{modeLabel(liveClass.mode)}</span></div>
          </div>
        </div>
      </div>

      <div className="print-fee-section print-live-summary">
        <h2>Attendance summary</h2>
        <div className="print-live-summary-grid">
          <div className="print-row"><span className="print-row-label">Total students</span><span className="print-row-value">{roster.length}</span></div>
          <div className="print-row"><span className="print-row-label">Present</span><span className="print-row-value">{entries.length}</span></div>
          <div className="print-row"><span className="print-row-label">Absent</span><span className="print-row-value">{absent.length}</span></div>
          <div className="print-row"><span className="print-row-label">Class started</span><span className="print-row-value">{started.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
        </div>
      </div>

      <div className="print-fee-section">
        <h2>Join and leave record</h2>
        {entries.length === 0 ? (
          <p className="print-live-empty">No student joined this online class.</p>
        ) : (
          <table className="print-dmc-table print-live-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Student</th>
                <th>Joined</th>
                <th>Left</th>
                <th>Minutes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id}>
                  <td>{index + 1}</td>
                  <td>{entry.student_name}</td>
                  <td>{joinTimeLabel(entry.joined_at)}</td>
                  <td>{entry.left_at ? joinTimeLabel(entry.left_at) : 'Still in the room'}</td>
                  <td>{entry.minutes_present === null ? '—' : entry.minutes_present}</td>
                  <td>{entry.left_at ? 'Attended' : 'Present'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {absent.length > 0 && (
        <div className="print-fee-section">
          <h2>Did not join</h2>
          <p className="print-live-absent">{absent.map((student) => student.full_name).join(', ')}</p>
        </div>
      )}

      <div className="print-live-signoff">
        <div><span>Prepared by</span><i /></div>
        <div><span>{audience === 'admin' ? 'Principal / Administrator' : 'Class teacher'}</span><i /></div>
      </div>
    </section>
  );
}
