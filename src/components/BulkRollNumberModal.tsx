import { useMemo, useState } from 'react';
import { CircleAlert as AlertCircle, Hash, Loader as Loader2, ListOrdered, Users, X } from 'lucide-react';
import { useClassOptions, useSectionOptions, withCurrent } from '@/lib/classSections';
import {
  ROLL_SORT_ORDERS,
  ROLL_START_CHOICES,
  bulkAssignRollNumbers,
  nextRollNumber,
  rollLabel,
  sortForRollAssignment,
  type RollSortOrder,
} from '@/lib/studentRoll';
import type { Student } from '@/lib/schoolTypes';

// Offers the whole class a clean run of roll numbers in one go. Nothing is written until
// the office has looked at the preview and pressed Confirm, because re-sequencing
// overwrites whatever numbers are already there.
export function BulkRollNumberModal({
  students,
  defaultClassName = '',
  onClose,
  onToast,
  onSaved,
}: {
  students: Student[];
  defaultClassName?: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const classNames = useClassOptions();
  const sectionNames = useSectionOptions();

  const [className, setClassName] = useState(defaultClassName);
  const [sectionName, setSectionName] = useState('');
  const [order, setOrder] = useState<RollSortOrder>('name');
  const [startInput, setStartInput] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classOptions = useMemo(() => withCurrent(classNames, className), [classNames, className]);
  const sectionOptions = useMemo(() => ['All sections', ...withCurrent(sectionNames, sectionName)], [sectionNames, sectionName]);

  const start = Number(startInput);
  const validStart = Number.isInteger(start) && start >= 1 && start <= 9999;
  const width = validStart ? Math.max(2, String(start).length) : 2;

  const roster = useMemo(
    () => sortForRollAssignment(
      students.filter((student) => (
        student.status === 'active'
        && student.class_name === className
        && (!sectionName || student.section_name === sectionName)
      )),
      order,
    ),
    [students, className, sectionName, order],
  );

  // What each student's number will become, shown next to what it is now so a change can
  // be spotted before it is saved.
  const preview = useMemo(
    () => roster.map((student, index) => ({
      student,
      next: validStart ? nextRollNumber(start, index, width) : '',
    })),
    [roster, start, width, validStart],
  );

  const changedCount = preview.filter((row) => rollLabel(row.student) !== row.next).length;

  const apply = async () => {
    if (!className) { setError('Choose the class you want to number.'); return; }
    if (!validStart) { setError('The starting number must be between 1 and 9999.'); return; }
    if (preview.length === 0) { setError('No active student is enrolled in this class.'); return; }
    setSaving(true);
    setError(null);
    const result = await bulkAssignRollNumbers(className, sectionName, preview.map((row) => row.student.id), start);
    if (result.error) { setSaving(false); setError(result.error); return; }
    await onSaved();
    setSaving(false);
    onToast(`${result.assigned} ${result.assigned === 1 ? 'student' : 'students'} in ${className} re-numbered from ${nextRollNumber(start, 0, width)}`);
    onClose();
  };

  return (
    <div className="notice-overlay">
      <section className="notice-preview bulk-roll-modal">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Students · Roll numbers</span>
            <h2 className="mt-2 text-lg font-bold text-slate-800">Bulk assign / re-sequence roll numbers</h2>
            <p className="mt-1 text-sm text-slate-600">Number a whole class in one go. Nothing is saved until you confirm the preview.</p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close roll number tool"><X size={18} /></button>
        </div>

        <div className="bulk-roll-controls">
          <label className="control-field">Class
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">Choose a class…</option>
              {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Section
            <select value={sectionName || 'All sections'} onChange={(event) => setSectionName(event.target.value === 'All sections' ? '' : event.target.value)}>
              {sectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Sorting order
            <select value={order} onChange={(event) => setOrder(event.target.value as RollSortOrder)}>
              {ROLL_SORT_ORDERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="control-field">Starting number
            <input
              type="number"
              min="1"
              max="9999"
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
            />
          </label>
        </div>

        <div className="bulk-roll-starts">
          <span>Quick start</span>
          {ROLL_START_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`bulk-roll-chip${Number(startInput) === choice ? ' active' : ''}`}
              onClick={() => setStartInput(String(choice))}
            >
              <Hash size={13} /> {nextRollNumber(choice, 0, Math.max(2, String(choice).length))}
            </button>
          ))}
        </div>

        <div className="bulk-roll-summary">
          <span><Users size={14} /> {preview.length} {preview.length === 1 ? 'student' : 'students'} selected</span>
          <span><ListOrdered size={14} /> {changedCount} {changedCount === 1 ? 'number will change' : 'numbers will change'}</span>
        </div>

        {error && <p className="dmc-warning"><AlertCircle size={13} /> {error}</p>}

        <div className="bulk-roll-table-wrap">
          <table className="bulk-roll-table">
            <thead>
              <tr>
                <th>Student name</th>
                <th>Admission no.</th>
                <th>Current roll no.</th>
                <th>New roll no.</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => {
                const current = rollLabel(row.student);
                const changes = current !== row.next;
                return (
                  <tr key={row.student.id} className={changes ? 'bulk-roll-row-changed' : ''}>
                    <td>{row.student.full_name}</td>
                    <td className="muted-cell">{row.student.admission_number}</td>
                    <td className="muted-cell">{current}</td>
                    <td><span className={`bulk-roll-new${changes ? ' changed' : ''}`}>{row.next}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview.length === 0 && (
            <div className="empty-state large">
              {className ? `No active student is enrolled in ${className}${sectionName ? ` · Section ${sectionName}` : ''}.` : 'Choose a class to see the students who will be numbered.'}
            </div>
          )}
        </div>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void apply()}
            disabled={saving || preview.length === 0 || !validStart}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ListOrdered size={15} />}
            {saving ? 'Applying…' : 'Confirm & Apply'}
          </button>
        </div>
      </section>
    </div>
  );
}
