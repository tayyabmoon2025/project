import { SchoolLogo } from '@/components/SchoolLogo';
import { SCHOOL_NAME } from '@/lib/noticeText';
import type { UtilityReportCard, UtilityReportModel } from '@/lib/utilityReports';

// The sheet every one of the eleven utility reports is printed on. It is deliberately
// plain: usePrintSheet portals it to <body>, so whatever is rendered here is the whole
// printed page and nothing else. The same markup is shown in the preview modal, so what
// the office sees on screen is exactly what comes out of the printer.
export function UtilityReportSheet({ card, model }: { card: UtilityReportCard; model: UtilityReportModel }) {
  const landscape = card.paper === 'A4 landscape';
  const empty = model.sections.every((section) => section.rows.length === 0);

  return (
    <article className="report-sheet">
      <header className="report-sheet-head">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="report-sheet-logo" />
        <div className="report-sheet-head-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>{model.title}</p>
        </div>
        <div className="report-sheet-issued">
          <span>Printed</span>
          <strong>{new Date().toLocaleDateString()}</strong>
          <span>{landscape ? 'A4 landscape' : 'A4'}</span>
        </div>
      </header>

      <div className="report-sheet-meta">
        <span><b>Scope:</b> {model.subtitle}</span>
        <span><b>Filters:</b> {model.filters.join('  ·  ')}</span>
      </div>

      <div className="report-sheet-kpis">
        {model.kpis.map((kpi) => (
          <div key={kpi.label} className="report-sheet-kpi">
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
          </div>
        ))}
      </div>

      {empty && <p className="report-empty-note">No records were found for these filters, so the sheet has nothing to list.</p>}

      {model.sections.map((section, sectionIndex) => (
        <section key={`${section.title ?? 'section'}-${sectionIndex}`} className="report-sheet-section">
          {section.title && <h2 className="report-sheet-table-title">{section.title}</h2>}
          {section.rows.length === 0 ? (
            <p className="report-empty-note">Nothing to list in this part of the report.</p>
          ) : (
            <table className="report-sheet-table">
              <thead>
                <tr>{section.head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
              </thead>
              <tbody>
                {section.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={cellIndex === 0 && typeof cell === 'number' ? 'report-num' : ''}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {section.foot && (
                <tfoot>
                  <tr>{section.foot.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
                </tfoot>
              )}
            </table>
          )}
        </section>
      ))}

      {model.notes.length > 0 && (
        <div className="report-sheet-notes">
          {model.notes.map((note, index) => <p key={index}>{note}</p>)}
        </div>
      )}

      <div className="report-sheet-sign-row">
        <div className="report-sheet-signature">
          <strong>Prepared by</strong>
          <span>Office / class teacher</span>
        </div>
        <div className="report-sheet-signature">
          <strong>Principal</strong>
          <span>{SCHOOL_NAME}</span>
        </div>
      </div>
    </article>
  );
}
