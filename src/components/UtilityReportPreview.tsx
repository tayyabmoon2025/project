import { Download, Printer, X } from 'lucide-react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { UtilityReportSheet } from '@/components/UtilityReportSheet';
import { downloadCsv } from '@/lib/fees';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { SCHOOL_NAME } from '@/lib/noticeText';
import {
  utilityReportCsv,
  utilityReportFileName,
  type UtilityReportCard,
  type UtilityReportModel,
} from '@/lib/utilityReports';

// The preview an office user opens before anything is printed or downloaded. The sheet
// shown here is the same component that goes to the printer, so the preview is never a
// rough approximation of the paper that comes out.
export function UtilityReportPreview({
  card,
  model,
  onClose,
  onToast,
}: {
  card: UtilityReportCard;
  model: UtilityReportModel;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const landscape = card.paper === 'A4 landscape';
  const empty = model.sections.every((section) => section.rows.length === 0);

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-report-sheet">
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 8mm; }`}</style>
      <UtilityReportSheet card={card} model={model} />
    </section>
  ));

  const exportCsv = () => {
    downloadCsv(utilityReportFileName(card.id, model), utilityReportCsv(model));
    onToast('The report was exported as a CSV file.');
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal report-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Printer size={14} /> Print preview — {landscape ? 'A4 landscape' : 'A4'}</span>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">{model.title}</h2>
        <p className="payroll-modal-sub">{model.subtitle}</p>

        <div className="util-report-preview-meta">
          {model.kpis.map((kpi) => (
            <span key={kpi.label}><b>{kpi.value}</b> {kpi.label}</span>
          ))}
        </div>

        {empty && (
          <p className="report-preview-warning">
            Nothing matches the filters you chose, so this sheet would print empty. Clear a filter above and open the report again.
          </p>
        )}

        <div className="report-preview-scroll">
          <UtilityReportSheet card={card} model={model} />
        </div>

        <div className="report-preview-actions">
          <button type="button" className="primary-button" onClick={() => window.print()}>
            <Printer size={16} /> Print on letterhead
          </button>
          <button type="button" className="secondary-button" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
        </div>

        <p className="util-report-preview-foot">
          <SchoolLogo alt="" className="util-report-preview-logo" />
          <span>Printed on the {SCHOOL_NAME} letterhead. The filters set on the Reports tab are carried into both the print and the CSV file.</span>
        </p>

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        </div>
      </section>
      {printSheet}
    </div>
  );
}
