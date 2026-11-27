import { Printer } from 'lucide-react';
import { formatDay, formatMoney } from '@/lib/fees';
import { buildIncomeStatement, type LedgerEntry } from '@/lib/finance';
import { RangePicker } from '@/components/FinanceRange';
import type { FinanceRangeValue } from '@/lib/financeRange';

export function FinanceIncomeStatementTab({ entries, loading, range }: {
  entries: LedgerEntry[];
  loading: boolean;
  range: FinanceRangeValue;
}) {
  const statement = buildIncomeStatement(entries);
  const surplus = statement.net >= 0;

  return (
    <div className="finance-tab">
      <div className="fin-toolbar">
        <RangePicker range={range} />
        <div className="fin-toolbar-actions">
          <button className="secondary-button" onClick={() => window.print()}><Printer size={15} /> Print statement</button>
        </div>
      </div>

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Total income</span><strong>{formatMoney(statement.totalIncome)}</strong><small>Fees plus other income</small></div></div>
        <div className="fee-kpi coral"><div><span>Total expenses</span><strong>{formatMoney(statement.expenseTotal)}</strong><small>Everything paid out</small></div></div>
        <div className={`fee-kpi ${surplus ? 'mint' : 'sun'}`}><div><span>{surplus ? 'Net surplus' : 'Net deficit'}</span><strong>{formatMoney(Math.abs(statement.net))}</strong><small>{surplus ? 'Income is ahead' : 'Expenses are ahead'}</small></div></div>
      </div>

      <section className="fee-card fin-statement">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Income statement</span>
            <h2>{formatDay(range.from)} — {formatDay(range.to)}</h2>
          </div>
          <span className={`fin-check ${surplus ? 'ok' : 'warn'}`}>{surplus ? 'Surplus' : 'Deficit'}</span>
        </div>

        {loading ? <p className="fee-empty">Working out the statement…</p> : (
          <div className="fin-statement-body">
            <div className="fin-statement-block">
              <h3>Income</h3>
              <div className="fin-statement-row"><span>Fees collected</span><strong>{formatMoney(statement.feeCollected)}</strong></div>
              <div className="fin-statement-row head"><span>Other income</span><strong>{formatMoney(statement.otherIncomeTotal)}</strong></div>
              {statement.otherIncome.length > 0 ? statement.otherIncome.map((row) => (
                <div className="fin-statement-row sub" key={row.name}><span>{row.name}</span><strong>{formatMoney(row.amount)}</strong></div>
              )) : <p className="fin-hint">Nothing recorded in the other income tab for this period.</p>}
              <div className="fin-statement-row total"><span>Total income</span><strong>{formatMoney(statement.totalIncome)}</strong></div>
            </div>

            <div className="fin-statement-block">
              <h3>Expenses</h3>
              {statement.expenseHeads.length > 0 ? statement.expenseHeads.map((row) => (
                <div className="fin-statement-row sub" key={row.name}><span>{row.name}</span><strong>{formatMoney(row.amount)}</strong></div>
              )) : <p className="fin-hint">No expenses recorded for this period.</p>}
              <div className="fin-statement-row total"><span>Total expenses</span><strong>{formatMoney(statement.expenseTotal)}</strong></div>
            </div>

            <div className={`fin-statement-net ${surplus ? 'surplus' : 'deficit'}`}>
              <span>{surplus ? 'Net surplus for the period' : 'Net deficit for the period'}</span>
              <strong>{formatMoney(Math.abs(statement.net))}</strong>
            </div>
          </div>
        )}
      </section>

      <p className="fin-hint no-print">
        Fee money comes from the fee counter receipts for the period, so a change made there shows here immediately.
        Other income and expenses come from their own tabs.
      </p>
    </div>
  );
}
