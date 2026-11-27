import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarOff, Camera, ClipboardCopy, CornerDownLeft, FileText, Info, Loader as Loader2, MessageCircle, Mic, MicOff, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import {
  answerQuestion,
  detectIntent,
  greetingFor,
  type AssistantAction,
  type AssistantContext,
  type AssistantReply,
  type AssistantTool,
} from '@/lib/assistant';
import { canUseIntent, canUseTool, isPortalRole, quickChipsFor, scopeLabel } from '@/lib/assistantRoles';
import { ClassOffTool, DatesheetTool, RemindersTool } from '@/components/AssistantTools';
import { PaperTool } from '@/components/AssistantPaperTool';
import { prepareImageFile, type PreparedImage } from '@/lib/paperImage';
import { useSchoolData } from '@/lib/schoolData';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { openWhatsAppChat } from '@/lib/whatsappQueue';
import { useVoiceInput } from '@/lib/useVoiceInput';

type Toast = (message: string) => void;

const TOOL_TITLES: Record<AssistantTool, string> = {
  classOff: 'Mark a class off',
  datesheet: 'Exam datesheet',
  reminders: 'Fee reminders',
  paper: 'Quiz / paper generator',
};

// Copies text, falling back to a hidden selection where the async clipboard is blocked.
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

