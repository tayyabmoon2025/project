import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BellRing, Coins, ExternalLink, FileSpreadsheet, FileText, RefreshCw, ScanLine, Send, UserSearch, Wallet, X,
} from 'lucide-react';
import { DeleteVoucherModal } from '@/components/DeleteVoucherModal';
import { CollectFeeStudentSearch } from '@/components/CollectFeeStudentSearch';
import { FeeReceiptView } from '@/components/FeeDocuments';
import { FeeVoucherList } from '@/components/FeeVoucherList';
import { ChallanTab, ReportsTab, StructureTab } from '@/components/FeeSetupTabs';
import { fetchAbsenteeSendMode } from '@/lib/absenteeAlerts';
import { todayKey } from '@/lib/attendance';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { queueSmsMessages, updateSmsStatus } from '@/lib/smsLog';
import type { Student } from '@/lib/schoolTypes';
import { useAuth } from '@/lib/auth';
import { useClassOptions } from '@/lib/classSections';
import {
  EMPTY_PAYMENT_SETTINGS, PAYMENT_METHODS, autoRemarks, collectedInMonth, collectedOn, fetchChallans,
  fetchFeePayments, fetchFeeStructures, fetchPaymentSettings, formatDay, formatMoney, lookupFeeChallan, monthKey,
  monthLabel, monthOptions, payableFee, recordFeePayment, updateFeeVoucher,
  type FeeChallan, type FeePayment, type FeeStructure, type PaymentMethod, type PaymentSettings,
} from '@/lib/fees';
import { pickWhatsAppContact, whatsappLink, whatsappWebLink, whatsappNumberWarning, type AlertSendMode } from '@/lib/whatsapp';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { supabase } from '@/lib/supabase';
import type { NoticeContext } from '@/lib/sentNotices';
import { AdjustmentTab, LedgerTab, OpeningBalanceTab, SiblingsTab } from '@/components/FeeManagementTabs';
import { ConcessionApprovalPanel } from '@/components/ConcessionApprovalPanel';

export type FeeTab =
  | 'overview' | 'generate' | 'collect' | 'outstanding' | 'adjustment'
  | 'siblings' | 'ledger' | 'structure' | 'opening' | 'reports' | 'approvals';

const TABS: { id: FeeTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'generate', label: 'Generate Fee' },
  { id: 'collect', label: 'Collect Fee' },
  { id: 'outstanding', label: 'Outstanding Fee' },
  { id: 'adjustment', label: 'Fee Adjustment' },
  { id: 'siblings', label: 'Brother & Sister' },
  { id: 'ledger', label: 'Students Fee Ledger' },
  { id: 'structure', label: 'Fee Structure' },
  { id: 'opening', label: 'Fee Opening Balance' },
  { id: 'reports', label: 'Reports' },
  { id: 'approvals', label: 'Approvals' },
];

function reminderMessage(student: Student, due: number, month: string) {
  return [
    SCHOOL_NAME,
    `Fee reminder — ${monthLabel(month)}`,
    `Dear Parent, the fee account for ${student.full_name} (${student.class_name} · Section ${student.section_name}) has an outstanding balance of ${formatMoney(due)}.`,
    'Kindly clear the dues at the school office at your earliest convenience. Thank you.',
  ].join('\n');
}

function KpiCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`fee-kpi ${tone}`}>
      <div className="fee-kpi-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export function FeeManagementPanel({ students, onToast, onRefresh, initialTab = 'overview', onSendNotice }: {
  students: Student[];
  onToast: (message: string) => void;
  onRefresh: () => Promise<void>;
  initialTab?: FeeTab;
  // Opens the shared Send Student Notice window with the fee wording already chosen.
  onSendNotice?: (student: Student, context: NoticeContext) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [tab, setTab] = useState<FeeTab>(initialTab);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [challans, setChallans] = useState<FeeChallan[]>([]);
  const [challanMonth, setChallanMonth] = useState(monthKey());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [sendMode, setSendMode] = useState<AlertSendMode>('web');
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(EMPTY_PAYMENT_SETTINGS);

  const today = todayKey();
  const currentMonth = monthKey();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [structureResult, paymentResult, settingsResult] = await Promise.all([
        fetchFeeStructures(), fetchFeePayments(400), fetchPaymentSettings(),
      ]);
      if (cancelled) return;
      setStructures(structureResult.structures);
      setPayments(paymentResult.payments);
      setPaymentSettings(settingsResult.settings);
      setLoadError(structureResult.error ?? paymentResult.error ?? settingsResult.error ?? '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    void fetchChallans(challanMonth).then(({ challans: rows, error }) => {
      if (cancelled) return;
      if (error) setLoadError(error);
      else setChallans(rows);
    });
    return () => { cancelled = true; };
  }, [challanMonth, reloadToken]);

  useEffect(() => {
    void fetchAbsenteeSendMode().then((mode) => { if (mode) setSendMode(mode); });
  }, []);

  const reload = () => setReloadToken((token) => token + 1);
  const refreshEverything = async () => { reload(); await onRefresh(); };

  const activeStudents = useMemo(() => students.filter((student) => student.status === 'active'), [students]);
  const classNames = useClassOptions();
  // Every class the school runs, in the school's own order, with any class a student
  // still carries but the list has dropped added on the end so a record is never
  // unreachable from the filter.
  const classList = useMemo(() => {
    const present = activeStudents.map((student) => student.class_name);
    return [...classNames, ...present.filter((name) => !classNames.includes(name))];
  }, [classNames, activeStudents]);
  const sectionsFor = (className: string) => Array.from(new Set(
    activeStudents.filter((student) => !className || student.class_name === className).map((student) => student.section_name),
  )).sort();

  const pendingDues = activeStudents.reduce((total, student) => total + Math.max(0, Number(student.fee_balance ?? 0)), 0);
  const defaulterCount = activeStudents.filter((student) => Number(student.fee_balance ?? 0) > 0).length;
  const collectedToday = collectedOn(payments, today);
  const monthlyCollection = collectedInMonth(payments, currentMonth);

  const lastPaymentFor = (studentId: string): { date: string; amount: number } | null => payments
    .filter((payment) => payment.student_id === studentId && !payment.voided)
    .reduce<{ date: string; amount: number } | null>((latest, payment) => {
      if (!latest || payment.payment_date > latest.date) return { date: payment.payment_date, amount: Number(payment.amount) };
      return latest;
    }, null);

  const [reminderQueue, setReminderQueue] = useState<{ studentName: string; phone: string; link: string; message: string }[]>([]);

  // One reminder can be sent from a row; the batch button sends to everyone on screen.
  // Only the first student's WhatsApp opens immediately; the rest are queued as
  // clickable links so the browser does not block a barrage of pop-ups. Portal
  // notifications are created for every student regardless of the WhatsApp outcome.
  const sendReminders = async (targets: Student[]) => {
    if (targets.length === 0) return;
    let sent = 0;
    let skipped = 0;
    const queue: { studentName: string; phone: string; link: string; message: string }[] = [];
    let firstOpened = false;
    for (const student of targets) {
      const contact = pickWhatsAppContact(student);
      if (!contact.number) { skipped += 1; continue; }
      const due = Math.max(0, Number(student.fee_balance ?? 0));
      const body = reminderMessage(student, due, currentMonth);
      const { ids, error } = await queueSmsMessages([{
        student_id: student.id,
        student_name: student.full_name,
        class_name: student.class_name,
        section_name: student.section_name,
        parent_phone: contact.number,
        message_type: 'fee_reminder',
        message_body: body,
        attendance_date: today,
      }]);
      if (error) { onToast(error); return; }
      try {
        await supabase.rpc('create_fee_reminder_notification', {
          p_student_id: student.id,
          p_due_amount: due,
          p_reminder_date: today,
        });
      } catch { /* portal notification is convenience, not a gate */ }
      if (!firstOpened) {
        const result = openWhatsAppChat(contact.number, body, sendMode);
        if (result.ok) {
          sent += 1;
          await updateSmsStatus(ids, 'sent', `WhatsApp opened (${sendMode})`);
          firstOpened = true;
        } else {
          await updateSmsStatus(ids, 'pending', 'Queued — open from the reminder list');
          queue.push({ studentName: student.full_name, phone: contact.number, link: result.link, message: body });
        }
      } else {
        const link = whatsappLink(contact.number, body, sendMode);
        await updateSmsStatus(ids, 'pending', 'Queued — open from the reminder list');
        queue.push({ studentName: student.full_name, phone: contact.number, link, message: body });
      }
    }
    if (queue.length > 0) setReminderQueue(queue);
    const parts = sent > 0
      ? [`${sent} fee reminder${sent === 1 ? '' : 's'} opened in WhatsApp.`]
      : [`${queue.length} fee reminder${queue.length === 1 ? '' : 's'} queued.`];
    if (skipped > 0) parts.push(`${skipped} skipped — check the saved contact numbers.`);
    if (sent > 0 && queue.length > 0) parts.push(`${queue.length} queued — use the links below to open them.`);
    else if (queue.length > 0) parts.push('Use the links below to open them in WhatsApp.');
    onToast(parts.join(' '));
  };

  return (
    <div className="fee-panel">
      <div className="fee-tabs" role="tablist">
        {TABS.filter((entry) => entry.id !== 'approvals' || isAdmin).map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={`fee-tab ${tab === entry.id ? 'on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="fee-alert">
          <span>{loadError}</span>
          <button className="secondary-button" onClick={reload}><RefreshCw size={15} /> Try again</button>
        </div>
      )}

      {tab === 'overview' && (
        <OverviewTab
          loading={loading}
          collectedToday={collectedToday}
          monthlyCollection={monthlyCollection}
          pendingDues={pendingDues}
          defaulterCount={defaulterCount}
          currentMonth={currentMonth}
          payments={payments}
          onCollect={() => setTab('collect')}
          onChallan={() => setTab('generate')}
          onDefaulters={() => setTab('outstanding')}
        />
      )}

      {tab === 'generate' && (
        <ChallanTab
          students={activeStudents}
          structures={structures}
          classList={classList}
          sectionsFor={sectionsFor}
          month={challanMonth}
          setMonth={setChallanMonth}
          savedChallans={challans}
          paymentSettings={paymentSettings}
          onToast={onToast}
          onSaved={reload}
        />
      )}

      {tab === 'collect' && (
        <CollectionTab
          students={activeStudents}
          roster={students}
          payments={payments}
          loading={loading}
          today={today}
          onToast={onToast}
          onSaved={refreshEverything}
        />
      )}

      {tab === 'outstanding' && (
        <DefaultersTab
          students={activeStudents}
          classList={classList}
          sectionsFor={sectionsFor}
          challans={challans}
          challanMonth={challanMonth}
          setChallanMonth={setChallanMonth}
          lastPaymentFor={lastPaymentFor}
          onSend={sendReminders}
          sendMode={sendMode}
          onSendModeChange={setSendMode}
          reminderQueue={reminderQueue}
          onClearQueue={() => setReminderQueue([])}
          onSendNotice={onSendNotice}
        />
      )}

      {tab === 'adjustment' && (
        <AdjustmentTab students={activeStudents} onToast={onToast} onSaved={refreshEverything} />
      )}

      {tab === 'siblings' && (
        <SiblingsTab
          students={activeStudents}
          onSend={sendReminders}
          sendMode={sendMode}
          onSendModeChange={setSendMode}
          onToast={onToast}
          onRefresh={onRefresh}
        />
      )}

      {tab === 'ledger' && (
        <LedgerTab
          students={activeStudents}
          structures={structures}
          payments={payments}
          loading={loading}
          onToast={onToast}
          onCollect={() => setTab('collect')}
        />
      )}

      {tab === 'structure' && (
        <StructureTab structures={structures} isAdmin={isAdmin} paymentSettings={paymentSettings} onToast={onToast} onSaved={reload} />
      )}

      {tab === 'opening' && (
        <OpeningBalanceTab students={activeStudents} onToast={onToast} onSaved={refreshEverything} />
      )}

      {tab === 'reports' && (
        <ReportsTab
          payments={payments}
          challans={challans}
          students={activeStudents}
          pendingDues={pendingDues}
          roster={students}
          today={today}
          onToast={onToast}
          onOpenAdjustments={() => setTab('adjustment')}
          isAdmin={isAdmin}
          approverName={profile?.full_name ?? 'Principal'}
          onResolved={refreshEverything}
        />
      )}

      {tab === 'approvals' && isAdmin && (
        <ConcessionApprovalPanel
          students={students}
          approverName={profile?.full_name ?? 'Principal'}
          onToast={onToast}
          onResolved={refreshEverything}
        />
      )}
    </div>
  );
}

function OverviewTab({ loading, collectedToday, monthlyCollection, pendingDues, defaulterCount, currentMonth, payments, onCollect, onChallan, onDefaulters }: {
  loading: boolean;
  collectedToday: number;
  monthlyCollection: number;
  pendingDues: number;
  defaulterCount: number;
  currentMonth: string;
  payments: FeePayment[];
  onCollect: () => void;
  onChallan: () => void;
  onDefaulters: () => void;
}) {
  const recent = payments.slice(0, 6);
  return (
    <div className="fee-section">
      <div className="fee-kpi-grid">
        <KpiCard label="Collected today" value={loading ? '—' : formatMoney(collectedToday)} detail="Receipts issued today" tone="mint" icon={<Coins size={20} />} />
        <KpiCard label="Monthly collection" value={loading ? '—' : formatMoney(monthlyCollection)} detail={monthLabel(currentMonth)} tone="sky" icon={<Wallet size={20} />} />
        <KpiCard label="Pending dues" value={loading ? '—' : formatMoney(pendingDues)} detail="Across all active students" tone="sun" icon={<FileSpreadsheet size={20} />} />
        <KpiCard label="Defaulter students" value={loading ? '—' : String(defaulterCount)} detail="With a balance above zero" tone="coral" icon={<BellRing size={20} />} />
      </div>

      <div className="fee-quick">
        <button className="primary-button" onClick={onCollect}><Coins size={16} /> Collect Fee</button>
        <button className="secondary-button" onClick={onChallan}><FileSpreadsheet size={16} /> Generate Challan</button>
        <button className="secondary-button" onClick={onDefaulters}><BellRing size={16} /> View defaulters</button>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Latest activity</span><h2>Recent fee transactions</h2></div>
        </div>
        {loading ? <p className="fee-empty">Loading transactions…</p> : recent.length === 0 ? (
          <p className="fee-empty">No fee payments have been recorded yet. Use Collect Fee to issue the first receipt.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Receipt</th><th>Student</th><th>Class</th><th>Method</th><th className="text-right">Amount</th><th className="text-right">Balance after</th><th>Date</th></tr></thead>
              <tbody>
                {recent.map((payment) => (
                  <tr key={payment.id}>
                    <td className="fee-mono">{payment.receipt_number}</td>
                    <td><strong>{payment.student_name}</strong></td>
                    <td>{payment.class_name ?? '—'} · {payment.section_name ?? '—'}</td>
                    <td className="capitalize">{payment.method}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                    <td className="text-right tabular-nums">{formatMoney(payment.balance_after)}</td>
                    <td>{formatDay(payment.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type VoucherForm = {
  dueFee: string;
  fine: string;
  concession: string;
  discount: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  receiptNumber: string;
  remarks: string;
};

const emptyVoucher = (today: string): VoucherForm => ({
  dueFee: '', fine: '', concession: '', discount: '', amount: '',
  method: 'cash', paymentDate: today, receiptNumber: '', remarks: '',
});

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// The counter screen. One code gets the student on screen with their due fee already
// filled in; the calculation updates as the counter types; and every voucher submitted in
// the month is listed underneath to correct, delete or reprint.
function CollectionTab({ students, roster, payments, loading, today, onToast, onSaved }: {
  students: Student[];
  roster: Student[];
  payments: FeePayment[];
  loading: boolean;
  today: string;
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [studentId, setStudentId] = useState('');
  const [challanNumber, setChallanNumber] = useState('');
  const [form, setForm] = useState<VoucherForm>(() => emptyVoucher(today));
  const [remarksTouched, setRemarksTouched] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<FeePayment | null>(null);
  const [reprinting, setReprinting] = useState<FeePayment | null>(null);
  const [deleting, setDeleting] = useState<FeePayment | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const focusLookup = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  // The counter can only look up an active student, but the Search Student modal also
  // covers students who have left. A row picked there is handed straight to loadStudent.
  const student = students.find((row) => row.id === studentId) ?? roster.find((row) => row.id === studentId) ?? null;

  const dueFee = toNumber(form.dueFee);
  const fine = toNumber(form.fine);
  const concession = toNumber(form.concession);
  const discount = toNumber(form.discount);
  const paid = toNumber(form.amount);
  const payable = payableFee(dueFee, fine, concession, discount);
  const remaining = Math.max(0, payable - paid);

  // The remark follows the figures until the counter edits it, after which their wording
  // is kept as typed.
  useEffect(() => {
    if (remarksTouched) return;
    setForm((current) => ({ ...current, remarks: autoRemarks(payable, paid, remaining) }));
  }, [payable, paid, remaining, remarksTouched]);

  const set = (patch: Partial<VoucherForm>) => setForm((current) => ({ ...current, ...patch }));

  const loadStudent = (row: Student, due: number, challan: string) => {
    setStudentId(row.id);
    setChallanNumber(challan);
    setCode(row.admission_number);
    setForm({ ...emptyVoucher(today), dueFee: due > 0 ? String(Math.round(due)) : '' });
    setRemarksTouched(false);
    setEditingId('');
    setError('');
    focusLookup();
  };

  // An admission number finds the student straight away; anything else is handed to the
  // database, which understands challan numbers and scanned codes too.
  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { setError('Enter or scan an admission number or challan number first.'); return; }

    setLooking(true);
    setError('');

    // Try the roster first: an exact admission number match is the fastest path and avoids
    // a round trip. Digits-only ("2401" for "SD-2401") is accepted too, so a counter who
    // skips the prefix still lands on the student.
    const lowerTrimmed = trimmed.toLowerCase();
    const digitsOnly = trimmed.replace(/\D/g, '');
    const byAdmission = students.find(
      (row) => (row.admission_number ?? '').toLowerCase() === lowerTrimmed
        || (digitsOnly && (row.admission_number ?? '').replace(/\D/g, '') === digitsOnly),
    );
    if (byAdmission) {
      setLooking(false);
      loadStudent(byAdmission, Math.max(0, Number(byAdmission.fee_balance ?? 0)), '');
      return;
    }

    // Anything else — a challan number, a barcode, or an admission number for a student
    // not on the active roster — is resolved by the database, which understands every
    // form a code can take.
    const result = await lookupFeeChallan(trimmed);
    setLooking(false);
    if (result.error || !result.challan) {
      setStudentId('');
      setError(result.error ?? 'No student or challan matches that code.');
      return;
    }

    const found = roster.find((row) => row.id === result.challan?.student_id);
    if (!found) {
      setError('That challan belongs to a student who is not on the school roll.');
      return;
    }
    loadStudent(found, result.challan.remaining, result.challan.challan_number ?? '');
  };

  // A student chosen in the Search Student modal closes it and fills the form with their
  // pending dues already in place.
  const pickSearchedStudent = (row: Student) => {
    setSearchOpen(false);
    loadStudent(row, Math.max(0, Number(row.fee_balance ?? 0)), '');
    onToast(`${row.full_name} loaded into the Collect Fee form.`);
  };

  const startEdit = (payment: FeePayment) => {
    const row = students.find((item) => item.id === payment.student_id) ?? null;
    if (row) setStudentId(row.id);
    setCode(row?.admission_number ?? payment.admission_number ?? '');
    setChallanNumber(payment.challan_number ?? '');
    setEditingId(payment.id);
    setRemarksTouched(true);
    setError('');
    setForm({
      dueFee: payment.due_fee === null ? '' : String(Math.round(payment.due_fee)),
      fine: payment.fine_amount > 0 ? String(Math.round(payment.fine_amount)) : '',
      concession: payment.concession > 0 ? String(Math.round(payment.concession)) : '',
      discount: payment.discount > 0 ? String(Math.round(payment.discount)) : '',
      amount: String(Math.round(payment.amount)),
      method: payment.method,
      paymentDate: payment.payment_date,
      receiptNumber: payment.receipt_number,
      remarks: payment.remarks ?? '',
    });
    window.setTimeout(() => document.getElementById('fee-voucher-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const cancelEdit = () => {
    setEditingId('');
    setChallanNumber('');
    setForm(emptyVoucher(today));
    setRemarksTouched(false);
    setError('');
    focusLookup();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!student) { setError('Look up a student first.'); return; }
    if (paid <= 0) { setError('Enter the amount received.'); return; }
    if (paid > 1000000) { setError('That amount is larger than this form accepts.'); return; }
    if (form.paymentDate > today) { setError('The payment date cannot be in the future.'); return; }

    setSaving(true);
    setError('');

    if (editingId) {
      const result = await updateFeeVoucher(editingId, {
        amount: paid,
        method: form.method,
        paymentDate: form.paymentDate,
        remarks: form.remarks.trim(),
        receiptNumber: form.receiptNumber,
        dueFee,
        fine,
        concession,
        discount,
      });
      setSaving(false);
      if (result.error) { setError(result.error); return; }
      onToast(`Voucher ${form.receiptNumber} updated for ${student.full_name}.`);
      cancelEdit();
      await onSaved();
      return;
    }

    const result = await recordFeePayment({
      studentId: student.id,
      amount: paid,
      method: form.method,
      paymentDate: form.paymentDate,
      remarks: form.remarks.trim(),
      receiptNumber: form.receiptNumber.trim(),
      challanNumber: challanNumber || undefined,
      dueFee,
      fine,
      concession,
      discount,
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }

    setReceipt({
      id: result.paymentId || `local-${result.receiptNumber}`,
      student_id: student.id,
      receipt_number: result.receiptNumber,
      amount: paid,
      method: form.method,
      payment_date: form.paymentDate,
      remarks: form.remarks.trim() || null,
      balance_after: result.balanceAfter,
      created_at: new Date().toISOString(),
      challan_id: null,
      challan_number: challanNumber || null,
      source: 'manual',
      voided: false,
      voided_at: null,
      void_reason: null,
      due_fee: dueFee,
      fine_amount: fine,
      concession,
      discount,
      payable_fee: payable,
      updated_at: null,
      edit_count: 0,
      student_name: student.full_name,
      fathers_name: student.fathers_name ?? null,
      class_name: student.class_name,
      section_name: student.section_name,
      admission_number: student.admission_number,
    });
    onToast(`Receipt ${result.receiptNumber} saved for ${student.full_name}.`);
    cancelEdit();
    await onSaved();
  };

  const studentChallan = challanNumber
    ? payments.find((payment) => payment.student_id === studentId && payment.challan_number === challanNumber)
    : undefined;

  return (
    <div className="fee-section">
      <section className="fee-card fee-counter">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Step 1 · Quick lookup</span>
            <h2>Admission no. or challan no.</h2>
            <p className="fee-sub">Type it or scan the barcode and press Enter. The student, their class and their due fee fill in on their own.</p>
          </div>
          <span className="fee-hint">Barcode reader ready</span>
        </div>

        <form className="fee-scan-bar" onSubmit={lookup}>
          <div className="fee-scan-field">
            <ScanLine size={18} />
            <input
              ref={inputRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Admission no. / challan no., then Enter"
              autoComplete="off"
              spellCheck={false}
              aria-label="Admission number or challan number"
            />
          </div>
          <button type="submit" className="primary-button" disabled={looking}>{looking ? 'Looking up…' : 'Load student'}</button>
          <button type="button" className="secondary-button" onClick={() => setSearchOpen(true)}><UserSearch size={16} /> Search Student</button>
          {student && <button type="button" className="secondary-button" onClick={() => { setStudentId(''); setChallanNumber(''); setCode(''); setForm(emptyVoucher(today)); setRemarksTouched(false); setEditingId(''); focusLookup(); }}><X size={16} /> Clear</button>}
        </form>

        {error && <p className="fee-error">{error}</p>}

        {student ? (
          <div className="fee-identity">
            <div><span>Student Name</span><strong>{student.full_name}</strong></div>
            <div><span>Father Name</span><strong>{student.fathers_name || student.guardian_name || '—'}</strong></div>
            <div><span>Class / Section</span><strong>{student.class_name} / {student.section_name}</strong></div>
            <div><span>Due Fee</span><strong className={Number(student.fee_balance ?? 0) > 0 ? 'due' : 'clear'}>{formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</strong></div>
          </div>
        ) : (
          !loading && <p className="fee-empty">No student loaded yet. Enter an admission number to begin.</p>
        )}
      </section>

      {student && (
        <section className="fee-card" id="fee-voucher-form">
          <div className="fee-card-head">
            <div>
              <span className="eyebrow">Step 2 · Fee voucher</span>
              <h2>{editingId ? 'Update this voucher' : 'Calculate and collect'}</h2>
              {editingId && <p className="fee-sub">Receipt {form.receiptNumber} keeps its number; only the figures below change.</p>}
            </div>
            {editingId && <button type="button" className="secondary-button" onClick={cancelEdit}>Cancel edit</button>}
          </div>

          <form className="fee-form" onSubmit={submit}>
            <div className="fee-voucher-grid">
              <label className="control-field"><span>Due Fee (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.dueFee} onChange={(event) => set({ dueFee: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Late Fee Fine (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.fine} onChange={(event) => set({ fine: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Fee Concession (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.concession} onChange={(event) => set({ concession: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Discount (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.discount} onChange={(event) => set({ discount: event.target.value })} placeholder="0" />
              </label>
              <label className="control-field"><span>Payable Fee (Rs)</span>
                <input value={Math.round(payable).toLocaleString()} readOnly className="fee-readonly" aria-label="Payable fee, worked out from due fee, fine, concession and discount" />
              </label>
              <label className="control-field"><span>Paid Fee (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={form.amount} onChange={(event) => set({ amount: event.target.value })} placeholder="Amount received" required />
              </label>
              <label className="control-field"><span>Remaining (Rs)</span>
                <input value={Math.round(remaining).toLocaleString()} readOnly className="fee-readonly" aria-label="Remaining balance" />
              </label>
              <label className="control-field"><span>Payment method</span>
                <select value={form.method} onChange={(event) => set({ method: event.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              <label className="control-field"><span>Payment date</span>
                <input type="date" max={today} value={form.paymentDate} onChange={(event) => set({ paymentDate: event.target.value })} required />
              </label>
              <label className="control-field"><span>Receipt no.</span>
                <input value={form.receiptNumber} onChange={(event) => set({ receiptNumber: event.target.value })} placeholder="Blank generates one" maxLength={40} readOnly={Boolean(editingId)} />
              </label>
              <label className="control-field full"><span>Remarks</span>
                <input
                  value={form.remarks}
                  onChange={(event) => { setRemarksTouched(true); set({ remarks: event.target.value }); }}
                  placeholder="Filled in automatically, edit it if you need to"
                />
              </label>
            </div>

            <div className="fee-form-actions">
              {payable > 0 && <button type="button" className="secondary-button" onClick={() => set({ amount: String(Math.round(payable)) })}>Pay full {formatMoney(payable)}</button>}
              {remaining > 0 && <button type="button" className="secondary-button" onClick={() => set({ amount: String(Math.round(payable / 2)) })}>Half</button>}
              {remarksTouched && <button type="button" className="secondary-button" onClick={() => setRemarksTouched(false)}>Reset remarks</button>}
              <button type="submit" className="primary-button" disabled={saving}>
                <Coins size={16} /> {saving ? 'Saving…' : editingId ? 'Update voucher' : 'Save voucher & print'}
              </button>
            </div>

            <div className="fee-tally">
              <span>Total fee payable <strong>{formatMoney(payable)}</strong></span>
              <span>Fee paid <strong>{formatMoney(paid)}</strong></span>
              <span>Balance <strong className={remaining > 0 ? 'due' : 'clear'}>{formatMoney(remaining)}</strong></span>
              {studentChallan?.challan_number && <span>Challan <strong>{studentChallan.challan_number}</strong></span>}
            </div>
          </form>
        </section>
      )}

      <FeeVoucherList
        payments={payments}
        loading={loading}
        onEdit={startEdit}
        onDelete={setDeleting}
        onPrint={setReprinting}
      />

      {searchOpen && (
        <CollectFeeStudentSearch roster={roster} onSelect={pickSearchedStudent} onClose={() => { setSearchOpen(false); focusLookup(); }} />
      )}

      {receipt && <FeeReceiptView payment={receipt} student={student} summary={null} onClose={() => setReceipt(null)} />}
      {reprinting && (
        <FeeReceiptView
          payment={reprinting}
          student={students.find((row) => row.id === reprinting.student_id) ?? roster.find((row) => row.id === reprinting.student_id) ?? null}
          summary={null}
          onClose={() => setReprinting(null)}
        />
      )}
      {deleting && (
        <DeleteVoucherModal
          payment={deleting}
          onClose={() => setDeleting(null)}
          onDone={async (message) => { setDeleting(null); onToast(message); await onSaved(); }}
        />
      )}

      {!student && !loading && (
        <p className="fee-hint"><Wallet size={14} /> Load a student above to see their due fee and collect the payment.</p>
      )}
    </div>
  );
}

const SEND_MODE_OPTIONS: { value: AlertSendMode; label: string }[] = [
  { value: 'app', label: 'Desktop App' },
  { value: 'web', label: 'WhatsApp Web' },
  { value: 'wa.me', label: 'WhatsApp Link' },
];

function DefaultersTab({ students, classList, sectionsFor, challans, challanMonth, setChallanMonth, lastPaymentFor, onSend, sendMode, onSendModeChange, reminderQueue, onClearQueue, onSendNotice }: {
  students: Student[];
  classList: string[];
  sectionsFor: (className: string) => string[];
  challans: FeeChallan[];
  challanMonth: string;
  setChallanMonth: (month: string) => void;
  lastPaymentFor: (studentId: string) => { date: string; amount: number } | null;
  onSend: (targets: Student[]) => Promise<void>;
  sendMode: AlertSendMode;
  onSendModeChange: (mode: AlertSendMode) => void;
  reminderQueue: { studentName: string; phone: string; link: string; message: string }[];
  onClearQueue: () => void;
  onSendNotice?: (student: Student, context: NoticeContext) => void;
}) {
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState('');
  const [copied, setCopied] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students
      .filter((student) => Number(student.fee_balance ?? 0) > 0)
      .filter((student) => !classFilter || student.class_name === classFilter)
      .filter((student) => !sectionFilter || student.section_name === sectionFilter)
      .filter((student) => !needle || `${student.full_name} ${student.admission_number}`.toLowerCase().includes(needle))
      .map((student) => {
        const challan = challans.find((row) => row.student_id === student.id);
        return {
          student,
          due: Math.max(0, Number(student.fee_balance ?? 0)),
          lastPayment: lastPaymentFor(student.id),
          challan,
        };
      })
      .sort((a, b) => b.due - a.due);
  }, [students, classFilter, sectionFilter, search, challans, lastPaymentFor]);

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

  const runSelected = async () => {
    const targets = rows.filter((row) => selected.has(row.student.id)).map((row) => row.student);
    if (targets.length === 0) return;
    setSendingId('batch');
    await onSend(targets);
    setSendingId('');
    setSelected(new Set());
  };

  const sendOne = async (student: Student) => {
    setSendingId(student.id);
    await onSend([student]);
    setSendingId('');
  };

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Follow-up</span><h2>Outstanding balances</h2></div>
          <span className="fee-hint">{rows.length} students · {formatMoney(totalDue)} pending</span>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Fee month</span>
            <select value={challanMonth} onChange={(event) => setChallanMonth(event.target.value)}>
              {monthOptions().map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter(''); }}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Section</span>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="">All sections</option>
              {(classFilter ? sectionsFor(classFilter) : Array.from(new Set(students.map((student) => student.section_name))).sort()).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or admission no." />
          </label>
        </div>
        <div className="fee-quick">
          <div className="segmented-control compact fee-sendmode">
            {SEND_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={sendMode === option.value ? 'selected' : ''}
                onClick={() => onSendModeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            onClick={() => void runSelected()}
            disabled={sendingId !== '' || selectedCount === 0}
          >
            <Send size={16} /> {sendingId === 'batch' ? 'Sending…' : `Send Selected (${selectedCount})`}
          </button>
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
                  <th>Challan status</th>
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
                    <td>
                      <strong>{row.student.full_name}</strong>
                      <small className="fee-sub">{row.student.admission_number} · Guardian {row.student.guardian_phone}</small>
                    </td>
                    <td>{row.student.class_name} · {row.student.section_name}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(row.due)}</td>
                    <td>{row.lastPayment ? `${formatMoney(row.lastPayment.amount)} · ${formatDay(row.lastPayment.date)}` : 'No payment yet'}</td>
                    <td>
                      <span className={`fee-status ${row.challan ? row.challan.status : 'none'}`}>
                        {row.challan ? row.challan.status : 'No challan'}
                      </span>
                    </td>
                    <td className="text-right no-print">
                      <button type="button" className="fee-link" onClick={() => void sendOne(row.student)} disabled={sendingId !== ''}>
                        <BellRing size={14} /> {sendingId === row.student.id ? 'Sending…' : 'Send reminder'}
                      </button>
                      {onSendNotice ? (
                        <button type="button" className="fee-link" onClick={() => onSendNotice(row.student, 'fee')}>
                          <FileText size={14} /> Send Notice / Warning
                        </button>
                      ) : null}
                      {whatsappNumberWarning(row.student) && (
                        <small className="fee-warn" title={whatsappNumberWarning(row.student)}>Check contact no.</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reminderQueue.length > 0 && (
        <div className="notice-overlay" onClick={onClearQueue}>
          <section className="notice-modal fee-blocked-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">WhatsApp reminder queue</span>
              <button className="close-button" onClick={onClearQueue} aria-label="Close">×</button>
            </div>
            <p className="fee-blocked-intro">Click <strong>Open WhatsApp App</strong> to launch the installed WhatsApp desktop app. If that does not work, use <strong>Open WhatsApp Web</strong> to open it in a browser tab instead.</p>
            <ul className="fee-blocked-list">
              {reminderQueue.map((row) => (
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
              <button className="secondary-button" onClick={onClearQueue}>Done</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
