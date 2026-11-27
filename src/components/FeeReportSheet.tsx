import { Fragment } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import type { FeeReport, FeeReportColumn, FeeReportFilters, FeeReportRow } from '@/lib/feeReports';
import { reportPeriodLabel, reportScopeLabel } from '@/lib/feeReports';

const cell = (row: FeeReportRow, column: FeeReportColumn) => {
  const value = row[column.key];
  if (value === undefined || value === null || value === '') return '—';
  if (column.format === 'money') return `Rs ${Math.round(Number(value) || 0).toLocaleString()}`;
  if (column.format === 'percent') return `${Number(value) || 0}%`;
  if (column.format === 'number') return Number(value).toLocaleString();
  return String(value);
};

// The printable version of whichever report is on screen. It is portalled to the page
// top level while printing, so only the report reaches the printer.
export function FeeReportSheet({ report, filters, schoolName }: {
  report: FeeReport;
  filters: FeeReportFilters;
  schoolName: string;
}) {
  return (
    <section className="print-only print-fee-report" aria-hidden="true">
      <header className="print-header">
        <SchoolLogo alt={`${schoolName} logo`} />
        <div className="print-header-copy">
          <h1>{schoolName}</h1>
          <p>Fee Management — {report.title}</p>
        </div>
        <div className="print-header-admitted">
          <span>Period</span>
          <strong>{reportPeriodLabel(filters)}</strong>
        </div>
      </header>

      <div className="print-report-meta">
        <div><span>Class scope</span><strong>{reportScopeLabel(filters)}</strong></div>
        <div><span>Rows</span><strong>{report.rows.length.toLocaleString()}</strong></div>
        {report.totals?.age90plus !== undefined && (
          <div><span>Stuck over 90 days</span><strong>{`Rs ${Math.round(Number(report.totals.age90plus) || 0).toLocaleString()}`}</strong></div>
        )}
        <div><span>Printed</span><strong>{new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
      </div>

      <p className="print-report-note">{report.note}</p>

      <table className="print-dmc-table print-report-table">
        <thead>
          <tr>
            {report.columns.filter((column) => !column.action).map((column) => (
              <th key={column.key} className={column.format && column.format !== 'text' ? 'text-right' : undefined}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => {
            const classTotal = row.classEnd
              ? report.classTotals?.find((entry) => entry.className === row.classEnd)
              : undefined;
            return (
              <Fragment key={index}>
                <tr>
                  {report.columns.filter((column) => !column.action).map((column) => (
                    <td key={column.key} className={[column.format && column.format !== 'text' ? 'text-right' : '', column.key === 'age90plus' ? 'print-age-old' : ''].filter(Boolean).join(' ') || undefined}>
                      {cell(row, column)}
                    </td>
                  ))}
                </tr>
                {classTotal && (
                  <tr className="print-class-subtotal">
                    {report.columns.filter((column) => !column.action).map((column) => (
                      <td key={column.key} className={column.format && column.format !== 'text' ? 'text-right' : undefined}>
                        {cell(classTotal.totals, column)}
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {report.totals && (
          <tfoot>
            <tr>
              {report.columns.filter((column) => !column.action).map((column) => (
                <td key={column.key} className={column.format && column.format !== 'text' ? 'text-right' : undefined}>
                  {cell(report.totals as FeeReportRow, column)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>

      {report.breakdowns && report.breakdowns.length > 0 && (
        <div className="print-report-splits">
          <p>This period in figures</p>
          <table className="print-dmc-table print-report-split-table">
            <thead>
              <tr><th>Figure</th><th>Students</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {report.breakdowns.map((entry) => (
                <tr key={entry.key}>
                  <td>{entry.label}</td>
                  <td>{entry.lines.length.toLocaleString()}</td>
                  <td className="text-right">{`Rs ${Math.round(entry.total).toLocaleString()}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="print-report-splits-note">{report.breakdowns.find((entry) => entry.key === 'billed')?.note}</p>
        </div>
      )}

      <div className="print-signatures">
        <div className="print-signature"><span>Prepared by</span></div>
        <div className="print-signature"><span>Authorised Signature</span></div>
      </div>
    </section>
  );
}
