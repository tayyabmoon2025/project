import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BellRing,
  Clock,
  FlaskConical,
  Hand,
  MessageCircle,
  Mic,
  Radio,
  RefreshCw,
  Users,
  UserX,
  Video,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { LiveClassStage } from '@/components/LiveClassStage';
import {
  fetchClassStudents,
  fetchLiveAttendance,
  fetchLiveHands,
  jitsiRoomUrl,
  joinLiveClass,
  leaveLiveClass,
  liveClassWhatsAppLink,
  lowerHand,
  modeLabel,
  formatClassDate,
  formatClassTime,
  formatDuration,
  joinTimeLabel,
  raiseHand,
  type LiveClass,
  type LiveClassAttendance,
  type LiveClassHand,
  type LiveClassStudent,
} from '@/lib/liveClasses';

const POLL_MS = 6000;

type Toast = (message: string) => void;
type LiveToastTone = 'in' | 'out' | 'hand';

// A live room with the attendance tracker beside it. The feed is read on a short
// interval rather than over a websocket, so it keeps working on a slow school
// connection and needs nothing extra published in the database.
export function LiveClassroom({
  liveClass,
  onClose,
  onToast,
  onChanged,
  viewerName,
}: {
  liveClass: LiveClass;
  onClose: () => void;
  onToast: Toast;
  onChanged: () => void;
  viewerName: string;
}) {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<LiveClassAttendance[]>([]);
  const [hands, setHands] = useState<LiveClassHand[]>([]);
  const [handBusy, setHandBusy] = useState(false);
  const [roster, setRoster] = useState<LiveClassStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [liveToasts, setLiveToasts] = useState<{ id: string; text: string; tone: LiveToastTone }[]>([]);
  const [roomReady, setRoomReady] = useState(false);
  const [myStudentIds, setMyStudentIds] = useState<string[]>([]);
  const knownRef = useRef<Map<string, LiveClassAttendance> | null>(null);
  const knownHandsRef = useRef<Map<string, LiveClassHand> | null>(null);

  const isStaff = profile?.role === 'admin' || profile?.role === 'teacher' ||
    profile?.role === 'office_assistant' || profile?.role === 'support_staff';
  const isFamily = profile?.role === 'parent' || profile?.role === 'student';

  const pushToast = useCallback((text: string, tone: LiveToastTone) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setLiveToasts((current) => [...current, { id, text, tone }].slice(-4));
    window.setTimeout(() => setLiveToasts((current) => current.filter((item) => item.id !== id)), 6000);
  }, []);

  // The class list is only needed for the "test student join" preview and for
  // working out who is still absent, so it is fetched once per room.
  useEffect(() => {
    void fetchClassStudents(liveClass.class_name, liveClass.section_name).then((result) => {
      setRoster(result.students);
    });
  }, [liveClass.class_name, liveClass.section_name]);

  const poll = useCallback(async () => {
    const [attendance, handsResult] = await Promise.all([
      fetchLiveAttendance(liveClass.id),
      fetchLiveHands(liveClass.id),
    ]);
    if (attendance.error) { setError(attendance.error); setLoading(false); return; }
    setError(null);
    setLoading(false);

    const previous = knownRef.current;
    const next = new Map(attendance.entries.map((entry) => [entry.student_id, entry]));

    // The very first read establishes the baseline — nothing is announced for a
    // student who was already in the room before this screen was opened.
    if (previous) {
      for (const entry of attendance.entries) {
        const before = previous.get(entry.student_id);
        if (!before) pushToast(`${entry.student_name} joined the class`, 'in');
        else if (!before.left_at && entry.left_at) pushToast(`${entry.student_name} left the class`, 'out');
        else if (before.left_at && !entry.left_at) pushToast(`${entry.student_name} rejoined the class`, 'in');
      }
    }
    knownRef.current = next;
    setEntries(attendance.entries);

    const openNow = handsResult.hands.filter((hand) => !hand.lowered_at);
    const previousHands = knownHandsRef.current;
    if (isStaff && previousHands) {
      for (const hand of openNow) {
        if (!previousHands.has(hand.student_id)) pushToast(`${hand.student_name} raised their hand`, 'hand');
      }
    }
    knownHandsRef.current = new Map(openNow.map((hand) => [hand.student_id, hand]));
    setHands(handsResult.hands);
  }, [isStaff, liveClass.id, pushToast]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => { void poll(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  // Which student records belong to the person looking at the screen: a student's own
  // record, or a parent's linked children. Staff have no records here.
  useEffect(() => {
    if (!profile || !isFamily) { setMyStudentIds([]); return; }
    void (async () => {
      if (profile.role === 'student') {
        const { data } = await supabase.from('user_profiles').select('student_id').eq('id', profile.id).maybeSingle();
        const id = (data as { student_id: string | null } | null)?.student_id;
        setMyStudentIds(id ? [id] : []);
        return;
      }
      const { data } = await supabase.from('parent_student_links').select('student_id').eq('parent_user_id', profile.id);
      setMyStudentIds(((data ?? []) as { student_id: string }[]).map((row) => row.student_id));
    })();
  }, [profile, isFamily]);

  // Opening this screen is the moment attendance is taken for a family, so the join is
  // recorded on the way in and the leave time on the way out.
  const autoJoinIds = useMemo(
    () => myStudentIds.filter((id) => roster.some((student) => student.id === id)),
    [myStudentIds, roster],
  );

  useEffect(() => {
    if (autoJoinIds.length === 0) return;
    void (async () => {
      for (const studentId of autoJoinIds) await joinLiveClass(liveClass.id, studentId);
      await poll();
    })();
  }, [autoJoinIds, liveClass.id, poll]);

  useEffect(() => {
    if (autoJoinIds.length === 0) return;
    const ids = autoJoinIds;
    const markLeaving = () => {
      for (const studentId of ids) void leaveLiveClass(liveClass.id, studentId);
    };
    window.addEventListener('beforeunload', markLeaving);
    return () => {
      window.removeEventListener('beforeunload', markLeaving);
      markLeaving();
    };
  }, [autoJoinIds, liveClass.id]);

  const testJoin = async () => {
    const candidate = roster.find((student) => !entries.some((entry) => entry.student_id === student.id)) ?? roster[0];
    if (!candidate) { onToast('Add a student to this class first, then the test join will work.'); return; }
    setBusy(true);
    const result = await joinLiveClass(liveClass.id, candidate.id);
    setBusy(false);
    if (result.error) { onToast(result.error); return; }
    await poll();
    onToast(`${candidate.full_name} was marked present for the local preview.`);
  };

  const markPresent = async (student: LiveClassStudent) => {
    setBusy(true);
    const result = await joinLiveClass(liveClass.id, student.id);
    setBusy(false);
    if (result.error) { onToast(result.error); return; }
    await poll();
    onChanged();
  };

  const markAbsent = async (student: LiveClassStudent) => {
    setBusy(true);
    const result = await leaveLiveClass(liveClass.id, student.id);
    setBusy(false);
    if (result.error) { onToast(result.error); return; }
    await poll();
    onChanged();
  };

  const openHands = hands.filter((hand) => !hand.lowered_at);
  const openHandIds = new Set(openHands.map((hand) => hand.student_id));
  const myHandUp = isFamily && autoJoinIds.length > 0 && autoJoinIds.every((id) => openHandIds.has(id));

  const toggleMyHand = async () => {
    if (autoJoinIds.length === 0 || handBusy) return;
    setHandBusy(true);
    for (const studentId of autoJoinIds) {
      const result = myHandUp ? await lowerHand(liveClass.id, studentId) : await raiseHand(liveClass.id, studentId);
      if (result.error) { onToast(result.error); break; }
    }
    setHandBusy(false);
    await poll();
  };

  const lowerFor = async (studentId: string) => {
    if (handBusy) return;
    setHandBusy(true);
    const result = await lowerHand(liveClass.id, studentId);
    setHandBusy(false);
    if (result.error) { onToast(result.error); return; }
    await poll();
  };

  const presentIds = new Set(entries.map((entry) => entry.student_id));
  const stillHere = entries.filter((entry) => !entry.left_at).length;
  const shareLink = liveClassWhatsAppLink(liveClass);
  const meetingUrl = jitsiRoomUrl(liveClass.room_id, viewerName);

  return (
    <div className="live-room">
      <div className="live-room-bar">
        <button type="button" className="live-back" onClick={onClose}><ArrowLeft size={16} /> Back to live classes</button>
        <div className="live-room-ident">
          <span className={`live-badge ${liveClass.status === 'live' ? 'on-air' : 'ready'}`}>
            {liveClass.status === 'live' ? <><Radio size={13} /> Live now</> : <><Clock size={13} /> Room open</>}
          </span>
          <div>
            <strong>{liveClass.subject_name} — {liveClass.class_name} {liveClass.section_name}</strong>
            <small>{liveClass.lesson_topic}</small>
          </div>
        </div>
        <div className="live-room-meta">
          <span>{formatClassDate(liveClass.class_date)}</span>
          <span>{formatClassTime(liveClass.start_time)} · {formatDuration(liveClass.duration_minutes)}</span>
          <span className="live-mode-chip">{liveClass.mode === 'audio' ? <><Mic size={13} /> {modeLabel(liveClass.mode)}</> : <><Video size={13} /> {modeLabel(liveClass.mode)}</>}</span>
        </div>
        <div className="live-room-actions">
          <a className="live-share" href={shareLink} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Share class link on WhatsApp</a>
          <button type="button" className="live-secondary" onClick={() => void navigator.clipboard.writeText(jitsiRoomUrl(liveClass.room_id, viewerName)).then(() => onToast('Class link copied'))}><RefreshCw size={14} /> Copy link</button>
          <button type="button" className="live-secondary" onClick={() => setRoomReady((value) => !value)}>{roomReady ? 'Hide the room' : 'Show the room'}</button>
        </div>
      </div>

      {isFamily && autoJoinIds.length > 0 && (
        <div className={`live-hand-bar ${myHandUp ? 'up' : ''}`}>
          <Hand size={17} />
          {myHandUp ? (
            <>
              <p><strong>Your hand is raised.</strong> The teacher has been notified and will call on you soon.</p>
              <button type="button" className="live-hand-button down" onClick={() => void toggleMyHand()} disabled={handBusy}>
                Lower hand
              </button>
            </>
          ) : (
            <>
              <p><strong>Have a question?</strong> Raise your hand and the teacher will see it right away.</p>
              <button type="button" className="live-hand-button" onClick={() => void toggleMyHand()} disabled={handBusy}>
                <Hand size={15} /> Raise hand
              </button>
            </>
          )}
        </div>
      )}

      <div className="live-room-body">
        <section className="live-stage">
          {roomReady ? (
            <LiveClassStage mode={liveClass.mode} meetingUrl={meetingUrl} meetingLabel={`${liveClass.subject_name} live class`} />
          ) : (
            <div className="live-stage-placeholder">
              <div className="live-stage-icon"><Video size={34} strokeWidth={1.6} /></div>
              <h3>Your classroom is ready</h3>
              <p>
                Open the room to join {liveClass.teacher_name}'s {modeLabel(liveClass.mode).toLowerCase()} session.
                {liveClass.mode === 'audio' ? ' The camera stays off in this mode — voice only.' : ' Camera and microphone are both available.'}
              </p>
              <button type="button" className="primary-button" onClick={() => setRoomReady(true)}>
                {isStaff ? 'Watch and listen live' : 'Join the live class'}
              </button>
              <small>The room runs entirely inside the school app — nothing is embedded from an outside meeting site, so it cannot be blocked.</small>
            </div>
          )}
        </section>

        <aside className="live-feed">
          <div className="live-feed-head">
            <div>
              <span className="eyebrow">Student attendance and join feed</span>
              <h3>{entries.length} of {roster.length} joined</h3>
            </div>
            <span className="live-feed-live"><Users size={14} /> {stillHere} in the room</span>
          </div>

          <div className="live-feed-tools">
            <button type="button" className="live-test-button" onClick={() => void testJoin()} disabled={busy}>
              <FlaskConical size={14} /> Test student join
            </button>
            <button type="button" className="live-secondary" onClick={() => void poll()}><RefreshCw size={14} /> Refresh</button>
          </div>

          {error && <p className="dmc-warning">{error}</p>}

          {isStaff && openHands.length > 0 && (
            <div className="live-hand-queue">
              <span className="live-roster-label"><Hand size={12} /> Raised hands — {openHands.length}</span>
              <ul>
                {openHands.map((hand) => (
                  <li key={hand.id}>
                    <div className="live-hand-who">
                      <strong>{hand.student_name}</strong>
                      <small>Raised {joinTimeLabel(hand.raised_at)}</small>
                    </div>
                    <button type="button" className="live-mini" onClick={() => void lowerFor(hand.student_id)} disabled={handBusy}>
                      Lower
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading ? (
            <p className="empty-state">Reading the attendance feed…</p>
          ) : entries.length === 0 ? (
            <p className="empty-state">No student has joined yet. The list updates by itself as they arrive.</p>
          ) : (
            <ul className="live-feed-list">
              {entries.map((entry) => (
                <li className={`live-feed-row ${entry.left_at ? 'left' : 'in'}`} key={entry.id}>
                  <span className="live-feed-dot" />
                  <div className="live-feed-name">
                    <strong>{entry.student_name}</strong>
                    <small>Joined {joinTimeLabel(entry.joined_at)}{entry.left_at ? ` · Left ${joinTimeLabel(entry.left_at)}` : ' · still in the room'}</small>
                  </div>
                  {entry.minutes_present !== null && <span className="live-feed-minutes">{entry.minutes_present} min</span>}
                </li>
              ))}
            </ul>
          )}

          {roster.length > 0 && (
            <div className="live-roster">
              <span className="live-roster-label">Mark a student by hand</span>
              <ul>
                {roster.map((student) => (
                  <li key={student.id}>
                    <span>{student.full_name}</span>
                    {presentIds.has(student.id) ? (
                      <button type="button" className="live-mini danger" onClick={() => void markAbsent(student)} disabled={busy}>
                        <UserX size={12} /> Undo
                      </button>
                    ) : (
                      <button type="button" className="live-mini" onClick={() => void markPresent(student)} disabled={busy}>
                        Present
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {liveToasts.length > 0 && (
        <div className="live-toast-stack" role="status" aria-live="polite">
          {liveToasts.map((item) => (
            <div className={`live-toast ${item.tone}`} key={item.id}>
              {item.tone === 'in' ? <BellRing size={15} /> : item.tone === 'hand' ? <Hand size={15} /> : <UserX size={15} />}
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
