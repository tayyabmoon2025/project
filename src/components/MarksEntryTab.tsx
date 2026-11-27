import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert as AlertCircle, Eraser, Info, ListOrdered, Mic, MicOff, Search } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { supabase } from '@/lib/supabase';
import { useClassOptions } from '@/lib/classSections';
import { IdentifierModeToggle } from '@/components/IdentifierModeToggle';
import { BulkRollNumberModal } from '@/components/BulkRollNumberModal';
import { admissionLabel, compareRoster, identifierColumnLabel, matchesIdentifier, rollLabel, type IdentifierMode } from '@/lib/studentRoll';
import { useVoiceInput } from '@/lib/useVoiceInput';
import type { Student } from '@/lib/schoolTypes';
import {
  GRADE_OPTIONS,
  clearSubjectMarks,
  fetchExamMarks,
  fetchExamSubjects,
  fetchExamTypes,
  gradeFor,
  saveStudentMarks,
  type ExamMark,
  type ExamSubject,
  type ExamType,
} from '@/lib/exams';

type Draft = { obtained: string; absent: boolean; paperA: string; paperB: string; grade: string };

// Spoken words become marks: digits as spoken ("seventy eight"), words for small
// numbers, and the three commands that move the sheet along.
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

// "forty five" → 45, "seventy eight" → 78, "one hundred" → 100.
const wordsToNumber = (text: string): number | null => {
  const words = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let total = 0;
  let matched = false;
  for (const word of words) {
    if (word in NUMBER_WORDS) {
      const value = NUMBER_WORDS[word];
      if (value === 100) total = (total || 1) * 100;
      else total += value;
      matched = true;
    } else if (/^\d+(\.\d+)?$/.test(word)) {
      total += Number(word);
      matched = true;
    } else if (total > 0) {
      break;
    } else {
      return null;
    }
  }
  return matched ? total : null;
};

// One heard phrase → a value for the active cell. "skip" leaves the box empty and
// moves on; "absent" ticks the absent box; a number fills the box.
const parseVoiceCommand = (text: string): { kind: 'mark' | 'absent' | 'skip'; value?: number } | null => {
  const said = text.toLowerCase().trim();
  if (!said) return null;
  if (/\b(absent|abson|absence)\b/.test(said)) return { kind: 'absent' };
  if (/\b(skip|next|blank|leave it)\b/.test(said)) return { kind: 'skip' };
  const direct = said.match(/-?\d+(\.\d+)?/);
  if (direct) return { kind: 'mark', value: Number(direct[0]) };
  const fromWords = wordsToNumber(said);
  if (fromWords !== null) return { kind: 'mark', value: fromWords };
  return null;
};