export function SchoolAssistant({
  onNavigate,
  onToast,
}: {
  onNavigate: (view: string) => void;
  onToast: Toast;
}) {
  const { students, attendance, refresh } = useSchoolData();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [tool, setTool] = useState<AssistantTool | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // Which engine produced the answer on screen, and why it fell back if it did.
  const [engine, setEngine] = useState<'ai' | 'local'>('local');
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<{ linkedStudentIds: string[]; ownStudentId: string | null }>({ linkedStudentIds: [], ownStudentId: null });
  // A photo attached to the chat, and the plain answer given when a role may not use the
  // paper generator.
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [quizNotice, setQuizNotice] = useState<string | null>(null);
  // The topic typed in the chat, carried into the generator so the teacher does not have
  // to type it twice.
  const [paperSeed, setPaperSeed] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const role = profile?.role ?? 'student';
  // Generating a quiz paper is a staff capability; the exact refusal wording is shared
  // with the server so both say the same thing.
  const canMakePaper = canUseIntent(role, 'paper');

  // A parent account is linked to its children through parent_student_links; a student
  // account carries its own student id. Staff carry neither, which is what keeps their
  // answers school-wide. The database enforces the same links, so this only decides what
  // the assistant offers to show.
  useEffect(() => {
    if (!profile || !isPortalRole(profile.role)) {
      setLinks({ linkedStudentIds: [], ownStudentId: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      if (profile.role === 'parent') {
        const { data } = await supabase
          .from('parent_student_links')
          .select('student_id')
          .eq('parent_user_id', profile.id);
        if (!cancelled) setLinks({ linkedStudentIds: ((data ?? []) as { student_id: string }[]).map((row) => row.student_id), ownStudentId: null });
      } else {
        const { data } = await supabase
          .from('user_profiles')
          .select('student_id')
          .eq('id', profile.id)
          .maybeSingle();
        if (!cancelled) setLinks({ linkedStudentIds: [], ownStudentId: (data as { student_id: string | null } | null)?.student_id ?? null });
      }
    })();
    return () => { cancelled = true; };
  }, [profile]);

  const context = useMemo<AssistantContext | null>(
    () => (profile ? { students, attendance, profile, linkedStudentIds: links.linkedStudentIds, ownStudentId: links.ownStudentId } : null),
    [students, attendance, profile, links],
  );

  // The opening card shows live figures the moment the panel opens, limited to what the
  // signed-in role is entitled to see.
  const greeting = useMemo<AssistantReply | null>(
    () => (context ? greetingFor(context) : null),
    [context],
  );

  const chips = useMemo(() => quickChipsFor(role), [role]);

  const shown = reply ?? greeting;

  const run = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || !context) return;
    // A request to build a paper is not a question for the model: it opens the generator,
    // where the topic or the photo is turned into the paper. The permission is checked
    // first, so a parent or student is told plainly instead of being sent to a tool.
    if (detectIntent(text).kind === 'paper') {
      setCommand('');
      if (!canUseIntent(context.profile.role, 'paper')) {
        setReply({ title: 'Quiz / paper generator', notes: ['this function is available for admins only.'] });
        setEngine('local');
        setEngineNotice(null);
        return;
      }
      // A short trigger ("generate quiz paper") opens the tool empty; a longer sentence is
      // treated as the topic the paper should be written about.
      setPaperSeed(text.split(/\s+/).length > 4 ? text : '');
      setTool('paper');
      return;
    }
    setBusy(true);
    setCommand('');
    setHistory((current) => [...current.slice(-4), text]);
    // The smart assistant answers first; the local rule-based bot is the backup, so a
    // rate limit or an outage never leaves the question unanswered.
    const result = await answerQuestion(text, context);
    setReply(result.reply);
    setEngine(result.source);
    setEngineNotice(result.notice ?? null);
    // A tool is only opened if the role is allowed to use it, so a reply can never
    // hand a parent or student a panel they are not entitled to.
    if (result.reply.openTool && canUseTool(context.profile.role, result.reply.openTool)) setTool(result.reply.openTool);
    setBusy(false);
  }, [context]);

  // Opening the generator. A role that may not use it gets the fixed sentence rather than
  // an empty panel.
  const openPaper = useCallback(() => {
    if (!canMakePaper) {
      setQuizNotice('this function is available for admins only.');
      return;
    }
    setQuizNotice(null);
    // Anything already typed becomes the paper's instruction.
    setPaperSeed(command.trim());
    setCommand('');
    setTool('paper');
  }, [canMakePaper, command]);

  // The photo is scaled down here, before it is attached, so an ordinary camera shot
  // becomes a small image the assistant can read.
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (!canMakePaper) {
      setQuizNotice('this function is available for admins only.');
      return;
    }
    setPreparing(true);
    setQuizNotice(null);
    const result = await prepareImageFile(file);
    setPreparing(false);
    if ('error' in result) {
      setQuizNotice(result.error);
      return;
    }
    setImage(result.image);
  };

  const submit = () => {
    if (voice.listening) { voice.stop(); return; }
    // A photo always means "make a paper from this page", which is what the camera icon
    // and the quiz pill are for. Text on its own is an ordinary question.
    if (image) { openPaper(); return; }
    if (command.trim()) void run(command);
  };

  const closeTool = () => {
    setTool(null);
    setImage(null);
    setPaperSeed('');
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // While listening, the recognised words are streamed straight into the command box so
  // the office can see the command forming. When the speaker stops, the finished command
  // is run through the very same parser the typed commands use.
  const voice = useVoiceInput({
    onTranscript: (text) => setCommand(text),
    onFinal: (text) => {
      setVoiceNotice(null);
      void run(text);
    },
  });

  useEffect(() => {
    if (voice.error) setVoiceNotice(voice.error);
  }, [voice.error]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [reply, tool]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { voice.stop(); setOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, voice.stop]);

  const runAction = async (action: AssistantAction) => {
    if (action.kind === 'copy') {
      const ok = await copyText(action.text);
      onToast(ok ? 'Copied to the clipboard' : 'Could not copy. Select the text and copy it manually.');
      return;
    }
    if (action.kind === 'whatsapp') {
      // Only staff reach a WhatsApp action: the parent and student replies never build one.
      const result = openWhatsAppChat(action.phone, action.message, 'web');
      if (!result.ok) onToast('WhatsApp could not open. Check the contact number and try again.');
      return;
    }
    if (action.kind === 'navigate') {
      onNavigate(action.view);
      setOpen(false);
      return;
    }
    if (!canUseTool(role, action.tool)) {
      onToast('That tool is not available for your account.');
      return;
    }
    setTool(action.tool);
  };

  const openFloating = open && (
    <section className="assistant-panel" role="dialog" aria-label="School Assistant">
      <header className="assistant-panel-head">
        <div className="assistant-identity">
          <span className="assistant-avatar"><Sparkles size={17} /></span>
          <div>
            <strong>School Assistant</strong>
            <span>{scopeLabel(role)}</span>
            <span className={`assistant-engine ${engine}`}>
              {engine === 'ai' ? 'Gemini smart answers' : 'Built-in answers'}
            </span>
          </div>
        </div>
        <div className="assistant-head-actions">
          <button className="assistant-icon-button" type="button" title="Refresh data" onClick={() => void refresh()}><RefreshCw size={15} /></button>
          <button className="assistant-icon-button" type="button" title="Close" onClick={() => { voice.stop(); setOpen(false); }}><X size={16} /></button>
        </div>
      </header>

      <div className="assistant-panel-body" ref={scrollRef}>
        {tool ? (
          <div className="assistant-tool-view">
            <button className="assistant-back" type="button" onClick={closeTool}>
              <CornerDownLeft size={14} /> Back to the assistant
            </button>
            <h3>{TOOL_TITLES[tool]}</h3>
            {tool === 'classOff' && <ClassOffTool onToast={onToast} />}
            {tool === 'datesheet' && <DatesheetTool onToast={onToast} />}
            {tool === 'reminders' && <RemindersTool students={students} onToast={onToast} />}
            {tool === 'paper' && <PaperTool key={paperSeed || (image ? 'photo' : 'blank')} onToast={onToast} initialTopic={paperSeed} initialImage={image} />}
          </div>
        ) : shown ? (
          <>
            <article className="assistant-card">
              <h3>{shown.title}</h3>
              {shown.notes?.map((note) => <p key={note} className="assistant-note">{note}</p>)}
            </article>

            {shown.stats && shown.stats.length > 0 && (
              <div className="assistant-stat-grid">
                {shown.stats.map((stat) => (
                  <div className={`assistant-stat ${stat.tone ?? 'info'}`} key={stat.label}>
                    <span>{stat.label}</span><strong>{stat.value}</strong>
                  </div>
                ))}
              </div>
            )}

            {shown.table && (
              <div className="assistant-table-wrap">
                <table className="assistant-table">
                  <thead><tr>{shown.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>
                    {shown.table.rows.map((row, index) => (
                      <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {shown.list && (
              <ul className="assistant-list">
                {shown.list.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <strong>{item.title}</strong>
                    {item.subtitle && <span>{item.subtitle}</span>}
                    {item.meta && <em>{item.meta}</em>}
                  </li>
                ))}
              </ul>
            )}

            {shown.actions && shown.actions.length > 0 && (
              <div className="assistant-actions">
                {shown.actions.map((action) => (
                  <button key={action.id} className="ghost-button" type="button" onClick={() => void runAction(action)}>
                    {action.kind === 'copy' ? <ClipboardCopy size={15} /> : action.kind === 'whatsapp' ? <MessageCircle size={15} /> : action.kind === 'tool' ? <CalendarOff size={15} /> : <Send size={15} />}
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {shown.followUps && shown.followUps.length > 0 && (
              <div className="assistant-followups">
                <span className="assistant-followups-label">Try next</span>
                <div className="assistant-chip-set">
                  {shown.followUps.map((item) => (
                    <button key={item} className="assistant-chip small" type="button" onClick={() => void run(item)}>{item}</button>
                  ))}
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className="assistant-followups">
                <span className="assistant-followups-label">Recent</span>
                <div className="assistant-chip-set">
                  {history.map((item, index) => (
                    <button key={`${item}-${index}`} className="assistant-chip small quiet" type="button" onClick={() => void run(item)}>{item}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="assistant-empty">Loading your school data…</p>
        )}

        {engineNotice && (
          <p className="assistant-engine-notice">
            <Info size={14} />
            <span>{engineNotice}</span>
            <button type="button" onClick={() => setEngineNotice(null)} aria-label="Dismiss"><X size={13} /></button>
          </p>
        )}
        {quizNotice && (
          <p className="assistant-engine-notice">
            <Info size={14} />
            <span>{quizNotice}</span>
            <button type="button" onClick={() => setQuizNotice(null)} aria-label="Dismiss"><X size={13} /></button>
          </p>
        )}
        {voiceNotice && (
          <p className="assistant-voice-notice">
            <MicOff size={14} />
            <span>{voiceNotice}</span>
            <button type="button" onClick={() => setVoiceNotice(null)} aria-label="Dismiss"><X size={13} /></button>
          </p>
        )}
      </div>

      {!tool && (
        <div className="assistant-chips">
          {canMakePaper && (
            <button className="assistant-pill" type="button" onClick={openPaper} disabled={busy || voice.listening}>
              <FileText size={14} /> Generate Quiz/Paper
            </button>
          )}
          {chips.map((chip) => (
            <button key={chip.command} className="assistant-chip" type="button" onClick={() => void run(chip.command)} disabled={busy || voice.listening}>
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="assistant-composer"
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        {image && (
          <div className="assistant-attachment">
            <img src={image.preview} alt="Attached page" />
            <span>{image.name}</span>
            <button type="button" onClick={() => setImage(null)} aria-label="Remove the attached photo"><X size={13} /></button>
          </div>
        )}
        <div className="assistant-composer-row">
          <input
            ref={inputRef}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={voice.listening
              ? 'Listening… speak your command'
              : canMakePaper
                ? 'Ask a question, or attach a page for a quiz…'
                : 'Ask about attendance, fees, records, results…'}
            aria-label="Ask the School Assistant"
          />
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="assistant-file-input"
            onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ''; }}
          />
          <button
            className="assistant-camera"
            type="button"
            onClick={() => { if (!canMakePaper) { setQuizNotice('this function is available for admins only.'); return; } imageRef.current?.click(); }}
            title={canMakePaper ? 'Snap or upload a textbook page' : 'Available to admins and teachers only'}
            aria-label="Attach a photo of a textbook page"
            disabled={preparing}
          >
            {preparing ? <Loader2 size={17} className="assistant-spin" /> : <Camera size={17} />}
          </button>
          <button
            className={`assistant-mic ${voice.listening ? 'listening' : ''}`}
            type="button"
            onClick={() => { if (voice.listening) { voice.stop(); return; } voice.start(); }}
            title={voice.supported ? (voice.listening ? 'Stop listening' : 'Speak your command') : 'Voice input is not available in this browser'}
            aria-label={voice.listening ? 'Stop listening' : 'Speak your command'}
            aria-pressed={voice.listening}
          >
            {voice.listening ? <MicOff size={17} /> : <Mic size={17} />}
            {voice.listening && <span className="assistant-mic-ring" />}
          </button>
          <button className="assistant-send" type="submit" disabled={busy || preparing || (!command.trim() && !image)} aria-label="Send">
            {busy ? <Loader2 size={17} className="assistant-spin" /> : <Send size={17} />}
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <div className="assistant-root">
      {openFloating}
      <button
        className={`assistant-launcher ${open ? 'open' : ''}`}
        type="button"
        onClick={() => setOpen((current) => { if (current) voice.stop(); return !current; })}
        aria-label={open ? 'Close the School Assistant' : 'Open the School Assistant'}
        title="School Assistant"
      >
        {open ? <X size={22} /> : <Bot size={24} />}
        {!open && <span className="assistant-launcher-dot" />}
      </button>
    </div>
  );
}
