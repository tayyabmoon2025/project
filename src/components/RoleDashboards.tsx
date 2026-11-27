import { useEffect, useState } from 'react';
import { Bell, BellRing, BookOpenCheck, CalendarCheck2, FileBadge2, GraduationCap, Paperclip, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { fetchPortalNotifications } from '@/lib/absenteeAlerts';
import { PortalHomeworkPanel } from '@/components/PortalHomeworkPanel';
import { PortalLiveClassesPanel } from '@/components/PortalLiveClassesPanel';
import { StudentPortalCertificates } from '@/components/StudentPortalCertificates';
import { StudentFeePanel } from '@/components/StudentFeePanel';
import { StaffCheckInCard } from '@/components/StaffCheckInCard';
import { HolidayTomorrowBanner } from '@/components/HolidayTomorrowBanner';
import type { PortalNotification, Student } from '@/lib/schoolTypes';

export function ParentDashboard({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const [children, setChildren] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, { present: number; absent: number; late: number }>>({});
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data: links } = await supabase
        .from('parent_student_links')
        .select('student_id')
        .eq('parent_user_id', profile.id);
      if (!links || links.length === 0) { setLoading(false); return; }

      const studentIds = (links as { student_id: string }[]).map((l) => l.student_id);
      const { data: students } = await supabase
        .from('school_students')
        .select('id, admission_number, full_name, class_name, section_name, guardian_phone, fee_balance, status, photo_url, fee_concession_category, fee_concession_amount, fee_concession_percentage, concession_approval_status, concession_approved_by, concession_approved_at')
        .in('id', studentIds)
        .order('full_name');
      setChildren(students as Student[] ?? []);

      const { data: att } = await supabase
        .from('school_attendance')
        .select('student_id, status')
        .in('student_id', studentIds);

      const map: Record<string, { present: number; absent: number; late: number }> = {};
      for (const row of (att as { student_id: string; status: string }[]) ?? []) {
        if (!map[row.student_id]) map[row.student_id] = { present: 0, absent: 0, late: 0 };
        if (row.status in map[row.student_id]) (map[row.student_id] as Record<string, number>)[row.status]++;
      }
      setAttendance(map);

      const notices = await fetchPortalNotifications(studentIds);
      setNotifications(notices.notifications);
      setNoticeError(notices.error);
      setLoading(false);
    })();
  }, [profile]);

  // A school-wide notice (a holiday announcement) carries no child, so it is shown as
  // coming from the school rather than being attributed to one of the children.
  const childName = (studentId: string | null) => {
    if (!studentId) return 'School announcement';
    return children.find((child) => child.id === studentId)?.full_name ?? 'your child';
  };

  if (loading) return <div className="page"><p className="empty-state large">Loading your children's records…</p></div>;

  if (children.length === 0) {
    return (
      <div className="page parent-page">
        <HolidayTomorrowBanner />
        <div className="module-heading">
          <div>
            <span className="eyebrow">Parent portal</span>
            <h1>Welcome, {profile?.full_name}</h1>
            <p>Your children's records will appear here once an administrator links them to your account.</p>
          </div>
        </div>
        <div className="panel" style={{ padding: '45px', textAlign: 'center' }}>
          <Users size={40} style={{ color: '#a2b2bc', margin: '0 auto 14px' }} />
          <p className="empty-state">No children are linked to your account yet. Please contact the school office to be linked.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page parent-page">
      <HolidayTomorrowBanner />
      <div className="module-heading">
        <div>
          <span className="eyebrow">Parent portal</span>
          <h1>Welcome, {profile?.full_name}</h1>
          <p>Here's how your children are doing at school.</p>
        </div>
      </div>

      <section className="panel parent-notices-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Attendance, homework and fee notifications</span>
            <h2>Notices from the school</h2>
            <p className="panel-subtitle">A notice appears here as soon as the school records your child as absent, on leave or late, publishes new homework, or issues a fee challan. A reminder follows automatically as homework falls due.</p>
          </div>
          <Bell size={20} />
        </div>
        {noticeError && <p className="dmc-warning">{noticeError}</p>}
        {notifications.length === 0 ? (
          <p className="empty-state">No notices yet. When your child is marked absent, on leave or late, new homework is published or falls due, or a fee challan is issued, the details will appear here.</p>
        ) : (
          <ul className="parent-notice-list">
            {notifications.map((notice) => (
              <li className="parent-notice" key={notice.id}>
                <span className="parent-notice-icon">{notice.notification_type === 'homework' ? <BookOpenCheck size={15} /> : notice.notification_type === 'homework_reminder' ? <BellRing size={15} /> : <Bell size={15} />}</span>
                <div>
                  <div className="parent-notice-top">
                    <strong>{notice.title}</strong>
                    <small>{new Date(notice.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
                  </div>
                  <span className="parent-notice-child">{childName(notice.student_id)}</span>
                  <p>{notice.body}</p>
                  {notice.attachment_url && (
                    <a className="parent-notice-attachment" href={notice.attachment_url} target="_blank" rel="noreferrer">
                      <Paperclip size={13} /> View the document attached to this notice
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PortalHomeworkPanel />
      <PortalLiveClassesPanel onToast={onToast} />
      <StudentPortalCertificates
        studentIds={children.map((child) => child.id)}
        studentNames={Object.fromEntries(children.map((child) => [child.id, child.full_name]))}
        onToast={onToast}
      />

      <div className="parent-children-grid">
        {children.map((child) => {
          const att = attendance[child.id] ?? { present: 0, absent: 0, late: 0 };
          const total = att.present + att.absent + att.late;
          const pct = total ? Math.round((att.present / total) * 100) : 0;
          return (
            <section className="panel parent-child-card" key={child.id}>
              <div className="parent-child-header">
                <div className="student-avatar" style={{ width: '48px', height: '48px', fontSize: '14px' }}>
                  {child.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <h3>{child.full_name}</h3>
                  <span>{child.class_name} · Section {child.section_name}</span>
                </div>
                <span className="status-pill">{child.status === 'active' ? 'Active' : child.status}</span>
              </div>

              <div className="parent-child-stats">
                <div className="parent-stat">
                  <CalendarCheck2 size={18} />
                  <div><strong>{pct}%</strong><span>Attendance</span></div>
                </div>
                <div className="parent-stat">
                  <div><strong>{att.present}</strong><span>Present</span></div>
                </div>
                <div className="parent-stat">
                  <div><strong>{att.absent}</strong><span>Absent</span></div>
                </div>
                <div className="parent-stat">
                  <div><strong>{att.late}</strong><span>Late</span></div>
                </div>
              </div>

              <div className="parent-child-details">
                <div className="parent-detail-row"><span>Admission no.</span><strong>{child.admission_number}</strong></div>
                <div className="parent-detail-row"><span>Fee balance</span><strong>Rs. {child.fee_balance.toLocaleString()}</strong></div>
                <div className="parent-detail-row"><span>Guardian phone</span><strong>{child.guardian_phone}</strong></div>
              </div>

              <StudentFeePanel studentId={child.id} studentName={child.full_name} admissionNumber={child.admission_number} student={child} />
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function StudentDashboard({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const [student, setStudent] = useState<Student | null>(null);
  const [summary, setSummary] = useState<{ present: number; absent: number; late: number }>({ present: 0, absent: 0, late: 0 });
  const [results, setResults] = useState<{ subject: string; obtained: number; total: number }[]>([]);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      try {
        const { data: link } = await supabase
          .from('user_profiles')
          .select('student_id')
          .eq('id', profile.id)
          .maybeSingle();
        const studentId = (link as { student_id: string | null } | null)?.student_id;
        if (!active || !studentId) { setLoading(false); return; }

        const [{ data: record }, { data: attendance }, { data: dmc }] = await Promise.all([
          supabase
            .from('school_students')
            .select('id, admission_number, full_name, class_name, section_name, guardian_phone, fee_balance, status, photo_url, fee_concession_category, fee_concession_amount, fee_concession_percentage, concession_approval_status, concession_approved_by, concession_approved_at')
            .eq('id', studentId)
            .maybeSingle(),
          supabase.from('school_attendance').select('status').eq('student_id', studentId),
          supabase
            .from('school_dmc_records')
            .select('attendance_percentage, remarks, term, session')
            .eq('student_id', studentId)
            .order('period_end', { ascending: false })
            .limit(1),
        ]);

        if (!active) return;
        setStudent(record as Student | null);

        const notices = await fetchPortalNotifications([studentId]);
        if (!active) return;
        setNotifications(notices.notifications);
        setNoticeError(notices.error);

        const counts = { present: 0, absent: 0, late: 0 };
        for (const row of (attendance as { status: string }[]) ?? []) {
          if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
        }
        setSummary(counts);

        const latest = ((dmc ?? []) as { attendance_percentage: number; remarks: string | null; term: string; session: string }[])[0];
        if (latest?.remarks) {
          setResults([{ subject: `${latest.term} ${latest.session}`, obtained: Number(latest.attendance_percentage), total: 100 }]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [profile]);

  if (loading) return <div className="page"><p className="empty-state large">Loading your record…</p></div>;

  if (!student) {
    return (
      <div className="page parent-page">
        <div className="module-heading">
          <div>
            <span className="eyebrow">Student portal</span>
            <h1>Welcome, {profile?.full_name}</h1>
            <p>Your record could not be found. Please contact the school office.</p>
          </div>
        </div>
      </div>
    );
  }

  const total = summary.present + summary.absent + summary.late;
  const percentage = total ? Math.round((summary.present / total) * 1000) / 10 : 0;

  return (
    <div className="page parent-page">
      <HolidayTomorrowBanner />
      <div className="module-heading">
        <div>
          <span className="eyebrow">Student portal</span>
          <h1>Welcome, {student.full_name}</h1>
          <p>{student.class_name} · Section {student.section_name} · Admission no. {student.admission_number}</p>
        </div>
        <button className="secondary-button" onClick={() => onToast('Ask the school office to correct any detail that looks wrong.')}>
          Request a correction
        </button>
      </div>

      <section className="panel parent-notices-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Attendance, homework and fee notifications</span>
            <h2>Notices from the school</h2>
            <p className="panel-subtitle">A notice appears here as soon as the school records you as absent, on leave or late, publishes new homework, or issues a fee reminder. A reminder follows automatically as homework falls due.</p>
          </div>
          <Bell size={20} />
        </div>
        {noticeError && <p className="dmc-warning">{noticeError}</p>}
        {notifications.length === 0 ? (
          <p className="empty-state">No notices yet. When you are marked absent, on leave or late, new homework is published or falls due, or a fee reminder is sent, the details will appear here.</p>
        ) : (
          <ul className="parent-notice-list">
            {notifications.map((notice) => (
              <li className="parent-notice" key={notice.id}>
                <span className="parent-notice-icon">{notice.notification_type === 'homework' ? <BookOpenCheck size={15} /> : notice.notification_type === 'homework_reminder' ? <BellRing size={15} /> : <Bell size={15} />}</span>
                <div>
                  <div className="parent-notice-top">
                    <strong>{notice.title}</strong>
                    <small>{new Date(notice.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
                  </div>
                  <p>{notice.body}</p>
                  {notice.attachment_url && (
                    <a className="parent-notice-attachment" href={notice.attachment_url} target="_blank" rel="noreferrer">
                      <Paperclip size={13} /> View the document attached to this notice
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PortalHomeworkPanel title="Your homework diary" />
      <PortalLiveClassesPanel onToast={onToast} title="Your live classes" />
      <StudentPortalCertificates
        studentIds={[student.id]}
        studentNames={{ [student.id]: student.full_name }}
        onToast={onToast}
      />

      <div className="parent-children-grid">
        <section className="panel parent-child-card">
          <div className="parent-child-header">
            <div className="student-avatar" style={{ width: '48px', height: '48px', fontSize: '14px' }}>
              {student.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
            <div>
              <h3>{student.full_name}</h3>
              <span>{student.class_name} · Section {student.section_name}</span>
            </div>
            <span className="status-pill">{student.status === 'active' ? 'Active' : student.status === 'promoted' ? 'Pass Out' : 'Inactive'}</span>
          </div>

          <div className="parent-child-stats">
            <div className="parent-stat">
              <CalendarCheck2 size={18} />
              <div><strong>{percentage}%</strong><span>Attendance</span></div>
            </div>
            <div className="parent-stat">
              <div><strong>{summary.present}</strong><span>Present</span></div>
            </div>
            <div className="parent-stat">
              <div><strong>{summary.absent}</strong><span>Absent</span></div>
            </div>
            <div className="parent-stat">
              <div><strong>{summary.late}</strong><span>Late</span></div>
            </div>
          </div>

          <div className="parent-child-details">
            <div className="parent-detail-row"><span>Admission no.</span><strong>{student.admission_number}</strong></div>
            <div className="parent-detail-row"><span>Fee balance</span><strong>Rs. {Number(student.fee_balance ?? 0).toLocaleString()}</strong></div>
            <div className="parent-detail-row"><span>Guardian phone</span><strong>{student.guardian_phone || '—'}</strong></div>
          </div>
        </section>

        <section className="panel parent-child-card">
          <div className="parent-child-header">
            <div>
              <h3>Marks certificate</h3>
              <span>Your most recent result summary</span>
            </div>
            <FileBadge2 size={20} />
          </div>
          {results.length === 0 ? (
            <p className="empty-state">No marks certificate has been issued yet. It will appear here once your teacher publishes it.</p>
          ) : (
            <div className="parent-child-details">
              {results.map((row) => (
                <div className="parent-detail-row" key={row.subject}>
                  <span>{row.subject}</span>
                  <strong>{row.obtained.toFixed(1)}%</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <StudentFeePanel studentId={student.id} admissionNumber={student.admission_number} student={student} />
    </div>
  );
}

export function TeacherDashboard({ onNavigate, onToast }: { onNavigate: (view: string) => void; onToast: (message: string) => void }) {
  // onNavigate accepts a string key; caller maps to View
  const [studentCount, setStudentCount] = useState(0);
  const [presentToday, setPresentToday] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ count }, { data: att }] = await Promise.all([
        supabase.from('school_students').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('school_attendance').select('student_id, status').eq('attendance_date', new Date().toISOString().slice(0, 10)).eq('status', 'present'),
      ]);
      setStudentCount(count ?? 0);
      setPresentToday(att?.length ?? 0);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="page">
      <HolidayTomorrowBanner />
      <div className="welcome-banner" style={{ background: 'linear-gradient(105deg, #6ebddd, #8ad2df)' }}>
        <div className="welcome-copy">
          <span className="eyebrow light"><GraduationCap size={14} /> Teacher workspace</span>
          <h1>Good day, teacher</h1>
          <p>Manage attendance, search student records, and send notices — all in one place.</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card blue"><div className="stat-icon"><Users size={20} /></div><div><span>Active students</span><strong>{loading ? '—' : studentCount.toString()}</strong><small>Across all classes</small></div></div>
        <div className="stat-card green"><div className="stat-icon"><CalendarCheck2 size={20} /></div><div><span>Present today</span><strong>{loading ? '—' : presentToday.toString()}</strong><small>Checked in so far</small></div></div>
        <div className="stat-card yellow"><div className="stat-icon"><FileBadge2 size={20} /></div><div><span>Quick actions</span><strong>3</strong><small>Available tools</small></div></div>
      </div>

      <StaffCheckInCard onToast={onToast} />

      <div className="section-heading">
        <div><span className="eyebrow">Teacher tools</span><h2>What would you like to do?</h2></div>
      </div>
      <div className="module-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button className="module-card sky" onClick={() => onNavigate('attendance')}><div className="module-icon"><CalendarCheck2 size={28} strokeWidth={1.8} /></div><div className="module-content"><h3>Mark attendance</h3><p>Take today's register for your class</p></div><span className="card-arrow">↗</span></button>
        <button className="module-card mint" onClick={() => onNavigate('students')}><div className="module-icon"><Users size={28} strokeWidth={1.8} /></div><div className="module-content"><h3>Search students</h3><p>Find and view student records</p></div><span className="card-arrow">↗</span></button>
        <button className="module-card sun" onClick={() => onNavigate('admission')}><div className="module-icon"><GraduationCap size={28} strokeWidth={1.8} /></div><div className="module-content"><h3>New admission</h3><p>Enroll a new student</p></div><span className="card-arrow">↗</span></button>
      </div>
    </div>
  );
}
