import { useMemo, useState } from 'react';
import { Check, RotateCcw, Search, UserRoundX, Users } from 'lucide-react';
import { useClassOptions } from '@/lib/classSections';
import type { Student } from '@/lib/schoolTypes';
import { STUDENT_STATUS_LABELS } from '@/lib/withdrawal';
import { WithdrawStudentModal } from '@/components/WithdrawStudentModal';

type StatusFilter = 'all' | 'roll' | 'left';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All students' },
  { value: 'roll', label: 'On the roll' },
  { value: 'left', label: 'Left the school' },
];

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

const isLeft = (student: Student) => student.status === 'withdrawn' || student.status === 'promoted';

const leavingDateLabel = (student: Student) => text(student.leaving_date).slice(0, 10) || '—';

// The roster the office works from when a student leaves. Selecting a student opens their
// leaving record, which is stored on the student's own profile and is the same record the
// admission form's "Leaving Info" tab shows.
export function WithdrawStudentsPanel({
  students,
  onToast,
  onRefresh,
}: {
  students: Student[];
  onToast: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const classNames = useClassOptions();
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const classesPresent = useMemo(() => {
    const present = new Set(students.map((student) => student.class_name));
    return classNames.filter((option) => present.has(option));
  }, [students, classNames]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((student) => {
      if (classFilter && student.class_name !== classFilter) return false;
      if (statusFilter === 'roll' && isLeft(student)) return false;
      if (statusFilter === 'left' && !isLeft(student)) return false;
      if (!term) return true;
      return `${student.full_name} ${student.admission_number} ${student.section_name ?? ''}`.toLowerCase().includes(term);
    });
  }, [students, classFilter, statusFilter, search]);

  const onRoll = students.filter((student) => !isLeft(student)).length;
  const inactive = students.filter((student) => student.status === 'withdrawn').length;
  const passedOut = students.filter((student) => student.status === 'promoted').length;

  const openStudent = students.find((student) => student.id === openId) ?? null;

  return (
    <div className="withdraw-panel">
      <div className="panel promote-toolbar">
        <div className="promote-toolbar-head">
          <div>
            <span className="eyebrow">Withdraw students</span>
            <h2>{students.length} student{students.length === 1 ? '' : 's'} in the roster</h2>
            <p className="panel-subtitle">
              Open a student's leaving record to mark them Inactive or Pass Out. The SLC serial number, withdrawal
              date, reason, remark, fee paid upto, conduct, progress and attendance summary are all written into the
              Leaving Info section of their admission form, so both screens always show the same record.
            </p>
          </div>
          <span className="promote-session-badge"><UserRoundX size={15} /> {inactive + passedOut} left the school</span>
        </div>
        <div className="promote-toolbar-controls">
          <label className="control-field">Class
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classesPresent.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Show
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="control-field">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student or admission number" />
          </label>
          <button type="button" className="secondary-button" onClick={() => { setClassFilter(''); setStatusFilter('all'); setSearch(''); }}>
            <Search size={15} /> Clear
          </button>
        </div>
      </div>

      <div className="panel promote-list-panel">
        <div className="promote-list-head">
          <div className="promote-list-stats">
            <span className="promote-chip total"><Users size={14} /> {visible.length} shown</span>
            <span className="promote-chip chosen"><Check size={14} /> {onRoll} on the roll</span>
            {inactive > 0 && <span className="promote-chip failed"><UserRoundX size={14} /> {inactive} inactive</span>}
            {passedOut > 0 && <span className="promote-chip out"><RotateCcw size={14} /> {passedOut} passed out</span>}
          </div>
        </div>

        <div className="table-wrap">
          <table className="min-w-[1000px]">
            <thead>
              <tr>
                <th>Student</th>
                <th>Admission no.</th>
                <th>Class</th>
                <th>Status</th>
                <th>Leaving date</th>
                <th>SLC serial no.</th>
                <th className="withdraw-action-head">Leaving record</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((student) => {
                const left = isLeft(student);
                return (
                  <tr key={student.id} className={left ? 'withdraw-row-left' : ''}>
                    <td>
                      <strong>{student.full_name}</strong>
                      <small className="promote-sub">Guardian: {student.guardian_name || '—'}</small>
                    </td>
                    <td className="muted-cell">{student.admission_number}</td>
                    <td>{student.class_name} · {student.section_name ?? '—'}</td>
                    <td>
                      <span className={`withdraw-status-pill ${student.status === 'promoted' ? 'out' : student.status === 'withdrawn' ? 'inactive' : student.status}`}>
                        {STUDENT_STATUS_LABELS[student.status] ?? student.status}
                      </span>
                    </td>
                    <td className="muted-cell">{left ? leavingDateLabel(student) : '—'}</td>
                    <td className="muted-cell">{text(student.slc_serial_number) || '—'}</td>
                    <td className="withdraw-action-cell">
                      <button type="button" className="secondary-button" onClick={() => setOpenId(student.id)}>
                        {left ? <RotateCcw size={15} /> : <UserRoundX size={15} />} {left ? 'View / edit' : 'Withdraw'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="empty-state large">
              No student matches these filters. Try another class, status or search term.
            </div>
          )}
        </div>
      </div>

      {openStudent && (
        <WithdrawStudentModal
          key={openStudent.id}
          student={openStudent}
          onClose={() => setOpenId(null)}
          onToast={onToast}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}
