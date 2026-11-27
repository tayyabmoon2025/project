import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleCheck as CheckCircle2, ClipboardCheck, Clock, Eye, FileText, Mic, Play, Plus, Printer, Radio, RefreshCw, ShieldCheck, CircleStop as StopCircle, Trash2, UserCheck, Video, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useClassOptions, useSectionOptions, withCurrent } from '@/lib/classSections';
import { todayKey } from '@/lib/attendance';
import { toCsv, downloadCsv } from '@/lib/fees';
import { usePrintSheet } from '@/lib/usePrintSheet';
import { LiveClassroom } from '@/components/LiveClassroom';
import { LiveClassSheet } from '@/components/LiveClassSheet';
import {
  DURATION_CHOICES,
  deleteLiveClass,
  fetchClassStudents,
  fetchLiveAttendance,
  fetchLiveClasses,
  formatClassDate,
  formatClassTime,
  formatDuration,
  joinTimeLabel,
  liveClassWhatsAppLink,
  modeLabel,
  requestLiveClass,
  reviewLiveClass,
  setLiveClassState,
  statusLabel,
  type LiveClass,
  type LiveClassAttendance,
  type LiveClassDraft,
  type LiveClassMode,
  type LiveClassStudent,
} from '@/lib/liveClasses';

type Toast = (message: string) => void;
type LiveTab = 'schedule' | 'pending' | 'monitor' | 'reports';

const SUBJECTS = [
  'English', 'Urdu', 'Mathematics', 'Science', 'Islamiat', 'Social Studies',
  'Computer', 'Physics', 'Chemistry', 'Biology', 'Pakistan Studies',
];

const emptyDraft = (className: string, sectionName: string): LiveClassDraft => ({
  className,
  sectionName,
  subjectName: '',
  lessonTopic: '',
  classDate: todayKey(),
  startTime: '16:00',
  durationMinutes: 40,
  mode: 'video',
});

type ReportBundle = { liveClass: LiveClass; roster: LiveClassStudent[]; entries: LiveClassAttendance[] };

