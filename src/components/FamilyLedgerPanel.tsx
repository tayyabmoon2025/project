import { useState } from 'react';
import { Download, FileText, Users } from 'lucide-react';
import type { FamilyLedger } from '@/lib/familyLedger';
import { downloadCsv } from '@/lib/fees';
import { FamilyFeeStatementModal } from '@/components/FamilyFeeStatementModal';
import { familyStatementCsv, familyStatementFilename, type FamilyStatementInfo } from '@/lib/familyStatement';

const money = (value: number) => `Rs ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const headClass = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const headClassRight = `${headClass} text-right`;

// The family's combined fee position, shown beside the sibling discount so the office can
// see at a glance what the whole family is charged and what they still owe before saving.
export function FamilyLedgerPanel({ ledger, familyLabel, statementInfo, onToast }: { ledger: FamilyLedger; familyLabel: string; statementInfo: FamilyStatementInfo; onToast: (message: string) => void }) {
  const [statementOpen, setStatementOpen] = useState(false);

  const download = () => {
    downloadCsv(familyStatementFilename(statementInfo), familyStatementCsv(ledger, statementInfo));
    onToast('Family fee statement downloaded.');
  };

  return (
    <section className="col-span-full overflow-hidden rounded-xl border border-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users size={17} className="text-slate-600" />
          <div>
            <strong className="block text-sm text-slate-800">Family fee ledger</strong>
            <span className="text-xs text-slate-500">{familyLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="secondary-button" onClick={() => setStatementOpen(true)}>
            <FileText size={15} /> Fee statement
          </button>
          <button type="button" className="secondary-button" onClick={download}>
            <Download size={15} /> Download CSV
          </button>
          <div className="text-right">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Family total per month</span>
            <strong className="text-base tabular-nums text-slate-800">{money(ledger.totalMonthly)}</strong>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={headClass}>Child</th>
              <th className={headClass}>Class</th>
              <th className={headClassRight}>Tuition</th>
              <th className={headClassRight}>Concession</th>
              <th className={headClassRight}>Sibling</th>
              <th className={headClassRight}>Net tuition</th>
              <th className={headClassRight}>Monthly</th>
              <th className={headClassRight}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => (
              <tr key={row.key} className={`border-b border-slate-100 last:border-0 ${row.isCandidate ? 'bg-sky-50/70' : ''}`}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">#{row.siblingOrder}</span>
                    <span className="text-slate-800">{row.name || 'New student'}</span>
                    {row.isCandidate && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">This form</span>}
                  </span>
                  {row.admissionNumber && <span className="block pl-6 text-xs text-slate-400">{row.admissionNumber}</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.className || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(row.tuition)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.concession > 0 ? `− ${money(row.concession)}` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                  {row.siblingDiscount > 0 ? `− ${money(row.siblingDiscount)}` : '—'}
                  {row.discountPercentage > 0 && <span className="block text-xs text-emerald-600">{row.discountPercentage}%</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800">{money(row.netTuition)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{money(row.monthlyCharge)}</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.outstanding > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {row.outstanding > 0 ? money(row.outstanding) : 'Clear'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-semibold text-slate-700" colSpan={2}>{ledger.rows.length} children in this family</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-700">{money(ledger.totalTuition)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-700">{ledger.totalConcession > 0 ? `− ${money(ledger.totalConcession)}` : '—'}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{ledger.totalSiblingDiscount > 0 ? `− ${money(ledger.totalSiblingDiscount)}` : '—'}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{money(ledger.totalMonthly)}</td>
              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${ledger.totalOutstanding > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {ledger.totalOutstanding > 0 ? money(ledger.totalOutstanding) : 'Clear'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
        Monthly is the tuition after the concession and sibling discount, plus admission / misc, exam and lab, and transport
        for the class. Outstanding is what the family still owes the school today. The sibling discount follows the
        Brothers and sisters rules in Fee Structure.
      </p>

      {statementOpen && <FamilyFeeStatementModal ledger={ledger} info={statementInfo} onClose={() => setStatementOpen(false)} />}
    </section>
  );
}
