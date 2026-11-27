import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, Mic, Radio, RefreshCw, UserCheck, Video } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { LiveClassroom } from '@/components/LiveClassroom';
import {
  fetchLiveAttendance,
  fetchLiveClasses,
  formatClassDate,
  formatClassTime,
  formatDuration,
  isStartingSoon,
  modeLabel,
  type LiveClass,
  type LiveClassAttendance,
} from '@/lib/liveClasses';

type Toast = (message: string) => void;

// The family view of the live classes: only approved sessions ever reach here, and only
// for the classes the linked children are actually in — the database decides that, so
// this screen cannot show a class that belongs to somebody else.
export function PortalLiveClassesPanel({ onToast, title }: { onToast: Toast; title?: string }) {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<LiveClass[]>([]);
  const [joined, setJoined] = useState<LiveClassAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<LiveClass | null>(null);

  const load = useCallback(async () => {
    const result = await fetchLiveClasses();
    setError(result.error);
    const open = result.classes
      .filter((item) => item.status === 'approved' || item.status === 'live')
      .sort((a, b) => `${a.class_date}${a.start_time}`.localeCompare(`${b.class_date}${b.start_time}`));
    setClasses(open);

    // A short record of the sessions this family has already joined, so a parent can see
    // that attendance was taken without opening the room again.
    const entries: LiveClassAttendance[] = [];
    for (const item of open.filter((entry) => entry.status === 'live')) {
      const result2 = await fetchLiveAttendance(item.id);
      entries.push(...result2.entries);
    }
    setJoined(entries);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const myJoin = useMemo(
    () => new Set(joined.map((entry) => `${entry.class_id}:${entry.student_id}`)),
    [joined],
  );

  if (active) {
    return (
      <section className="panel live-portal-panel">
        <LiveClassroom
          liveClass={active}
          viewerName={profile?.full_name ?? 'Guest'}
          onToast={onToast}
          onChanged={() => void load()}
          onClose={() => { setActive(null); void load(); }}
        />
      </section>
    );
  }

  return (
    <section className="panel live-portal-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Online learning</span>
          <h2>{title ?? 'Live classes'}</h2>
          <p className="panel-subtitle">
            Approved online classes appear here. Open the room at the class time and your child's
            attendance is recorded automatically with the exact time they joined.
          </p>
        </div>
        <div className="live-portal-head-actions">
          <button type="button" className="live-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="dmc-warning">{error}</p>}

      {loading ? (
        <p className="empty-state">Checking for online classes…</p>
      ) : classes.length === 0 ? (
        <p className="empty-state">No online class has been scheduled for your class yet. It will appear here as soon as the school approves one.</p>
      ) : (
        <ul className="live-portal-list">
          {classes.map((item) => {
            const soon = isStartingSoon(item);
            const attended = joined.filter((entry) => entry.class_id === item.id).length;
            return (
              <li className={`live-portal-card ${item.status === 'live' ? 'on-air' : ''}`} key={item.id}>
                <div className="live-portal-card-head">
                  <span className={`live-badge ${item.status === 'live' ? 'on-air' : soon ? 'ready' : 'planned'}`}>
                    {item.status === 'live' ? <><Radio size={13} /> Live now</> : soon ? <><Clock size={13} /> Starting soon</> : <><CalendarDays size={13} /> Scheduled</>}
                  </span>
                  <div>
                    <strong>{item.subject_name}</strong>
                    <span>{item.class_name} · Section {item.section_name} · {item.teacher_name}</span>
                  </div>
                </div>
                <p className="live-portal-topic">{item.lesson_topic}</p>
                <div className="live-portal-facts">
                  <span><CalendarDays size={13} /> {formatClassDate(item.class_date)}</span>
                  <span><Clock size={13} /> {formatClassTime(item.start_time)} · {formatDuration(item.duration_minutes)}</span>
                  <span>{item.mode === 'audio' ? <><Mic size={13} /> {modeLabel(item.mode)}</> : <><Video size={13} /> {modeLabel(item.mode)}</>}</span>
                </div>
                <div className="live-portal-actions">
                  <button type="button" className="primary-button" onClick={() => setActive(item)}>
                    <Video size={15} /> Join Live Class
                  </button>
                  {attended > 0 && (
                    <span className="live-portal-attended">
                      <UserCheck size={14} /> Attendance recorded for {attended} {attended === 1 ? 'student' : 'students'}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {myJoin.size > 0 && (
        <p className="fee-hint"><UserCheck size={14} /> Your child's join time has been sent to the teacher's live attendance tracker.</p>
      )}
    </section>
  );
}