export function MarksEntryTab({ students, onToast, onRefresh }: { students: Student[]; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [exams, setExams] = useState<ExamType[]>([]);
  const [examId, setExamId] = useState('');
  const [className, setClassName] = useState('');
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [marks, setMarks] = useState<ExamMark[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>('both');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollToolOpen, setRollToolOpen] = useState(false);

  // Paper A & Paper B mode, worked per subject with editable paper totals.
  const [paperSplit, setPaperSplit] = useState(false);
  const [paperAMax, setPaperAMax] = useState('50');
  const [paperBMax, setPaperBMax] = useState('50');

  // Which cell the keyboard and the microphone are pointed at.
  const [cursor, setCursor] = useState<{ studentId: string; paper: 'total' | 'a' | 'b' } | null>(null);
  const [heard, setHeard] = useState('');
  const [voiceWanted, setVoiceWanted] = useState(false);

  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Only exams that are open for entry are offered, so a closed exam cannot be
  // edited by accident.
  useEffect(() => {
    void (async () => {
      const { exams: rows, error: loadError } = await fetchExamTypes();
      if (loadError) { setError(loadError); return; }
      const open = rows.filter((exam) => exam.is_active);
      setExams(open);
      setExamId((current) => current || open[0]?.id || '');
    })();
  }, []);

  // Every class the school has set up is offered — Nursery and Prep/KG included — not
  // only the classes that happen to have a student on the roll, so a class can be
  // picked the moment it is created.
  const schoolClasses = useClassOptions();
  const classes = useMemo(() => {
    const names = new Set(schoolClasses);
    for (const student of students) {
      if (student.status === 'active' && student.class_name) names.add(student.class_name);
    }
    return Array.from(names);
  }, [schoolClasses, students]);

  useEffect(() => {
    setClassName((current) => (current && classes.includes(current) ? current : classes[0] ?? ''));
  }, [classes]);

  // Read inside the exam-change effect below so switching exams keeps the class the
  // user is already working in. Reading it through a ref avoids refetching the
  // subjects every time the class dropdown changes.
  const classNameRef = useRef(className);
  classNameRef.current = className;

  const loadSubjects = useCallback(async (id: string): Promise<ExamSubject[]> => {
    if (!id) { setSubjects([]); return []; }
    const { subjects: rows, error: loadError } = await fetchExamSubjects(id);
    setSubjects(rows);
    setError(loadError);
    return rows;
  }, []);

  useEffect(() => {
    void (async () => {
      const rows = await loadSubjects(examId);
      setSubjectId('');
      setMarks([]);
      setDrafts({});
      if (rows.length) {
        const first = rows.find((subject) => subject.class_name === classNameRef.current) ?? rows[0];
        setClassName(first.class_name);
        setSubjectId(first.id);
      }
    })();
  }, [examId, loadSubjects]);

  const subjectsForClass = useMemo(
    () => subjects.filter((subject) => subject.class_name === className),
    [subjects, className],
  );

  useEffect(() => {
    setSubjectId((current) => (current && subjectsForClass.some((subject) => subject.id === current) ? current : subjectsForClass[0]?.id ?? ''));
  }, [subjectsForClass]);

  const selectedSubject = subjects.find((subject) => subject.id === subjectId) ?? null;
  // A grade-only subject is awarded a letter; the marks grid becomes a grade picker.
  const gradeOnly = selectedSubject?.is_grade_only ?? false;

  // The toggle and the paper totals follow the subject that is selected. The paper
  // totals are editable so a subject can be sat as, say, 30 + 70.
  useEffect(() => {
    setPaperSplit(selectedSubject?.paper_split ?? false);
    setPaperAMax(String(selectedSubject?.paper_a_max ?? 50));
    setPaperBMax(String(selectedSubject?.paper_b_max ?? 50));
    setCursor(null);
  }, [selectedSubject]);

  const loadMarks = useCallback(async (id: string) => {
    if (!id) { setMarks([]); setDrafts({}); return; }
    const { marks: rows, error: loadError } = await fetchExamMarks(id);
    setMarks(rows);
    setDrafts({});
    setError(loadError);
  }, []);

  useEffect(() => { void loadMarks(examId); }, [examId, loadMarks]);

  const roster = useMemo(
    () => students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .sort(compareRoster),
    [students, className],
  );

  const markByStudent = useMemo(() => {
    const map = new Map<string, ExamMark>();
    for (const mark of marks) if (mark.subject_id === subjectId) map.set(mark.student_id, mark);
    return map;
  }, [marks, subjectId]);

  const emptyDraft: Draft = { obtained: '', absent: false, paperA: '', paperB: '', grade: '' };

  const draftFor = (student: Student): Draft => {
    const saved = markByStudent.get(student.id);
    return drafts[student.id] ?? {
      obtained: saved && !saved.is_absent && saved.obtained_marks !== null ? String(saved.obtained_marks) : '',
      absent: saved?.is_absent ?? false,
      paperA: saved?.paper_a_marks !== null && saved?.paper_a_marks !== undefined ? String(saved.paper_a_marks) : '',
      paperB: saved?.paper_b_marks !== null && saved?.paper_b_marks !== undefined ? String(saved.paper_b_marks) : '',
      grade: saved && !saved.is_absent && saved.grade ? saved.grade : '',
    };
  };

  const setDraft = (studentId: string, next: Draft) => setDrafts((current) => ({ ...current, [studentId]: next }));

  const visibleRoster = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter((student) => matchesIdentifier(student, identifierMode, term));
  }, [roster, query, identifierMode]);

  const enteredCount = roster.filter((student) => {
    const draft = draftFor(student);
    return draft.absent || draft.obtained.trim() !== '' || draft.grade.trim() !== '';
  }).length;

  const dirtyStudents = roster.filter((student) => {
    if (!drafts[student.id]) return false;
    const draft = draftFor(student);
    const saved = markByStudent.get(student.id);
    const savedValue = saved && !saved.is_absent && saved.obtained_marks !== null ? String(saved.obtained_marks) : '';
    const savedAbsent = saved?.is_absent ?? false;
    const savedGrade = saved && !saved.is_absent && saved.grade ? saved.grade : '';
    return draft.absent !== savedAbsent || draft.obtained.trim() !== savedValue || draft.grade.trim() !== savedGrade;
  });

  // A combined figure is worked out on the fly in split mode: the papers that have
  // been filled in so far, so a sheet can be saved between the two papers.
  const totalOf = (draft: Draft): string => {
    if (!paperSplit) return draft.obtained;
    const a = draft.paperA.trim() === '' ? 0 : Number(draft.paperA);
    const b = draft.paperB.trim() === '' ? 0 : Number(draft.paperB);
    if (draft.paperA.trim() === '' && draft.paperB.trim() === '') return '';
    return String(a + b);
  };

  const maxOf = (paper: 'total' | 'a' | 'b'): number => {
    if (paper === 'a') return Number(paperAMax) || 0;
    if (paper === 'b') return Number(paperBMax) || 0;
    return selectedSubject?.max_marks ?? 0;
  };

  const focusCell = (studentId: string, paper: 'total' | 'a' | 'b') => {
    setCursor({ studentId, paper });
    const key = `${studentId}:${paper}`;
    const input = inputRefs.current.get(key);
    if (input) {
      input.focus();
      input.select();
    }
  };

  // The order the cursor walks: in split mode Paper A then Paper B of each student,
  // otherwise straight down the marks column.
  const nextCell = (studentId: string, paper: 'total' | 'a' | 'b'): { studentId: string; paper: 'total' | 'a' | 'b' } | null => {
    const index = visibleRoster.findIndex((student) => student.id === studentId);
    if (index === -1) return null;
    if (paperSplit && paper === 'a') return { studentId, paper: 'b' };
    const nextStudent = visibleRoster[index + 1];
    if (!nextStudent) return null;
    return { studentId: nextStudent.id, paper: paperSplit ? 'a' : 'total' };
  };

  // Enter, a voice "next", or a filled box: land the cursor on the next cell.
  const advanceFrom = (studentId: string, paper: 'total' | 'a' | 'b') => {
    const next = nextCell(studentId, paper);
    if (next) focusCell(next.studentId, next.paper);
  };

  // Enter walks the cursor down the sheet; nothing is saved until the teacher
  // presses Save, so a mistyped row is still editable.
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, studentId: string, paper: 'total' | 'a' | 'b') => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    advanceFrom(studentId, paper);
  };

  // A number can never be typed above the paper total; anything larger is clipped.
  const clampDraft = (value: string, max: number): string => {
    if (value === '') return '';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value.replace(/[^\d.]/g, '');
    return String(Math.min(parsed, max));
  };

  const applyVoice = useCallback((text: string) => {
    const active = cursorRef.current;
    setHeard(text);
    if (gradeOnly) return;
    const command = parseVoiceCommand(text);
    if (!active || !command) return;
    const student = roster.find((row) => row.id === active.studentId);
    if (!student) return;

    const draft = draftFor(student);
    if (command.kind === 'absent') {
      setDraft(student.id, { ...emptyDraft, absent: true });
      advanceFrom(student.id, active.paper);
      return;
    }
    if (command.kind === 'skip') {
      advanceFrom(student.id, active.paper);
      return;
    }
    const max = maxOf(active.paper);
    const value = command.value ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > max) {
      setError(`The spoken marks must be between 0 and ${max}.`);
      return;
    }
    const clamped = String(value);
    if (active.paper === 'a') {
      const paperB = draft.paperB.trim() === '' ? '' : draft.paperB;
      const combined = paperB === '' ? clamped : String(Number(clamped) + Number(paperB));
      setDraft(student.id, { ...draft, paperA: clamped, absent: false, obtained: combined });
    } else if (active.paper === 'b') {
      const paperA = draft.paperA.trim() === '' ? '' : draft.paperA;
      const combined = paperA === '' ? clamped : String(Number(paperA) + Number(clamped));
      setDraft(student.id, { ...draft, paperB: clamped, absent: false, obtained: combined });
    } else {
      setDraft(student.id, { ...draft, obtained: clamped, absent: false });
    }
    advanceFrom(student.id, active.paper);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, paperSplit, paperAMax, paperBMax, gradeOnly]);

  const voice = useVoiceInput({ onTranscript: setHeard, onFinal: applyVoice });
  const { start: startVoice, listening, error: voiceError, supported: voiceSupported } = voice;

  // The browser's speech engine stops after each phrase, so while voice entry is on
  // the microphone is picked straight back up — the teacher never has to touch it.
  useEffect(() => {
    if (!voiceWanted || listening || voiceError || !voiceSupported) return;
    const timer = window.setTimeout(() => startVoice(), 350);
    return () => window.clearTimeout(timer);
  }, [voiceWanted, listening, voiceError, voiceSupported, startVoice]);

  const toggleVoice = () => {
    if (gradeOnly) return;
    if (listening) {
      setVoiceWanted(false);
      voice.stop();
      return;
    }
    // The mic fills whatever cell is active, so a cell is chosen first: the first
    // empty box on the sheet, or the very first box when everything is filled.
    if (!cursorRef.current) {
      const firstEmpty = visibleRoster.find((student) => {
        const draft = draftFor(student);
        return !draft.absent && draft.obtained.trim() === '';
      }) ?? visibleRoster[0];
      if (firstEmpty) setCursor({ studentId: firstEmpty.id, paper: paperSplit ? 'a' : 'total' });
    }
    setVoiceWanted(true);
    voice.start();
  };

  const saveAll = async (moveToNextSubject: boolean): Promise<boolean | void> => {
    if (!selectedSubject) { onToast('Choose an exam, class and subject first.'); return false; }
    if (dirtyStudents.length === 0) { onToast('There are no new marks to save.'); return false; }

    // Every figure is checked against its paper total before anything is written,
    // so a typo is caught here rather than rejected halfway through the save.
    const outOfRange = gradeOnly ? undefined : dirtyStudents.find((student) => {
      const draft = draftFor(student);
      if (draft.absent) return false;
      if (!paperSplit) {
        if (draft.obtained.trim() === '') return false;
        const value = Number(draft.obtained);
        return !Number.isFinite(value) || value < 0 || value > selectedSubject.max_marks;
      }
      for (const [value, max] of [[draft.paperA, paperAMax], [draft.paperB, paperBMax]] as const) {
        if (value.trim() === '') continue;
        const parsed = Number(value);
        const limit = Number(max);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > limit) return true;
      }
      return false;
    });
    if (outOfRange) {
      setError(`Marks for ${outOfRange.full_name} must be within each paper's total.`);
      return false;
    }

    setSaving(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const enteredBy = data.user?.id ?? null;

    for (const student of dirtyStudents) {
      const draft = draftFor(student);
      const { error: saveError } = await saveStudentMarks({
        examTypeId: examId,
        studentId: student.id,
        className,
        entries: [{
          subject_id: selectedSubject.id,
          obtained: paperSplit ? totalOf(draft) : draft.obtained,
          absent: draft.absent,
          paper_a: paperSplit ? draft.paperA : '',
          paper_b: paperSplit ? draft.paperB : '',
          grade: gradeOnly ? draft.grade : '',
        }],
        enteredBy,
        paperSplit,
      });
      if (saveError) { setError(saveError); setSaving(false); return false; }
    }

    await loadMarks(examId);
    setSaving(false);
    onToast(`Marks saved for ${dirtyStudents.length} ${dirtyStudents.length === 1 ? 'student' : 'students'}.`);

    // "Save & next subject": jump to the next paper the class still has to enter.
    if (moveToNextSubject) {
      const index = subjectsForClass.findIndex((subject) => subject.id === subjectId);
      const next = subjectsForClass[index + 1];
      if (next) {
        setSubjectId(next.id);
        onToast(`Moved on to ${next.subject_name}.`);
      } else {
        onToast('That was the last subject for this class.');
      }
    }
    return true;
  };

  const clearThisSubject = async () => {
    if (!selectedSubject || !examId) return;
    const confirmed = window.confirm(`Clear every mark recorded for ${selectedSubject.subject_name} in ${className}?`);
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    const { error: clearError } = await clearSubjectMarks(examId, selectedSubject.id);
    if (clearError) { setError(clearError); setSaving(false); return; }
    await loadMarks(examId);
    setSaving(false);
    onToast(`Marks cleared for ${selectedSubject.subject_name}.`);
  };

  // Persist the toggle and paper totals onto the subject so the report card and the
  // results screen see the same split.
  const applyPaperSplit = async (next: boolean) => {
    if (!selectedSubject) return;
    if (next) {
      const a = Number(paperAMax);
      const b = Number(paperBMax);
      if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) {
        setError('Both paper totals must be numbers greater than zero.');
        return;
      }
      if (a + b !== selectedSubject.max_marks) {
        // The subject total follows the two papers, so the two can never disagree.
        const { error: updateError } = await supabase
          .from('school_exam_subjects')
          .update({ paper_split: true, paper_a_max: a, paper_b_max: b, max_marks: a + b })
          .eq('id', selectedSubject.id);
        if (updateError) { setError('The paper totals could not be saved. Please try again.'); return; }
      } else {
        const { error: updateError } = await supabase
          .from('school_exam_subjects')
          .update({ paper_split: true, paper_a_max: a, paper_b_max: b })
          .eq('id', selectedSubject.id);
        if (updateError) { setError('The paper totals could not be saved. Please try again.'); return; }
      }
      setPaperSplit(true);
      await loadSubjects(examId);
      onToast(`${selectedSubject.subject_name} is now split into Paper A (${a}) and Paper B (${b}).`);
      return;
    }
    const { error: updateError } = await supabase
      .from('school_exam_subjects')
      .update({ paper_split: false })
      .eq('id', selectedSubject.id);
    if (updateError) { setError('The paper split could not be turned off. Please try again.'); return; }
    setPaperSplit(false);
    await loadSubjects(examId);
    onToast(`${selectedSubject.subject_name} is back to a single paper.`);
  };

  return (
    <div className="exam-marks">
      <div className="panel attendance-filters-panel">
        <div className="att-filters">
          <label className="control-field">Exam
            <select value={examId} onChange={(event) => setExamId(event.target.value)}>
              <option value="">Select an exam</option>
              {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
          <label className="control-field">Class
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">Select a class</option>
              {classes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="control-field">Subject
            <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">Select a subject</option>
              {subjectsForClass.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.subject_name} {subject.is_grade_only ? '(grade only)' : `(${subject.max_marks} marks)`}
                </option>
              ))}
            </select>
          </label>
          {selectedSubject && !gradeOnly && (
            <div className="paper-split-field">
              <label className="att-filter-check">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-600"
                  checked={paperSplit}
                  onChange={(event) => void applyPaperSplit(event.target.checked)}
                />
                <span>Has Paper A & Paper B</span>
              </label>
              {paperSplit && (
                <div className="paper-split-max">
                  <label className="control-field compact">Paper A total
                    <input
                      type="number" min="1" value={paperAMax}
                      onChange={(event) => setPaperAMax(event.target.value)}
                      onBlur={() => void applyPaperSplit(true)}
                    />
                  </label>
                  <span className="paper-split-plus">+</span>
                  <label className="control-field compact">Paper B total
                    <input
                      type="number" min="1" value={paperBMax}
                      onChange={(event) => setPaperBMax(event.target.value)}
                      onBlur={() => void applyPaperSplit(true)}
                    />
                  </label>
                  <span className="paper-split-equals">= {selectedSubject.max_marks}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedSubject ? (
        <div className="panel roster-panel">
          <div className="empty-state large">
            {exams.length === 0
              ? 'No exam is open for marks entry. Open one in Exams Setup, or set up a new exam.'
              : subjectsForClass.length === 0
                ? 'This exam has no subjects for the selected class yet. Add them in Exams Setup.'
                : 'Choose an exam, class and subject to start entering marks.'}
          </div>
        </div>
      ) : (
        <>
          <div className="panel exam-marks-head">
            <div className="exam-marks-copy">
              <span className="eyebrow">{exams.find((exam) => exam.id === examId)?.name}</span>
              <h2>{selectedSubject.subject_name} — {className}</h2>
              <p>
                {gradeOnly
                  ? `Grade-only subject · ${enteredCount} of ${roster.length} entered`
                  : paperSplit
                    ? `Paper A ${paperAMax} + Paper B ${paperBMax} = ${selectedSubject.max_marks} · pass mark ${selectedSubject.pass_marks} · ${enteredCount} of ${roster.length} entered`
                    : `Paper total ${selectedSubject.max_marks} · pass mark ${selectedSubject.pass_marks} · ${enteredCount} of ${roster.length} entered`}
              </p>
            </div>
            <div className="exam-marks-actions">
              <button
                type="button"
                className={`secondary-button voice-toggle ${listening ? 'listening' : ''}`}
                onClick={toggleVoice}
                disabled={!voice.supported || gradeOnly}
                title={gradeOnly ? 'Voice entry is not used for grade-only subjects' : voice.supported ? 'Speak marks hands-free' : 'This browser does not support voice entry'}
              >
                {listening ? <Mic size={15} /> : <MicOff size={15} />}
                {listening ? 'Listening…' : 'Voice Entry'}
              </button>
              <button type="button" className="secondary-button" onClick={() => void clearThisSubject()} disabled={saving}>
                <Eraser size={15} /> Clear this subject
              </button>
              <AsyncSaveButton
                className="secondary-button"
                label="Save & next subject"
                disabled={saving || dirtyStudents.length === 0}
                onSave={() => saveAll(true)}
              />
              <AsyncSaveButton
                label={`Save ${dirtyStudents.length > 0 ? `${dirtyStudents.length} ` : ''}marks`}
                disabled={saving || dirtyStudents.length === 0}
                onSave={() => saveAll(false)}
              />
            </div>
          </div>

          {listening && !gradeOnly && (
            <div className="voice-indicator">
              <Mic size={14} className="voice-indicator-icon" />
              <span className="voice-indicator-text">
                {heard.trim() ? heard : 'Listening — speak a number, or say “absent”, “skip” or “next”.'}
              </span>
              {cursor && (
                <span className="voice-indicator-target">
                  {roster.find((student) => student.id === cursor.studentId)?.full_name ?? ''} · {paperSplit ? (cursor.paper === 'a' ? 'Paper A' : 'Paper B') : 'Marks'}
                </span>
              )}
            </div>
          )}
          {voice.error && <p className="dmc-warning"><AlertCircle size={13} /> {voice.error}</p>}

          <div className="panel roster-panel">
            <div className="table-toolbar">
              <IdentifierModeToggle value={identifierMode} onChange={setIdentifierMode} />
              <div className="search-field">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={identifierMode === 'roll' ? 'Search by name or roll number' : identifierMode === 'admission' ? 'Search by name or admission number' : 'Search by name, roll number or admission number'}
                />
              </div>
              <span className="result-count">{visibleRoster.length} students</span>
              <button type="button" className="secondary-button" onClick={() => setRollToolOpen(true)}>
                <ListOrdered size={15} /> Roll Numbers
              </button>
            </div>

            {error && <p className="dmc-warning"><AlertCircle size={13} /> {error}</p>}

            <div className="table-wrap">
              <table className="exam-marks-table">
                <thead>
                  <tr>
                    <th>{identifierColumnLabel(identifierMode)}</th>
                    <th>Student</th>
                    {gradeOnly ? (
                      <th>Grade</th>
                    ) : paperSplit ? (
                      <>
                        <th>Paper A ({paperAMax})</th>
                        <th>Paper B ({paperBMax})</th>
                        <th>Total</th>
                      </>
                    ) : (
                      <th>Marks obtained</th>
                    )}
                    <th>Absent</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRoster.map((student) => {
                    const draft = draftFor(student);
                    const saved = markByStudent.get(student.id);
                    const combined = paperSplit ? totalOf(draft) : draft.obtained;
                    const numeric = draft.absent ? null : Number(combined);
                    const hasValue = gradeOnly ? (draft.absent || draft.grade.trim() !== '') : (draft.absent || combined.trim() !== '');
                    const maxMarks = selectedSubject.max_marks;
                    const inRange = gradeOnly || !hasValue || draft.absent || (Number.isFinite(numeric) && (numeric as number) >= 0 && (numeric as number) <= maxMarks);
                    const percentage = gradeOnly || !hasValue || numeric === null || Number.isNaN(numeric)
                      ? 0
                      : Math.round((numeric / maxMarks) * 1000) / 10;
                    const displayGrade = gradeOnly ? (draft.grade || '—') : gradeFor(draft.absent ? 0 : percentage).grade;
                    const failed = gradeOnly
                      ? hasValue && !draft.absent && draft.grade === 'F'
                      : hasValue && (draft.absent || (numeric !== null && numeric < selectedSubject.pass_marks));
                    const changed = drafts[student.id] !== undefined;
                    const rowActive = cursor?.studentId === student.id;
                    return (
                      <tr key={student.id} className={`${changed ? 'exam-row-changed' : ''} ${rowActive ? 'exam-row-active' : ''}`}>
                        <td className="muted-cell">
                          <span className="identifier-cell">
                            {identifierMode !== 'admission' && <strong>{rollLabel(student)}</strong>}
                            {identifierMode !== 'roll' && <small>{admissionLabel(student)}</small>}
                          </span>
                        </td>
                        <td>
                          <div className="table-student">
                            <div className="student-avatar">{student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                            <span>
                              <strong>{student.full_name}</strong>
                              {identifierMode === 'roll' && <small>{student.admission_number}</small>}
                            </span>
                          </div>
                        </td>
                        {gradeOnly ? (
                          <td>
                            <select
                              className={`exam-mark-select ${cursor?.studentId === student.id ? 'exam-input-active' : ''}`}
                              value={draft.absent ? '' : draft.grade}
                              disabled={draft.absent}
                              onChange={(event) => setDraft(student.id, { ...draft, grade: event.target.value, absent: false })}
                              onFocus={() => setCursor({ studentId: student.id, paper: 'total' })}
                            >
                              <option value="">—</option>
                              {GRADE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </td>
                        ) : paperSplit ? (
                          <>
                            <td>
                              <input
                                ref={(input) => {
                                  const key = `${student.id}:a`;
                                  if (input) inputRefs.current.set(key, input); else inputRefs.current.delete(key);
                                }}
                                className={`exam-mark-input ${cursor?.studentId === student.id && cursor?.paper === 'a' ? 'exam-input-active' : ''}`}
                                type="number"
                                min="0"
                                max={paperAMax}
                                step="0.5"
                                value={draft.absent ? '' : draft.paperA}
                                disabled={draft.absent}
                                placeholder={draft.absent ? 'Absent' : 'A'}
                                onChange={(event) => {
                                  const paperA = clampDraft(event.target.value, Number(paperAMax) || 0);
                                  const paperB = draft.paperB.trim() === '' ? '' : draft.paperB;
                                  const combinedNext = paperA === '' || paperB === '' ? '' : String(Number(paperA) + Number(paperB));
                                  setDraft(student.id, { ...draft, paperA, obtained: combinedNext, absent: false });
                                }}
                                onKeyDown={(event) => onInputKeyDown(event, student.id, 'a')}
                                onFocus={() => setCursor({ studentId: student.id, paper: 'a' })}
                              />
                            </td>
                            <td>
                              <input
                                ref={(input) => {
                                  const key = `${student.id}:b`;
                                  if (input) inputRefs.current.set(key, input); else inputRefs.current.delete(key);
                                }}
                                className={`exam-mark-input ${cursor?.studentId === student.id && cursor?.paper === 'b' ? 'exam-input-active' : ''}`}
                                type="number"
                                min="0"
                                max={paperBMax}
                                step="0.5"
                                value={draft.absent ? '' : draft.paperB}
                                disabled={draft.absent}
                                placeholder={draft.absent ? 'Absent' : 'B'}
                                onChange={(event) => {
                                  const paperB = clampDraft(event.target.value, Number(paperBMax) || 0);
                                  const paperA = draft.paperA.trim() === '' ? '' : draft.paperA;
                                  const combinedNext = paperA === '' || paperB === '' ? '' : String(Number(paperA) + Number(paperB));
                                  setDraft(student.id, { ...draft, paperB, obtained: combinedNext, absent: false });
                                }}
                                onKeyDown={(event) => onInputKeyDown(event, student.id, 'b')}
                                onFocus={() => setCursor({ studentId: student.id, paper: 'b' })}
                              />
                            </td>
                            <td>
                              <span className={`paper-total-badge ${combined.trim() === '' ? 'empty' : inRange ? '' : 'invalid'}`}>
                                {draft.absent ? 'Absent' : combined.trim() === '' ? '—' : combined}
                              </span>
                            </td>
                          </>
                        ) : (
                          <td>
                            <input
                              ref={(input) => {
                                const key = `${student.id}:total`;
                                if (input) inputRefs.current.set(key, input); else inputRefs.current.delete(key);
                              }}
                              className={`exam-mark-input ${inRange ? '' : 'invalid'} ${cursor?.studentId === student.id && cursor?.paper === 'total' ? 'exam-input-active' : ''}`}
                              type="number"
                              min="0"
                              max={maxMarks}
                              step="0.5"
                              value={draft.absent ? '' : draft.obtained}
                              disabled={draft.absent}
                              placeholder={draft.absent ? 'Absent' : '—'}
                              onChange={(event) => setDraft(student.id, { ...draft, obtained: clampDraft(event.target.value, maxMarks), absent: false })}
                              onKeyDown={(event) => onInputKeyDown(event, student.id, 'total')}
                              onFocus={() => setCursor({ studentId: student.id, paper: 'total' })}
                            />
                          </td>
                        )}
                        <td>
                          <label className="att-filter-check exam-absent-check">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-rose-500"
                              checked={draft.absent}
                              onChange={(event) => setDraft(student.id, { ...emptyDraft, absent: event.target.checked })}
                            />
                            <span>Absent</span>
                          </label>
                        </td>
                        <td>
                          {!hasValue ? (
                            <span className="exam-result muted">{saved ? 'Saved' : 'Not entered'}</span>
                          ) : (
                            <span className={`exam-result ${failed ? 'fail' : 'pass'}`}>
                              {draft.absent ? 'Absent' : gradeOnly ? displayGrade : `${displayGrade} · ${percentage}%`}
                              {changed && <small>unsaved</small>}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleRoster.length === 0 && (
                <div className="empty-state large">
                  {roster.length === 0 ? `No active students are enrolled in ${className}.` : 'No student matches your search.'}
                </div>
              )}
            </div>
          </div>

          <p className="cal-hint">
            <Info size={14} />
            {gradeOnly
              ? 'This is a grade-only subject, so each student is given a letter instead of marks. It is left out of the totals, percentage and position, but is shown on the report card.'
              : 'A paper left blank stays unmarked and is never counted as a zero, so a half-finished sheet cannot affect a result. Tick Absent only when the student did not sit the paper — that counts as zero and is shown on the report card. Press Enter to jump to the next box, or turn on Voice Entry and speak the marks, “absent”, “skip” or “next”.'}
          </p>
        </>
      )}

      {rollToolOpen && (
        <BulkRollNumberModal
          students={students}
          defaultClassName={className}
          onClose={() => setRollToolOpen(false)}
          onToast={onToast}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}
