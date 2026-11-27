import { useEffect, useRef, useState } from 'react';
import { Camera, ClipboardCopy, FileDown, FileText, ImagePlus, Loader as Loader2, MessageCircle, Printer, Sparkles, Trash2 } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { prepareImageFile, type PreparedImage } from '@/lib/paperImage';
import { paperToText, sanitisePaper, type Paper } from '@/lib/quizPaper';
import { downloadPaperDocx } from '@/lib/docx';
import { DEFAULT_LOGO, fetchSchoolLogo, logoForDocx, prepareLogoFile, saveSchoolLogo } from '@/lib/schoolLogo';
import { requestPaper } from '@/lib/assistantGemini';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { useAuth } from '@/lib/auth';
import { openWhatsAppChat } from '@/lib/whatsappQueue';

type Toast = (message: string) => void;

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

// The printable paper. Only this block is shown while printing, so the sheet is the paper
// and nothing else, and the browser's "Save as PDF" turns it into a file.
function PaperSheet({ paper, logo }: { paper: Paper; logo: string }) {
  return (
    <div className="print-only print-quiz-sheet">
      <header className="print-quiz-head">
        <img src={logo || DEFAULT_LOGO} alt="" />
        <div>
          <strong>{SCHOOL_NAME}</strong>
          <span>{paper.title}</span>
        </div>
      </header>

      <div className="print-quiz-meta">
        {paper.subject && <span><b>Subject:</b> {paper.subject}</span>}
        {paper.className && <span><b>Class:</b> {paper.className}</span>}
        {paper.timeAllowed && <span><b>Time:</b> {paper.timeAllowed}</span>}
        {paper.totalMarks && <span><b>Total marks:</b> {paper.totalMarks}</span>}
      </div>

      <div className="print-quiz-lines">
        <span>Name: ______________________</span>
        <span>Roll no.: ____________</span>
      </div>

      {paper.instructions.length > 0 && (
        <div className="print-quiz-instructions">
          <b>Instructions</b>
          <ul>{paper.instructions.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}

      {paper.sections.map((section) => (
        <section className="print-quiz-section" key={section.heading}>
          <h4>{section.heading}</h4>
          {section.instructions && <p className="print-quiz-section-note">{section.instructions}</p>}
          <ol>
            {section.questions.map((question, index) => (
              <li key={`${question.question}-${index}`}>
                <span className="print-quiz-question">
                  {question.question}
                  {question.marks && <em> [{question.marks}]</em>}
                </span>
                {question.options.length > 0 && (
                  <ul className="print-quiz-options">
                    {question.options.map((option) => <li key={option}>{option}</li>)}
                  </ul>
                )}
                <span className="print-quiz-answer-line" />
              </li>
            ))}
          </ol>
        </section>
      ))}

      <section className="print-quiz-section print-quiz-key">
        <h4>Answer key</h4>
        {paper.sections.map((section) => (
          <div key={section.heading}>
            <p className="print-quiz-section-note">{section.heading}</p>
            <ol>{section.questions.map((question, index) => <li key={`${question.answer}-${index}`}>{question.answer || '—'}</li>)}</ol>
          </div>
        ))}
      </section>

      <footer className="print-quiz-foot">{SCHOOL_NAME} — generated with the School Assistant</footer>
    </div>
  );
}

export function PaperTool({ onToast, initialTopic, initialImage }: { onToast: Toast; initialTopic?: string; initialImage?: PreparedImage | null }) {
  const { profile } = useAuth();
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [image, setImage] = useState<PreparedImage | null>(initialImage ?? null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logo, setLogo] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const logoRef = useRef<HTMLInputElement | null>(null);

  // Only the paper is printed; the panel around it is hidden by the print stylesheet.
  usePrintSheet(paper !== null, paper ? <PaperSheet paper={paper} logo={logo} /> : null);

  // The logo belongs to the school, not to this paper, so it is loaded once when the
  // tool opens and every paper afterwards carries it.
  useEffect(() => {
    let active = true;
    void fetchSchoolLogo().then((result) => {
      if (active && result.src) setLogo(result.src);
    });
    return () => { active = false; };
  }, []);

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    setNotice(null);
    const prepared = await prepareLogoFile(file);
    if ('error' in prepared) {
      setLogoBusy(false);
      setNotice(prepared.error);
      return;
    }
    const saved = await saveSchoolLogo(prepared.dataUrl);
    setLogoBusy(false);
    if (saved.error) {
      setNotice(saved.error);
      return;
    }
    setLogo(prepared.dataUrl);
    onToast('School logo saved. It will appear on every quiz paper.');
  };

  // A topic typed in the chat is already the instruction, so the paper is written as soon
  // as the tool opens rather than making the teacher type it a second time.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (initialTopic?.trim() || initialImage) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    setNotice(null);
    const result = await prepareImageFile(file);
    setPreparing(false);
    if ('error' in result) {
      setNotice(result.error);
      return;
    }
    setImage(result.image);
  };

  const generate = async () => {
    if (!profile) return;
    if (!topic.trim() && !image) {
      setNotice('Type a topic or attach a photo of the page first.');
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await requestPaper({
      question: topic.trim(),
      role: profile.role,
      today: new Date().toISOString().slice(0, 10),
      image: image ? { mimeType: image.mimeType, base64: image.base64 } : undefined,
    });
    setBusy(false);

    if (result.status === 'denied') {
      setNotice(result.message);
      return;
    }
    if (result.status === 'fallback') {
      setNotice(result.message);
      return;
    }
    const next = sanitisePaper(result.paper);
    if (!next) {
      setNotice('The paper came back empty. Try a clearer photo or a shorter topic.');
      return;
    }
    setPaper(next);
    onToast('Quiz paper ready — print, download or copy it.');
  };

  const share = () => {
    if (!paper) return;
    const result = openWhatsAppChat('', paperToText(paper), 'web');
    if (!result.ok) onToast('WhatsApp could not open. Copy the paper instead.');
  };

  const downloadWord = async () => {
    if (!paper) return;
    const name = downloadPaperDocx(paper, await logoForDocx(logo || DEFAULT_LOGO));
    onToast(`Word file saved: ${name}`);
  };

  return (
    <div className="quiz-tool">
      <div className="quiz-form">
        <label className="control-field full">
          <span>Topic or instruction (optional when a photo is attached)</span>
          <textarea
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Class 6 Science, Chapter 3 — Photosynthesis, 10 MCQs and 5 short questions"
            rows={3}
          />
        </label>

        <div className="quiz-attach">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="quiz-file-input"
            onChange={(event) => { void pickImage(event.target.files?.[0]); event.target.value = ''; }}
          />
          <button className="ghost-button" type="button" onClick={() => fileRef.current?.click()} disabled={preparing || busy}>
            {preparing ? <Loader2 size={15} className="assistant-spin" /> : <Camera size={15} />}
            {image ? 'Change photo' : 'Snap or upload page'}
          </button>
          {image && (
            <button className="ghost-button quiz-remove" type="button" onClick={() => setImage(null)} disabled={busy}>
              <Trash2 size={15} /> Remove photo
            </button>
          )}
        </div>

        {image && (
          <div className="quiz-preview">
            <img src={image.preview} alt="Attached textbook page" />
            <span>{image.name}</span>
          </div>
        )}

        <div className="quiz-logo-row">
          <img className="quiz-logo-thumb" src={logo || DEFAULT_LOGO} alt="" />
          <div className="quiz-logo-text">
            <strong>School logo on the paper</strong>
            <span>{logo ? 'Saved for every quiz paper.' : 'Using the built-in school logo.'}</span>
          </div>
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            className="quiz-file-input"
            onChange={(event) => { void pickLogo(event.target.files?.[0]); event.target.value = ''; }}
          />
          <button className="ghost-button" type="button" onClick={() => logoRef.current?.click()} disabled={logoBusy || busy}>
            {logoBusy ? <Loader2 size={15} className="assistant-spin" /> : <ImagePlus size={15} />}
            {logo ? 'Replace logo' : 'Upload logo'}
          </button>
        </div>

        <button className="primary-button quiz-generate" type="button" onClick={() => void generate()} disabled={busy || preparing}>
          {busy ? <Loader2 size={16} className="assistant-spin" /> : <Sparkles size={16} />}
          {busy ? 'Writing the paper…' : paper ? 'Generate again' : 'Generate quiz paper'}
        </button>
      </div>

      {notice && <p className="quiz-notice">{notice}</p>}

      {paper && (
        <div className="quiz-result">
          <div className="quiz-result-head">
            <div>
              <strong>{paper.title}</strong>
              <span>{[paper.subject, paper.className, paper.timeAllowed, paper.totalMarks].filter(Boolean).join(' · ')}</span>
            </div>
          </div>

          <div className="quiz-result-actions">
            <button className="ghost-button" type="button" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
            <button className="ghost-button" type="button" onClick={() => void downloadWord()}><FileDown size={15} /> Word (.docx)</button>
            <button className="ghost-button" type="button" onClick={() => void copyText(paperToText(paper)).then((ok) => onToast(ok ? 'Paper copied' : 'Could not copy. Print it instead.'))}><ClipboardCopy size={15} /> Copy</button>
            <button className="ghost-button" type="button" onClick={share}><MessageCircle size={15} /> WhatsApp</button>
          </div>

          {paper.instructions.length > 0 && (
            <ul className="quiz-instructions">
              {paper.instructions.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}

          {paper.sections.map((section) => (
            <section className="quiz-section" key={section.heading}>
              <h4>{section.heading}</h4>
              {section.instructions && <p className="quiz-section-note">{section.instructions}</p>}
              <ol>
                {section.questions.map((question, index) => (
                  <li key={`${question.question}-${index}`}>
                    <span className="quiz-question">
                      {question.question}
                      {question.marks && <em> [{question.marks}]</em>}
                    </span>
                    {question.options.length > 0 && (
                      <ul className="quiz-options">
                        {question.options.map((option) => <li key={option}>{option}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <section className="quiz-section quiz-key">
            <h4><FileText size={15} /> Answer key</h4>
            {paper.sections.map((section) => (
              <div key={section.heading}>
                <p className="quiz-section-note">{section.heading}</p>
                <ol>{section.questions.map((question, index) => <li key={`${question.answer}-${index}`}>{question.answer || '—'}</li>)}</ol>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
