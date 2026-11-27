import { useState } from 'react';
import { Printer } from 'lucide-react';
import { FeeReceiptModal } from '@/components/FeeReceiptModal';
import type { FeeTransaction, Student } from '@/lib/schoolTypes';

const formatAmount = (value: number) => `Rs ${Number(value).toLocaleString()}`;

export function FeeHistory({ student, entries, loading, error }: { student: Student; entries: FeeTransaction[]; loading: boolean; error: string }) {
  const [receiptEntry, setReceiptEntry] = useState<FeeTransaction | null>(null);

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Fee history</h3>
      {loading && <p className="mt-3 text-sm text-slate-500">Loading fee history…</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">No payments or charges recorded yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 text-right font-semibold">Balance after</th>
                <th className="px-4 py-3 text-right font-semibold no-print"><span className="sr-only">Receipt</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 text-slate-700">{new Date(entry.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.kind === 'payment' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {entry.kind === 'payment' ? 'Payment' : 'Charge'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${entry.kind === 'payment' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {entry.kind === 'payment' ? '−' : '+'}{formatAmount(entry.amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-800">{formatAmount(entry.balance_after)}</td>
                  <td className="px-4 py-3 text-right no-print">
                    <button
                      type="button"
                      onClick={() => setReceiptEntry(entry)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50"
                    >
                      <Printer size={14} /> Print receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {receiptEntry && <FeeReceiptModal student={student} entry={receiptEntry} onClose={() => setReceiptEntry(null)} />}
    </section>
  );
}
