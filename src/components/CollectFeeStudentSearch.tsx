import { useEffect, useMemo, useState } from 'react';
import { Search, UserSearch, X } from 'lucide-react';
import { resolveWhatsAppNumber } from '@/lib/whatsapp';
import {
  COLLECT_CLASS_OPTIONS, COLLECT_CRITERIA_OPTIONS, COLLECT_STATUS_OPTIONS,
  filterCollectStudents, isActiveStudent, studentStatusLabel, type CollectClassFilter,
  type CollectCriteria, type CollectStatusFilter,
} from '@/lib/collectFeeSearch';
import type { Student } from '@/lib/schoolTypes';

// The counter's own student search. Deliberately narrow: it filters the roster already in
// memory, so the list and the record count update as the counter types, and a click hands
// the student straight back to the Collect Fee form.
export function CollectFeeStudentSearch({ roster, onSelect, onClose }: {
  roster: Student[];
  onSelect: (student: Student) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<CollectStatusFilter>('active');
  const [classMode, setClassMode] = useState<CollectClassFilter>('all');
  const [className, setClassName] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [criteria, setCriteria] = useState<CollectCriteria>('name');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const classList = useMemo(() => Array.from(new Set(roster.map((student) => student.class_name).filter(Boolean))).sort(), [roster]);
  const sectionList = useMemo(() => Array.from(new Set(
    roster
      .filter((student) => !className || student.class_name === className)
      .map((student) => student.section_name)
      .filter(Boolean),
  )).sort(), [roster, className]);

  const results = useMemo(
    () => filterCollectStudents(roster, { status, classMode, className, sectionName, criteria, term }),
    [roster, status, classMode, className, sectionName, criteria, term],
  );

  const activeHint = COLLECT_STATUS_OPTIONS.find((option) => option.value === status)?.hint ?? '';
  const placeholder = COLLECT_CRITERIA_OPTIONS.find((option) => option.value === criteria)?.placeholder ?? '';

  const clearAll = () => {
    setStatus('active');
    setClassMode('all');
    setClassName('');
    setSectionName('');
    setCriteria('name');
    setTerm('');
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal fee-student-search" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow"><UserSearch size={13} /> Collect fee</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">Search Student</h2>
            <p className="fee-sub">{activeHint}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close search"><X size={18} /></button>
        </div>

        <div className="wa-search-filters">
          <div className="fee-form-group">
            <p className="fee-form-group-label">Status</p>
            <div className="segmented-control compact">
              {COLLECT_STATUS_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={status === option.value ? 'selected' : ''} onClick={() => setStatus(option.value)}>{option.label}</button>
              ))}
            </div>
          </div>

          <div className="fee-form-group">
            <p className="fee-form-group-label">Class filter</p>
            <div className="segmented-control compact">
              {COLLECT_CLASS_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={classMode === option.value ? 'selected' : ''} onClick={() => { setClassMode(option.value); if (option.value === 'all') { setClassName(''); setSectionName(''); } }}>{option.label}</button>
              ))}
            </div>
            {classMode !== 'all' && (
              <div className="fee-filters">
                <label className="control-field"><span>Class</span>
                  <select value={className} onChange={(event) => { setClassName(event.target.value); setSectionName(''); }}>
                    <option value="">All classes</option>
                    {classList.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                {classMode === 'classSection' && (
                  <label className="control-field"><span>Section</span>
                    <select value={sectionName} onChange={(event) => setSectionName(event.target.value)}>
                      <option value="">All sections</option>
                      {sectionList.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="fee-form-group">
            <p className="fee-form-group-label">Search criteria</p>
            <div className="segmented-control compact">
              {COLLECT_CRITERIA_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={criteria === option.value ? 'selected' : ''} onClick={() => setCriteria(option.value)}>{option.label}</button>
              ))}
            </div>
            <div className="fee-scan-field">
              <Search size={17} />
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                autoFocus
                aria-label={COLLECT_CRITERIA_OPTIONS.find((option) => option.value === criteria)?.label}
              />
            </div>
          </div>
        </div>

        <div className="wa-search-count">
          <strong>{results.length}</strong>
          <span>{results.length === 1 ? 'student matches' : 'students match'} these filters</span>
          <button type="button" className="secondary-button" onClick={clearAll}>Clear filters</button>
        </div>

        {results.length === 0 ? (
          <p className="fee-empty">No student matches these filters. Try choosing All for status, widening the class filter, or clearing the text.</p>
        ) : (
          <div className="table-wrap wa-search-table">
            <table>
              <thead>
                <tr>
                  <th>Admission No.</th>
                  <th>Student Name</th>
                  <th>Father Name</th>
                  <th>Class-Section</th>
                  <th>Status</th>
                  <th>Contact / WhatsApp No.</th>
                </tr>
              </thead>
              <tbody>
                {results.map((student) => {
                  const contact = resolveWhatsAppNumber(student, roster);
                  return (
                    <tr
                      key={student.id}
                      className="wa-search-row"
                      tabIndex={0}
                      role="button"
                      title={`Load ${student.full_name} into the Collect Fee form`}
                      onClick={() => onSelect(student)}
                      onDoubleClick={() => onSelect(student)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(student); } }}
                    >
                      <td className="fee-mono">{student.admission_number}</td>
                      <td><strong>{student.full_name}</strong></td>
                      <td>{student.fathers_name || student.guardian_name || '—'}</td>
                      <td>{student.class_name}{student.section_name ? ` · ${student.section_name}` : ''}</td>
                      <td><span className={`wa-status ${isActiveStudent(student) ? 'active' : 'inactive'}`}>{studentStatusLabel(student)}</span></td>
                      <td>
                        {contact.number
                          ? <><span className="wa-number">{contact.display}</span><small className="wa-source">{contact.borrowed ? `From ${contact.siblingName ?? 'a sibling'}'s record` : contact.source}</small></>
                          : <span className="wa-none">No WhatsApp no.</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