// Live Classes: a teacher asks for an after-school online lesson, an administrator
// approves it, and once it is approved the room can be opened. Attendance is recorded
// automatically the moment a student or parent joins, so the teacher never has to take
// a register for an online class.
export function LiveClassesModule({ onToast }: { onToast: Toast }) {
  const { profile } = useAuth();
  const classes = useClassOptions();
  const sections = useSectionOptions();
  const isAdmin = profile?.role === 'admin';
  const isTeacher = profile?.role === 'teacher';

  const [tab, setTab] = useState<LiveTab>(isAdmin ? 'pending' : 'schedule');
  const [items, setItems] = useState<LiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roomClass, setRoomClass] = useState<LiveClass | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [report, setReport] = useState<ReportBundle | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [printTarget, setPrintTarget] = useState<ReportBundle | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<LiveClassDraft>(() => emptyDraft(classes[0] ?? '', sections[0] ?? ''));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchLiveClasses();
    setItems(result.classes);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // While a class is running, the list refreshes on its own so the monitoring tab and
  // the teacher's own screen both notice a class starting or finishing.
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const pending = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);
  const live = useMemo(() => items.filter((item) => item.status === 'live'), [items]);
  const approved = useMemo(() => items.filter((item) => item.status === 'approved'), [items]);
  const myClasses = useMemo(
    () => (isAdmin ? items : items.filter((item) => item.teacher_id === profile?.id)),
    [items, isAdmin, profile],
  );

  usePrintSheet(printTarget !== null, printTarget ? (
    <LiveClassSheet
      liveClass={printTarget.liveClass}
      roster={printTarget.roster}
      entries={printTarget.entries}
      audience={isAdmin ? 'admin' : 'teacher'}
    />
  ) : null);

  const openRoom = async (item: LiveClass) => {
    setBusyId(item.id);
    if (item.status === 'approved') {
      const result = await setLiveClassState(item.id, { status: 'live', started_at: new Date().toISOString() });
      if (result.error) { setBusyId(null); onToast(result.error); return; }
    }
    setBusyId(null);
    setRoomClass({ ...item, status: item.status === 'approved' ? 'live' : item.status });
    void load();
  };

  const endClass = async (item: LiveClass) => {
    setBusyId(item.id);
    const result = await setLiveClassState(item.id, {
      status: 'ended',
      ended_at: new Date().toISOString(),
      ended_by: profile?.id ?? null,
    });
    setBusyId(null);
    if (result.error) { onToast(result.error); return; }
    if (roomClass?.id === item.id) setRoomClass(null);
    onToast('The live class has been closed and the attendance record is saved.');
    await load();
  };

  const cancelRequest = async (item: LiveClass) => {
    setBusyId(item.id);
    const result = await deleteLiveClass(item.id);
    setBusyId(null);
    if (result.error) { onToast(result.error); return; }
    onToast('The live class request was withdrawn.');
    await load();
  };

  const decide = async (item: LiveClass, decision: 'approved' | 'rejected') => {
    setBusyId(item.id);
    const result = await reviewLiveClass(item.id, decision, decision === 'rejected' ? rejectRemarks : '');
    setBusyId(null);
    setRejectingId(null);
    setRejectRemarks('');
    if (result.error) { onToast(result.error); return; }
    if (decision === 'approved') {
      onToast(`Approved. The teacher and ${result.parentNotices} parent notice${result.parentNotices === 1 ? '' : 's'} were sent.`);
    } else {
      onToast('The live class request was rejected. The teacher has been told.');
    }
    await load();
  };

  const submitRequest = async () => {
    if (!profile) return;
    if (!draft.className) { setFormError('Choose the class this live class is for.'); return; }
    if (!draft.sectionName) { setFormError('Choose the section this live class is for.'); return; }
    if (!draft.subjectName.trim()) { setFormError('Name the subject, for example Mathematics.'); return; }
    if (draft.lessonTopic.trim().length < 2) { setFormError('Write the lesson topic so parents know what to expect.'); return; }
    if (!draft.classDate) { setFormError('Choose the date of the live class.'); return; }
    if (!draft.startTime) { setFormError('Choose the time the class starts.'); return; }
    if (draft.durationMinutes < 10 || draft.durationMinutes > 240) { setFormError('A live class lasts between 10 and 240 minutes.'); return; }

    setSaving(true);
    const result = await requestLiveClass(draft, { id: profile.id, fullName: profile.full_name });
    setSaving(false);
    if (result.error) { setFormError(result.error); return; }
    setFormOpen(false);
    setFormError(null);
    setDraft(emptyDraft(draft.className, draft.sectionName));
    onToast('Your live class request has been sent to the administrator for approval.');
    await load();
  };

  const loadReport = async (item: LiveClass) => {
    setReportLoading(true);
    setReport(null);
    const [rosterResult, entriesResult] = await Promise.all([
      fetchClassStudents(item.class_name, item.section_name),
      fetchLiveAttendance(item.id),
    ]);
    setReportLoading(false);
    if (entriesResult.error) { onToast(entriesResult.error); return; }
    setReport({ liveClass: item, roster: rosterResult.students, entries: entriesResult.entries });
  };

  const printReport = async () => {
    if (!report) return;
    setPrintTarget(report);
    window.setTimeout(() => window.print(), 140);
  };

  const exportReport = () => {
    if (!report) return;
    const rows: (string | number | null)[][] = [
      ['Student', 'Joined', 'Left', 'Minutes present', 'Status'],
      ...report.entries.map((entry) => [
        entry.student_name,
        new Date(entry.joined_at).toLocaleString(),
        entry.left_at ? new Date(entry.left_at).toLocaleString() : 'Still in the room',
        entry.minutes_present ?? '',
        entry.left_at ? 'Attended' : 'Present',
      ]),
    ];
    downloadCsv(`live-class-${report.liveClass.class_name}-${report.liveClass.class_date}.csv`, toCsv(rows));
    onToast('The attendance record has been downloaded.');
  };

  const tabs: { id: LiveTab; label: string; hint: string; icon: typeof CalendarDays }[] = isAdmin
    ? [
        { id: 'pending', label: 'Pending Approvals', hint: 'Approve or reject requests', icon: ClipboardCheck },
        { id: 'monitor', label: 'Live Monitoring', hint: 'Watch and listen to running classes', icon: Eye },
        { id: 'reports', label: 'Attendance Reports', hint: 'Who joined, and when', icon: FileText },
      ]
    : [
        { id: 'schedule', label: 'My Live Classes', hint: 'Request and host a class', icon: Video },
        { id: 'reports', label: 'Attendance Reports', hint: 'Who joined, and when', icon: FileText },
      ];

  if (roomClass) {
    return (
      <div className="admin-panel live-module">
        <LiveClassroom
          liveClass={roomClass}
          viewerName={profile?.full_name ?? 'Guest'}
          onToast={onToast}
          onChanged={() => void load()}
          onClose={() => { setRoomClass(null); void load(); }}
        />
      </div>
    );
  }

  return (
    <div className="admin-panel live-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Online learning</span>
          <h2>Live Classes</h2>
          <p>
            {isAdmin
              ? 'Approve the online classes your teachers ask for, join any running lesson to observe, and print the attendance record afterwards.'
              : 'Ask for an after-school online class, then open the room when the administrator approves it. Attendance is recorded automatically.'}
          </p>
        </div>
        <div className="live-head-actions">
          {!isAdmin && isTeacher && (
            <button type="button" className="primary-button" onClick={() => { setFormOpen((value) => !value); setFormError(null); }}>
              <Plus size={16} /> Request a live class
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="att-tabs" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`att-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={15} />
              <span className="att-tab-label">
                {item.label}
                <small>{item.hint}</small>
              </span>
              {item.id === 'pending' && pending.length > 0 && <span className="live-tab-count">{pending.length}</span>}
              {item.id === 'monitor' && live.length > 0 && <span className="live-tab-count live">{live.length}</span>}
            </button>
          );
        })}
      </div>

      {error && <p className="dmc-warning">{error}</p>}

      {formOpen && !isAdmin && (
        <section className="live-request-panel">
          <div className="live-request-head">
            <div>
              <span className="eyebrow">New request</span>
              <h3>Schedule an after-school online class</h3>
              <p>The request goes to the administrator first. Once approved, the class link is ready to share with parents.</p>
            </div>
            <button type="button" className="live-icon-button" onClick={() => setFormOpen(false)} aria-label="Close the request form"><X size={17} /></button>
          </div>

          <div className="live-request-grid">
            <label className="control-field">
              <span>Class</span>
              <select value={draft.className} onChange={(event) => setDraft({ ...draft, className: event.target.value })}>
                <option value="">Choose a class</option>
                {withCurrent(classes, draft.className).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="control-field">
              <span>Section</span>
              <select value={draft.sectionName} onChange={(event) => setDraft({ ...draft, sectionName: event.target.value })}>
                <option value="">Choose a section</option>
                {withCurrent(sections, draft.sectionName).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="control-field">
              <span>Subject</span>
              <input
                list="live-subject-options"
                value={draft.subjectName}
                onChange={(event) => setDraft({ ...draft, subjectName: event.target.value })}
                placeholder="e.g. Mathematics"
              />
              <datalist id="live-subject-options">
                {SUBJECTS.map((subject) => <option key={subject} value={subject} />)}
              </datalist>
            </label>
            <label className="control-field live-field-wide">
              <span>Lesson topic</span>
              <input
                value={draft.lessonTopic}
                onChange={(event) => setDraft({ ...draft, lessonTopic: event.target.value })}
                placeholder="e.g. Fractions — addition and subtraction"
              />
            </label>
            <label className="control-field">
              <span>Date</span>
              <input type="date" value={draft.classDate} onChange={(event) => setDraft({ ...draft, classDate: event.target.value })} />
            </label>
            <label className="control-field">
              <span>Start time</span>
              <input type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} />
            </label>
            <label className="control-field">
              <span>Duration</span>
              <select value={draft.durationMinutes} onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) })}>
                {DURATION_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>)}
              </select>
            </label>
            <div className="control-field">
              <span>Mode</span>
              <div className="live-mode-toggle">
                {(['audio', 'video'] as LiveClassMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`live-mode-option ${draft.mode === mode ? 'active' : ''}`}
                    onClick={() => setDraft({ ...draft, mode })}
                  >
                    {mode === 'audio' ? <Mic size={14} /> : <Video size={14} />}
                    {modeLabel(mode)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {formError && <p className="fee-error">{formError}</p>}

          <div className="live-request-foot">
            <p className="fee-hint"><ShieldCheck size={14} /> Only an administrator can approve a live class. Nothing is shared with parents before approval.</p>
            <div className="live-request-buttons">
              <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void submitRequest()} disabled={saving}>
                {saving ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'pending' && (
        <section className="live-panel">
          <div className="live-panel-head">
            <div><span className="eyebrow">Approval queue</span><h3>{pending.length} request{pending.length === 1 ? '' : 's'} waiting</h3></div>
          </div>
          {loading ? <p className="empty-state">Loading requests…</p> : pending.length === 0 ? (
            <p className="empty-state">No live class is waiting for approval. New teacher requests appear here.</p>
          ) : (
            <ul className="live-request-list">
              {pending.map((item) => (
                <li className="live-request-row" key={item.id}>
                  <div className="live-request-ident">
                    <span className="live-request-avatar">{item.teacher_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
                    <div>
                      <strong>{item.subject_name} — {item.class_name} {item.section_name}</strong>
                      <span>{item.teacher_name} · {formatClassDate(item.class_date)} at {formatClassTime(item.start_time)}</span>
                      <small>{item.lesson_topic}</small>
                    </div>
                  </div>
                  <div className="live-request-facts">
                    <span className="live-fact"><Clock size={13} /> {formatDuration(item.duration_minutes)}</span>
                    <span className="live-fact">{item.mode === 'audio' ? <Mic size={13} /> : <Video size={13} />} {modeLabel(item.mode)}</span>
                  </div>
                  {rejectingId === item.id ? (
                    <div className="live-reject-box">
                      <input
                        value={rejectRemarks}
                        onChange={(event) => setRejectRemarks(event.target.value)}
                        placeholder="Reason for the teacher (optional)"
                      />
                      <button type="button" className="live-mini danger" onClick={() => void decide(item, 'rejected')} disabled={busyId === item.id}>Confirm reject</button>
                      <button type="button" className="live-mini" onClick={() => { setRejectingId(null); setRejectRemarks(''); }}>Cancel</button>
                    </div>
                  ) : (
                    <div className="live-row-actions">
                      <button type="button" className="live-approve" onClick={() => void decide(item, 'approved')} disabled={busyId === item.id}>
                        <CheckCircle2 size={15} /> Approve
                      </button>
                      <button type="button" className="live-reject" onClick={() => { setRejectingId(item.id); setRejectRemarks(''); }}>
                        <X size={15} /> Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'monitor' && (
        <section className="live-panel">
          <div className="live-panel-head">
            <div><span className="eyebrow">Live monitoring</span><h3>{live.length} class{live.length === 1 ? '' : 'es'} running now</h3></div>
            <p className="live-panel-note">Open a room to watch and listen without disturbing the lesson.</p>
          </div>

          {live.length === 0 ? (
            <p className="empty-state">No online class is running at the moment. Approved classes that have been started will appear here.</p>
          ) : (
            <div className="live-monitor-grid">
              {live.map((item) => (
                <article className="live-monitor-card on-air" key={item.id}>
                  <span className="live-badge on-air"><Radio size={13} /> Live now</span>
                  <h4>{item.subject_name} — {item.class_name} {item.section_name}</h4>
                  <p>{item.lesson_topic}</p>
                  <dl>
                    <div><dt>Teacher</dt><dd>{item.teacher_name}</dd></div>
                    <div><dt>Started</dt><dd>{item.started_at ? joinTimeLabel(item.started_at) : formatClassTime(item.start_time)}</dd></div>
                    <div><dt>Mode</dt><dd>{modeLabel(item.mode)}</dd></div>
                  </dl>
                  <div className="live-monitor-actions">
                    <button type="button" className="live-watch" onClick={() => void openRoom(item)} disabled={busyId === item.id}>
                      <Eye size={15} /> Watch &amp; Listen Live (Admin Monitor)
                    </button>
                    <button type="button" className="live-mini" onClick={() => void endClass(item)} disabled={busyId === item.id}>
                      <StopCircle size={13} /> Close the class
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {approved.length > 0 && (
            <div className="live-ready-block">
              <span className="live-roster-label">Approved and ready to open</span>
              <ul className="live-ready-list">
                {approved.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.subject_name} — {item.class_name} {item.section_name}</strong>
                      <span>{item.teacher_name} · {formatClassDate(item.class_date)} at {formatClassTime(item.start_time)}</span>
                    </div>
                    <button type="button" className="live-mini" onClick={() => void openRoom(item)} disabled={busyId === item.id}>
                      <Play size={13} /> Open the room
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === 'schedule' && (
        <section className="live-panel">
          <div className="live-panel-head">
            <div><span className="eyebrow">My schedule</span><h3>{myClasses.length} live class{myClasses.length === 1 ? '' : 'es'}</h3></div>
          </div>
          {loading ? <p className="empty-state">Loading your live classes…</p> : myClasses.length === 0 ? (
            <p className="empty-state">You have not requested a live class yet. Use “Request a live class” to schedule one.</p>
          ) : (
            <div className="table-wrap">
              <table className="live-table">
                <thead>
                  <tr><th>Date &amp; time</th><th>Class</th><th>Subject &amp; topic</th><th>Mode</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {myClasses.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{formatClassDate(item.class_date)}</strong>
                        <small className="fee-sub">{formatClassTime(item.start_time)} · {formatDuration(item.duration_minutes)}</small>
                      </td>
                      <td>{item.class_name} · {item.section_name}</td>
                      <td>
                        <strong>{item.subject_name}</strong>
                        <small className="fee-sub">{item.lesson_topic}</small>
                        {item.admin_remarks && <small className="live-remarks">Admin: {item.admin_remarks}</small>}
                      </td>
                      <td>{item.mode === 'audio' ? <span className="live-fact"><Mic size={13} /> Audio</span> : <span className="live-fact"><Video size={13} /> Audio + Video</span>}</td>
                      <td><span className={`live-status ${item.status}`}>{statusLabel(item.status)}</span></td>
                      <td>
                        <div className="live-row-actions">
                          {item.status === 'approved' && (
                            <button type="button" className="live-approve" onClick={() => void openRoom(item)} disabled={busyId === item.id}>
                              <Play size={14} /> Start Live Class
                            </button>
                          )}
                          {item.status === 'live' && (
                            <>
                              <button type="button" className="live-approve" onClick={() => void openRoom(item)}><Eye size={14} /> Open room</button>
                              <button type="button" className="live-mini" onClick={() => void endClass(item)} disabled={busyId === item.id}><StopCircle size={13} /> End</button>
                            </>
                          )}
                          {item.status === 'pending' && (
                            <button type="button" className="live-mini danger" onClick={() => void cancelRequest(item)} disabled={busyId === item.id}>
                              <Trash2 size={13} /> Withdraw
                            </button>
                          )}
                          {(item.status === 'ended' || item.status === 'live') && (
                            <button type="button" className="live-mini" onClick={() => { setTab('reports'); void loadReport(item); }}>
                              <FileText size={13} /> Report
                            </button>
                          )}
                          {item.status === 'approved' && (
                            <a className="live-mini" href={liveClassWhatsAppLink(item)} target="_blank" rel="noreferrer">Share link</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'reports' && (
        <section className="live-panel">
          <div className="live-panel-head">
            <div><span className="eyebrow">Attendance reports</span><h3>Online class attendance</h3></div>
            <p className="live-panel-note">Choose a class to see who joined, when they joined and when they left.</p>
          </div>

          <div className="live-report-picker">
            {items.filter((item) => item.status === 'ended' || item.status === 'live').length === 0 ? (
              <p className="empty-state">No online class has been held yet. Attendance appears here once a class has run.</p>
            ) : (
              items.filter((item) => item.status === 'ended' || item.status === 'live').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`live-report-chip ${report?.liveClass.id === item.id ? 'active' : ''}`}
                  onClick={() => void loadReport(item)}
                >
                  <strong>{item.class_name} {item.section_name} · {item.subject_name}</strong>
                  <span>{formatClassDate(item.class_date)} · {item.teacher_name}</span>
                </button>
              ))
            )}
          </div>

          {reportLoading && <p className="empty-state">Loading the attendance record…</p>}

          {report && !reportLoading && (
            <div className="live-report">
              <div className="live-report-head">
                <div>
                  <span className="eyebrow">{report.liveClass.class_name} {report.liveClass.section_name} · {report.liveClass.subject_name}</span>
                  <h3>{report.liveClass.lesson_topic}</h3>
                  <p>{report.liveClass.teacher_name} · {formatClassDate(report.liveClass.class_date)} at {formatClassTime(report.liveClass.start_time)} · {modeLabel(report.liveClass.mode)}</p>
                </div>
                <div className="live-report-buttons">
                  <button type="button" className="secondary-button" onClick={() => void printReport()}><Printer size={15} /> Print A4 summary</button>
                  <button type="button" className="secondary-button" onClick={exportReport}><FileText size={15} /> Download CSV</button>
                  <button type="button" className="secondary-button" onClick={() => setReport(null)}>Close</button>
                </div>
              </div>

              <div className="acct-mini-stats">
                <div><span>Total students</span><strong>{report.roster.length}</strong></div>
                <div><span>Present</span><strong className="text-emerald-700">{report.entries.length}</strong></div>
                <div><span>Absent</span><strong className="text-rose-600">{Math.max(0, report.roster.length - report.entries.length)}</strong></div>
                <div><span>Still in the room</span><strong>{report.entries.filter((entry) => !entry.left_at).length}</strong></div>
              </div>

              {report.entries.length === 0 ? (
                <p className="empty-state">No student joined this online class.</p>
              ) : (
                <div className="table-wrap">
                  <table className="live-table">
                    <thead>
                      <tr><th>#</th><th>Student</th><th>Joined</th><th>Left</th><th>Minutes</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {report.entries.map((entry, index) => (
                        <tr key={entry.id}>
                          <td className="muted-cell">{index + 1}</td>
                          <td><strong>{entry.student_name}</strong></td>
                          <td>{joinTimeLabel(entry.joined_at)}</td>
                          <td>{entry.left_at ? joinTimeLabel(entry.left_at) : 'Still in the room'}</td>
                          <td className="tabular-nums">{entry.minutes_present ?? '—'}</td>
                          <td><span className={`live-status ${entry.left_at ? 'ended' : 'live'}`}>{entry.left_at ? 'Attended' : 'Present'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.roster.filter((student) => !report.entries.some((entry) => entry.student_id === student.id)).length > 0 && (
                <p className="live-absent-note">
                  <UserCheck size={14} /> Did not join:{' '}
                  {report.roster
                    .filter((student) => !report.entries.some((entry) => entry.student_id === student.id))
                    .map((student) => student.full_name)
                    .join(', ')}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
