import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CalendarDays, Paperclip, RefreshCw, Search } from 'lucide-react';
import { formatDisplayDate } from '@/lib/classOffDays';
import { todayKey } from '@/lib/attendance';
import {
  COMPLETION_LABELS,
  COMPLETION_TONES,
  fetchPortalHomework,
  type HomeworkCompletionStatus,
  type PortalHomeworkEntry,
  type PortalHomeworkPayload,
} from '@/lib/homework';

// The homework diary a parent or a student reads. It shows only published work
// for the records linked to the signed-in account, and the database holds the
// work back entirely while a fee balance is pending.
export function PortalHomeworkPanel({ title }: { title?: string }) {
  const [payload, setPayload] = useState<PortalHomeworkPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentFilter, setStudentFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await fetchPortalHomework();
      if (!active) return;
      setPayload(result.payload);
      setError(result.error);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const students = useMemo(() => payload?.students ?? [], [payload]);
  const entries = useMemo(() => payload?.entries ?? [], [payload]);

  // Only the subjects that actually appear in the diary are offered, so the list
  // never shows a subject with nothing behind it.
  const subjects = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.subject_name))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (studentFilter) {
        const student = students.find((row) => row.id === studentFilter);
        if (!student || entry.class_name !== student.class_name || entry.section_name !== student.section_name) return false;
      }
      if (subjectFilter && entry.subject_name !== subjectFilter) return false;
      if (!needle) return true;
      return [entry.subject_name, entry.title, entry.details ?? '', entry.assigned_by_name ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, students, studentFilter, subjectFilter, search]);

  const todays = useMemo(() => filtered.filter((entry) => entry.homework_date === todayKey()), [filtered]);
  const upcoming = useMemo(
    () => filtered.filter((entry) => entry.due_date && entry.due_date >= todayKey()).slice(0, 6),
    [filtered],
  );

  const hasFilters = Boolean(studentFilter || subjectFilter || search.trim());

  const statusFor = (entry: PortalHomeworkEntry): { status: HomeworkCompletionStatus; remarks: string | null } | null => {
    const relevant = studentFilter
      ? entry.completions.filter((row) => row.student_id === studentFilter)
      : entry.completions;
    if (relevant.length === 0) return null;
    return { status: relevant[0].status, remarks: relevant[0].remarks };
  };

  if (loading) {
    return (
      <section className="panel parent-notices-panel">
        <p className="empty-state large">Loading the homework diary…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel parent-notices-panel">
        <div className="panel-header">
          <div><span className="eyebrow">Homework</span><h2>{title ?? 'Homework diary'}</h2></div>
          <BookOpenCheck size={20} />
        </div>
        <p className="dmc-warning">{error}</p>
      </section>
    );
  }

  // While a fee balance is pending the diary is withheld, exactly as exam results
  // are. The reason is stated plainly rather than the screen simply looking empty.
  if (payload?.blocked) {
    const due = Number(payload.due_amount ?? 0);
    return (
      <section className="panel parent-notices-panel hw-blocked-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Homework</span>
            <h2>Homework is on hold</h2>
          </div>
          <BookOpenCheck size={20} />
        </div>
        <div className="hw-blocked">
          <strong>Pending fee balance</strong>
          <p>
            There is an outstanding fee balance of Rs. {due.toLocaleString()} on this account, so the homework diary and
            exam results are held back. Please clear the dues at the school office and the diary will appear again
            straight away.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel parent-notices-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Homework</span>
          <h2>{title ?? 'Homework diary'}</h2>
          <p className="panel-subtitle">
            Every published assignment for {students.length > 1 ? 'your children' : 'this record'}, newest first. A draft
            stays with the teacher until it is published.
          </p>
        </div>
        <BookOpenCheck size={20} />
      </div>

      {entries.length > 0 && (
        <div className="fee-filters hw-portal-filters">
          {students.length > 1 && (
            <label className="control-field">
              <span>Show</span>
              <select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}>
                <option value="">All children</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>{student.full_name} · {student.class_name}-{student.section_name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="control-field">
            <span>Subject</span>
            <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
              <option value="">All subjects</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>
          <label className="control-field hw-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, subject or teacher" />
          </label>
          {(studentFilter || subjectFilter || search.trim()) && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => { setStudentFilter(''); setSubjectFilter(''); setSearch(''); }}
            >
              <RefreshCw size={15} /> Clear filters
            </button>
          )}
          {hasFilters && (
            <span className="hw-filter-count">{filtered.length} of {entries.length} shown</span>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="empty-state">
          No homework has been published yet. New assignments appear here the day the teacher publishes them.
        </p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">
          No assignment matches these filters. Choose All subjects or clear the search to see the whole diary.
        </p>
      ) : (
        <>
          <div className="hw-portal-stats">
            <div className="hw-summary"><span>Today</span><strong>{todays.length}</strong></div>
            <div className="hw-summary"><span>Showing</span><strong>{filtered.length}</strong></div>
            <div className="hw-summary"><span>Coming up</span><strong>{upcoming.length}</strong></div>
          </div>

          <ul className="hw-portal-list">
            {filtered.slice(0, 40).map((entry) => {
              const marked = statusFor(entry);
              return (
                <li className="hw-portal-item" key={entry.id}>
                  <div className="hw-portal-item-head">
                    <div>
                      <strong>{entry.subject_name} — {entry.title}</strong>
                      <span>
                        {entry.class_name} · Section {entry.section_name} · Set {formatDisplayDate(entry.homework_date)}
                        {entry.due_date ? ` · Hand in by ${formatDisplayDate(entry.due_date)}` : ''}
                      </span>
                    </div>
                    {marked ? (
                      <span className={`fee-status ${COMPLETION_TONES[marked.status]}`}>{COMPLETION_LABELS[marked.status]}</span>
                    ) : (
                      <span className="fee-status neutral">New</span>
                    )}
                  </div>
                  {entry.details && <p className="hw-portal-detail">{entry.details}</p>}
                  <div className="hw-portal-foot">
                    <span><CalendarDays size={13} /> {entry.assigned_by_name ? `Set by ${entry.assigned_by_name}` : 'Set by the school'}</span>
                    {entry.attachment_url && (
                      <a href={entry.attachment_url} target="_blank" rel="noreferrer">
                        <Paperclip size={13} /> Open the attached worksheet
                      </a>
                    )}
                  </div>
                  {marked?.remarks && <p className="hw-portal-remark">Teacher's note: {marked.remarks}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
