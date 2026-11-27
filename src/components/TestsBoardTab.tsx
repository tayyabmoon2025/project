import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ClipboardList, ExternalLink, Info, Loader as Loader2, MessageCircle, Plus, Save, Search, Trash2 } from 'lucide-react';
import {
  deleteBoardResult,
  deleteClassTest,
  fetchBoardResults,
  fetchClassTestMarks,
  fetchClassTests,
  saveBoardResult,
  saveClassTest,
  saveClassTestMarks,
  type BoardResult,
  type ClassTest,
  type ClassTestMark,
} from '@/lib/examExtras';
import { pickWhatsAppContact } from '@/lib/whatsapp';
import { useClassOptions } from '@/lib/classSections';
import { IdentifierModeToggle } from '@/components/IdentifierModeToggle';
import { admissionLabel, compareRoster, identifierColumnLabel, matchesIdentifier, rollLabel, type IdentifierMode } from '@/lib/studentRoll';
import type { Student } from '@/lib/schoolTypes';

type TestDraft = { title: string; test_date: string; class_name: string; subject_name: string; max_marks: string };
type BoardDraft = {
  id: string | null;
  studentId: string;
  className: string;
  boardName: string;
  examYear: string;
  boardRollNumber: string;
  totalMarks: string;
  obtainedMarks: string;
  gradeDivision: string;
};

const emptyTest = (className: string): TestDraft => ({
  title: '', test_date: new Date().toISOString().slice(0, 10), class_name: className, subject_name: '', max_marks: '10',
});

const emptyBoard = (): BoardDraft => ({
  id: null, studentId: '', className: '', boardName: '', examYear: String(new Date().getFullYear()),
  boardRollNumber: '', totalMarks: '1100', obtainedMarks: '', gradeDivision: '',
});

