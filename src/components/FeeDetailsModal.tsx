import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, Wallet, X } from 'lucide-react';
import { FeeHistory } from '@/components/FeeHistory';
import { useFeeTransactions } from '@/lib/useFeeTransactions';
import {
  challanDisplayNumber, fetchChallansForStudent, formatDay, formatMoney, monthLabel,
  type FeeChallan,
} from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';

type FeeMode = 'payment' | 'charge';

const headLabels: { key: keyof FeeChallan; label: string }[] = [
  { key: 'tuition_fee', label: 'Tuition' },
  { key: 'admission_misc', label: 'Admission / misc' },
  { key: 'exam_lab', label: 'Exam / lab' },
  { key: 'transport', label: 'Transport' },
  { key: 'arrears', label: 'Arrears' },
  { key: 'late_fine', label: 'Late fine' },
  { key: 'concession', label: 'Concession' },
];

// The fee tab on a student's record. The figures the office needs — fee heads, total
// payable, challan no., status and due date — all live on the generated challan, so the
// challan is loaded alongside the transaction history. A student whose challans have not
// been generated yet sees that clearly, instead of every number reading zero.
export function FeeDetailsModal({ student, onClose, onRecord }: { student: Student; onClose: () => void; onRecord: (mode: FeeMode) => void }) {
  const { entries, loading, error } = useFeeTransactions(student.id);
  const [challans, setChallans] = useState<FeeChallan[]>([]);
  const [challanLoading, setChallanLoading] = useState(true);
  const [challanError, setChallanError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setChallanLoading(true);
    void fetchChallansForStudent(student.id).then(({ challans: rows, error: fetchError }) => {
      if (cancelled) return;
      setChallanLoading(false);
      if (fetchError) { setChallanError(fetchError); return; }
      setChallans(rows);
    });
    return () => { cancelled = true; };
  }, [student.id]);

  const pending = Number(student.fee_balance);
  const openChallans = useMemo(() => challans.filter((challan) => challan.status !== 'paid'), [challans]);
  const payable = openChallans.reduce((sum, challan) => sum + Number(challan.total), 0);
  const latestChallan = challans[0] ?? null;
  const totalPaid = entries.filter((entry) => entry.kind === 'payment').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const summaryReady = !loading && !error;

  const summaryCards: { label: string; value: string; tone: string }[] = [
    { label: 'Pending balance', value: formatMoney(pending), tone: pending > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700' },
    { label: 'Challans payable', value: formatMoney(payable), tone: payable > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700' },
    { label: 'Total paid', value: summaryReady ? formatMoney(totalPaid) : '—', tone: 'bg-sky-50 text-sky-700' },
  ];

  return (
    <div className="notice-overlay">
      <section className="notice-modal fee-details-modal">
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Fee details</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{student.full_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{student.admission_number} · {student.class_name} · Section {student.section_name}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close fee details"><X size={18} /></button>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {summaryCards.map((card) => (
            <div key={card.label} className={`rounded-xl px-4 py-3 ${card.tone}`}>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">{card.label}</dt>
              <dd className="mt-1 text-lg font-bold">{card.value}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Fee challans</h3>
          {challanLoading && <p className="mt-3 text-sm text-slate-500">Loading fee challans…</p>}
          {challanError && <p className="mt-3 text-sm text-rose-600">{challanError}</p>}
          {!challanLoading && !challanError && challans.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">No fee challan has been generated for this student yet. Generate one from the Fee Management panel.</p>
          )}
          {!challanLoading && !challanError && challans.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Challan no.</th>
                    <th className="px-4 py-3 font-semibold">Fee month</th>
                    <th className="px-4 py-3 font-semibold">Due date</th>
                    <th className="px-4 py-3 text-right font-semibold">Total payable</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {challans.map((challan) => (
                    <tr key={challan.id}>
                      <td className="px-4 py-3 font-mono text-slate-700">{challanDisplayNumber(challan) || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{monthLabel(challan.month)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDay(challan.due_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatMoney(challan.total)}</td>
                      <td className="px-4 py-3">
                        <span className={`fee-status ${challan.status}`}>{challan.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {latestChallan && (
          <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2 text-slate-600">
              <FileSpreadsheet size={16} />
              <h3 className="text-sm font-semibold uppercase tracking-wide">Latest challan breakdown</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {challanDisplayNumber(latestChallan)} · {monthLabel(latestChallan.month)} · due {formatDay(latestChallan.due_date)}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              {headLabels.map(({ key, label }) => {
                const value = Number(latestChallan[key] ?? 0);
                const isConcession = key === 'concession';
                return (
                  <div key={key} className="flex items-center justify-between gap-2 border-b border-slate-200/70 pb-1.5">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className={`font-semibold tabular-nums ${isConcession && value > 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                      {isConcession && value > 0 ? '−' : ''}{formatMoney(value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-4 py-2.5 text-sm">
              <span className="font-semibold text-slate-600">Total fee payable</span>
              <span className="text-lg font-bold text-slate-800 tabular-nums">{formatMoney(latestChallan.total)}</span>
            </div>
          </section>
        )}

        <FeeHistory student={student} entries={entries} loading={loading} error={error} />

        <div className="notice-preview-actions mt-6">
          <button type="button" className="secondary-button" onClick={() => onRecord('charge')}><Plus size={16} /> Add charge</button>
          <button type="button" className="primary-button" onClick={() => onRecord('payment')}><Wallet size={16} /> Collect payment</button>
        </div>
      </section>
    </div>
  );
}
