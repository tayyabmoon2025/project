import { Info, Loader as Loader2, MessageSquareQuote, RotateCcw, Save } from 'lucide-react';

// The Teacher's Remarks editor on a single report card. It sits between the marks and
// the print buttons, so the wording can be adjusted and then printed in one place.
//
// The text is controlled by the parent because the printed sheet reads the same value:
// whatever is in this box is exactly what appears in the Teacher's Remarks box on the
// A4 report card.
export function ReportCardRemarkEditor({
  value,
  sourceLabel,
  modified,
  hasOverride,
  saving,
  error,
  onChange,
  onSave,
  onReset,
}: {
  value: string;
  sourceLabel: string;
  modified: boolean;
  hasOverride: boolean;
  saving: boolean;
  error: string | null;
  onChange: (next: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="report-remark-editor">
      <div className="report-remark-head">
        <span className="eyebrow"><MessageSquareQuote size={14} /> Teacher's remarks</span>
        <span className="report-remark-source">{sourceLabel}</span>
      </div>
      <textarea
        value={value}
        rows={3}
        maxLength={300}
        onChange={(event) => onChange(event.target.value)}
        placeholder="The remark to print on this report card"
        aria-label="Teacher's remarks for this report card"
      />
      {error && <p className="dmc-warning">{error}</p>}
      <div className="report-remark-actions">
        <span className="report-remark-count">{value.trim().length}/300</span>
        {(modified || hasOverride) && (
          <button type="button" className="secondary-button" onClick={onReset} disabled={saving}>
            <RotateCcw size={14} /> Reset to Bank Remark
          </button>
        )}
        <button type="button" className="primary-button" onClick={onSave} disabled={saving || value.trim().length < 3 || !modified}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save for this student
        </button>
      </div>
      <p className="report-remark-hint">
        <Info size={13} />
        Left untouched, this card follows the Grade Remarks Bank — editing the bank changes it here straight away. Saving keeps
        your wording for this student only, and resetting puts the bank remark back.
      </p>
    </div>
  );
}
