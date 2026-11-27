import { CalendarRange, RotateCcw } from 'lucide-react';
import type { FeeReportFilters } from '@/lib/feeReports';
import type { Student } from '@/lib/schoolTypes';

// The From / To / Class / Section bar every fee report shares, so one period and one
// class scope drive every report on the tab.
export function FeeReportControls({ filters, onChange, students, loading, onRefresh }: {
  filters: FeeReportFilters;
  onChange: (patch: Partial<FeeReportFilters>) => void;
  students: Student[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const classList = Array.from(new Set(students.map((student) => student.class_name).filter(Boolean) as string[])).sort();
  const sectionList = Array.from(new Set(
    students
      .filter((student) => !filters.className || student.class_name === filters.className)
      .map((student) => student.section_name)
      .filter(Boolean) as string[],
  )).sort();

  return (
    <div className="fee-report-filters">
      <label className="control-field"><span>From date</span>
        <input type="date" value={filters.from} onChange={(event) => onChange({ from: event.target.value })} />
      </label>
      <label className="control-field"><span>To date</span>
        <input type="date" value={filters.to} onChange={(event) => onChange({ to: event.target.value })} />
      </label>
      <label className="control-field"><span>Class</span>
        <select value={filters.className} onChange={(event) => onChange({ className: event.target.value, section: '' })}>
          <option value="">All classes</option>
          {classList.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="control-field"><span>Section</span>
        <select value={filters.section} onChange={(event) => onChange({ section: event.target.value })}>
          <option value="">All sections</option>
          {sectionList.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className="fee-filter-reset">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onChange({ className: '', section: '' })}
          disabled={!filters.className && !filters.section}
        >
          <RotateCcw size={15} /> Reset scope
        </button>
      </div>
      <div className="fee-report-scope">
        <CalendarRange size={14} />
        <span>{loading ? 'Loading the period…' : 'Every report below uses this period and class scope.'}</span>
        <button type="button" className="fee-link" onClick={onRefresh} disabled={loading}>Refresh</button>
      </div>
    </div>
  );
}
