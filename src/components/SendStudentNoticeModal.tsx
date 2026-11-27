import { useEffect, useMemo, useState } from 'react';
import { Bell, FileText, History, MessageCircle, Printer, RefreshCw, Save, Send, ShieldAlert, X } from 'lucide-react';
import { NoticeSlip, type NoticeSlipData } from '@/components/NoticeSlip';
import { fillNoticePlaceholders, fetchNoticeTemplates, fetchSentNotices, noticePlaceholderValues, pickTemplateForContext, renderStudentNotice, sendStudentNotice, type NoticeContext } from '@/lib/sentNotices';
import { useSchoolProfile } from '@/lib/schoolProfile';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { pickWhatsAppContact, whatsappNumberWarning } from '@/lib/whatsapp';
import { formatAbsenteeDate } from '@/lib/noticeText';
import { NOTICE_CATEGORIES, NOTICE_LANGUAGES, type NoticeCategory, type NoticeLanguage, type NoticeTemplate, type SentNotice, type Student } from '@/lib/schoolTypes';

const CONTEXT_DEFAULT_CATEGORY: Record<NoticeContext, NoticeCategory> = {
  fee: 'FEE',
  warning: 'WARNING',
  attendance: 'ATTENDANCE',
  general: 'NOTICE',
};

const CONTEXT_EYEBROW: Record<NoticeContext, string> = {
  fee: 'Fee follow-up',
  warning: 'Discipline follow-up',
  attendance: 'Attendance follow-up',
  general: 'School notice',
};

type Props = {
  student: Student;
  context?: NoticeContext;
  senderName?: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onSent?: () => void;
};

