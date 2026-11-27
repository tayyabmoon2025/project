import { IDENTIFIER_MODES, type IdentifierMode } from '@/lib/studentRoll';

// A small segmented selector used on the marks sheets to choose whether the first
// column and the search box work by roll number, admission number, or both.
export function IdentifierModeToggle({ value, onChange }: { value: IdentifierMode; onChange: (next: IdentifierMode) => void }) {
  return (
    <div className="identifier-toggle" role="group" aria-label="Enter marks by">
      <span className="identifier-toggle-label">Enter marks by</span>
      <div className="segmented-control compact">
        {IDENTIFIER_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={value === mode.id ? 'selected' : ''}
            aria-pressed={value === mode.id}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
