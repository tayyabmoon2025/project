import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlert as AlertTriangle, BellRing, BookOpenCheck, CalendarClock, CheckCheck, Clock, ExternalLink, Globe, Loader as Loader2, MessageCircle, Monitor, Paperclip, RefreshCw, Save, Send, Trash2, Upload, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AbsenteeTemplate, HomeworkAlertEntry } from '@/lib/schoolTypes';
import { HOMEWORK_PLACEHOLDERS, renderHomeworkText, SCHOOL_NAME, SCHOOL_NAME_UR } from '@/lib/noticeText';
import { todayKey } from '@/lib/attendance';
import { queueSmsMessages, updateSmsStatus } from '@/lib/smsLog';
import { fetchAbsenteeSendMode, saveAbsenteeSendMode } from '@/lib/absenteeAlerts';
import {
  fetchHomeworkAlerts, fetchHomeworkWording, markHomeworkAlertsSent, removeHomeworkAlerts,
  rewordHomeworkAlerts, runHomeworkDeadlineReminders, saveHomeworkWording,
} from '@/lib/homeworkAlerts';
import {
  DEFAULT_HOMEWORK_REMINDER_WORDING, DEFAULT_HOMEWORK_WORDING, type HomeworkWording,
} from '@/lib/alertStatuses';
import type { HomeworkEntry } from '@/lib/homework';
import {
  ATTACHMENT_ACCEPT, isValidWhatsAppNumber, messageWithAttachment, uploadAbsenteeAttachment,
  whatsappWebLink, type AlertSendMode,
} from '@/lib/whatsapp';
import { openWhatsAppChat } from '@/lib/whatsappQueue';

const SEND_MODES: { value: AlertSendMode; label: string; hint: string; icon: typeof Globe }[] = [
  { value: 'app', label: 'Desktop App', hint: 'Opens the installed WhatsApp app via whatsapp://', icon: Monitor },
  { value: 'web', label: 'WhatsApp Web', hint: 'Opens web.whatsapp.com in a browser tab', icon: Globe },
  { value: 'wa.me', label: 'WhatsApp Link', hint: 'Universal wa.me link — works on mobile and desktop', icon: Globe },
];

const clampPause = (value: string, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.round(parsed), 600);
};

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

// The reminder lead time is kept between 0 (due today) and 14 days, which is the
// range the reminder function accepts.
const clampLead = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.round(parsed), 0), 14);
};