export function SendStudentNoticeModal({ student, context = 'general', senderName = '', onClose, onToast, onSent }: Props) {
  const profile = useSchoolProfile();
  const [templates, setTemplates] = useState<NoticeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [template, setTemplate] = useState<NoticeTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<NoticeCategory>(CONTEXT_DEFAULT_CATEGORY[context]);
  const [language, setLanguage] = useState<NoticeLanguage>('English');
  const [englishText, setEnglishText] = useState('');
  const [urduText, setUrduText] = useState('');
  const [busy, setBusy] = useState('');
  const [printing, setPrinting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SentNotice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const values = useMemo(
    () => noticePlaceholderValues(student, profile?.school_name),
    [student, profile?.school_name],
  );

  const applyTemplate = (next: NoticeTemplate | null) => {
    setTemplate(next);
    if (!next) return;
    setTitle(next.title);
    setCategory(next.category);
    setEnglishText(fillNoticePlaceholders(next.body_english, values));
    setUrduText(fillNoticePlaceholders(next.body_urdu, values));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchNoticeTemplates();
      if (cancelled) return;
      setTemplates(result.templates);
      setLoadError(result.error ?? '');
      setLoading(false);
      applyTemplate(pickTemplateForContext(result.templates, context));
    })();
    return () => { cancelled = true; };
    // The template is chosen once, from the screen this modal was opened from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  // Switching language rewrites the fields from the saved template, so the office is
  // never left with English text sitting in the Urdu box.
  useEffect(() => {
    if (!template) return;
    setEnglishText(fillNoticePlaceholders(template.body_english, values));
    setUrduText(fillNoticePlaceholders(template.body_urdu, values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const showEnglish = language === 'English' || language === 'Bilingual';
  const showUrdu = language === 'Urdu' || language === 'Bilingual';
  const renderedText = renderStudentNotice({ body_english: englishText, body_urdu: urduText }, language, values).trim();
  const contact = pickWhatsAppContact(student);
  const contactProblem = whatsappNumberWarning(student);

  const slip: NoticeSlipData = {
    student,
    title,
    category,
    language,
    english: englishText,
    urdu: urduText,
    reference: `N-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${student.admission_number}`,
    dateLabel: formatAbsenteeDate(new Date().toISOString()),
    senderName,
  };
  usePrintSheet(printing, <NoticeSlip data={slip} />);

  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => window.print(), 260);
    const finish = () => setPrinting(false);
    window.addEventListener('afterprint', finish);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', finish); };
  }, [printing]);

  const log = async (channels: string[], whatsappNumber: string) => {
    const result = await sendStudentNotice({
      student,
      template,
      title: title.trim() || 'Notice from the school',
      category,
      bodyEnglish: englishText,
      bodyUrdu: urduText,
      language,
      renderedText,
      channels,
      whatsappNumber,
    });
    if (result.error) return result.error;
    onSent?.();
    return null;
  };

  const sendWhatsApp = async () => {
    if (!renderedText) { onToast('Write the notice wording first.'); return; }
    if (!contact.number) { onToast(contactProblem); return; }
    setBusy('whatsapp');
    const message = [title.trim(), '', renderedText].filter((part, index) => part || index === 1).join('\n');
    const { ok } = openWhatsAppChat(contact.number, message, 'web');
    const error = await log(['whatsapp'], contact.number);
    setBusy('');
    if (error) { onToast('WhatsApp opened, but the notice could not be logged.'); return; }
    onToast(ok
      ? `WhatsApp notice ready for ${student.full_name} (${contact.source ?? 'contact'})`
      : `WhatsApp could not be opened. The notice was saved to the history.`);
  };

  const printSlip = () => {
    if (!renderedText) { onToast('Write the notice wording first.'); return; }
    setPrinting(true);
    onToast('Notice slip sent to print');
  };

  const postToPortal = async () => {
    if (!renderedText) { onToast('Write the notice wording first.'); return; }
    setBusy('portal');
    const error = await log(['portal', 'log'], contact.number);
    setBusy('');
    if (error) { onToast('The notice could not be posted to the parent portal.'); return; }
    onToast(`${student.full_name}'s notice is now in the parent portal and the sent history`);
    void loadHistory();
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    const result = await fetchSentNotices(student.id);
    setHistory(result.notices);
    setHistoryLoading(false);
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) void loadHistory();
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal send-notice-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">SchoolDesk · {CONTEXT_EYEBROW[context]}</span>
            <h2 className="send-notice-heading">Send Student Notice</h2>
            <small className="send-notice-sub">{student.full_name} · {[student.class_name, student.section_name].filter(Boolean).join(' · ')} · Roll {student.roll_number || '—'}</small>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {loadError ? <div className="send-notice-error"><ShieldAlert size={16} /> {loadError}</div> : null}

        <div className="send-notice-controls">
          <label className="control-field"><span>Saved template</span>
            <select value={template?.notice_type ?? ''} disabled={loading} onChange={(event) => applyTemplate(templates.find((item) => item.notice_type === event.target.value) ?? null)}>
              <option value="">{loading ? 'Loading templates…' : 'Write a one-off notice'}</option>
              {templates.map((item) => <option key={item.id} value={item.notice_type}>{item.title} · {item.category}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as NoticeCategory)}>
              {NOTICE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="control-field"><span>Language</span>
            <div className="segmented-control compact lang-toggle">
              {NOTICE_LANGUAGES.map((item) => (
                <button key={item} type="button" className={language === item ? 'selected' : ''} onClick={() => setLanguage(item)}>{item === 'Bilingual' ? 'English + Urdu' : item}</button>
              ))}
            </div>
          </label>
        </div>

        <label className="control-field send-notice-title"><span>Notice title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fee clearance reminder" />
        </label>

        <div className="send-notice-bodies">
          {showEnglish ? (
            <label className="control-field full"><span>English message <small>filled in with {student.full_name}'s details — edit freely</small></span>
              <textarea value={englishText} onChange={(event) => setEnglishText(event.target.value)} rows={6} placeholder="Dear Parent, …" />
            </label>
          ) : null}
          {showUrdu ? (
            <label className="control-field full"><span>Urdu message</span>
              <textarea className="urdu-input" dir="rtl" value={urduText} onChange={(event) => setUrduText(event.target.value)} rows={6} placeholder="محترم والدین …" />
            </label>
          ) : null}
        </div>

        <div className="send-notice-placeholders">
          <FileText size={15} />
          <span>Placeholders are filled automatically: {['student_name', 'father_name', 'class_name', 'roll_no', 'due_amount', 'date', 'school_name'].map((key) => <code key={key}>{`{{${key}}}`}</code>)}</span>
          {template ? <button type="button" className="fee-link" onClick={() => applyTemplate(template)}><RefreshCw size={13} /> Reset to template</button> : null}
        </div>

        <div className="send-notice-preview">
          <span className="eyebrow">{language === 'Bilingual' ? 'Preview · English + Urdu' : `Preview · ${language}`}</span>
          {showEnglish && englishText.trim() ? <p className="notice-slip-english">{englishText}</p> : null}
          {showUrdu && urduText.trim() ? <p className="notice-slip-urdu urdu-text" dir="rtl">{urduText}</p> : null}
          {!renderedText ? <p className="notice-slip-placeholder">Choose a template or write the wording above.</p> : null}
        </div>

        {contact.number ? (
          <p className="send-notice-contact"><MessageCircle size={14} /> WhatsApp will open for <b>{student.guardian_phone || contact.raw}</b> ({contact.source})</p>
        ) : (
          <p className="send-notice-contact warn"><ShieldAlert size={14} /> {contactProblem}</p>
        )}

        <div className="send-notice-actions">
          <button type="button" className="primary-button wa" onClick={() => void sendWhatsApp()} disabled={busy !== ''}>
            <Send size={16} /> {busy === 'whatsapp' ? 'Opening…' : 'Send via WhatsApp'}
          </button>
          <button type="button" className="primary-button print" onClick={printSlip} disabled={busy !== ''}>
            <Printer size={16} /> Print Notice Slip
          </button>
          <button type="button" className="primary-button portal" onClick={() => void postToPortal()} disabled={busy !== ''}>
            <Save size={16} /> {busy === 'portal' ? 'Posting…' : 'Post to Parent Portal & Log'}
          </button>
        </div>

        <div className="send-notice-history">
          <button type="button" className="history-toggle" onClick={toggleHistory} aria-expanded={historyOpen}>
            <History size={15} /> {historyOpen ? 'Hide sent notices' : 'Sent notices history'}
          </button>
          {historyOpen ? (
            historyLoading ? <p className="fee-empty">Loading history…</p> : history.length === 0 ? (
              <p className="fee-empty">Nothing has been sent to {student.full_name} yet.</p>
            ) : (
              <ul className="send-notice-history-list">
                {history.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{row.title}</strong>
                      <small>{new Date(row.created_at).toLocaleString()} · {row.language} · {row.delivery_channels.join(', ') || 'logged'}</small>
                    </div>
                    <span className={`template-badge ${row.category.toLowerCase()}`}><Bell size={11} /> {row.category}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}
