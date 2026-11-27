import { useEffect, useMemo, useState } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { CalendarOff, Check, ClipboardCopy, Loader as Loader2, MessageCircle, Printer, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { monthKey, monthLabel, monthOptions } from '@/lib/fees';
import {
  examOffNotice,
  fetchClassOffDays,
  formatDisplayDate,
  removeClassOffDay,
  saveClassOffDays,
  type ClassOffDay,
} from '@/lib/classOffDays';
import { buildDatesheet, datesheetNotice, datesheetText, type DatesheetRow } from '@/lib/datesheet';
import { fetchAbsenteeSendMode } from '@/lib/absenteeAlerts';
import { loadSchoolCalendar } from '@/lib/schoolCalendar';
import { DEFAULT_CALENDAR_POLICY, todayKey, type CalendarDay, type CalendarPolicy } from '@/lib/attendance';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { pickWhatsAppContact } from '@/lib/whatsapp';
import { sendFeeReminders, type QueuedReminder } from '@/lib/feeReminders';
import { defaulterTargets } from '@/lib/assistant';
import { canUseTool } from '@/lib/assistantRoles';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { useAuth } from '@/lib/auth';
import { useClassOptions } from '@/lib/classSections';
import { SCHOOL_NAME } from '@/lib/noticeText';
import type { Student } from '@/lib/schoolTypes';

type Toast = (message: string) => void;

// Copies text to the clipboard, falling back to a temporary selection on browsers that
// block the async clipboard outside a user gesture.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Class off day
// ---------------------------------------------------------------------------

export function ClassOffTool({ onToast }: { onToast: Toast }) {
  const { profile } = useAuth();
  const CLASS_OPTIONS = useClassOptions();
  const [offDate, setOffDate] = useState(todayKey());
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<ClassOffDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noticeClass, setNoticeClass] = useState<string | null>(null);

  const load = async () => {
    const result = await fetchClassOffDays(todayKey());
    setDays(result.days);
    setError(result.error);
  };

  useEffect(() => { void load(); }, []);

  const toggle = (className: string) => setSelected((current) =>
    current.includes(className) ? current.filter((item) => item !== className) : [...current, className]);

  const save = async () => {
    if (selected.length === 0) { setError('Choose at least one class to mark off.'); return; }
    setSaving(true);
    const result = await saveClassOffDays(offDate, selected, note, profile?.id ?? null);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    setError(null);
    setNoticeClass(selected[0]);
    onToast(`${selected.length} class${selected.length === 1 ? '' : 'es'} marked off on ${formatDisplayDate(offDate)}`);
    await load();
  };

  const remove = async (id: string) => {
    const result = await removeClassOffDay(id);
    if (result.error) { setError(result.error); return; }
    await load();
  };

  const notice = noticeClass ? examOffNotice(noticeClass, offDate, note) : '';

  const sendNotice = async () => {
    if (!notice) return;
    const mode = await fetchAbsenteeSendMode();
    const result = openWhatsAppChat(null, notice, mode);
    if (!result.ok) {
      const copied = await copyText(notice);
      onToast(copied ? 'WhatsApp could not open. The notice was copied instead.' : 'WhatsApp could not open.');
    }
  };

  return (
    <div className="assistant-tool">
      <div className="assistant-field-row">
        <label className="assistant-field">
          <span>Off day</span>
          <input type="date" value={offDate} onChange={(event) => setOffDate(event.target.value)} />
        </label>
        <label className="assistant-field">
          <span>Reason (optional)</span>
          <input value={note} placeholder="Exam day, staff training…" onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>

      <div className="assistant-chip-set">
        {CLASS_OPTIONS.map((className) => (
          <button
            key={className}
            type="button"
            className={`assistant-chip small ${selected.includes(className) ? 'selected' : ''}`}
            onClick={() => toggle(className)}
          >
            {className}
          </button>
        ))}
      </div>

      {error && <p className="assistant-error">{error}</p>}

      <div className="assistant-tool-actions">
        <button className="primary-button" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="assistant-spin" /> : <CalendarOff size={16} />} Mark off
        </button>
        {selected.length > 0 && <button className="ghost-button" type="button" onClick={() => setSelected([])}><X size={15} /> Clear</button>}
      </div>

      {notice && (
        <div className="assistant-notice">
          <div className="assistant-notice-head"><strong>Parent notice</strong><span>Ready to share</span></div>
          <pre>{notice}</pre>
          <div className="assistant-tool-actions">
            <button className="ghost-button" type="button" onClick={() => void copyText(notice).then((ok) => onToast(ok ? 'Notice copied' : 'Could not copy the notice'))}><ClipboardCopy size={15} /> Copy</button>
            <button className="ghost-button" type="button" onClick={() => void sendNotice()}><MessageCircle size={15} /> WhatsApp</button>
          </div>
        </div>
      )}

      <div className="assistant-list-head">
        <strong>Upcoming class-off days</strong>
        <button className="assistant-icon-button" type="button" title="Refresh" onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>
      {days.length === 0
        ? <p className="assistant-empty">No class-off days are scheduled. Their classes are included in absentee alerts as usual.</p>
        : (
          <ul className="assistant-rows">
            {days.map((day) => (
              <li key={day.id}>
                <div>
                  <strong>{day.class_name}</strong>
                  <span>{formatDisplayDate(day.off_date)}{day.note ? ` · ${day.note}` : ''}</span>
                </div>
                <button className="assistant-icon-button danger" type="button" title="Remove" onClick={() => void remove(day.id)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exam datesheet
// ---------------------------------------------------------------------------

export function DatesheetTool({ onToast }: { onToast: Toast }) {
  const classNames = useClassOptions();
  const [className, setClassName] = useState(classNames[0] ?? '');
  const [examName, setExamName] = useState('Term Examination');
  const [startDate, setStartDate] = useState(todayKey());
  const [subjectText, setSubjectText] = useState('English\nMathematics\nScience\nIslamiat\nSocial Studies');
  const [startTime, setStartTime] = useState('09:00');
  const [alternateDays, setAlternateDays] = useState(false);
  const [rows, setRows] = useState<DatesheetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<{ policy: CalendarPolicy; days: CalendarDay[] }>({ policy: DEFAULT_CALENDAR_POLICY, days: [] });

  useEffect(() => {
    void loadSchoolCalendar().then((result) => setCalendar({ policy: result.policy, days: result.days }));
  }, []);

  const subjects = useMemo(
    () => subjectText.split('\n').map((line) => line.trim()).filter(Boolean),
    [subjectText],
  );

  const generate = () => {
    if (subjects.length === 0) { setError('Add at least one subject, one per line.'); return; }
    if (!startDate) { setError('Choose a start date.'); return; }
    const built = buildDatesheet(
      { startDate, subjects, workingDays: calendar.policy.working_days, alternateDays, startTime },
      calendar.policy,
      calendar.days,
    );
    setError(null);
    setRows(built);
    if (built.length === 0) setError('No working days were found from that date. Check the school calendar.');
  };

  const text = useMemo(
    () => (rows.length ? datesheetText(className, examName, rows, startTime) : ''),
    [rows, className, examName, startTime],
  );
  const notice = useMemo(
    () => (rows.length ? datesheetNotice(className, examName, rows, startTime) : ''),
    [rows, className, examName, startTime],
  );

  usePrintSheet(rows.length > 0, (
    <div className="print-only print-datesheet">
      <header className="print-datesheet-head">
        <SchoolLogo alt="" />
        <div><strong>{SCHOOL_NAME}</strong><span>{examName} — Datesheet</span></div>
      </header>
      <table>
        <thead><tr><th>Date</th><th>Day</th><th>Subject</th><th>Time</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}><td>{formatDisplayDate(row.date)}</td><td>{row.weekday}</td><td>{row.subject}</td><td>{startTime}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="print-datesheet-foot">Class {className} · Issued {formatDisplayDate(todayKey())}</p>
    </div>
  ));

  const sendNotice = async () => {
    if (!notice) return;
    const mode = await fetchAbsenteeSendMode();
    const result = openWhatsAppChat(null, notice, mode);
    if (!result.ok) {
      const copied = await copyText(notice);
      onToast(copied ? 'WhatsApp could not open. The notice was copied instead.' : 'WhatsApp could not open.');
    }
  };

  return (
    <div className="assistant-tool">
      <div className="assistant-field-row">
        <label className="assistant-field">
          <span>Class</span>
          <select value={className} onChange={(event) => setClassName(event.target.value)}>
            {classNames.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="assistant-field">
          <span>Exam</span>
          <input value={examName} onChange={(event) => setExamName(event.target.value)} placeholder="Term Examination" />
        </label>
        <label className="assistant-field">
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="assistant-field">
          <span>Paper time</span>
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        </label>
      </div>

      <label className="assistant-field">
        <span>Subjects — one per line, in exam order</span>
        <textarea dir="auto" rows={5} value={subjectText} onChange={(event) => setSubjectText(event.target.value)} />
      </label>

      <label className="assistant-check">
        <input type="checkbox" checked={alternateDays} onChange={(event) => setAlternateDays(event.target.checked)} />
        <span>Leave a gap between papers (one paper every other working day)</span>
      </label>

      {error && <p className="assistant-error">{error}</p>}

      <div className="assistant-tool-actions">
        <button className="primary-button" type="button" onClick={generate}><Check size={16} /> Generate datesheet</button>
        {rows.length > 0 && <span className="assistant-count">{rows.length} papers</span>}
      </div>

      {rows.length > 0 && (
        <>
          <div className="assistant-table-wrap">
            <table className="assistant-table">
              <thead><tr><th>Date</th><th>Day</th><th>Subject</th><th>Time</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date}>
                    <td>{formatDisplayDate(row.date)}</td>
                    <td>{row.weekday}</td>
                    <td>{row.subject}</td>
                    <td>{startTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="assistant-tool-actions">
            <button className="ghost-button" type="button" onClick={() => void copyText(text).then((ok) => onToast(ok ? 'Datesheet copied' : 'Could not copy the datesheet'))}><ClipboardCopy size={15} /> Copy</button>
            <button className="ghost-button" type="button" onClick={() => window.print()}><Printer size={15} /> Print view</button>
            <button className="ghost-button" type="button" onClick={() => void sendNotice()}><MessageCircle size={15} /> Notice</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fee reminders
// ---------------------------------------------------------------------------

export function RemindersTool({ students, onToast }: { students: Student[]; onToast: Toast }) {
  const { profile } = useAuth();
  const [month, setMonth] = useState(monthKey());
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<QueuedReminder[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRemind = profile ? canUseTool(profile.role, 'reminders') : false;
  const targets = useMemo(() => (canRemind ? defaulterTargets(students) : []), [canRemind, students]);
  const reachable = useMemo(() => targets.filter((student) => Boolean(pickWhatsAppContact(student).number)).length, [targets]);

  const run = async () => {
    setSending(true);
    setError(null);
    const result = await sendFeeReminders(targets, month, todayKey());
    setSending(false);
    if (result.error) { setError(result.error); return; }
    setQueue(result.queue);
    setSummary(`${result.sent} chat${result.sent === 1 ? '' : 's'} opened, ${result.queue.length} waiting in the list, ${result.skipped} without a number.`);
    onToast(`Fee reminders ready for ${monthLabel(month)}`);
  };

  const openOne = (item: QueuedReminder) => {
    const result = openWhatsAppChat(item.phone, item.message, 'web');
    if (!result.ok) onToast('WhatsApp could not open. Use the link below.');
  };

  return (
    <div className="assistant-tool">
      {!canRemind ? (
        <p className="assistant-note">
          Fee reminders are sent by the accounts office and the administrator. Your account can view fee records but
          cannot start a reminder run.
        </p>
      ) : (
      <>
      <p className="assistant-note">
        Reminders go through the same WhatsApp queue the Fees screens use, and each one is logged. Only the first chat
        opens straight away — the rest wait below so the browser does not block them.
      </p>
      <div className="assistant-field-row">
        <label className="assistant-field">
          <span>Fee month</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            {monthOptions(12).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </select>
        </label>
        <div className="assistant-field">
          <span>Defaulters</span>
          <strong className="assistant-readonly">{targets.length} · {reachable} reachable</strong>
        </div>
      </div>

      {error && <p className="assistant-error">{error}</p>}

      <div className="assistant-tool-actions">
        <button className="primary-button" type="button" onClick={() => void run()} disabled={sending || targets.length === 0}>
          {sending ? <Loader2 size={16} className="assistant-spin" /> : <Send size={16} />} Start reminder run
        </button>
      </div>

      {summary && <p className="assistant-note">{summary}</p>}

      {queue.length > 0 && (
        <>
          <div className="assistant-list-head"><strong>Waiting to open</strong><span>{queue.length}</span></div>
          <ul className="assistant-rows">
            {queue.map((item) => (
              <li key={item.studentId}>
                <div><strong>{item.studentName}</strong><span>{item.phone}</span></div>
                <button className="assistant-icon-button" type="button" title="Open WhatsApp" onClick={() => openOne(item)}><MessageCircle size={14} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
      </>
      )}
    </div>
  );
}
