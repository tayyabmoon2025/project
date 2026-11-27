import { useEffect, useRef, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Printer, X } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { usePrintSheet } from '@/lib/usePrintSheet';
import type { FamilyLedger } from '@/lib/familyLedger';
import { statementChildName, statementDate, statementMoney, type FamilyStatementInfo } from '@/lib/familyStatement';

const money = (value: number) => `Rs ${statementMoney(value).toLocaleString()}`;

const detailRows = (info: FamilyStatementInfo): [string, string][] => [
  ['Guardian', info.guardianName || '—'],
  ['Contact number', info.guardianPhone || '—'],
  ['CNIC', info.guardianCnic || '—'],
  ['Prepared for', info.preparedFor || '—'],
  ['Statement date', statementDate()],
];

// A formal statement of the whole family's fees, ready to print or save as a PDF for the
// parents. It carries the same figures as the on-screen ledger.
export function FamilyFeeStatementModal({ ledger, info, onClose }: { ledger: FamilyLedger; info: FamilyStatementInfo; onClose: () => void }) {
  const printedRef = useRef(false);
  const [logoSettled, setLogoSettled] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);

  const printSheet = usePrintSheet(true, (
    <section className="print-only print-family-statement" aria-hidden="true">
      <div className="print-sheet-page">
        <header className="print-header">
          <SchoolLogo alt={`${SCHOOL_NAME} logo`} onLoad={() => setLogoSettled(true)} />
          <div className="print-header-copy">
            <h1>{SCHOOL_NAME}</h1>
            <p>Family Fee Statement</p>
          </div>
          <div className="print-header-badge">
            <div>
              <span>Statement date</span>
              <strong>{statementDate()}</strong>
            </div>
            <div>
              <span>Children</span>
              <strong>{ledger.rows.length}</strong>
            </div>
          </div>
        </header>

        <section className="print-card print-card-statement-party">
          <h2>Statement For</h2>
          <div className="print-other-grid">
            {detailRows(info).map(([label, value]) => (
              <div className="print-row" key={label}>
                <span className="print-row-label">{label}</span>
                <span className="print-row-value">{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="print-card print-card-statement-table">
          <h2>Charges and Balances</h2>
          <table className="print-statement-table">
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>Student</th>
                <th>Class</th>
                <th className="text-right">Tuition</th>
                <th className="text-right">Concession</th>
                <th className="text-right">Sibling</th>
                <th className="text-right">Net tuition</th>
                <th className="text-right">Monthly</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row) => (
                <tr key={row.key}>
                  <td className="text-center">{row.siblingOrder}</td>
                  <td>
                    <strong>{statementChildName(row)}</strong>
                    {row.admissionNumber && <small className="print-statement-sub">{row.admissionNumber}</small>}
                  </td>
                  <td>{row.className || '—'}</td>
                  <td className="text-right">{money(row.tuition)}</td>
                  <td className="text-right">{row.concession > 0 ? `− ${money(row.concession)}` : '—'}</td>
                  <td className="text-right">
                    {row.siblingDiscount > 0 ? `− ${money(row.siblingDiscount)}` : '—'}
                    {row.discountPercentage > 0 && <small className="print-statement-sub">{row.discountPercentage}%</small>}
                  </td>
                  <td className="text-right">{money(row.netTuition)}</td>
                  <td className="text-right">{money(row.monthlyCharge)}</td>
                  <td className="text-right">{money(row.outstanding)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Family total</strong></td>
                <td className="text-right">{money(ledger.totalTuition)}</td>
                <td className="text-right">{ledger.totalConcession > 0 ? `− ${money(ledger.totalConcession)}` : '—'}</td>
                <td className="text-right">{ledger.totalSiblingDiscount > 0 ? `− ${money(ledger.totalSiblingDiscount)}` : '—'}</td>
                <td />
                <td className="text-right">{money(ledger.totalMonthly)}</td>
                <td className="text-right">{money(ledger.totalOutstanding)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="print-statement-note">
            Monthly is the tuition after the concession and sibling discount, plus admission / misc, exam and lab, and
            transport for the class. Balance is the amount still payable to the school as at the statement date.
          </p>
        </section>

        <section className="print-statement-total">
          <div>
            <span>Total payable by the family</span>
            <strong>{money(ledger.totalOutstanding)}</strong>
          </div>
          <div>
            <span>Total monthly charges</span>
            <strong>{money(ledger.totalMonthly)}</strong>
          </div>
        </section>

        <div className="print-sign-space" aria-hidden="true" />

        <div className="print-signatures">
          <div className="print-signature"><span>Parent / Guardian Signature</span></div>
          <div className="print-signature"><span>Authorised Signature</span></div>
        </div>
      </div>
    </section>
  ));

  useEffect(() => {
    if (!autoPrint || !logoSettled || printedRef.current) return;
    printedRef.current = true;
    window.print();
  }, [autoPrint, logoSettled]);

  return (
    <div className="notice-overlay">
      <section className="notice-modal print-family-statement-modal">
        <div className="notice-preview-top">
          <div className="flex items-center gap-4">
            <SchoolLogo alt={`${SCHOOL_NAME} logo`} className="h-14 w-14 object-contain" />
            <div>
              <span className="eyebrow">Family fee statement</span>
              <h2 className="mt-1 text-xl font-bold text-slate-800">{SCHOOL_NAME}</h2>
            </div>
          </div>
          <button className="close-button no-print" onClick={onClose} aria-label="Close statement"><X size={18} /></button>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          {detailRows(info).map(([label, value]) => (
            <div key={label} className="border-b border-slate-100 pb-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Student</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Class</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Tuition</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Concession</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Sibling</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-800">{statementChildName(row)}</td>
                  <td className="px-3 py-2 text-slate-600">{row.className || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(row.tuition)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.concession > 0 ? `− ${money(row.concession)}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{row.siblingDiscount > 0 ? `− ${money(row.siblingDiscount)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{money(row.monthlyCharge)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.outstanding > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {row.outstanding > 0 ? money(row.outstanding) : 'Clear'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-3 py-2 font-semibold text-slate-700" colSpan={5}>Family total</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{money(ledger.totalMonthly)}</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${ledger.totalOutstanding > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {ledger.totalOutstanding > 0 ? money(ledger.totalOutstanding) : 'Clear'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="notice-preview-actions mt-6 no-print">
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => { setAutoPrint(true); if (logoSettled) window.print(); }}>
            <Printer size={16} /> Print statement
          </button>
        </div>
      </section>
      {printSheet}
    </div>
  );
}