// Universal WhatsApp web link — works on desktop and mobile alike.
const waLink = (phone: string, text: string) => `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;

export function TestsBoardTab({ students, onToast }: { students: Student[]; onToast: (message: string) => void }) {
  const [section, setSection] = useState<'tests' | 'board'>('tests');

  const schoolClasses = useClassOptions();
  const classes = useMemo(() => {
    const names = new Set(schoolClasses);
    for (const student of students) {
      if (student.status === 'active' && student.class_name) names.add(student.class_name);
    }
    return Array.from(names);
  }, [schoolClasses, students]);

  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>('both');
  const [rosterQuery, setRosterQuery] = useState('');

  // Class tests -------------------------------------------------------------
  const [className, setClassName] = useState('');
  const [tests, setTests] = useState<ClassTest[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TestDraft>(emptyTest(''));
  const [editingTestId, setEditingTestId] = useState<string | null>(null);
  const [openTestId, setOpenTestId] = useState<string | null>(null);
  const [testMarks, setTestMarks] = useState<ClassTestMark[]>([]);
  const [markDrafts, setMarkDrafts] = useState<Record<string, { obtained: string; absent: boolean }>>({});
  const [marksSaving, setMarksSaving] = useState(false);

  useEffect(() => {
    setClassName((current) => (current && classes.includes(current) ? current : classes[0] ?? ''));
  }, [classes]);

  const loadTests = useCallback(async (klass: string) => {
    if (!klass) { setTests([]); return; }
    setTestsLoading(true);
    const { tests: rows, error: loadError } = await fetchClassTests(klass);
    setTests(rows);
    setTestsError(loadError);
    setTestsLoading(false);
  }, []);

  useEffect(() => { void loadTests(className); }, [className, loadTests]);

  const roster = useMemo(
    () => students
      .filter((student) => student.status === 'active' && student.class_name === className)
      .sort(compareRoster),
    [students, className],
  );

  const visibleRoster = useMemo(() => {
    const term = rosterQuery.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter((student) => matchesIdentifier(student, identifierMode, term));
  }, [roster, rosterQuery, identifierMode]);

  const openTest = tests.find((test) => test.id === openTestId) ?? null;

  const loadTestMarks = useCallback(async (testId: string) => {
    const { marks: rows, error: loadError } = await fetchClassTestMarks(testId);
    setTestMarks(rows);
    setTestsError(loadError);
    setMarkDrafts({});
  }, []);

  const openTestSheet = (test: ClassTest) => {
    if (openTestId === test.id) { setOpenTestId(null); return; }
    setOpenTestId(test.id);
    void loadTestMarks(test.id);
  };

  const markDraftFor = (studentId: string) => {
    const saved = testMarks.find((mark) => mark.student_id === studentId && mark.test_id === openTestId);
    return markDrafts[studentId] ?? {
      obtained: saved && !saved.is_absent && saved.obtained_marks !== null ? String(saved.obtained_marks) : '',
      absent: saved?.is_absent ?? false,
    };
  };

  const saveTest = async () => {
    setTestsError(null);
    const { error: saveError } = await saveClassTest({
      id: editingTestId,
      title: draft.title,
      testDate: draft.test_date,
      className: draft.class_name || className,
      subjectName: draft.subject_name,
      maxMarks: draft.max_marks,
    });
    if (saveError) { setTestsError(saveError); return; }
    setDraft(emptyTest(className));
    setEditingTestId(null);
    await loadTests(className);
    onToast('Class test saved.');
  };

  const removeTest = async (test: ClassTest) => {
    const confirmed = window.confirm(`Delete "${test.title}" and its marks? This cannot be undone.`);
    if (!confirmed) return;
    setTestsError(null);
    const { error: removeError } = await deleteClassTest(test.id);
    if (removeError) { setTestsError(removeError); return; }
    if (openTestId === test.id) setOpenTestId(null);
    await loadTests(className);
    onToast('Test deleted.');
  };

  const saveMarks = async () => {
    if (!openTest) return;
    setMarksSaving(true);
    setTestsError(null);
    const entries = roster.map((student) => {
      const value = markDraftFor(student.id);
      return { studentId: student.id, obtained: value.obtained, absent: value.absent, maxMarks: openTest.max_marks };
    });
    const { error: saveError } = await saveClassTestMarks({ testId: openTest.id, entries });
    if (saveError) { setTestsError(saveError); setMarksSaving(false); return; }
    await loadTestMarks(openTest.id);
    setMarksSaving(false);
    onToast(`Marks saved for ${openTest.title}.`);
  };

  const whatsappFor = (student: Student, test: ClassTest, draft: { obtained: string; absent: boolean }) => {
    const contact = pickWhatsAppContact(student);
    if (!contact.number) return null;
    const score = draft.absent ? 'Absent' : draft.obtained.trim() === '' ? 'Not marked yet' : `${draft.obtained} / ${test.max_marks}`;
    const message = `Dear Parent, ${student.full_name} (${student.class_name}) scored ${score} in "${test.title}" (${test.subject_name}) held on ${test.test_date}. — Class Teacher`;
    return waLink(contact.number, message);
  };

  // Board results -----------------------------------------------------------
  const [boardResults, setBoardResults] = useState<BoardResult[]>([]);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardDraft, setBoardDraft] = useState<BoardDraft>(emptyBoard());
  const [boardSaving, setBoardSaving] = useState(false);
  const [boardQuery, setBoardQuery] = useState('');

  const loadBoardResults = useCallback(async () => {
    setBoardSaving(true);
    const { results: rows, error: loadError } = await fetchBoardResults();
    setBoardResults(rows);
    setBoardError(loadError);
    setBoardSaving(false);
  }, []);

  useEffect(() => { if (section === 'board') void loadBoardResults(); }, [section, loadBoardResults]);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const boardVisible = useMemo(() => {
    const term = boardQuery.trim().toLowerCase();
    if (!term) return boardResults;
    return boardResults.filter((result) => {
      const student = studentById.get(result.student_id);
      return `${student?.full_name ?? ''} ${result.board_roll_number} ${result.board_name} ${result.class_name}`.toLowerCase().includes(term);
    });
  }, [boardResults, boardQuery, studentById]);

  const saveBoard = async () => {
    setBoardError(null);
    const { error: saveError } = await saveBoardResult({ ...boardDraft });
    if (saveError) { setBoardError(saveError); return; }
    setBoardDraft(emptyBoard());
    await loadBoardResults();
    onToast('Board result saved.');
  };

  const editBoard = (result: BoardResult) => {
    setBoardDraft({
      id: result.id,
      studentId: result.student_id,
      className: result.class_name,
      boardName: result.board_name,
      examYear: String(result.exam_year),
      boardRollNumber: result.board_roll_number,
      totalMarks: String(result.total_marks),
      obtainedMarks: String(result.obtained_marks),
      gradeDivision: result.grade_division ?? '',
    });
  };

  const removeBoard = async (result: BoardResult) => {
    const confirmed = window.confirm(`Delete the ${result.exam_year} ${result.board_name} result? This cannot be undone.`);
    if (!confirmed) return;
    setBoardError(null);
    const { error: removeError } = await deleteBoardResult(result.id);
    if (removeError) { setBoardError(removeError); return; }
    await loadBoardResults();
    onToast('Board result deleted.');
  };

  return (
    <div className="exam-tests">
      <div className="att-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={section === 'tests'} className={`att-tab ${section === 'tests' ? 'active' : ''}`} onClick={() => setSection('tests')}>
          <ClipboardList size={15} />
          <span className="att-tab-label">Weekly / Monthly Tests<small>Quick marks and WhatsApp results</small></span>
        </button>
        <button type="button" role="tab" aria-selected={section === 'board'} className={`att-tab ${section === 'board' ? 'active' : ''}`} onClick={() => setSection('board')}>
          <Award size={15} />
          <span className="att-tab-label">External / Board Results<small>Official board exam records</small></span>
        </button>
      </div>

      {section === 'tests' ? (
        <>
          <div className="panel attendance-filters-panel">
            <div className="att-filters">
              <label className="control-field">Class
                <select value={className} onChange={(event) => setClassName(event.target.value)}>
                  <option value="">Select a class</option>
                  {classes.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="panel roster-panel">
            <div className="table-toolbar">
              <span className="result-count">{tests.length} tests for {className || '—'}</span>
            </div>
            {testsError && <p className="dmc-warning">{testsError}</p>}

            <div className="test-create-grid">
              <input type="text" className="exam-mark-input" placeholder="Test title, e.g. Weekly Test 4" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              <input type="date" className="exam-mark-input" value={draft.test_date} onChange={(event) => setDraft((current) => ({ ...current, test_date: event.target.value }))} />
              <select className="exam-mark-input" value={draft.class_name || className} onChange={(event) => setDraft((current) => ({ ...current, class_name: event.target.value }))}>
                {classes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input type="text" className="exam-mark-input" placeholder="Subject" value={draft.subject_name} onChange={(event) => setDraft((current) => ({ ...current, subject_name: event.target.value }))} />
              <input type="number" className="exam-mark-input" min="1" placeholder="Max marks" value={draft.max_marks} onChange={(event) => setDraft((current) => ({ ...current, max_marks: event.target.value }))} />
              <button type="button" className="primary-button" onClick={() => void saveTest()}>
                {editingTestId ? <Save size={15} /> : <Plus size={15} />} {editingTestId ? 'Update test' : 'Create test'}
              </button>
            </div>
            {editingTestId && (
              <button type="button" className="text-button" onClick={() => { setEditingTestId(null); setDraft(emptyTest(className)); }}>Cancel edit</button>
            )}

            <div className="table-wrap">
              <table className="exam-marks-table">
                <thead>
                  <tr><th>Date</th><th>Test</th><th>Subject</th><th>Total</th><th>Entered</th><th /></tr>
                </thead>
                <tbody>
                  {tests.map((test) => {
                    const entered = testMarks.filter((mark) => mark.test_id === test.id && (mark.is_absent || mark.obtained_marks !== null)).length;
                    return (
                      <tr key={test.id} className={openTestId === test.id ? 'exam-row-active' : ''}>
                        <td className="muted-cell">{test.test_date}</td>
                        <td>
                          <button type="button" className="text-button" onClick={() => openTestSheet(test)}>
                            <strong>{test.title}</strong>
                          </button>
                          {openTestId === test.id && <small className="block text-[10px] text-slate-400">Marks sheet open below</small>}
                        </td>
                        <td className="muted-cell">{test.subject_name}</td>
                        <td className="muted-cell">{test.max_marks}</td>
                        <td className="muted-cell">{openTestId === test.id ? `${entered} of ${roster.length}` : '—'}</td>
                        <td>
                          <div className="exam-marks-actions">
                            <button type="button" className="row-action-btn" title="Edit test" onClick={() => { setEditingTestId(test.id); setDraft({ title: test.title, test_date: test.test_date, class_name: test.class_name, subject_name: test.subject_name, max_marks: String(test.max_marks) }); }}>
                              <Save size={14} />
                            </button>
                            <button type="button" className="row-action-btn" title="Delete test" onClick={() => void removeTest(test)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tests.length === 0 && !testsLoading && (
                <div className="empty-state large">No tests yet for {className || 'this class'}. Create one above.</div>
              )}
              {testsLoading && <div className="empty-state large"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
            </div>

            {openTest && (
              <div className="test-marks-sheet">
                <div className="table-toolbar">
                  <span className="result-count"><strong>{openTest.title}</strong> · {openTest.subject_name} · total {openTest.max_marks}</span>
                  <button type="button" className="primary-button" onClick={() => void saveMarks()} disabled={marksSaving}>
                    {marksSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save marks
                  </button>
                </div>
                <div className="table-toolbar">
                  <IdentifierModeToggle value={identifierMode} onChange={setIdentifierMode} />
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      value={rosterQuery}
                      onChange={(event) => setRosterQuery(event.target.value)}
                      placeholder={identifierMode === 'roll' ? 'Search by name or roll number' : identifierMode === 'admission' ? 'Search by name or admission number' : 'Search by name, roll number or admission number'}
                    />
                  </div>
                  <span className="result-count">{visibleRoster.length} students</span>
                </div>
                <div className="table-wrap">
                  <table className="exam-marks-table">
                    <thead>
                      <tr><th>{identifierColumnLabel(identifierMode)}</th><th>Student</th><th>Marks ({openTest.max_marks})</th><th>Absent</th><th>WhatsApp result</th></tr>
                    </thead>
                    <tbody>
                      {visibleRoster.map((student) => {
                        const value = markDraftFor(student.id);
                        const link = whatsappFor(student, openTest, value);
                        return (
                          <tr key={student.id}>
                            <td className="muted-cell">
                              <span className="identifier-cell">
                                {identifierMode !== 'admission' && <strong>{rollLabel(student)}</strong>}
                                {identifierMode !== 'roll' && <small>{admissionLabel(student)}</small>}
                              </span>
                            </td>
                            <td>
                              <div className="table-student">
                                <div className="student-avatar">{student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                                <span><strong>{student.full_name}</strong>{identifierMode === 'roll' && <small>{student.admission_number}</small>}</span>
                              </div>
                            </td>
                            <td>
                              <input
                                type="number"
                                className="exam-mark-input"
                                min="0"
                                max={openTest.max_marks}
                                value={value.absent ? '' : value.obtained}
                                disabled={value.absent}
                                placeholder={value.absent ? 'Absent' : '—'}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  const clamped = Number.isFinite(parsed) ? String(Math.min(parsed, openTest.max_marks)) : event.target.value;
                                  setMarkDrafts((current) => ({ ...current, [student.id]: { obtained: clamped, absent: false } }));
                                }}
                              />
                            </td>
                            <td>
                              <label className="att-filter-check exam-absent-check">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-rose-500"
                                  checked={value.absent}
                                  onChange={(event) => setMarkDrafts((current) => ({ ...current, [student.id]: { obtained: '', absent: event.target.checked } }))}
                                />
                                <span>Absent</span>
                              </label>
                            </td>
                            <td>
                              {link ? (
                                <a className="secondary-button test-wa-link" href={link} target="_blank" rel="noreferrer">
                                  <MessageCircle size={14} /> Send
                                </a>
                              ) : (
                                <span className="muted-cell">No number</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="cal-hint">
                  <Info size={14} />
                  Save the marks first, then press Send on a row to open WhatsApp with the result message already written to that
                  student's parent.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="panel roster-panel">
            <div className="table-toolbar">
              <div className="search-field">
                <ExternalLink size={18} />
                <input value={boardQuery} onChange={(event) => setBoardQuery(event.target.value)} placeholder="Search by student, board or roll number" />
              </div>
              <span className="result-count">{boardVisible.length} board results</span>
            </div>
            {boardError && <p className="dmc-warning">{boardError}</p>}

            <div className="board-form-grid">
              <select className="exam-mark-input" value={boardDraft.studentId} onChange={(event) => setBoardDraft((current) => ({ ...current, studentId: event.target.value }))}>
                <option value="">Select student</option>
                {students.filter((student) => student.status === 'active').map((student) => (
                  <option key={student.id} value={student.id}>{student.full_name} · {student.class_name}</option>
                ))}
              </select>
              <input type="text" className="exam-mark-input" placeholder="Class, e.g. 10th" value={boardDraft.className} onChange={(event) => setBoardDraft((current) => ({ ...current, className: event.target.value }))} />
              <input type="text" className="exam-mark-input" placeholder="Board, e.g. BISE Kohat" value={boardDraft.boardName} onChange={(event) => setBoardDraft((current) => ({ ...current, boardName: event.target.value }))} />
              <input type="number" className="exam-mark-input" placeholder="Year" value={boardDraft.examYear} onChange={(event) => setBoardDraft((current) => ({ ...current, examYear: event.target.value }))} />
              <input type="text" className="exam-mark-input" placeholder="Board roll no." value={boardDraft.boardRollNumber} onChange={(event) => setBoardDraft((current) => ({ ...current, boardRollNumber: event.target.value }))} />
              <input type="number" className="exam-mark-input" placeholder="Total marks" value={boardDraft.totalMarks} onChange={(event) => setBoardDraft((current) => ({ ...current, totalMarks: event.target.value }))} />
              <input type="number" className="exam-mark-input" placeholder="Obtained" value={boardDraft.obtainedMarks} onChange={(event) => setBoardDraft((current) => ({ ...current, obtainedMarks: event.target.value }))} />
              <input type="text" className="exam-mark-input" placeholder="Grade / Division" value={boardDraft.gradeDivision} onChange={(event) => setBoardDraft((current) => ({ ...current, gradeDivision: event.target.value }))} />
              <button type="button" className="primary-button" onClick={() => void saveBoard()} disabled={boardSaving}>
                {boardSaving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {boardDraft.id ? 'Update result' : 'Record result'}
              </button>
            </div>
            {boardDraft.id && <button type="button" className="text-button" onClick={() => setBoardDraft(emptyBoard())}>Cancel edit</button>}

            <div className="table-wrap">
              <table className="exam-marks-table">
                <thead>
                  <tr><th>Student</th><th>Class</th><th>Board</th><th>Year</th><th>Roll No.</th><th>Marks</th><th>%</th><th>Grade / Division</th><th /></tr>
                </thead>
                <tbody>
                  {boardVisible.map((result) => {
                    const student = studentById.get(result.student_id);
                    const percentage = result.total_marks > 0 ? Math.round((result.obtained_marks / result.total_marks) * 1000) / 10 : 0;
                    return (
                      <tr key={result.id}>
                        <td><strong>{student?.full_name ?? 'Unknown student'}</strong></td>
                        <td className="muted-cell">{result.class_name}</td>
                        <td className="muted-cell">{result.board_name}</td>
                        <td className="muted-cell">{result.exam_year}</td>
                        <td className="muted-cell">{result.board_roll_number}</td>
                        <td className="muted-cell">{result.obtained_marks} / {result.total_marks}</td>
                        <td className="muted-cell">{percentage}%</td>
                        <td className="muted-cell">{result.grade_division || '—'}</td>
                        <td>
                          <div className="exam-marks-actions">
                            <button type="button" className="row-action-btn" title="Edit result" onClick={() => editBoard(result)}><Save size={14} /></button>
                            <button type="button" className="row-action-btn" title="Delete result" onClick={() => void removeBoard(result)}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {boardVisible.length === 0 && <div className="empty-state large">No board results recorded yet.</div>}
            </div>
          </div>

          <p className="cal-hint">
            <Info size={14} />
            Board results are the official figures from the external board, kept separate from the school's own exam results so the
            two never mix. Record one row per student per year.
          </p>
        </>
      )}
    </div>
  );
}
