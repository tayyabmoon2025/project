import { X, Users } from 'lucide-react';
import { formatMoney } from '@/lib/fees';
import type { FeeReportBreakdown } from '@/lib/feeReports';

// A footer total on the Fee Trail is a sum, and this is where that sum is shown to be
// one: every student who contributed to it, with their share and the number of entries
// that built it, biggest first. It is read-only, so it cannot change any fee record.
export function FeeReportBreakdownModal({ breakdown, period, scope, onClose }: {
  breakdown: FeeReportBreakdown;
  period: string;
  scope: string;
  onClose: () => void;
}) {
  const lines = breakdown.lines;
  const entries = lines.reduce((sum, line) => sum + line.events, 0);
  const largest = lines.reduce((max, line) => Math.max(max, Math.abs(line.amount)), 0) || 1;

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section
        className="notice-modal fee-breakdown-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${breakdown.label} — students behind this total`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="notice-preview-top">
          <span className="eyebrow"><Users size={14} /> Fee Trail · {breakdown.label}</span>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h2 className={`fee-breakdown-total ${breakdown.total < 0 ? 'fee-negative' : ''}`}>{formatMoney(breakdown.total)}</h2>
        <p className="fee-breakdown-when">{period} · {scope}</p>
        <p className="fee-breakdown-note">{breakdown.note}</p>

        {lines.length === 0 ? (
          <p className="fee-empty">No student contributed to this total in the period.</p>
        ) : (
          <>
            <p className="fee-breakdown-count">
              {lines.length} student{lines.length === 1 ? '' : 's'} · {entries} entr{entries === 1 ? 'y' : 'ies'}
            </p>
            <div className="table-wrap fee-breakdown-table">
              <table>
                <thead>
                  <tr>
                    <th>Admission no.</th>
                    <th>Student</th>
                    <th className="text-right">Entries</th>
                    <th className="text-right">Amount</th>
                    <th aria-label="Share of the total" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={`${line.admission}-${line.student}`}>
                      <td className="fee-mono">{line.admission}</td>
                      <td>{line.student}</td>
                      <td className="text-right tabular-nums">{line.events}</td>
                      <td className={`text-right tabular-nums ${line.amount < 0 ? 'fee-negative' : ''}`}>{formatMoney(line.amount)}</td>
                      <td className="fee-breakdown-share">
                        <span
                          className={`fee-breakdown-bar ${line.amount < 0 ? 'down' : ''}`}
                          style={{ width: `${Math.max(4, Math.round((Math.abs(line.amount) / largest) * 100))}%` }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="fee-total-row">
                    <td>Total</td>
                    <td>{lines.length} student{lines.length === 1 ? '' : 's'}</td>
                    <td className="text-right tabular-nums">{entries}</td>
                    <td className={`text-right tabular-nums ${breakdown.total < 0 ? 'fee-negative' : ''}`}>{formatMoney(breakdown.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