const daysUntil = (value: string) => {
  const today = new Date(`${todayKey()}T00:00:00`);
  const target = new Date(`${value}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
};

const formatStamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function HomeworkAlertsPanel({
  homework,
  onToast,
  onQueueChanged,
}: {
  homework: HomeworkEntry[];
  onToast: (message: string) => void;
  onQueueChanged?: () => void;
}) {
  const [forDate, setForDate] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | 'assigned' | 'reminder'>('');
  const [language, setLanguage] = useState<AbsenteeTemplate['language']>('English');
  const [wordingKind, setWordingKind] = useState<'homework_alert' | 'homework_reminder'>('homework_alert');
  const [wording, setWording] = useState<HomeworkWording>(() => ({ ...DEFAULT_HOMEWORK_WORDING }));
  const [reminderWording, setReminderWording] = useState<HomeworkWording>(() => ({ ...DEFAULT_HOMEWORK_REMINDER_WORDING }));
  const [leadDays, setLeadDays] = useState('1');
  const [preparing, setPreparing] = useState(false);
  const [lastRun, setLastRun] = useState<{ days: number; prepared: number } | null>(null);
  const [sendMode, setSendMode] = useState<AlertSendMode>('web');
  const [statusFilter, setStatusFilter] = useState<'' | 'queued' | 'sent'>('queued');
  const [rows, setRows] = useState<HomeworkAlertEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingWording, setSavingWording] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pause, setPause] = useState({ min: '3', max: '8' });
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelSend = useRef(false);
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [blocked, setBlocked] = useState<{ id: string; logId: string | null; student: string; phone: string; link: string; message: string }[]>([]);
  const [unreachable, setUnreachable] = useState<{ id: string; student: string }[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;
  const toast = useRef(onToast);
  toast.current = onToast;
  const lead = useRef(leadDays);
  lead.current = leadDays;

  // The wording and the send mode are school-wide settings, so they are read once and
  // written back only when the office changes them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, mode] = await Promise.all([fetchHomeworkWording(), fetchAbsenteeSendMode()]);
      if (cancelled) return;
      setWording(stored.wording);
      setReminderWording(stored.reminder);
      setSendMode(mode);
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchHomeworkAlerts({ date: forDate, status: statusFilter, kind: kindFilter });
    setRows(result.entries);
    setError(result.error);
    setLoading(false);
  }, [forDate, statusFilter, kindFilter]);

  useEffect(() => { void load(); }, [load]);

  // Opening this screen prepares the reminders for work falling due at the chosen
  // lead time, so the office does not have to remember to run them. The work is
  // idempotent, so a second visit the same day adds nothing.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    void (async () => {
      const days = clampLead(lead.current);
      const { prepared, error: prepareError } = await runHomeworkDeadlineReminders(days);
      if (prepareError || prepared === 0) return;
      setLastRun({ days, prepared });
      toast.current(`${prepared} homework reminder${prepared === 1 ? '' : 's'} prepared for work due in ${days} day${days === 1 ? '' : 's'}.`);
      await load();
    })();
  }, [load]);

  // Every waiting homework message across all dates drives the sidebar count.
  const queued = rows.filter((row) => row.status === 'queued');
  const sendable = queued.filter((row) => selected.includes(row.id));
  const missingNumbers = queued.filter((row) => !isValidWhatsAppNumber(row.parent_phone)).length;
  const allSelected = queued.length > 0 && sendable.length === queued.length;

  useEffect(() => { queueChanged.current?.(); }, [queued.length]);

  const activeWording = wordingKind === 'homework_reminder' ? reminderWording : wording;

  const setActiveWording = (value: string) => {
    if (wordingKind === 'homework_reminder') setReminderWording((current) => ({ ...current, [language]: value }));
    else setWording((current) => ({ ...current, [language]: value }));
  };

  // The preview follows the wording being edited, falling back to the first row of
  // that kind so an empty list still shows what will go out.
  const previewRow = sendable.find((row) => row.alert_kind === (wordingKind === 'homework_reminder' ? 'reminder' : 'assigned'))
    ?? rows.find((row) => row.status === 'queued' && row.alert_kind === (wordingKind === 'homework_reminder' ? 'reminder' : 'assigned'))
    ?? sendable[0]
    ?? queued[0]
    ?? null;

  const preview = useMemo(() => {
    if (previewRow) {
      return messageWithAttachment(previewRow.message_body ?? '', previewRow.attachment_url ?? attachment?.url ?? null);
    }
    const sample = homework[0];
    return messageWithAttachment(
      renderHomeworkText(activeWording[language], language, {
        student_name: language === 'Urdu' ? 'علی احمد' : 'Ali Ahmed',
        class_name: sample?.class_name ?? 'Class 5',
        section_name: sample?.section_name ?? 'A',
        subject: sample?.subject_name ?? 'Mathematics',
        title: sample?.title ?? 'Exercise 4.2, questions 1 to 10',
        date: sample?.homework_date ?? todayKey(),
        due_date: sample?.due_date ?? null,
      }),
      attachment?.url ?? null,
    );
  }, [previewRow, homework, activeWording, language, attachment]);

  // How much work is falling due, so the office can see what the reminders cover.
  const dueCounts = useMemo(() => {
    const published = homework.filter((entry) => entry.status === 'published' && entry.due_date);
    return {
      today: published.filter((entry) => daysUntil(entry.due_date as string) === 0).length,
      tomorrow: published.filter((entry) => daysUntil(entry.due_date as string) === 1).length,
      week: published.filter((entry) => {
        const offset = daysUntil(entry.due_date as string);
        return offset >= 0 && offset <= 7;
      }).length,
    };
  }, [homework]);

  const prepareNow = async () => {
    const days = clampLead(leadDays);
    setPreparing(true);
    const { prepared, error: prepareError } = await runHomeworkDeadlineReminders(days);
    setPreparing(false);
    if (prepareError) { onToast(prepareError); return; }
    setLastRun({ days, prepared });
    await load();
    onToast(prepared === 0
      ? `No new reminders to prepare for work due in ${days} day${days === 1 ? '' : 's'}. Anything already prepared is left as it is.`
      : `${prepared} reminder${prepared === 1 ? '' : 's'} prepared for work due in ${days} day${days === 1 ? '' : 's'}. Review them below, then send.`);
  };

  const pickLanguage = (next: AbsenteeTemplate['language']) => {
    if (next === language) return;
    setLanguage(next);
    onToast(`${next} is now the active wording. Messages still waiting have been re-worded.`);
  };

  const pickSendMode = (next: AlertSendMode) => {
    if (next === sendMode) return;
    setSendMode(next);
    void saveAbsenteeSendMode(next);
    onToast(next === 'app'
      ? 'Homework alerts will open in the WhatsApp Desktop app from now on.'
      : next === 'web'
        ? 'Homework alerts will open in a WhatsApp Web browser tab from now on.'
        : 'Homework alerts will open via the universal WhatsApp link from now on.');
  };

  const saveWording = async () => {
    const text = activeWording[language].trim();
    const label = wordingKind === 'homework_reminder' ? 'reminder' : 'homework alert';
    if (!text) { onToast(`Write the ${label} message before saving it.`); return; }
    setSavingWording(true);
    const failure = await saveHomeworkWording(wordingKind, language, text);
    if (failure) { setSavingWording(false); onToast(failure); return; }
    const nextWording = wordingKind === 'homework_alert' ? { ...wording, [language]: text } : wording;
    const nextReminder = wordingKind === 'homework_reminder' ? { ...reminderWording, [language]: text } : reminderWording;
    const rewordError = await rewordHomeworkAlerts(rows, homework, language, nextWording, nextReminder);
    setSavingWording(false);
    if (rewordError) onToast(rewordError);
    else onToast(`${wordingKind === 'homework_reminder' ? 'Reminder' : 'Homework alert'} wording saved${queued.length > 0 ? ' and applied to the messages still waiting' : ''}.`);
    await load();
  };

  const toggleOne = (id: string) => setSelected((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const toggleAll = (checked: boolean) => setSelected(checked ? queued.map((row) => row.id) : []);

  const deleteSelected = async () => {
    if (sendable.length === 0) { onToast('Tick the rows you want to remove first.'); return; }
    const ids = sendable.map((row) => row.id);
    const failure = await removeHomeworkAlerts(ids);
    if (failure) { onToast(failure); return; }
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    await load();
    onToast(`${ids.length} row${ids.length === 1 ? '' : 's'} removed from the homework alert list.`);
  };

  const minPause = clampPause(pause.min, 3);
  const maxPause = clampPause(pause.max, 8);
  const lowPause = Math.min(minPause, maxPause);
  const highPause = Math.max(minPause, maxPause);

  const pickAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    const result = await uploadAbsenteeAttachment(file);
    setUploading(false);
    if (result.error) { onToast(result.error); return; }
    setAttachment({ url: result.url, name: result.name });
    onToast(`${result.name} attached. Its link is added to every homework message.`);
  };

  const clearAttachment = () => {
    setAttachment(null);
    if (fileInput.current) fileInput.current.value = '';
    onToast('Attachment removed. Homework messages will go out as text only.');
  };

  // Each message opens in the WhatsApp app or the one reused browser tab with the text
  // pre-filled. The pause between sends keeps the school number from being flagged.
  const sendSelected = async () => {
    if (sendable.length === 0) { onToast('Tick the guardians you want to message first.'); return; }
    const reachable = sendable.filter((row) => isValidWhatsAppNumber(row.parent_phone));
    const unreachableRows = sendable.filter((row) => !isValidWhatsAppNumber(row.parent_phone));
    if (reachable.length === 0) {
      onToast(`${unreachableRows.length} selected student${unreachableRows.length === 1 ? ' has' : 's have'} no valid WhatsApp number saved. Add one on the student record, then try again.`);
      return;
    }
    cancelSend.current = false;
    setSending(true);
    setSendProgress({ done: 0, total: reachable.length });
    setBlocked([]);
    setUnreachable(unreachableRows.map((row) => ({ id: row.id, student: row.student_name })));

    const outgoing = reachable.map((row) => ({
      row,
      message: messageWithAttachment(row.message_body ?? '', row.attachment_url ?? attachment?.url ?? null),
    }));

    const log = await queueSmsMessages(reachable.map((row, index) => ({
      student_id: row.student_id,
      student_name: row.student_name,
      class_name: row.class_name,
      section_name: row.section_name,
      parent_phone: row.parent_phone,
      message_type: row.alert_kind === 'reminder' ? 'homework_reminder' : 'homework_alert',
      message_body: outgoing[index].message,
      attendance_date: row.homework_date,
      attachment_url: row.attachment_url ?? attachment?.url ?? null,
      attachment_name: attachment?.name ?? null,
    })));
    if (log.error) {
      setSending(false);
      setSendProgress(null);
      onToast('The homework alerts could not be logged, so nothing was sent. Please try again.');
      return;
    }

    const sentIds: string[] = [];
    const sentLogIds: string[] = [];
    const blockedRows: typeof blocked = [];
    for (let index = 0; index < outgoing.length; index += 1) {
      if (cancelSend.current) break;
      if (index > 0) {
        const delay = lowPause + Math.random() * (highPause - lowPause);
        await wait(delay * 1000);
      }
      if (cancelSend.current) break;
      const { row, message } = outgoing[index];
      const opened = openWhatsAppChat(row.parent_phone, message, sendMode);
      if (opened.ok) {
        sentIds.push(row.id);
        sentLogIds.push(log.ids[index]);
      } else {
        blockedRows.push({ id: row.id, logId: log.ids[index] ?? null, student: row.student_name, phone: row.parent_phone ?? '', link: opened.link, message });
      }
      setSendProgress({ done: index + 1, total: outgoing.length });
    }

    if (sentLogIds.length > 0) {
      const statusError = await updateSmsStatus(sentLogIds, 'sent', 'Homework alert');
      const queueError = await markHomeworkAlertsSent(sentIds);
      if (statusError || queueError) {
        onToast(`${sentIds.length} WhatsApp chats were opened, but recording them failed. Open the WhatsApp SMS Report to review.`);
      }
    }

    if (blockedRows.length > 0) {
      setBlocked(blockedRows);
      onToast(`${blockedRows.length} homework message${blockedRows.length === 1 ? '' : 's'} queued — use the links below to open them in WhatsApp.`);
    } else if (sentIds.length > 0) {
      onToast(`${sentIds.length} WhatsApp chat${sentIds.length === 1 ? '' : 's'} opened in ${sendMode === 'app' ? 'the WhatsApp Desktop app' : sendMode === 'web' ? 'WhatsApp Web' : 'WhatsApp'} and recorded in the WhatsApp SMS Report.`);
    } else {
      await supabase.from('school_sms_log').delete().in('id', log.ids);
      onToast('Sending stopped. Nothing was sent.');
    }

    if (sentIds.length > 0) setSelected((current) => current.filter((id) => !sentIds.includes(id)));
    await load();
    setSending(false);
    setSendProgress(null);
  };

  const confirmBlockedSent = async (row: typeof blocked[number]) => {
    if (row.logId) await updateSmsStatus([row.logId], 'sent', 'Sent from a fallback link');
    await markHomeworkAlertsSent([row.id]);
    setBlocked((current) => current.filter((item) => item.id !== row.id));
    setSelected((current) => current.filter((id) => id !== row.id));
    await load();
    onToast(`Recorded the homework alert to ${row.student} as sent.`);
  };

  const schoolHeading = language === 'Urdu' ? SCHOOL_NAME_UR : SCHOOL_NAME;
  const dates = useMemo(
    () => Array.from(new Set(rows.map((row) => row.homework_date))).sort().reverse().slice(0, 10),
    [rows],
  );

  return (
    <div className="absentee-panel homework-alerts-panel">
      <div className="panel absentee-toolbar">
        <div className="absentee-toolbar-head">
          <div>
            <span className="eyebrow">Homework WhatsApp alerts</span>
            <h2>{schoolHeading} · {queued.length} homework message{queued.length === 1 ? '' : 's'} waiting to send</h2>
            <p className="panel-subtitle">
              Publishing homework for a class puts a message for every guardian on this list, and a matching notice in the parent and student portal straight away. Confirm the wording here, then send.
            </p>
          </div>
          <span className={`absentee-sync ${loading ? 'busy' : ''}`}>
            {loading ? <><Loader2 size={14} className="spin" /> Loading…</> : <><CheckCheck size={14} /> List up to date</>}
          </span>
        </div>
        <div className="absentee-toolbar-controls">
          <label className="control-field">Homework date
            <input type="date" value={forDate} onChange={(event) => setForDate(event.target.value)} />
          </label>
          <button type="button" className="secondary-button" onClick={() => setForDate('')}><RefreshCw size={15} /> All dates</button>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}><Loader2 size={15} className={loading ? 'spin' : ''} /> Refresh list</button>
        </div>
        <div className="absentee-sendmode">
          <span className="absentee-sendmode-label">Open chats in</span>
          <div className="segmented-control compact">
            {SEND_MODES.map((option) => {
              const ModeIcon = option.icon;
              return (
                <button key={option.value} type="button" className={sendMode === option.value ? 'selected' : ''} onClick={() => pickSendMode(option.value)}>
                  <ModeIcon size={14} /> {option.label}
                </button>
              );
            })}
          </div>
          <small className="absentee-sendmode-hint">{SEND_MODES.find((option) => option.value === sendMode)?.hint}</small>
        </div>
      </div>

      {error && <p className="dmc-warning">{error}</p>}

      {missingNumbers > 0 && (
        <p className="dmc-warning">
          {missingNumbers} waiting student{missingNumbers === 1 ? ' has' : 's have'} no valid WhatsApp number saved. WhatsApp Number is used first, then Messaging Number, then Father Contact No. Add a WhatsApp number on the student record to message them.
        </p>
      )}

      <div className="panel absentee-template">
        <div className="absentee-template-head">
          <div className="absentee-template-pickers">
            <div className="segmented-control compact lang-toggle">
              {(['English', 'Urdu'] as const).map((lang) => (
                <button key={lang} type="button" className={language === lang ? 'selected' : ''} onClick={() => pickLanguage(lang)}>
                  {lang}
                </button>
              ))}
            </div>
            <div className="segmented-control compact lang-toggle">
              <button
                type="button"
                className={wordingKind === 'homework_alert' ? 'selected' : ''}
                onClick={() => setWordingKind('homework_alert')}
              >
                <BookOpenCheck size={14} /> New homework
              </button>
              <button
                type="button"
                className={wordingKind === 'homework_reminder' ? 'selected' : ''}
                onClick={() => setWordingKind('homework_reminder')}
              >
                <BellRing size={14} /> Due soon
              </button>
            </div>
          </div>
          <span className="absentee-template-note">
            {wordingKind === 'homework_reminder'
              ? 'Sent automatically as the hand-in date approaches, so a guardian is reminded of work already set. The subject, title, class and hand-in date are filled in per student.'
              : 'One wording covers every subject. The subject, homework title, class and hand-in date are filled in for each student automatically.'}
          </span>
        </div>

        <label className="control-field absentee-template-field">
          {wordingKind === 'homework_reminder' ? 'Homework reminder message' : 'Homework alert message'}
          <textarea
            rows={3}
            dir={language === 'Urdu' ? 'rtl' : 'ltr'}
            className={language === 'Urdu' ? 'urdu-text' : undefined}
            value={activeWording[language]}
            onChange={(event) => setActiveWording(event.target.value)}
            placeholder={wordingKind === 'homework_reminder' ? 'Write the homework reminder wording' : 'Write the homework alert wording'}
          />
        </label>

        <div className="absentee-placeholders">
          <span>Tap to insert:</span>
          {HOMEWORK_PLACEHOLDERS.map((token) => (
            <button
              key={token}
              type="button"
              className="absentee-placeholder"
              onClick={() => setActiveWording(`${activeWording[language]}${token}`)}
            >
              {token}
            </button>
          ))}
        </div>

        <div className="absentee-preview">
          <span className="absentee-preview-label">
            Preview · {language}{previewRow ? ` · ${previewRow.student_name}` : sendable.length > 0 ? ' (first selected row)' : ''}
          </span>
          <p className={language === 'Urdu' ? 'urdu-text' : undefined} dir={language === 'Urdu' ? 'rtl' : 'ltr'}>{preview}</p>
        </div>

        <div className="absentee-template-actions">
          <button type="button" className="secondary-button" onClick={() => void saveWording()} disabled={savingWording}>
            <Save size={15} /> {savingWording ? 'Saving…' : `Save ${language} wording`}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setActiveWording(wordingKind === 'homework_reminder' ? DEFAULT_HOMEWORK_REMINDER_WORDING[language] : DEFAULT_HOMEWORK_WORDING[language])}
          >
            Restore default
          </button>
        </div>
      </div>

      <div className="panel hw-reminder-runner">
        <div className="hw-reminder-copy">
          <span className="hw-reminder-icon"><CalendarClock size={17} /></span>
          <div>
            <strong>Automatic deadline reminders</strong>
            <small>
              Reminders are prepared for every published assignment falling due in the chosen number of days, and appear below as “Due soon” rows. Preparing them again the same day adds nothing, so a guardian is never messaged twice. Confirm the wording above, then send from this list.
            </small>
          </div>
        </div>
        <div className="hw-reminder-controls">
          <label className="control-field compact">Remind before hand-in
            <select value={leadDays} onChange={(event) => setLeadDays(event.target.value)}>
              {['0', '1', '2', '3', '5', '7', '10', '14'].map((option) => (
                <option key={option} value={option}>
                  {option === '0' ? 'On the hand-in day' : option === '1' ? '1 day before' : `${option} days before`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={() => void prepareNow()} disabled={preparing || loading}>
            {preparing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            {preparing ? 'Preparing…' : 'Prepare reminders now'}
          </button>
        </div>
        <div className="hw-reminder-stats">
          <span className="hw-reminder-stat"><strong>{dueCounts.today}</strong> due today</span>
          <span className="hw-reminder-stat"><strong>{dueCounts.tomorrow}</strong> due tomorrow</span>
          <span className="hw-reminder-stat"><strong>{dueCounts.week}</strong> due within 7 days</span>
          <span className="hw-reminder-stat"><strong>{rows.filter((row) => row.alert_kind === 'reminder').length}</strong> reminder rows on this list</span>
          {lastRun && (
            <span className="hw-reminder-run">
              <CheckCheck size={13} /> {lastRun.prepared} prepared {lastRun.days === 0 ? 'for today' : `${lastRun.days} day${lastRun.days === 1 ? '' : 's'} ahead`}
            </span>
          )}
        </div>
      </div>

      <div className="panel absentee-attachment">
        <div className="absentee-attachment-head">
          <span className="absentee-attachment-icon"><Paperclip size={16} /></span>
          <div>
            <strong>Optional attachment for this batch</strong>
            <small>JPEG, PNG, PDF or Word document, up to 10 MB. Its link is added to every message you send from this screen. An assignment's own attachment link is always included.</small>
          </div>
        </div>
        <div className="absentee-attachment-body">
          <input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="absentee-file-input"
            onChange={(event) => void pickAttachment(event.target.files?.[0] ?? null)}
          />
          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={uploading || sending}>
            <Upload size={15} /> {uploading ? 'Uploading…' : attachment ? 'Replace file' : 'Choose file'}
          </button>
          {attachment && (
            <span className="absentee-attachment-chip">
              <Paperclip size={13} /> {attachment.name}
              <a href={attachment.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
              <button type="button" onClick={clearAttachment} aria-label="Remove attachment" disabled={sending}><X size={13} /></button>
            </span>
          )}
        </div>
      </div>

      <div className="panel absentee-queue">
        <div className="absentee-queue-head">
          <div className="absentee-queue-stats">
            <span className="absentee-chip queued"><Clock size={14} /> {rows.filter((row) => row.status === 'queued').length} waiting</span>
            <span className="absentee-chip sent"><CheckCheck size={14} /> {rows.filter((row) => row.status === 'sent').length} sent</span>
            <span className="absentee-chip total"><Users size={14} /> {rows.length} on the list</span>
          </div>
          <div className="absentee-queue-actions">
            <button type="button" className="secondary-button" onClick={() => toggleAll(true)} disabled={queued.length === 0 || allSelected}>Select all</button>
            <button type="button" className="secondary-button" onClick={() => toggleAll(false)} disabled={sendable.length === 0}>Unselect all</button>
            <button type="button" className="secondary-button danger" onClick={() => void deleteSelected()} disabled={sendable.length === 0 || sending}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </div>

        <div className="absentee-status-filter">
          <span className="absentee-filter-label">Show</span>
          {([['', 'All'], ['queued', 'Waiting'], ['sent', 'Sent']] as const).map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              className={`absentee-filter ${statusFilter === value ? 'on' : ''}`}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
          <span className="absentee-filter-label">Kind</span>
          {([['', 'Both'], ['assigned', 'New homework'], ['reminder', 'Due soon']] as const).map(([value, label]) => (
            <button
              key={value || 'both'}
              type="button"
              className={`absentee-filter ${kindFilter === value ? 'on' : ''}`}
              onClick={() => setKindFilter(value)}
            >
              {label}
            </button>
          ))}
          {dates.length > 0 && (
            <>
              <span className="absentee-filter-label">Jump to</span>
              {dates.map((day) => (
                <button key={day} type="button" className={`absentee-filter ${forDate === day ? 'on' : ''}`} onClick={() => setForDate(day)}>
                  {formatStamp(`${day}T00:00:00`)}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="absentee-pause">
          <span className="absentee-pause-icon"><Clock size={16} /></span>
          <div>
            <strong>Anti-ban pause between messages</strong>
            <small>A random pause inside this range is used between each WhatsApp message.</small>
          </div>
          <label className="control-field compact">Min (seconds)
            <input type="number" min="0" max="600" value={pause.min} onChange={(event) => setPause((current) => ({ ...current, min: event.target.value }))} />
          </label>
          <label className="control-field compact">Max (seconds)
            <input type="number" min="0" max="600" value={pause.max} onChange={(event) => setPause((current) => ({ ...current, max: event.target.value }))} />
          </label>
          <span className="absentee-pause-summary">{lowPause}–{highPause}s between each send</span>
        </div>

        <div className="table-wrap">
          <table className="min-w-[1000px]">
            <thead>
              <tr>
                <th className="absentee-check">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-600"
                    checked={allSelected}
                    disabled={queued.length === 0}
                    onChange={(event) => toggleAll(event.target.checked)}
                    aria-label="Select all waiting homework messages"
                  />
                </th>
                <th>Student</th>
                <th>Kind</th>
                <th>Class / Section</th>
                <th>Homework date</th>
                <th>Parent number</th>
                <th>Message</th>
                <th>Attachment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.status === 'sent' ? 'absentee-row sent' : 'absentee-row'}>
                  <td className="absentee-check">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-600"
                      checked={selected.includes(row.id)}
                      disabled={row.status === 'sent'}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Select ${row.student_name}`}
                    />
                  </td>
                  <td><strong>{row.student_name}</strong></td>
                  <td>
                    {row.alert_kind === 'reminder' ? (
                      <span className="hw-kind-chip reminder" title={`Prepared ${row.reminder_days_before ?? 0} day(s) before the hand-in date`}>
                        <BellRing size={12} /> Due soon
                      </span>
                    ) : (
                      <span className="hw-kind-chip assigned"><BookOpenCheck size={12} /> New</span>
                    )}
                  </td>
                  <td>{row.class_name ? `${row.class_name} · ${row.section_name ?? '—'}` : '—'}</td>
                  <td className="muted-cell">{formatStamp(`${row.homework_date}T00:00:00`)}</td>
                  <td>
                    {row.parent_phone
                      ? <span className="absentee-number">{row.parent_phone}</span>
                      : <span className="absentee-number missing">No number</span>}
                  </td>
                  <td
                    className={`absentee-message ${row.language === 'Urdu' ? 'urdu-text' : ''}`}
                    dir={row.language === 'Urdu' ? 'rtl' : 'ltr'}
                  >
                    {row.message_body || '—'}
                  </td>
                  <td>
                    {row.attachment_url
                      ? <a className="sms-attachment" href={row.attachment_url} target="_blank" rel="noreferrer"><Paperclip size={12} /> Open</a>
                      : <span className="muted-cell">—</span>}
                  </td>
                  <td>
                    <span className={`absentee-status ${row.status}`}>
                      {row.status === 'sent' ? <><CheckCheck size={14} /> Sent</> : <><Clock size={14} /> Waiting</>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <div className="empty-state large">
              <BookOpenCheck size={20} />
              {statusFilter === 'sent'
                ? 'No homework alerts have been sent for these filters yet.'
                : kindFilter === 'reminder'
                  ? 'No deadline reminders have been prepared for these filters. Use Prepare reminders now to raise them for work falling due.'
                  : forDate
                    ? 'No homework alerts were raised for this date. Publish homework for a class and its guardians appear here on their own.'
                    : 'No homework alerts are waiting. Publish homework for a class from the Homework tab and every guardian appears here on their own.'}
            </div>
          )}
          {loading && <div className="empty-state large">Loading homework alerts…</div>}
        </div>

        <div className="absentee-send-bar">
          <span className="absentee-send-copy">
            {sendable.length === 0
              ? 'Tick the guardians to message, or use Select all.'
              : `${sendable.length} guardian${sendable.length === 1 ? '' : 's'} selected · about ${Math.max(0, sendable.length - 1) * ((lowPause + highPause) / 2) | 0}s of pauses`}
          </span>
          <div className="absentee-send-actions">
            {sending && (
              <button type="button" className="ghost-button" onClick={() => { cancelSend.current = true; }}>Stop after this one</button>
            )}
            <button type="button" className="primary-button" onClick={() => void sendSelected()} disabled={sending || uploading || sendable.length === 0}>
              <Send size={16} />
              {sending && sendProgress ? `Opening ${sendProgress.done}/${sendProgress.total}…` : 'Send selected homework alerts'}
            </button>
          </div>
        </div>

        {unreachable.length > 0 && (
          <div className="absentee-blocked unreachable">
            <div className="absentee-blocked-head">
              <AlertTriangle size={16} />
              <div>
                <strong>{unreachable.length} student{unreachable.length === 1 ? '' : 's'} could not be messaged</strong>
                <small>No valid WhatsApp number is saved for them, so no chat was opened. Save a WhatsApp number on the student record and send again.</small>
              </div>
            </div>
            <ul>
              {unreachable.map((row) => (
                <li key={row.id}><span><strong>{row.student}</strong><small>No valid WhatsApp number saved</small></span></li>
              ))}
            </ul>
          </div>
        )}

        {blocked.length > 0 && (
          <div className="absentee-blocked">
            <div className="absentee-blocked-head">
              <AlertTriangle size={16} />
              <div>
                <strong>{blocked.length} chat{blocked.length === 1 ? '' : 's'} were blocked by your browser</strong>
                <small>Click <strong>Open WhatsApp App</strong> to launch the installed app. If that does not work, use <strong>WhatsApp Web</strong> to open it in a browser tab, then mark it as sent.</small>
              </div>
            </div>
            <ul>
              {blocked.map((row) => (
                <li key={row.id}>
                  <span><strong>{row.student}</strong><small>{row.phone || 'No number saved'}</small></span>
                  <a className="primary-button" href={row.link} rel="noreferrer"><Send size={14} /> Open WhatsApp App</a>
                  <a className="secondary-button" href={whatsappWebLink(row.phone, row.message)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> WhatsApp Web</a>
                  <button type="button" className="ghost-button" onClick={() => void confirmBlockedSent(row)}><CheckCheck size={14} /> Mark as sent</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rows.length === 0 && !loading && !error && (
        <p className="hw-hint">
          <MessageCircle size={14} /> Homework alerts appear here the moment a teacher publishes an assignment, and deadline reminders appear as the hand-in date approaches. Drafts never notify anyone.
        </p>
      )}
    </div>
  );
}
