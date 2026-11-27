import { useMemo, useState } from 'react';
import { BellRing, Download, ExternalLink, Send } from 'lucide-react';
import { feeReminderMessage, sendFeeReminders } from '@/lib/feeReminders';
import { downloadCsv, formatDay, formatMoney, toCsv, type FeePayment } from '@/lib/fees';
import { pickWhatsAppContact, resolveWhatsAppNumber, whatsappWebLink, type AlertSendMode } from '@/lib/whatsapp';
import { fetchAbsenteeSendMode, saveAbsenteeSendMode } from '@/lib/absenteeAlerts';
import { WhatsappNumberCell } from '@/components/WhatsappNumberCell';
import type { Student } from '@/lib/schoolTypes';

const SEND_MODE_OPTIONS: { value: AlertSendMode; label: string }[] = [
  { value: 'app', label: 'Desktop App' },
  { value: 'web', label: 'WhatsApp Web' },
  { value: 'wa.me', label: 'WhatsApp Link' },
];

// Fee defaulters: every student with a balance still owing, sorted by the amount, with
// a reminder they can be sent through the school's existing WhatsApp route. The message
// is logged before it is sent, so a failed send is still visible in the SMS report.
export function AccountantDefaulters({ students, payments, month, today, onToast, onCollect, onRefresh }: {
  students: Student[];
  payments: FeePayment[];
  month: string;
  today: string;
  onToast: (message: string) => void;
  onCollect: (studentId: string) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [minDue, setMinDue] = useState('');
  const [sendingId, setSendingId] = useState('');
  const [preview, setPreview] = useState<Student | null>(null);
  const [queue, setQueue] = useState<{ studentName: string; phone: string; link: string; message: string }[]>([]);
  const [copied, setCopied] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendMode, setSendMode] = useState<AlertSendMode>('web');

  useMemo(() => { void fetchAbsenteeSendMode().then((mode) => setSendMode(mode)); }, []);

  const classList = useMemo(() => Array.from(new Set(students.map((student) => student.class_name))).sort(), [students]);
  const sectionList = useMemo(() => Array.from(new Set(
    students.filter((student) => !classFilter || student.class_name === classFilter).map((student) => student.section_name),
  )).sort(), [students, classFilter]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const floor = Number(minDue || 0);
    const lastPaymentFor = (studentId: string): { date: string; amount: number } | null => payments
      .filter((payment) => payment.student_id === studentId && !payment.voided)
      .reduce<{ date: string; amount: number } | null>((latest, payment) => {
        if (!latest || payment.payment_date > latest.date) return { date: payment.payment_date, amount: Number(payment.amount) };
        return latest;
      }, null);
    return students
      .filter((student) => Number(student.fee_balance ?? 0) > 0)
      .filter((student) => !classFilter || student.class_name === classFilter)
      .filter((student) => !sectionFilter || student.section_name === sectionFilter)
      .filter((student) => Number(student.fee_balance ?? 0) >= floor)
      .filter((student) => !needle || `${student.full_name} ${student.admission_number} ${student.guardian_phone}`.toLowerCase().includes(needle))
      .map((student) => ({ student, due: Math.max(0, Number(student.fee_balance ?? 0)), lastPayment: lastPaymentFor(student.id) }))
      .sort((a, b) => b.due - a.due);
  }, [students, classFilter, sectionFilter, search, minDue, payments]);

  const totalDue = rows.reduce((total, row) => total + row.due, 0);
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.student.id));
  const selectedCount = rows.filter((row) => selected.has(row.student.id)).length;

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(rows.map((row) => row.student.id)));
    else setSelected(new Set());
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pickSendMode = (mode: AlertSendMode) => {
    setSendMode(mode);
    void saveAbsenteeSendMode(mode);
  };

  // The row shows the resolved number, which may come from a brother or sister, so the
  // send uses the same number the office can see rather than the raw student field.
  const run = async (targets: Student[]) => {
    if (targets.length === 0) return;
    const prepared = targets.map((student) => {
      const resolved = resolveWhatsAppNumber(student, students);
      return resolved.number ? { ...student, whatsapp_number: resolved.number } : student;
    });
    const result = await sendFeeReminders(prepared, month, today);
    if (result.error) { onToast(result.error); return; }
    if (result.queue.length > 0) setQueue(result.queue);
    const parts = result.sent > 0
      ? [`${result.sent} fee reminder${result.sent === 1 ? '' : 's'} opened in WhatsApp.`]
      : [`${result.queue.length} fee reminder${result.queue.length === 1 ? '' : 's'} queued.`];
    if (result.skipped > 0) parts.push(`${result.skipped} skipped — check the saved contact numbers.`);
    if (result.sent > 0 && result.queue.length > 0) parts.push(`${result.queue.length} queued — use the links below to open them.`);
    else if (result.queue.length > 0) parts.push('Use the links below to open them in WhatsApp.');
    onToast(parts.join(' '));
  };

  const runSelected = async () => {
    const targets = rows.filter((row) => selected.has(row.student.id)).map((row) => row.student);
    if (targets.length === 0) return;
    setSendingId('batch');
    await run(targets);
    setSendingId('');
    setSelected(new Set());
  };

  const exportList = () => {
    const rowsCsv: (string | number | null)[][] = [
      ['Student', 'Admission no.', 'Class', 'Section', 'Guardian', 'WhatsApp no.', 'Due amount', 'Last payment amount', 'Last payment date'],
      ...rows.map((row) => [row.student.full_name, row.student.admission_number, row.student.class_name, row.student.section_name, row.student.guardian_name, pickWhatsAppContact(row.student).number, row.due, row.lastPayment?.amount ?? null, row.lastPayment?.date ?? null]),
    ];
    downloadCsv('fee-defaulters.csv', toCsv(rowsCsv));
    onToast(`${rows.length} defaulters exported`);
  };

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Follow-up</span><h2>{rows.length} students · {formatMoney(totalDue)} pending</h2></div>
          <div className="fee-quick">
            <button className="secondary-button" onClick={exportList}><Download size={15} /> Export list</button>
            <button
              className="primary-button"
              onClick={() => void runSelected()}
              disabled={sendingId !== '' || selectedCount === 0}
            >
              <Send size={15} /> {sendingId === 'batch' ? 'Sending…' : `Send Selected (${selectedCount})`}
            </button>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter(''); }}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Section</span>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="">All sections</option>
              {sectionList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Minimum due (Rs)</span>
            <input type="number" min="0" step="1" value={minDue} onChange={(event) => setMinDue(event.target.value)} placeholder="Any amount" />
          </label>
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, admission no. or phone" />
          </label>
        </div>
        <div className="fee-quick">
          <div className="segmented-control compact fee-sendmode">
            {SEND_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={sendMode === option.value ? 'selected' : ''}
                onClick={() => pickSendMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="fee-card">
        {rows.length === 0 ? (
          <p className="fee-empty">Every student in this filter has cleared their dues. Nothing to follow up.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="fee-check-col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleAll(event.target.checked)}
                      aria-label="Select all students"
                    />
                  </th>
                  <th>Student</th>
                  <th>Class</th>
                  <th className="text-right">Due amount</th>
                  <th>Last payment</th>
                  <th>WhatsApp no.</th>
                  <th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.student.id} className={selected.has(row.student.id) ? 'fee-row-selected' : ''}>
                    <td className="fee-check-col">
                      <input
                        type="checkbox"
                        checked={selected.has(row.student.id)}
                        onChange={() => toggleOne(row.student.id)}
                        aria-label={`Select ${row.student.full_name}`}
                      />
                    </td>
                    <td><strong>{row.student.full_name}</strong><small className="fee-sub">{row.student.admission_number} · Guardian {row.student.guardian_name || '—'}</small></td>
                    <td>{row.student.class_name} · {row.student.section_name}</td>
                    <td className="text-right font-semibold tabular-nums text-rose-600">{formatMoney(row.due)}</td>
                    <td>{row.lastPayment ? `${formatMoney(row.lastPayment.amount)} · ${formatDay(row.lastPayment.date)}` : 'No payment yet'}</td>
                    <td><WhatsappNumberCell student={row.student} family={students} onSaved={onRefresh} onToast={onToast} /></td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => setPreview(row.student)}><BellRing size={14} /> Preview</button>
                        <button type="button" className="fee-link" onClick={() => onCollect(row.student.id)}>Collect</button>
                        <button type="button" className="fee-link" onClick={async () => { setSendingId(row.student.id); await run([row.student]); setSendingId(''); }} disabled={sendingId !== ''}>
                          <Send size={14} /> {sendingId === row.student.id ? 'Sending…' : 'Remind'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {queue.length > 0 && (
        <div className="notice-overlay" onClick={() => setQueue([])}>
          <section className="notice-modal fee-blocked-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">WhatsApp reminder queue</span>
              <button className="close-button" onClick={() => setQueue([])} aria-label="Close">×</button>
            </div>
            <p className="fee-blocked-intro">Click <strong>Open WhatsApp App</strong> to launch the installed WhatsApp desktop app. If that does not work, use <strong>Open WhatsApp Web</strong> to open it in a browser tab instead.</p>
            <ul className="fee-blocked-list">
              {queue.map((row) => (
                <li key={row.phone + row.studentName}>
                  <div className="fee-blocked-row">
                    <strong>{row.studentName}</strong>
                    <small>{row.phone}</small>
                  </div>
                  <div className="fee-blocked-actions">
                    <a className="primary-button" href={row.link} rel="noopener noreferrer">
                      <Send size={14} /> Open WhatsApp App
                    </a>
                    <a className="ghost-button" href={whatsappWebLink(row.phone, row.message)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} /> WhatsApp Web
                    </a>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        navigator.clipboard?.writeText(row.message).then(() => {
                          setCopied(row.phone + row.studentName);
                          setTimeout(() => setCopied(''), 2000);
                        }).catch(() => {});
                      }}
                    >
                      {copied === row.phone + row.studentName ? 'Copied!' : 'Copy message'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={() => setQueue([])}>Done</button>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="notice-overlay" onClick={() => setPreview(null)}>
          <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">Fee reminder preview</span>
              <button className="close-button" onClick={() => setPreview(null)} aria-label="Close">×</button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-800">{preview.full_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{preview.class_name} · Section {preview.section_name} · {formatMoney(Math.max(0, Number(preview.fee_balance ?? 0)))} due</p>
            <pre className="acct-reminder-preview">{feeReminderMessage(preview, Math.max(0, Number(preview.fee_balance ?? 0)), month)}</pre>
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={() => setPreview(null)}>Close</button>
              <button className="primary-button" onClick={async () => { setSendingId(preview.id); await run([preview]); setSendingId(''); setPreview(null); }} disabled={sendingId !== ''}>
                <Send size={15} /> Send reminder
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
