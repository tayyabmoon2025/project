import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import {
  ChevronDown, Coins, Download, FileSpreadsheet, FileText, Minus, Pencil, Plus, Printer,
  RefreshCw, Save, Search, Send, Trash2, X,
} from 'lucide-react';
import {
  downloadCsv, formatDay, formatMoney, monthKey, monthlyChargeFor, toCsv,
  type FeePayment, type FeeStructure,
} from '@/lib/fees';
import {
  ADJUSTMENT_TYPES, adjustmentAmountFor, adjustmentExportFilename, adjustmentExportRows,
  adjustmentLabel, createFeeAdjustment, deleteFeeAdjustment,
  fetchAdjustmentsForDate, fetchAdjustmentsForStudent, findSiblingGroups, setFeeOpeningBalance,
  updateFeeAdjustment,
  type AdjustmentType, type FeeAdjustment,
} from '@/lib/feeAdjustments';
import { resolveWhatsAppNumber, type AlertSendMode } from '@/lib/whatsapp';
import { CONCESSION_CATEGORY_OPTIONS } from '@/lib/concessionCategories';
import { WhatsappNumberCell } from '@/components/WhatsappNumberCell';
import { todayKey } from '@/lib/attendance';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { usePrintSheet } from '@/lib/usePrintSheet';
import type { Student } from '@/lib/schoolTypes';
import { useFamilyDiscounts } from '@/lib/useFamilyDiscounts';

const SEND_MODE_OPTIONS: { value: AlertSendMode; label: string }[] = [
  { value: 'app', label: 'Desktop App' },
  { value: 'web', label: 'WhatsApp Web' },
  { value: 'wa.me', label: 'WhatsApp Link' },
];

// A searchable student picker shared by the adjustment and opening-balance screens.
function useStudentPicker(students: Student[]) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const selected = students.find((student) => student.id === selectedId) ?? null;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const digits = needle.replace(/\D/g, '');
    return students
      .filter((student) =>
        student.full_name.toLowerCase().includes(needle)
        || (student.admission_number ?? '').toLowerCase().includes(needle)
        || (digits && (student.admission_number ?? '').replace(/\D/g, '').includes(digits))
        || (student.guardian_phone ?? '').replace(/\D/g, '').includes(digits || needle.replace(/\D/g, '')))
      .slice(0, 8);
  }, [students, query]);
  return { query, setQuery, selectedId, setSelectedId, selected, matches };
}

