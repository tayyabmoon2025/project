import { Printer } from 'lucide-react';
import { formatDay, formatMoney } from '@/lib/fees';
import { trialBalance, type LedgerEntry } from '@/lib/finance';
import { RangePicker } from '@/components/FinanceRange';
import type { FinanceRangeValue } from '@/lib/financeRange';

export function FinanceTrialBalanceTab({ entries, loading, range }: {
  entries: LedgerEntry[];
  loading: boolean;
  range: FinanceRangeValue;
}) {
  const { rows, totalDebit, totalCredit, difference } = trialBalance(entries);
  const balanced = Math.abs(difference) < 1;

  return (
    <div className="finance-tab">
      <div className="fin-toolbar">
        <RangePicker range={range} />
        <div className="fin-toolbar-actions">
          <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </div>

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Total debit</span><strong>{formatMoney(totalDebit)}</strong><small>All money in, by head</small></div></div>
        <div className="fee-kpi coral"><div><span>Total credit</span><strong>{formatMoney(totalCredit)}</strong><small>All money out, by head</small></div></div>
        <div className={`fee-kpi ${balanced ? 'mint' : 'sun'}`}><div><span>Difference</span><strong>{formatMoney(difference)}</strong><small>{balanced ? 'The books balance' : 'Check the heads below'}</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Trial balance</span>
            <h2>{formatDay(range.from)} — {formatDay(range.to)}</h2>
            <p className="fee-hint mt-1">Every head used in the period with its total debit, total credit and net balance.</p>
          </div>
          <span className={`fin-check ${balanced ? 'ok' : 'warn'}`}>{balanced ? 'Balanced' : 'Out by ' + formatMoney(Math.abs(difference))}</span>
        </div>

        {loading ? <p className="fee-empty">Building the trial balance…</p> : rows.length === 0 ? (
          <p className="fee-empty">No money has been recorded for this period yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Head</th><th>Type</th>
                  <th className="text-right">Total debit</th><th className="text-right">Total credit</th>
                  <th className="text-right">Net balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.name}</strong></td>
                    <td><span className={`fin-kind ${row.accountType === 'income' ? 'mint' : 'coral'}`}>{row.accountType === 'income' ? 'Income' : 'Expense'}</span></td>
                    <td className="text-right tabular-nums text-emerald-700">{row.debit > 0 ? formatMoney(row.debit) : '—'}</td>
                    <td className="text-right tabular-nums text-rose-600">{row.credit > 0 ? formatMoney(row.credit) : '—'}</td>
                    <td className={`text-right font-semibold tabular-nums ${row.balance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fee-total-row">
                  <td colSpan={2}>Totals</td>
                  <td className="text-right">{formatMoney(totalDebit)}</td>
                  <td className="text-right">{formatMoney(totalCredit)}</td>
                  <td className="text-right">{formatMoney(totalDebit - totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="fin-hint no-print">
        In this school ledger a debit is money received and a credit is money paid out, so a head with a positive
        balance has brought money in and a head with a negative balance has cost money. The difference line compares
        the two totals: when the difference is nil every rupee has been accounted for.
      </p>    </div>
  );
}
