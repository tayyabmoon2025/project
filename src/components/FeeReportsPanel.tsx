import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CircleCheck, Coins, Check, Download, FileSpreadsheet, Printer, RefreshCw, Send, X } from 'lucide-react';
import { FeeReportBreakdownModal } from '@/components/FeeReportBreakdownModal';
import { FeeReportControls } from '@/components/FeeReportControls';
import { FeeReportSheet } from '@/components/FeeReportSheet';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { downloadCsv, formatMoney, monthKey, toCsv } from '@/lib/fees';
import { feeReminderMessage, sendFeeReminders, type QueuedReminder } from '@/lib/feeReminders';
import { whatsappNumberWarning } from '@/lib/whatsapp';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import {
  FEE_CONCESSION_CATEGORIES, FEE_REPORTS, FEE_REPORT_GROUPS, buildFeeReport, emptyFeeReport, emptyReportFilters, loadFeeReportData,
  reportCell, reportCsvRows, reportFileName, reportPeriodLabel, reportScopeLabel,
  type FeeReportData, type FeeReportColumn, type FeeReportFilters, type FeeReportId, type FeeReportMeta,
} from '@/lib/feeReports';

// The structured reporting workspace. One period and one class scope sit at the top and
// drive every report in the list; each report is previewed on screen and can be printed
// or exported without leaving the tab.
export function FeeReportsPanel({ students, today, onToast, onOpenAdjustments, isAdmin, approverName, onResolved }: {
  students: Student[];
  today: string;
  onToast: (message: string) => void;
  // Takes the reader straight to the screen where a reduction is posted, so the guidance on
  // the concessions report can be acted on instead of only read.
  onOpenAdjustments?: () => void;
  // Only an admin/principal can approve or reject a pending concession from the report.
  isAdmin?: boolean;
  approverName?: string;
  onResolved?: () => Promise<void>;
}) {
  const [reportId, setReportId] = useState<FeeReportId>('received-class');
  const [filters, setFilters] = useState<FeeReportFilters>(() => emptyReportFilters(today));
  const [data, setData] = useState<FeeReportData>({ payments: [], challans: [], adjustments: [], history: [], cumulativeChallans: [], cumulativePayments: [], structures: [], siblingRules: [] });
  // The reminder wording is dated from the report's own end date, so the message a
  // family receives matches the period the staff member is looking at.
  const reminderMonth = filters.to ? filters.to.slice(0, 7) : monthKey();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  // Every read in flight for the current scope. Try again settles these before asking for
  // a fresh set, so a second attempt starts from a known state rather than racing the first.
  const inFlight = useRef<Promise<unknown> | null>(null);
  const [printing, setPrinting] = useState(false);
  const [sendingId, setSendingId] = useState('');
  const [queue, setQueue] = useState<QueuedReminder[]>([]);
  const [copied, setCopied] = useState('');
  // The footer total that has been opened up, if any. Only the Fee Trail sets one.
  const [openTotal, setOpenTotal] = useState('');
  // Concession approval actions from the report. A pending concession can be approved
  // or rejected straight from the row, using the same RPC as the Approvals tab.
  const [busyApprovalId, setBusyApprovalId] = useState('');
  const [rejectingStudent, setRejectingStudent] = useState<Student | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // The Student & Class-wise report shows a cumulative figure, so it needs everything
  // billed and received up to the end date. The other reports do not, so they do not read it.
  const wantsCumulative = reportId === 'student-collection-balance';
  // The concessions report has to work out what a family is agreed to pay, which needs the
  // class fee structures and the sibling discount rules. No other report reads them.
  const wantsConcessions = reportId === 'concession-detail';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // The read is held so Try again can wait for it, and a rejection is turned into an
    // empty result here so no report is ever left without data to build from.
    const pending = loadFeeReportData(filters.from, filters.to, wantsCumulative, wantsConcessions).then(
      (result) => result,
      () => ({ data: { payments: [], challans: [], adjustments: [], history: [], cumulativeChallans: [], cumulativePayments: [], structures: [], siblingRules: [] } as FeeReportData, error: 'The fee records could not be read for this period. You can try again.' }),
    );
    inFlight.current = pending;
    void pending.then((result) => {
      if (cancelled) return;
      setLoading(false);
      setData(result.data);
      setLoadError(result.error ?? '');
    });
    return () => { cancelled = true; };
  }, [filters.from, filters.to, reloadToken, wantsCumulative, wantsConcessions]);

  // Every report reads from the loaded data, and a report that cannot be built for any
  // reason falls back to a clean empty one instead of replacing the panel with an error.
  const report = useMemo(() => {
    try {
      return buildFeeReport(reportId, students, data, filters);
    } catch {
      return emptyFeeReport(reportId, 'This report could not be prepared. Try again, or pick another report from the list.');
    }
  }, [reportId, students, data, filters]);

  const meta = FEE_REPORTS.find((entry) => entry.id === reportId) ?? FEE_REPORTS[0];

  // A footer total opens a list of the students behind it. Only the reports that supply
  // breakdowns offer this, and the open one is dropped when the report or its period moves.
  const breakdowns = report.breakdowns ?? [];
  const openBreakdown = breakdowns.find((entry) => entry.key === openTotal) ?? null;
  useEffect(() => {
    setOpenTotal('');
    // The category belongs to the concessions report alone, so a choice made there is cleared
    // on the way out rather than silently narrowing a report that does not offer it.
    setFilters((current) => (current.concessionCategory ? { ...current, concessionCategory: '' } : current));
  }, [reportId, filters.from, filters.to, filters.className, filters.section]);

  // Only the Defaulters and Nil Paid reports act on a student. Their rows carry the
  // matching student, so a row can be traced back to the record it came from.
  const reminderTargets = report.reminderTargets ?? [];
  const reminderRows = useMemo(() => {
    const targets = report.reminderTargets ?? [];
    return report.rows.map((row, index) => ({ row, student: targets[index] })).filter((entry) => entry.student);
  }, [report]);
  const withContact = reminderRows.filter((entry) => whatsappNumberWarning(entry.student) === '').length;

  // The concessions report carries the student for each row, so a pending concession can
  // be approved or rejected straight from the report. Rows that are not a pending
  // concession carry null, so the action cell stays blank for them.
  const approvalTargets = report.approvalTargets ?? [];

  const approveConcession = async (student: Student) => {
    setBusyApprovalId(student.id);
    try {
      const { error } = await supabase.rpc('set_concession_approval', {
        p_student_id: student.id,
        p_status: 'approved',
        p_approver_name: approverName ?? 'Principal',
      });
      if (error) { onToast(error.message); return; }
      onToast(`Approved concession for ${student.full_name}.`);
      await onResolved?.();
    } catch {
      onToast('Could not reach the school server. Try again.');
    } finally {
      setBusyApprovalId('');
    }
  };

  const confirmRejectConcession = async () => {
    if (!rejectingStudent) return;
    const reason = rejectReason.trim();
    if (!reason) { onToast('Please enter a reason for rejecting this concession.'); return; }
    setBusyApprovalId(rejectingStudent.id);
    try {
      const { error } = await supabase.rpc('set_concession_approval', {
        p_student_id: rejectingStudent.id,
        p_status: 'rejected',
        p_approver_name: approverName ?? 'Principal',
        p_rejection_reason: reason,
      });
      if (error) { onToast(error.message); return; }
      onToast(`Rejected concession for ${rejectingStudent.full_name}.`);
      setRejectingStudent(null);
      setRejectReason('');
      await onResolved?.();
    } catch {
      onToast('Could not reach the school server. Try again.');
    } finally {
      setBusyApprovalId('');
    }
  };

  // One reminder goes straight out; the rest are handed over as a queue of links so the
  // browser does not block a run of pop-ups. Sends run through the same pipeline as the
  // Outstanding Fee tab, so the SMS log and the portal notice behave identically.
  const sendReminders = async (targets: Student[]) => {
    if (targets.length === 0) return;
    const result = await sendFeeReminders(targets, reminderMonth, today);
    if (result.error) { onToast(result.error); return; }
    if (result.queue.length > 0) setQueue(result.queue);
    const parts = result.sent > 0
      ? [`${result.sent} fee reminder${result.sent === 1 ? '' : 's'} opened in WhatsApp.`]
      : [`${result.queue.length} fee reminder${result.queue.length === 1 ? '' : 's'} queued.`];
    if (result.skipped > 0) parts.push(`${result.skipped} skipped — no usable contact number on the student record.`);
    if (result.sent > 0 && result.queue.length > 0) parts.push(`${result.queue.length} queued — use the links below to open them.`);
    else if (result.queue.length > 0) parts.push('Use the links below to open them in WhatsApp.');
    onToast(parts.join(' '));
  };

  const sendAll = async () => {
    if (withContact === 0) { onToast('No student in this report has a usable WhatsApp number.'); return; }
    setSendingId('all');
    await sendReminders(reminderRows.map((entry) => entry.student));
    setSendingId('');
  };

  // The reports that carry an aging view put the four bracket columns at the end of a row.
  // They are singled out so the reader's eye can follow the money getting older across them.
  const ageColumns = report.columns.filter((column) => column.key.startsWith('age'));
  const ageTotal = ageColumns.reduce((sum, column) => sum + Number(report.totals?.[column.key] ?? 0), 0);
  // The headline figure: everything outstanding for more than 90 days, across every class in
  // scope, with how widely it is spread and how much of the dues it makes up.
  const stuckTotal = ageColumns.length > 0 ? Number(report.totals?.age90plus ?? 0) : 0;
  const stuckStudents = report.rows.filter((row) => Number(row.age90plus ?? 0) > 0).length;
  const stuckClasses = (report.classTotals ?? []).filter((entry) => Number(entry.totals.age90plus ?? 0) > 0).length;
  const stuckShare = ageTotal > 0 ? Math.round((stuckTotal / ageTotal) * 1000) / 10 : 0;

  const cellClass = (column: FeeReportColumn) => [
    column.format && column.format !== 'text' ? 'text-right tabular-nums' : '',
    column.key.startsWith('age') ? 'fee-age-col' : '',
    column.key === 'age90plus' ? 'fee-age-old' : '',
  ].filter(Boolean).join(' ') || undefined;

  const printSheet = usePrintSheet(printing, (
    <FeeReportSheet report={report} filters={filters} schoolName={SCHOOL_NAME} />
  ));

  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [printing]);

  // Try again recomputes the trail from the current period and class scope. It settles
  // whatever is in flight first, then clears the notice so the report reads cleanly.
  const retry = async () => {
    setLoadError('');
    setLoading(true);
    try { await inFlight.current; } catch { /* the settled result is handled by the effect */ }
    setReloadToken((token) => token + 1);
  };

  const exportCsv = () => {
    if (report.rows.length === 0) { onToast('There is nothing to export for this report yet.'); return; }
    downloadCsv(reportFileName(reportId, filters), toCsv(reportCsvRows(report, filters)));
    onToast(`${report.title} exported.`);
  };

  const print = () => {
    if (report.rows.length === 0) { onToast('There is nothing to print for this report yet.'); return; }
    setPrinting(true);
  };

  return (
    <div className="fee-section">
      <FeeReportControls
        filters={filters}
        onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        students={students}
        loading={loading}
        onRefresh={() => setReloadToken((token) => token + 1)}
      />

      {loadError && (
        <div className="fee-alert">
          <span>{loadError}</span>
          <button className="secondary-button" onClick={() => { void retry(); }}>
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      )}

      <div className="fee-report-layout">
        <aside className="fee-report-list">
          {FEE_REPORT_GROUPS.map((group) => (
            <div className="fee-report-group" key={group}>
              <p className="fee-form-group-label">{group}</p>
              {FEE_REPORTS.filter((entry) => entry.group === group).map((entry) => (
                <ReportChoice
                  key={entry.id}
                  entry={entry}
                  active={entry.id === reportId}
                  onPick={() => setReportId(entry.id)}
                />
              ))}
            </div>
          ))}
        </aside>

        <section className="fee-card fee-report-card">
          <div className="fee-card-head">
            <div>
              <span className="eyebrow">{meta.group}</span>
              <h2>{report.title}</h2>
              <span className="fee-sub">{report.note}</span>
            </div>
            <span className="fee-hint">{report.rows.length.toLocaleString()} row{report.rows.length === 1 ? '' : 's'}</span>
          </div>

          <div className="fee-report-meta">
            <span><strong>Period</strong>{reportPeriodLabel(filters)}</span>
            <span><strong>Scope</strong>{reportScopeLabel(filters)}</span>
          </div>

          {meta.usesMinDue && (
            <div className="fee-report-minimum">
              <label className="control-field"><span>Only show balances of at least</span>
                <input
                  type="number"
                  min={0}
                  value={filters.minDue}
                  onChange={(event) => setFilters((current) => ({ ...current, minDue: Math.max(0, Number(event.target.value) || 0) }))}
                />
              </label>
            </div>
          )}

          {/* The concessions report can be narrowed to one kind of reduction, so a principal
              can see just the sibling discounts, or just the scholarships, at a glance. */}
          {meta.usesConcessionCategory && (
            <div className="fee-report-minimum">
              <label className="control-field"><span>Concession category</span>
                <select
                  value={filters.concessionCategory}
                  onChange={(event) => setFilters((current) => ({ ...current, concessionCategory: event.target.value }))}
                >
                  {FEE_CONCESSION_CATEGORIES.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Where a reduction is assigned, so the person reading the report can go and set one
              up rather than only wondering why a student is missing from it. */}
          {meta.usesConcessionGuidance && (
            <div className="fee-report-guidance">
              <Coins size={17} />
              <div>
                <strong>Where a concession is assigned</strong>
                <p>
                  A standing reduction — orphan, scholarship, teacher&rsquo;s son / staff, or a plain agreed
                  concession — is set on the student&rsquo;s own record under <em>Fees and concessions</em>,
                  and applies to every challan raised for them. A one-off reduction is posted from
                  <em> Fee Adjustment</em>, where the same category list is offered. Either way it appears
                  here under the category chosen.
                </p>
                <p>
                  A sibling discount needs no category: it is worked out from the family groups and the
                  sibling discount rules, and is kept separate from the categories above.
                </p>
                {onOpenAdjustments && (
                  <button type="button" className="fee-link" onClick={onOpenAdjustments}>
                    Open Fee Adjustment <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="fee-form-actions fee-report-actions">
            {reminderRows.length > 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={sendAll}
                disabled={sendingId !== '' || withContact === 0}
                title={withContact === 0 ? 'No student in this report has a usable WhatsApp number.' : undefined}
              >
                <Send size={16} /> {sendingId === 'all' ? 'Opening WhatsApp…' : `Send WhatsApp reminders (${withContact})`}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={exportCsv}><Download size={16} /> Export CSV</button>
            <button type="button" className="secondary-button" onClick={print}><Printer size={16} /> Print</button>
          </div>

          {/* The headline for the aging view, sitting above the report itself: what has been
              outstanding for more than 90 days, gathered across every class in scope. */}
          {ageColumns.length > 0 && (
            <div className={`fee-stuck ${stuckTotal > 0 ? 'warn' : 'clear'}`}>
              {stuckTotal > 0 ? <AlertTriangle size={20} /> : <CircleCheck size={20} />}
              <div className="fee-stuck-copy">
                <span>Stuck over 90 days</span>
                <strong>{formatMoney(stuckTotal)}</strong>
                <p>
                  {stuckTotal > 0
                    ? `${stuckStudents} student${stuckStudents === 1 ? '' : 's'} across ${stuckClasses} class${stuckClasses === 1 ? '' : 'es'} — ${stuckShare}% of all pending dues in this scope.`
                    : 'No pending balance in this scope is more than 90 days old.'}
                </p>
              </div>
            </div>
          )}

          {ageColumns.length > 0 && (
            <div className="fee-aging">
              <p className="fee-form-group-label">Pending balance by age — every rupee of it against the charge it came from</p>
              <div className="fee-aging-row">
                {ageColumns.map((column, index) => {
                  const value = Number(report.totals?.[column.key] ?? 0);
                  const share = ageTotal > 0 ? Math.round((value / ageTotal) * 1000) / 10 : 0;
                  return (
                    <div key={column.key} className={`fee-aging-cell ${index === ageColumns.length - 1 ? 'oldest' : ''}`}>
                      <span>{column.label}</span>
                      <strong>{formatMoney(value)}</strong>
                      <div className="fee-aging-bar"><i style={{ width: `${Math.min(100, share)}%` }} /></div>
                      <em>{share}% of dues</em>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <p className="fee-empty">Reading the fee records for this period…</p>
          ) : report.rows.length === 0 ? (
            <p className="fee-empty">{report.empty}</p>
          ) : (
            <div className="table-wrap fee-report-table">
              <table>
                <thead>
                  <tr>{report.columns.map((column) => (
                    <th key={column.key} className={column.format && column.format !== 'text' ? 'text-right' : undefined}>{column.label}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => {
                    // The last row of a class is followed by that class's own subtotal, so a
                    // class can be read on its own and still adds up to the grand total.
                    const classTotal = row.classEnd
                      ? report.classTotals?.find((entry) => entry.className === row.classEnd)
                      : undefined;
                    return (
                      <Fragment key={index}>
                        <tr className={row.marker ? 'fee-report-partial' : undefined}>
                          {report.columns.map((column) => (
                            <td key={column.key} className={cellClass(column)}>
                              {column.action === 'remind'
                                ? <ReportContactCell
                                    student={reminderTargets[index]}
                                    month={reminderMonth}
                                    sending={sendingId === reminderTargets[index]?.id}
                                    onSend={() => {
                                      const target = reminderTargets[index];
                                      if (!target) return;
                                      setSendingId(target.id);
                                      void sendReminders([target]).finally(() => setSendingId(''));
                                    }}
                                  />
                                : column.action === 'approve'
                                ? <ReportApprovalCell
                                    student={approvalTargets[index]}
                                    isAdmin={isAdmin}
                                    busy={busyApprovalId === approvalTargets[index]?.id}
                                    onApprove={() => {
                                      const target = approvalTargets[index];
                                      if (target) void approveConcession(target);
                                    }}
                                    onReject={() => {
                                      const target = approvalTargets[index];
                                      if (target) setRejectingStudent(target);
                                    }}
                                  />
                                : (
                                  <>
                                    {reportCell(row, column)}
                                    {row.marker && column.key === 'student' && (
                                      <span className="fee-partial-tag" title="Some of this fee was paid, and some is still owed">{row.marker}</span>
                                    )}
                                  </>
                                )}
                            </td>
                          ))}
                        </tr>
                        {classTotal && (
                          <tr className="fee-class-subtotal">
                            {report.columns.map((column) => (
                              <td key={column.key} className={cellClass(column)}>
                                {reportCell(classTotal.totals, column)}
                              </td>
                            ))}
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                {report.totals && (
                  <tfoot>
                    <tr className="fee-total-row">
                      {report.columns.map((column) => {
                        const total = report.totals as Record<string, string | number>;
                        // The Amount column is the only footer figure that is one number, so
                        // it is the one that can be opened up into the students behind it.
                        const asTotal = column.key === 'amount' ? breakdowns.find((entry) => entry.key === 'net') : undefined;
                        return (
                          <td key={column.key} className={cellClass(column)}>
                            {asTotal ? (
                              <button type="button" className="fee-total-open" onClick={() => setOpenTotal(asTotal.key)}>
                                {reportCell(total, column)}
                              </button>
                            ) : reportCell(total, column)}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {breakdowns.length > 0 && (
            <div className="fee-report-splits">
              <p className="fee-form-group-label">This period in figures — click one to see the students behind it</p>
              <div className="fee-report-split-row">
                {breakdowns.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`fee-report-split ${entry.key === 'net' ? 'net' : ''}`}
                    onClick={() => setOpenTotal(entry.key)}
                  >
                    <span>{entry.label}</span>
                    <strong className={entry.total < 0 ? 'fee-negative' : ''}>{formatMoney(entry.total)}</strong>
                    <em>{entry.lines.length} student{entry.lines.length === 1 ? '' : 's'}</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="fee-report-note">
            <FileSpreadsheet size={13} /> Export CSV saves exactly what is shown here, including the totals row.
          </p>

          {queue.length > 0 && (
            <div className="fee-report-queue">
              <div className="fee-report-queue-head">
                <div>
                  <span className="eyebrow">WhatsApp reminders</span>
                  <h3>{queue.length} message{queue.length === 1 ? '' : 's'} ready to send</h3>
                  <p>WhatsApp only opens one chat at a time. Open each message below, then send it.</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => setQueue([])}>Done</button>
              </div>
              <ul className="fee-report-queue-list">
                {queue.map((entry) => (
                  <li key={entry.studentId}>
                    <div className="fee-report-queue-who">
                      <strong>{entry.studentName}</strong>
                      <span className="fee-mono">{entry.phone}</span>
                    </div>
                    <div className="fee-row-actions">
                      <a className="fee-link" href={entry.link} target="_blank" rel="noopener noreferrer">
                        <Send size={14} /> Open WhatsApp
                      </a>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          navigator.clipboard?.writeText(entry.message).then(() => {
                            setCopied(entry.studentId);
                            setTimeout(() => setCopied(''), 2000);
                          }).catch(() => {});
                        }}
                      >
                        {copied === entry.studentId ? 'Copied!' : 'Copy message'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      {printSheet}

      {openBreakdown && (
        <FeeReportBreakdownModal
          breakdown={openBreakdown}
          period={reportPeriodLabel(filters)}
          scope={reportScopeLabel(filters)}
          onClose={() => setOpenTotal('')}
        />
      )}

      {rejectingStudent && (
        <div className="notice-overlay" onClick={() => { setRejectingStudent(null); setRejectReason(''); }}>
          <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">Reject concession</span>
              <button className="close-button" onClick={() => { setRejectingStudent(null); setRejectReason(''); }} aria-label="Close">×</button>
            </div>
            <p className="fee-blocked-intro">
              Enter a reason for rejecting the concession for <strong>{rejectingStudent.full_name}</strong>. The reason will be shown on the student&rsquo;s record.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="e.g. Income evidence does not qualify for this scholarship bracket."
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={() => { setRejectingStudent(null); setRejectReason(''); }}>Cancel</button>
              <button
                className="primary-button"
                disabled={busyApprovalId === rejectingStudent.id || !rejectReason.trim()}
                onClick={() => void confirmRejectConcession()}
              >
                {busyApprovalId === rejectingStudent.id ? 'Saving…' : 'Confirm rejection'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ReportChoice({ entry, active, onPick }: { entry: FeeReportMeta; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className={`fee-report-choice ${active ? 'on' : ''}`}
      aria-pressed={active}
      onClick={onPick}
    >
      <strong>{entry.title}</strong>
      <span>{entry.hint}</span>
    </button>
  );
}

// The contact cell on the reports that can message a family. It shows the number the
// reminder will go to and sends for that one student; a record with no usable number
// says so instead of offering a send that cannot work.
function ReportContactCell({ student, month, sending, onSend }: {
  student?: Student;
  month: string;
  sending: boolean;
  onSend: () => void;
}) {
  if (!student) return <>—</>;
  const warning = whatsappNumberWarning(student);
  if (warning) return <span className="fee-warn">{warning}</span>;
  const preview = feeReminderMessage(student, Math.max(0, Number(student.fee_balance ?? 0)), month);
  return (
    <div className="fee-remind-cell">
      <button type="button" className="fee-link" onClick={onSend} disabled={sending} title={preview}>
        <Send size={13} /> {sending ? 'Opening…' : 'WhatsApp'}
      </button>
    </div>
  );
}

// The approve/reject cell on the concessions report. Only an admin sees the buttons; a
// non-admin sees a dash so the column stays quiet for them. A row without a pending
// concession target also shows a dash, so challan and adjustment rows stay blank.
function ReportApprovalCell({ student, isAdmin, busy, onApprove, onReject }: {
  student: Student | null | undefined;
  isAdmin?: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!student || !isAdmin) return <>—</>;
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" className="primary-button" disabled={busy} onClick={onApprove}>
        <Check size={14} /> {busy ? '…' : 'Approve'}
      </button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onReject}>
        <X size={14} /> Reject
      </button>
    </div>
  );
}