// The roster is passed in; every new tab reloads it through onSaved so a balance the
// database recomputed is reflected everywhere.
export function AdjustmentTab({ students, onToast, onSaved }: {
  students: Student[];
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const picker = useStudentPicker(students);
  const [type, setType] = useState<AdjustmentType>('concession');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entryDate, setEntryDate] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listDate, setListDate] = useState(todayKey());
  const [rows, setRows] = useState<FeeAdjustment[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [printing, setPrinting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // The student details are joined onto each row here rather than looked up at render
  // time, so a printed or exported day still reads correctly after a student leaves
  // the active roster.
  const loadDate = async (date: string) => {
    setLoadingRows(true);
    const result = await fetchAdjustmentsForDate(date);
    setLoadingRows(false);
    if (result.error) { onToast(result.error); return; }
    const byId = new Map(students.map((student) => [student.id, student]));
    setRows(result.adjustments.map((row) => {
      const student = byId.get(row.student_id);
      return student ? {
        ...row,
        student_name: student.full_name,
        fathers_name: student.fathers_name,
        guardian_name: student.guardian_name,
        class_name: student.class_name,
        section_name: student.section_name,
        admission_number: student.admission_number,
      } : row;
    }));
  };

  useEffect(() => {
    void loadDate(listDate);
    // Reloading whenever the posted date changes is the point of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listDate]);

  const dueFee = picker.selected ? Math.max(0, Number(picker.selected.fee_balance ?? 0)) : 0;
  const parsedAmount = Math.abs(Number(amount));
  const typed = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const signedPreview = typed > 0 ? adjustmentAmountFor(type, typed) : 0;
  const balanceAfter = Math.max(0, dueFee + signedPreview);
  // Only a reduction is a concession, so the category picker is offered for those and not
  // for a correction, which adds to the dues rather than reducing them.
  const isReduction = adjustmentAmountFor(type, 1) < 0;
  const reducedTotal = rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
  const addedTotal = rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + Number(row.amount), 0);
  const totalAdjusted = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);

  const resetForm = (keepDate = true) => {
    setEditingId('');
    setType('concession');
    setCategory('');
    setAmount('');
    setRemarks('');
    setError('');
    if (!keepDate) setEntryDate(todayKey());
    picker.setSelectedId('');
    picker.setQuery('');
  };

  const studentName = (row: FeeAdjustment) =>
    row.student_name ?? students.find((entry) => entry.id === row.student_id)?.full_name ?? 'Student';
  const studentFather = (row: FeeAdjustment) => {
    if (row.fathers_name || row.guardian_name) return row.fathers_name || row.guardian_name || '—';
    const student = students.find((entry) => entry.id === row.student_id);
    return student ? (student.fathers_name || student.guardian_name || '—') : '—';
  };
  const studentClass = (row: FeeAdjustment) => {
    if (row.class_name && row.section_name) return `${row.class_name} · ${row.section_name}`;
    const student = students.find((entry) => entry.id === row.student_id);
    return student ? `${student.class_name} · ${student.section_name}` : '—';
  };
  const studentAdmission = (row: FeeAdjustment) =>
    row.admission_number ?? students.find((entry) => entry.id === row.student_id)?.admission_number ?? '—';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picker.selected) { setError('Choose a student first.'); return; }
    if (!entryDate) { setError('Choose the date this adjustment is filed under.'); return; }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!remarks.trim()) { setError('Add a short remark explaining the adjustment.'); return; }
    setSaving(true);
    setError('');

    if (editingId) {
      const err = await updateFeeAdjustment({
        id: editingId,
        adjustmentType: type,
        amount: adjustmentAmountFor(type, parsedAmount),
        reason: remarks,
        entryDate,
        category: isReduction ? category : '',
      });
      setSaving(false);
      if (err) { setError(err); return; }
      onToast(`${adjustmentLabel(type)} updated for ${picker.selected.full_name}.`);
    } else {
      const result = await createFeeAdjustment({
        studentId: picker.selected.id,
        adjustmentType: type,
        amount: adjustmentAmountFor(type, parsedAmount),
        reason: remarks,
        effectiveDate: entryDate,
        category: isReduction ? category : '',
      });
      setSaving(false);
      if (result.error) { setError(result.error); return; }
      onToast(`${adjustmentLabel(type)} of ${formatMoney(parsedAmount)} posted for ${picker.selected.full_name}.`);
    }

    const filedDate = entryDate;
    resetForm();
    setListDate(filedDate);
    await loadDate(filedDate);
    await onSaved();
  };

  const startEdit = (row: FeeAdjustment) => {
    const student = students.find((entry) => entry.id === row.student_id);
    if (!student) { onToast('That student is no longer on the active roster.'); return; }
    picker.setSelectedId(student.id);
    picker.setQuery('');
    setEditingId(row.id);
    setType(row.adjustment_type);
    setCategory(row.category ?? '');
    setAmount(String(Math.abs(Number(row.amount))));
    setRemarks(row.reason ?? '');
    setEntryDate(row.entry_date || todayKey());
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeAdjustment = async (row: FeeAdjustment) => {
    const name = studentName(row);
    if (!window.confirm(`Remove this adjustment for ${name}? The balance will be recalculated.`)) return;
    setBusyId(row.id);
    const err = await deleteFeeAdjustment(row.id);
    setBusyId('');
    if (err) { onToast(err); return; }
    if (editingId === row.id) resetForm();
    onToast('Adjustment removed and the balance recalculated.');
    await loadDate(listDate);
    await onSaved();
  };

  const printSheet = usePrintSheet(printing, (
    <section className="print-only print-dmc-sheet print-fee-adjustments" aria-hidden="true">
      <div className="print-header">
        <SchoolLogo alt={`${SCHOOL_NAME} logo`} />
        <div className="print-header-copy">
          <h1>{SCHOOL_NAME}</h1>
          <p>Fee adjustment sheet</p>
        </div>
        <div className="print-header-admitted">
          <span>Posted date</span>
          <strong>{formatDay(listDate)}</strong>
        </div>
      </div>
      <table className="print-dmc-table">
        <thead>
          <tr><th>Admission no.</th><th>Student</th><th>Class</th><th>Type</th><th>Remarks</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={6}>No adjustments were posted on this date.</td></tr>
            : rows.map((row) => (
              <tr key={row.id}>
                <td>{studentAdmission(row)}</td>
                <td>{studentName(row)}</td>
                <td>{studentClass(row)}</td>
                <td>{adjustmentLabel(row.adjustment_type)}</td>
                <td>{row.reason || '—'}</td>
                <td>{row.amount < 0 ? '−' : '+'}{formatMoney(Math.abs(Number(row.amount)))}</td>
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={5}>Total adjusted</td><td>{formatMoney(totalAdjusted)}</td></tr>
        </tfoot>
      </table>
      <div className="print-signatures">
        <div className="print-signature"><span>Prepared by</span></div>
        <div className="print-signature"><span>Accounts Officer</span></div>
      </div>
    </section>
  ));

  const print = () => {
    // The sheet is portalled on the next paint, so the dialog waits a beat.
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  // Closes the export menu on any click outside it, so the list stays usable.
  useEffect(() => {
    if (!exportOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [exportOpen]);

  const exportSpreadsheet = () => {
    downloadCsv(adjustmentExportFilename(listDate), toCsv(adjustmentExportRows(rows, listDate)));
    setExportOpen(false);
    onToast(`${rows.length} ${rows.length === 1 ? 'adjustment' : 'adjustments'} exported for ${formatDay(listDate)}.`);
  };

  const exportPdf = () => {
    setExportOpen(false);
    // The print sheet is the PDF: the browser's dialog offers Save as PDF.
    print();
    onToast('Choose Save as PDF in the print dialog to download the report.');
  };

  return (
    <div className="fee-section">
      {printSheet}

      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Adjusted on {formatDay(listDate)}</span><strong>{formatMoney(totalAdjusted)}</strong><small>{rows.length} {rows.length === 1 ? 'entry' : 'entries'} posted</small></div></div>
        <div className="fee-kpi coral"><div><span>Taken off dues</span><strong>{formatMoney(reducedTotal)}</strong><small>Concessions, discounts and write-offs</small></div></div>
        <div className="fee-kpi sky"><div><span>Put back on dues</span><strong>{formatMoney(addedTotal)}</strong><small>Corrections and reversals</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">{editingId ? 'Edit adjustment' : 'New adjustment'}</span><h2>{editingId ? 'Correct a posted adjustment' : 'Reduce or correct a student\u2019s dues'}</h2></div>
          <span className="fee-hint">The pending balance updates as soon as you save</span>
        </div>
        <form className="fee-form" onSubmit={submit}>
          <div className="fee-form-group">
            <p className="fee-form-group-label">Student</p>
            <div className="fee-filters">
              <label className="control-field"><span>Admission no.</span>
                <input value={picker.query} onChange={(event) => picker.setQuery(event.target.value)} placeholder="Type an admission number or a name" autoComplete="off" />
              </label>
              <label className="control-field"><span>Dated</span>
                <input type="date" lang="en-GB" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
              </label>
            </div>
            {picker.query.trim() && (
              <div className="fee-quick-pick">
                {picker.matches.length === 0 ? <p className="fee-empty">No students match "{picker.query}".</p> : picker.matches.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    className={`fee-quick-pick-row ${picker.selectedId === student.id ? 'selected' : ''}`}
                    onClick={() => { picker.setSelectedId(student.id); picker.setQuery(''); }}
                  >
                    <span className="fee-quick-pick-name">{student.full_name}</span>
                    <span className="fee-quick-pick-meta">{student.admission_number} · {student.class_name} · Section {student.section_name} · Due {formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="fee-form-row">
              <label className="control-field"><span>Student</span>
                <input readOnly value={picker.selected?.full_name ?? 'No student selected'} className="fee-readonly" />
              </label>
              <label className="control-field"><span>Father</span>
                <input readOnly value={picker.selected ? (picker.selected.fathers_name || picker.selected.guardian_name || '—') : '—'} className="fee-readonly" />
              </label>
            </div>
            <div className="fee-form-row">
              <label className="control-field"><span>Class &amp; section</span>
                <input readOnly value={picker.selected ? `${picker.selected.class_name} · Section ${picker.selected.section_name}` : '—'} className="fee-readonly" />
              </label>
              <label className="control-field"><span>Current due fee</span>
                <input readOnly value={picker.selected ? formatMoney(dueFee) : '—'} className="fee-readonly" />
              </label>
            </div>
          </div>

          <div className="fee-form-group">
            <p className="fee-form-group-label">Adjustment</p>
            <div className="fee-segmented-wrap">
              <div className="segmented-control fee-segmented">
                {ADJUSTMENT_TYPES.map((entry) => (
                  <button key={entry.value} type="button" className={type === entry.value ? 'selected' : ''} onClick={() => setType(entry.value)}>{entry.label}</button>
                ))}
              </div>
              <small className="fee-hint">{ADJUSTMENT_TYPES.find((entry) => entry.value === type)?.hint}</small>
            </div>
            <div className="fee-form-row">
              <label className="control-field"><span>Fee adjusted (Rs)</span>
                <input type="number" min="0" step="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required />
              </label>
              <label className="control-field"><span>Balance after adjustment</span>
                <input readOnly value={picker.selected ? formatMoney(balanceAfter) : '—'} className="fee-readonly" />
              </label>
            </div>
            {/* The category is what files the reduction in Fee Concessions & Discounts, so it
                is offered for a reduction only and left out of a correction. */}
            {isReduction && (
              <label className="control-field full"><span>Concession category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">No category — work it out from the remarks</option>
                  {CONCESSION_CATEGORY_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
                <small className="fee-hint">Shown under this category in Fee Concessions &amp; Discounts.</small>
              </label>
            )}
            <label className="control-field full"><span>Remarks</span>
              <textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Why this adjustment was made, e.g. stationery and books purchased by the parent"
                maxLength={300}
                rows={3}
              />
            </label>
          </div>

          {error && <p className="fee-error">{error}</p>}

          <div className="fee-form-actions">
            <button type="submit" className="primary-button" disabled={saving}>
              {editingId ? <Save size={16} /> : <Plus size={16} />}
              {saving ? 'Saving…' : editingId ? 'Update adjustment' : 'Save adjustment'}
            </button>
            <button type="button" className="secondary-button" onClick={() => resetForm()} disabled={saving}>
              <X size={15} /> {editingId ? 'Cancel edit' : 'Clear'}
            </button>
            {picker.selected && (
              <span className="fee-tally-inline">
                Due fee <strong>{formatMoney(dueFee)}</strong> · after adjustment <strong>{formatMoney(balanceAfter)}</strong>
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Posted adjustments</span>
            <h2>{loadingRows ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'adjustment' : 'adjustments'} on ${formatDay(listDate)}`}</h2>
          </div>
          <div className="fee-quick">
            <button type="button" className="secondary-button" onClick={() => void loadDate(listDate)} disabled={loadingRows}><RefreshCw size={15} /> Refresh</button>
            <div className="fee-export" ref={exportRef}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setExportOpen((open) => !open)}
                disabled={rows.length === 0}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
              >
                <Download size={15} /> Export <ChevronDown size={14} />
              </button>
              {exportOpen && (
                <div className="fee-export-menu" role="menu">
                  <button type="button" role="menuitem" className="fee-export-item" onClick={exportSpreadsheet}>
                    <FileSpreadsheet size={16} />
                    <span>Excel / CSV<small>Download the day&rsquo;s sheet</small></span>
                  </button>
                  <button type="button" role="menuitem" className="fee-export-item" onClick={exportPdf}>
                    <FileText size={16} />
                    <span>PDF report<small>Print or save as PDF</small></span>
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="secondary-button" onClick={print} disabled={rows.length === 0}><Printer size={15} /> Print</button>
            <button type="button" className="primary-button" onClick={() => { resetForm(false); setListDate(todayKey()); }}><Plus size={16} /> New</button>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Fee period / posted date</span>
            <input type="date" lang="en-GB" value={listDate} onChange={(event) => setListDate(event.target.value)} />
          </label>
        </div>
        {loadingRows ? <p className="fee-empty">Loading adjustments…</p> : rows.length === 0 ? (
          <p className="fee-empty">No adjustments were posted on {formatDay(listDate)}. Pick another date or use New to post one.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Admission no.</th><th>Student</th><th>Class</th><th>Type</th><th>Remarks</th><th className="text-right">Amount</th><th className="no-print" /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={editingId === row.id ? 'fee-row-editing' : ''}>
                    <td className="fee-mono">{studentAdmission(row)}</td>
                    <td><strong>{studentName(row)}</strong><small className="fee-sub">{studentFather(row)}</small></td>
                    <td>{studentClass(row)}</td>
                    <td><span className="fee-status neutral">{adjustmentLabel(row.adjustment_type)}</span></td>
                    <td>{row.reason || '—'}</td>
                    <td className={`text-right font-semibold tabular-nums ${row.amount < 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {row.amount < 0 ? '−' : '+'}{formatMoney(Math.abs(Number(row.amount)))}
                    </td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => startEdit(row)}><Pencil size={14} /> Edit</button>
                        <button type="button" className="fee-link danger" onClick={() => void removeAdjustment(row)} disabled={busyId === row.id}><Trash2 size={14} /> {busyId === row.id ? 'Removing…' : 'Delete'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="acct-total-row">
                  <td colSpan={5}>Total adjusted</td>
                  <td className="text-right tabular-nums">{formatMoney(totalAdjusted)}</td>
                  <td className="no-print" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function SiblingsTab({ students, onSend, sendMode, onSendModeChange, onToast, onRefresh }: {
  students: Student[];
  onSend: (targets: Student[]) => Promise<void>;
  sendMode: AlertSendMode;
  onSendModeChange: (mode: AlertSendMode) => void;
  onToast: (message: string) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState('');
  const [sendingKey, setSendingKey] = useState('');
  const groups = useMemo(() => findSiblingGroups(students), [students]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => group.students.some((student) =>
      student.full_name.toLowerCase().includes(needle)
      || (student.admission_number ?? '').toLowerCase().includes(needle)
      || (student.guardian_name || student.fathers_name || '').toLowerCase().includes(needle)));
  }, [groups, search]);

  const totalFamilies = groups.length;
  const totalStudents = groups.reduce((sum, group) => sum + group.students.length, 0);
  const totalBalance = groups.reduce((sum, group) => sum + group.combinedBalance, 0);

  const remindFamily = async (group: typeof groups[number]) => {
    // The number shown in the row is what gets messaged, so a student whose own record is
    // blank or mistyped is still reached on the family's working number.
    const reachable = group.students.flatMap((student) => {
      const resolved = resolveWhatsAppNumber(student, group.students);
      return resolved.number ? [{ ...student, whatsapp_number: resolved.number }] : [];
    });
    if (reachable.length === 0) {
      onToast('No working WhatsApp number is saved for this family yet. Add one in the WhatsApp no. column, then send the reminder.');
      return;
    }
    if (reachable.length < group.students.length) {
      onToast(`${group.students.length - reachable.length} of ${group.students.length} students were left out — no working number on their record or on a brother or sister's record.`);
    }
    setSendingKey(group.key);
    await onSend(reachable);
    setSendingKey('');
  };

  return (
    <div className="fee-section">
      <div className="fee-kpi-grid compact">
        <div className="fee-kpi mint"><div><span>Families with siblings</span><strong>{totalFamilies}</strong><small>Grouped by shared parent details</small></div></div>
        <div className="fee-kpi sky"><div><span>Students in a family group</span><strong>{totalStudents}</strong><small>Brothers and sisters on the roll</small></div></div>
        <div className="fee-kpi coral"><div><span>Combined family dues</span><strong>{formatMoney(totalBalance)}</strong><small>Across all sibling groups</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Brother & sister</span><h2>Families on the roll</h2></div>
          <span className="fee-hint">Matched on guardian phone, CNIC or name</span>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student, admission no. or guardian" />
          </label>
          <div className="segmented-control compact fee-sendmode">
            {SEND_MODE_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={sendMode === option.value ? 'selected' : ''} onClick={() => onSendModeChange(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="fee-card"><p className="fee-empty">No sibling groups found. Add a guardian phone, CNIC or shared father name to the student records to link brothers and sisters.</p></section>
      ) : filtered.map((group) => (
        <section className="fee-card" key={group.key}>
          <div className="fee-card-head">
            <div>
              <span className="eyebrow">{group.students.length} students · {group.reason}</span>
              <h2>{group.students[0].guardian_name || group.students[0].fathers_name || 'Family account'}</h2>
            </div>
            <div className="fee-quick">
              <span className="fee-hint">Combined dues <strong>{formatMoney(group.combinedBalance)}</strong></span>
              <button type="button" className="primary-button" onClick={() => void remindFamily(group)} disabled={sendingKey !== ''}>
                <Send size={15} /> {sendingKey === group.key ? 'Sending…' : 'Remind family'}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Class</th><th>Admission no.</th><th className="text-right">Balance</th><th>WhatsApp no.</th></tr></thead>
              <tbody>
                {group.students.map((student) => (
                  <tr key={student.id}>
                    <td><strong>{student.full_name}</strong><small className="fee-sub">{student.guardian_name || student.fathers_name || '—'}</small></td>
                    <td>{student.class_name} · {student.section_name}</td>
                    <td className="fee-mono">{student.admission_number}</td>
                    <td className={`text-right font-semibold tabular-nums ${Number(student.fee_balance ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</td>
                    <td><WhatsappNumberCell student={student} family={group.students} onSaved={onRefresh} onToast={onToast} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

type LedgerStatus = 'all' | 'paid' | 'partial' | 'unpaid';

export function LedgerTab({ students, structures, payments, loading, onToast, onCollect }: {
  students: Student[];
  structures: FeeStructure[];
  payments: FeePayment[];
  loading: boolean;
  onToast: (message: string) => void;
  onCollect: (studentId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<LedgerStatus>('all');
  const [openStudent, setOpenStudent] = useState<Student | null>(null);
  const month = monthKey();

  const classList = useMemo(() => Array.from(new Set(students.map((student) => student.class_name))).sort(), [students]);
  // The sibling discount follows the Fee Structure "Brothers and sisters" rules, so the
  // ledger reads the same family percentage the challan was raised with.
  const familyDiscounts = useFamilyDiscounts(students);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students
      .map((student) => {
        const structure = structures.find((row) => row.class_name === student.class_name);
        const { currentMonthlyFee } = monthlyChargeFor(student, structure, familyDiscounts.percentageFor(student));
        const own = payments.filter((payment) => payment.student_id === student.id && !payment.voided);
        const paidThisMonth = own.filter((payment) => (payment.payment_date ?? '').slice(0, 7) === month).reduce((sum, payment) => sum + Number(payment.amount), 0);
        const paidTotal = own.reduce((sum, payment) => sum + Number(payment.amount), 0);
        const balance = Math.max(0, Number(student.fee_balance ?? 0));
        const opening = Math.max(0, Number(student.fee_opening_balance ?? 0));
        const lastPayment = own.reduce<string | null>((latest, payment) => (!latest || payment.payment_date > latest ? payment.payment_date : latest), null);
        return {
          student, monthlyFee: currentMonthlyFee, paidThisMonth, paidTotal, balance, opening, lastPayment,
          status: (balance <= 0 ? 'paid' : paidThisMonth > 0 ? 'partial' : 'unpaid') as Exclude<LedgerStatus, 'all'>,
        };
      })
      .filter((row) => {
        if (classFilter && row.student.class_name !== classFilter) return false;
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (!needle) return true;
        return [row.student.full_name, row.student.admission_number, row.student.guardian_name, row.student.guardian_phone]
          .some((value) => (value ?? '').toLowerCase().includes(needle));
      })
      .sort((a, b) => b.balance - a.balance);
  }, [students, structures, payments, month, search, classFilter, statusFilter, familyDiscounts]);

  const totals = rows.reduce((acc, row) => ({
    fee: acc.fee + row.monthlyFee,
    paid: acc.paid + row.paidThisMonth,
    balance: acc.balance + row.balance,
  }), { fee: 0, paid: 0, balance: 0 });

  return (
    <div className="fee-section">
      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Students fee ledger</span><h2>{rows.length} students · {formatMoney(totals.balance)} outstanding</h2></div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, admission no., guardian or phone" />
          </label>
          <label className="control-field"><span>Class</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classList.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Payment status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LedgerStatus)}>
              <option value="all">All students</option>
              <option value="paid">Fully paid</option>
              <option value="partial">Partial payment</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
        </div>
        <div className="acct-mini-stats">
          <div><span>Monthly fee</span><strong>{formatMoney(totals.fee)}</strong></div>
          <div><span>Collected this month</span><strong className="text-emerald-700">{formatMoney(totals.paid)}</strong></div>
          <div><span>Outstanding</span><strong className="text-rose-600">{formatMoney(totals.balance)}</strong></div>
        </div>
      </section>

      <section className="fee-card">
        {loading ? <p className="fee-empty">Loading the ledger…</p> : rows.length === 0 ? (
          <p className="fee-empty">No students match these filters. Try clearing the search or choosing another class.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Class</th><th className="text-right">Monthly fee</th>
                  <th className="text-right">Opening</th><th className="text-right">Paid this month</th>
                  <th className="text-right">Balance</th><th>Status</th><th>Last payment</th><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.student.id}>
                    <td><strong>{row.student.full_name}</strong><small className="fee-sub">{row.student.admission_number}</small></td>
                    <td>{row.student.class_name} · {row.student.section_name}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.monthlyFee)}</td>
                    <td className="text-right tabular-nums">{row.opening > 0 ? formatMoney(row.opening) : '—'}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.paidThisMonth)}</td>
                    <td className={`text-right font-semibold tabular-nums ${row.balance > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(row.balance)}</td>
                    <td><span className={`fee-status ${row.status}`}>{row.status === 'paid' ? 'Paid' : row.status === 'partial' ? 'Partial' : 'Unpaid'}</span></td>
                    <td>{row.lastPayment ? formatDay(row.lastPayment) : 'No payment yet'}</td>
                    <td className="text-right no-print">
                      <div className="fee-row-actions">
                        <button type="button" className="fee-link" onClick={() => setOpenStudent(row.student)}><Search size={14} /> History</button>
                        <button type="button" className="fee-link" onClick={() => onCollect(row.student.id)}><Coins size={14} /> Collect</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openStudent && (
        <StudentFeeHistoryModal
          student={openStudent}
          payments={payments.filter((payment) => payment.student_id === openStudent.id)}
          onClose={() => setOpenStudent(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// One student's full fee picture: opening balance, challan-linked receipts and every
// adjustment, so the office can explain exactly how the balance was reached.
function StudentFeeHistoryModal({ student, payments, onClose, onToast }: {
  student: Student;
  payments: FeePayment[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [adjustments, setAdjustments] = useState<FeeAdjustment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAdjustmentsForStudent(student.id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error) { onToast(result.error); return; }
      setAdjustments(result.adjustments);
    });
    return () => { cancelled = true; };
  }, [student.id, onToast]);

  const sorted = [...payments].sort((a, b) => (b.payment_date + (b.created_at ?? '')).localeCompare(a.payment_date + (a.created_at ?? '')));
  const paidTotal = sorted.filter((payment) => !payment.voided).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const reversedTotal = sorted.filter((payment) => payment.voided).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const reducedTotal = adjustments.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal acct-ledger-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">Fee ledger</span>
            <h2 className="mt-1 text-xl font-bold text-slate-800">{student.full_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{student.admission_number} · {student.class_name} · Section {student.section_name}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <dl className="fee-summary mt-4">
          <div className="strong"><dt>Current balance</dt><dd>{formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</dd></div>
          <div><dt>Opening balance</dt><dd>{formatMoney(Math.max(0, Number(student.fee_opening_balance ?? 0)))}</dd></div>
          <div><dt>Total paid</dt><dd className="credit">{formatMoney(paidTotal)}</dd></div>
          <div><dt>Adjustments</dt><dd className="credit">−{formatMoney(reducedTotal)}</dd></div>
          <div><dt>Reversed</dt><dd>{formatMoney(reversedTotal)}</dd></div>
        </dl>

        {loading ? <p className="fee-empty">Loading adjustments…</p> : adjustments.length > 0 && (
          <>
            <h3 className="fee-history-heading">Adjustments</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Type</th><th>Reason</th><th className="text-right">Amount</th><th>Effective</th></tr></thead>
                <tbody>
                  {adjustments.map((row) => (
                    <tr key={row.id}>
                      <td>{adjustmentLabel(row.adjustment_type)}</td>
                      <td>{row.reason || '—'}</td>
                      <td className={`text-right font-semibold tabular-nums ${row.amount < 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{row.amount < 0 ? '−' : '+'}{formatMoney(Math.abs(row.amount))}</td>
                      <td>{formatDay(row.effective_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3 className="fee-history-heading">Payments</h3>
        {sorted.length === 0 ? (
          <p className="fee-empty">No payments have been recorded for this student yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {sorted.map((payment) => (
                  <tr key={payment.id} className={payment.voided ? 'acct-void-row' : ''}>
                    <td className="fee-mono">{payment.receipt_number}</td>
                    <td>{formatDay(payment.payment_date)}</td>
                    <td className="capitalize">{payment.method}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                    <td>{payment.voided ? <span className="fee-status unpaid">Reversed</span> : <span className="fee-status paid">Recorded</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

export function OpeningBalanceTab({ students, onToast, onSaved }: {
  students: Student[];
  onToast: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const picker = useStudentPicker(students);
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const withOpening = useMemo(() => students
    .filter((student) => Number(student.fee_opening_balance ?? 0) > 0)
    .sort((a, b) => Number(b.fee_opening_balance ?? 0) - Number(a.fee_opening_balance ?? 0)), [students]);

  const totalOpening = withOpening.reduce((sum, student) => sum + Number(student.fee_opening_balance ?? 0), 0);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return withOpening;
    return withOpening.filter((student) =>
      student.full_name.toLowerCase().includes(needle)
      || (student.admission_number ?? '').toLowerCase().includes(needle));
  }, [withOpening, search]);

  const pickForEdit = (student: Student) => {
    picker.setSelectedId(student.id);
    picker.setQuery('');
    setAmount(String(Math.max(0, Number(student.fee_opening_balance ?? 0))));
    setAsOf(student.fee_opening_balance_date ?? todayKey());
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picker.selected) { setError('Choose a student first.'); return; }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) { setError('Enter a valid opening balance.'); return; }
    setSaving(true);
    setError('');
    const err = await setFeeOpeningBalance({ studentId: picker.selected.id, amount: parsed, asOf });
    setSaving(false);
    if (err) { setError(err); return; }
    onToast(parsed > 0
      ? `Opening balance of ${formatMoney(parsed)} saved for ${picker.selected.full_name}.`
      : `Opening balance cleared for ${picker.selected.full_name}.`);
    picker.setSelectedId('');
    picker.setQuery('');
    setAmount('');
    await onSaved();
  };

  return (
    <div className="fee-section">
      <div className="fee-kpi-grid compact">
        <div className="fee-kpi sun"><div><span>Students with an opening balance</span><strong>{withOpening.length}</strong><small>Dues carried forward</small></div></div>
        <div className="fee-kpi coral"><div><span>Total carried forward</span><strong>{formatMoney(totalOpening)}</strong><small>Added to their running balance</small></div></div>
      </div>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Fee opening balance</span><h2>Dues brought forward</h2></div>
          <span className="fee-hint">Shown on top of challan dues</span>
        </div>
        <p className="fee-note">
          Use this to record what a student already owed before their fee challans started in this system.
          It is added to their running balance and can be edited or cleared at any time.
        </p>
        <form className="fee-form" onSubmit={submit}>
          <div className="fee-filters">
            <label className="control-field"><span>Find a student</span>
              <input value={picker.query} onChange={(event) => picker.setQuery(event.target.value)} placeholder="Name or admission no." autoComplete="off" />
            </label>
            <label className="control-field"><span>Selected</span>
              <input readOnly value={picker.selected ? `${picker.selected.full_name} · ${picker.selected.class_name}` : 'No student selected'} className="fee-readonly" />
            </label>
            <label className="control-field"><span>Opening balance (Rs)</span>
              <input type="number" min="0" step="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required />
            </label>
            <label className="control-field"><span>As of</span>
              <input type="date" value={asOf} max={todayKey()} onChange={(event) => setAsOf(event.target.value)} />
            </label>
          </div>

          {picker.query.trim() && (
            <div className="fee-quick-pick">
              {picker.matches.length === 0 ? <p className="fee-empty">No students match "{picker.query}".</p> : picker.matches.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  className={`fee-quick-pick-row ${picker.selectedId === student.id ? 'selected' : ''}`}
                  onClick={() => pickForEdit(student)}
                >
                  <span className="fee-quick-pick-name">{student.full_name}</span>
                  <span className="fee-quick-pick-meta">{student.class_name} · {student.section_name} · Opening {formatMoney(Math.max(0, Number(student.fee_opening_balance ?? 0)))}</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="fee-error">{error}</p>}

          <div className="fee-form-actions">
            <button type="submit" className="primary-button" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save opening balance'}</button>
            {picker.selected && Number(picker.selected.fee_opening_balance ?? 0) > 0 && (
              <button type="button" className="secondary-button" onClick={() => setAmount('0')}><Minus size={15} /> Clear to zero</button>
            )}
          </div>
        </form>
      </section>

      <section className="fee-card">
        <div className="fee-card-head">
          <div><span className="eyebrow">Carried forward</span><h2>Students with an opening balance</h2></div>
          <label className="control-field compact"><span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or admission no." />
          </label>
        </div>
        {filtered.length === 0 ? (
          <p className="fee-empty">No opening balances have been recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Class</th><th className="text-right">Opening balance</th><th>As of</th><th className="text-right">Current balance</th><th className="no-print" /></tr></thead>
              <tbody>
                {filtered.map((student) => (
                  <tr key={student.id}>
                    <td><strong>{student.full_name}</strong><small className="fee-sub">{student.admission_number}</small></td>
                    <td>{student.class_name} · {student.section_name}</td>
                    <td className="text-right font-semibold tabular-nums">{formatMoney(Math.max(0, Number(student.fee_opening_balance ?? 0)))}</td>
                    <td>{student.fee_opening_balance_date ? formatDay(student.fee_opening_balance_date) : '—'}</td>
                    <td className={`text-right tabular-nums ${Number(student.fee_balance ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(Math.max(0, Number(student.fee_balance ?? 0)))}</td>
                    <td className="text-right no-print">
                      <button type="button" className="fee-link" onClick={() => pickForEdit(student)}><Pencil size={14} /> Edit</button>
                    </td>
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

