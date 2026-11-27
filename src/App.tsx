import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CertificateVerificationPage } from '@/components/CertificateVerificationPage';
import { readVerificationRequest } from '@/lib/certificateVerification';
import { SchoolLogo } from '@/components/SchoolLogo';
import { Bell, BookOpenCheck, CalendarCheck2, Check, ChevronDown, ClipboardCheck, Coins, CreditCard, FileBadge2, GraduationCap, KeyRound, LayoutDashboard, Lock, LogOut, MapPin, MessageCircle, MoveHorizontal as MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Shield, DoorOpen, NotebookPen, Settings, Settings2, ShieldCheck, Moon, Sun, CircleUser as UserCircle2, UserPlus, Users, UserRoundX, UsersRound, Video, Wallet, Wrench, X } from 'lucide-react';
import { StudentSearch } from '@/components/StudentSearch';
import { SendStudentNoticeModal } from '@/components/SendStudentNoticeModal';
import { StudentIdCardGenerator } from '@/components/StudentIdCardGenerator';
import { OtherInformation } from '@/components/OtherInformation';
import type { AdmissionFormState, InformationRecord, Student } from '@/lib/schoolTypes';
import { validateFeeFields } from '@/lib/admissionFees';
import { AdmissionForm } from '@/components/AdmissionForm';
import { BlankAdmissionSheet } from '@/components/BlankAdmissionSheet';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';
import type { InformationDraft } from '@/components/InformationRecords';
import { createAdmissionForm, fetchNextAdmissionNumber } from '@/lib/admissionFormState';
import { findSiblingGroups } from '@/lib/feeAdjustments';
import { fetchSiblingDiscountRules, siblingContextFor, type SiblingDiscountRule } from '@/lib/feeDiscountRules';
import { buildFamilyLedger } from '@/lib/familyLedger';
import type { FamilyStatementInfo } from '@/lib/familyStatement';
import { fetchFeeStructures, type FeeStructure } from '@/lib/fees';
import { AuthProvider, useAuth, type UserRole } from '@/lib/auth';
import { GlossyIcon, type GlossyIconName } from '@/components/GlossyIcon';
import { SchoolDataProvider, useSchoolData, type AddStudentResult, type Attendance } from '@/lib/schoolData';
import { ClassSectionProvider } from '@/lib/classSections';
import { AuthPage } from '@/components/AuthPage';
import { AdminPanel } from '@/components/AdminPanel';
import { StaffManagement } from '@/components/StaffManagement';
import { StaffCheckInCard } from '@/components/StaffCheckInCard';
import { ExaminationModule } from '@/components/ExaminationModule';
import { FinanceModule } from '@/components/FinanceModule';
import { UtilityToolsModule } from '@/components/UtilityToolsModule';
import { IssueStudentCertificateModule } from '@/components/IssueStudentCertificateModule';
import { SystemSetupModule } from '@/components/SystemSetupModule';
import { NoticeTemplateSettings } from '@/components/NoticeTemplateSettings';
import type { NoticeContext } from '@/lib/sentNotices';
import { LockScreen } from '@/components/LockScreen';
import { ProfileAvatar, ProfilePhotoPicker } from '@/components/ProfilePhoto';
import { SectionManager } from '@/components/SectionManager';
import { AttendanceManager } from '@/components/AttendanceManager';
import { AbsenteeAlertsPanel } from '@/components/AbsenteeAlertsPanel';
import { PromoteStudentsPanel } from '@/components/PromoteStudentsPanel';
import { WithdrawStudentsPanel } from '@/components/WithdrawStudentsPanel';
import { FeeManagementPanel } from '@/components/FeeManagementPanel';
import { AccountantPortal, accountantNavItems, type AccountantView } from '@/components/AccountantPortal';
import { NeonClock } from '@/components/NeonClock';
import { SchoolAssistant } from '@/components/SchoolAssistant';
import { fetchAbsenteeQueue } from '@/lib/absenteeAlerts';
import { fetchQueuedHomeworkAlertCount } from '@/lib/homeworkAlerts';
import { todayKey } from '@/lib/attendance';
import { ParentDashboard, StudentDashboard, TeacherDashboard } from '@/components/RoleDashboards';
import { HomeworkModule } from '@/components/HomeworkModule';
import { HalfDayGatePass } from '@/components/HalfDayGatePass';
import { CredentialsModal } from '@/components/CredentialsModal';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { AdmissionWelcomeModal } from '@/components/AdmissionWelcomeModal';
import { WelcomeBanner } from '@/components/WelcomeBanner';
import { HolidayTomorrowBanner } from '@/components/HolidayTomorrowBanner';
import { LiveClassesModule } from '@/components/LiveClassesModule';
import { BirthdayNavButton, BirthdayWishesModal, useBirthdayWishes } from '@/components/BirthdayWishes';
import {
  ensureParentLogin,
  generatePassword,
  provisionPortalAccount,
  usernameFromAdmissionNumber,
  type PortalCredentials,
} from '@/lib/portalAccounts';
import {
  guardianNameFor,
  parentUsernameFor,
  pickAdmissionContact,
  prepareAdmissionWelcome,
  type AdmissionWelcome,
} from '@/lib/admissionWelcome';

type View = 'dashboard' | 'students' | 'admission' | 'sections' | 'attendance' | 'sms' | 'promotions' | 'fees' | 'homework' | 'liveclasses' | 'halfday' | 'staff' | 'exams' | 'finance' | 'utility' | 'setup' | 'withdrawals' | 'certificates' | 'other' | 'reports' | 'settings' | 'users' | 'myattendance';

const adminNavItems: { label: string; icon: typeof LayoutDashboard; view: View }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Search Student', icon: Search, view: 'students' },
  { label: 'New Admission', icon: UserPlus, view: 'admission' },
  { label: 'Search Section', icon: Users, view: 'sections' },
  { label: 'Daily Attendance', icon: CalendarCheck2, view: 'attendance' },
  { label: 'Half-Day Gate Pass', icon: DoorOpen, view: 'halfday' },
  { label: 'Homework', icon: BookOpenCheck, view: 'homework' },
  { label: 'Live Classes', icon: Video, view: 'liveclasses' },
  { label: 'Send Absentee WhatsApp SMS', icon: MessageCircle, view: 'sms' },
  { label: 'Fee Management', icon: Coins, view: 'fees' },
  { label: 'Staff Management', icon: UsersRound, view: 'staff' },
  { label: 'Examination', icon: NotebookPen, view: 'exams' },
  { label: 'Finance', icon: Wallet, view: 'finance' },
  { label: 'Utility & Tools', icon: Wrench, view: 'utility' },
  { label: 'Promote Students', icon: GraduationCap, view: 'promotions' },
  { label: 'Withdraw Students', icon: UserRoundX, view: 'withdrawals' },
  { label: 'Issue Certificate', icon: FileBadge2, view: 'certificates' },
  { label: 'Other Information', icon: BookOpenCheck, view: 'other' },
  { label: 'Reports', icon: ClipboardCheck, view: 'reports' },
  { label: 'User Accounts', icon: Shield, view: 'users' },
  { label: 'System Setup', icon: Settings2, view: 'setup' },
  { label: 'Settings', icon: Settings, view: 'settings' },
];

// Each sidebar entry gets its 3D glossy twin by view, so Classic mode can simply not
// render it and the original outline icon shows through.
const viewGlossyIcons: Record<View, GlossyIconName> = {
  dashboard: 'dashboard', students: 'students', admission: 'admission', sections: 'sections',
  attendance: 'attendance', halfday: 'halfday', homework: 'homework', liveclasses: 'liveclasses',
  sms: 'sms', fees: 'fees', staff: 'staff', exams: 'exams', finance: 'finance', utility: 'utility',
  promotions: 'promotions', withdrawals: 'withdrawals', certificates: 'certificates', other: 'other',
  reports: 'reports', users: 'users', setup: 'setup', settings: 'settings', myattendance: 'myattendance',
};

const teacherNavItems: { label: string; icon: typeof LayoutDashboard; view: View }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'My Attendance', icon: MapPin, view: 'myattendance' },
  { label: 'Search Student', icon: Search, view: 'students' },
  { label: 'New Admission', icon: UserPlus, view: 'admission' },
  { label: 'Daily Attendance', icon: CalendarCheck2, view: 'attendance' },
  { label: 'Half-Day Gate Pass', icon: DoorOpen, view: 'halfday' },
  { label: 'Homework', icon: BookOpenCheck, view: 'homework' },
  { label: 'Live Classes', icon: Video, view: 'liveclasses' },
  { label: 'Fee Management', icon: Coins, view: 'fees' },
  { label: 'Examination', icon: NotebookPen, view: 'exams' },
  { label: 'Finance', icon: Wallet, view: 'finance' },
  { label: 'Utility & Tools', icon: Wrench, view: 'utility' },
  { label: 'Send Absentee WhatsApp SMS', icon: MessageCircle, view: 'sms' },
  { label: 'Other Information', icon: BookOpenCheck, view: 'other' },
];

const moduleCards: { title: string; description: string; icon: typeof UserPlus; tone: string; view: View }[] = [
  { title: 'Admissions', description: '7 new applications', icon: UserPlus, tone: 'sky', view: 'admission' },
  { title: 'Attendance', description: '94% present today', icon: CalendarCheck2, tone: 'mint', view: 'attendance' },
  { title: 'Absentee WhatsApp SMS', description: 'Review and send alerts', icon: MessageCircle, tone: 'sun', view: 'sms' },
  { title: 'Promotions', description: 'Review next year classes', icon: GraduationCap, tone: 'peach', view: 'promotions' },
  { title: 'Fee Management', description: 'Collect fees and track dues', icon: Coins, tone: 'mint', view: 'fees' },
  { title: 'Certificates', description: 'Issue, approve and print', icon: FileBadge2, tone: 'lilac', view: 'certificates' },
];

function App() {
  // A certificate's QR code opens this app with the certificate number and its printed
  // code in the address. That check happens before anything else — including before the
  // sign-in screen — because the person holding the paper has no account here.
  const [verification, setVerification] = useState(() => readVerificationRequest(window.location.search));

  if (verification) {
    return (
      <CertificateVerificationPage
        initialNumber={verification.number}
        initialCode={verification.code}
        onClose={() => setVerification(null)}
      />
    );
  }

  return <AuthProvider><ClassSectionProvider><SchoolDataProvider><AppInner /></SchoolDataProvider></ClassSectionProvider></AuthProvider>;
}

function AppInner() {
  const { profile, loading: authLoading, signOut } = useAuth();
  const { students, attendance, loading, error: dataError, refresh, addStudent: addStudentRecord } = useSchoolData();
  const [view, setView] = useState<View>('dashboard');
  const [acctView, setAcctView] = useState<AccountantView>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  // The Send Notice window is owned by the shell rather than by each screen, so the
  // same notice can be raised from the top bar, from a search result, or from a list.
  const [noticeRequest, setNoticeRequest] = useState<{ student: Student; context: NoticeContext } | null>(null);
  const [noticeSearchOpen, setNoticeSearchOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [credentials, setCredentials] = useState<PortalCredentials[] | null>(null);
  const [welcome, setWelcome] = useState<{ welcome: AdmissionWelcome; noticeError: string | null } | null>(null);
  const [waitingAlerts, setWaitingAlerts] = useState(0);
  const [waitingHomeworkAlerts, setWaitingHomeworkAlerts] = useState(0);
  const [alertCountToken, setAlertCountToken] = useState(0);
  const [locked, setLocked] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (window.localStorage.getItem('schooldesk_theme') === 'dark' ? 'dark' : 'light'));
  const [iconTheme, setIconTheme] = useState<'3d' | 'classic'>(() => (window.localStorage.getItem('schooldesk_icon_theme') === 'classic' ? 'classic' : '3d'));
  const canSendAlerts = profile?.role === 'admin' || ['teacher', 'office_assistant'].includes(profile?.role ?? '');
  // The daily birthday check runs for the administrator, the accountant and teachers.
  const canCheckBirthdays = profile?.role === 'admin' || profile?.role === 'teacher' || profile?.role === 'accountant';
  const birthdayWishes = useBirthdayWishes({ userId: profile?.id ?? null, enabled: canCheckBirthdays });
  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  const toggleIconTheme = () => setIconTheme((current) => (current === '3d' ? 'classic' : '3d'));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('schooldesk_theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem('schooldesk_icon_theme', iconTheme);
  }, [iconTheme]);

  // The sidebar badge shows how many absentee and homework alerts are still waiting.
  useEffect(() => {
    if (!canSendAlerts) return;
    let cancelled = false;
    void (async () => {
      const [absentees, homeworkAlerts] = await Promise.all([
        fetchAbsenteeQueue(todayKey()),
        fetchQueuedHomeworkAlertCount(),
      ]);
      if (cancelled) return;
      setWaitingAlerts(absentees.entries.filter((entry) => entry.status === 'queued').length);
      setWaitingHomeworkAlerts(homeworkAlerts);
    })();
    return () => { cancelled = true; };
  }, [canSendAlerts, view, alertCountToken]);

  const openNotice = (student: Student, context: NoticeContext) => setNoticeRequest({ student, context });
  const refreshAlertCount = () => setAlertCountToken((current) => current + 1);
  const addCredentials = (items: PortalCredentials[]) => setCredentials((prev) => [...(prev ?? []), ...items]);
  const addAdmissionWelcome = (result: { welcome: AdmissionWelcome; noticeError: string | null }) => setWelcome(result);

  useEffect(() => { if (dataError) setToast(dataError); }, [dataError]);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 3000); return () => window.clearTimeout(timer); } }, [toast]);

  const counts = useMemo(() => ({
    present: attendance.filter((item) => item.status === 'present').length,
    absent: attendance.filter((item) => item.status === 'absent').length,
    late: attendance.filter((item) => item.status === 'late').length,
    active: students.filter((student) => student.status === 'active').length,
  }), [attendance, students]);

  const filteredStudents = students.filter((student) => `${student.full_name} ${student.admission_number} ${student.class_name} ${student.section_name}`.toLowerCase().includes(searchTerm.toLowerCase()));

  const navigate = (nextView: View) => { setView(nextView); setSearchTerm(''); };

  if (authLoading) {
    return <div className="auth-loading"><div className="brand-mark"><SchoolLogo alt="SchoolDesk" /></div><span>Loading…</span></div>;
  }

  if (!profile) {
    return <AuthPage />;
  }

  // Anyone who is not active is held out of the app: suspended, not currently working, or
  // has left. All three see the same message, because the reason is a matter for the office.
  if (profile.status !== 'active') {
    return (
      <div className="auth-loading">
        <ShieldCheck size={32} />
        <h2>Your account is not active</h2>
        <p>Please contact the school administrator about your account.</p>
        <button className="primary-button" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  const staffRoles: UserRole[] = ['teacher', 'office_assistant', 'accountant', 'support_staff'];
  const isStaff = staffRoles.includes(profile.role);
  const roleNavItems = profile.role === 'admin' ? adminNavItems : isStaff ? teacherNavItems : [];
  const title = roleNavItems.find((item) => item.view === view)?.label
    ?? (view === 'myattendance' ? 'My Attendance' : 'Dashboard');

  const initials = profile.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const roleLabels: Record<UserRole, string> = { admin: 'Administrator', teacher: 'Teacher', parent: 'Parent', office_assistant: 'Office Assistant', accountant: 'Accountant', support_staff: 'Support Staff', student: 'Student' };
  const roleLabel = roleLabels[profile.role];

  const addStudent = async (student: AdmissionFormState, records: InformationRecord[]) => {
    const result = await addStudentRecord(student, records);
    setToast(result.message);
    if (result.ok) navigate('students');
    return result;
  };

  // The accountant has a dedicated workspace: its own menu, its own screens, and no
  // self-service account editing. Every rule here is also enforced in the database.
  if (profile.role === 'accountant') {
    const acctTitle = accountantNavItems.find((item) => item.view === acctView)?.label ?? 'Dashboard';
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><div className="brand-mark"><SchoolLogo alt="SchoolDesk" /></div><span>School<span className="brand-accent">Desk</span></span></div>
          <NeonClock />
          <p className="nav-label">Accounts office</p>
          <nav>
            {accountantNavItems.map((item) => {
              const Icon = item.icon;
              const glossy = iconTheme === '3d' ? (viewGlossyIcons as Record<string, GlossyIconName | undefined>)[item.view] : undefined;
              return (
                <button key={item.view} className={`nav-button ${acctView === item.view ? 'active' : ''}`} onClick={() => setAcctView(item.view)}>
                  {glossy ? <span className="nav-glossy-icon"><GlossyIcon name={glossy} size={23} /></span> : <Icon size={18} />}<span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer"><button className="settings-link" onClick={() => void signOut()}><LogOut size={17} /> Logout</button></div>
        </aside>
        <main className="main-content">
          <header className="topbar"><div className="breadcrumb"><span>SchoolDesk</span><span className="crumb-separator">/</span><strong>{acctTitle}</strong></div><div className="topbar-actions"><BirthdayNavButton count={birthdayWishes.birthdays.length} onClick={birthdayWishes.openBirthdays} /><IconThemeToggleButton iconTheme={iconTheme} onToggle={toggleIconTheme} compact /><ThemeToggleButton theme={theme} onToggle={toggleTheme} compact /><div className="profile-wrap"><button className="profile-button" onClick={() => setShowProfile(!showProfile)}><ProfileAvatar photoUrl={profile.photo_url} name={profile.full_name} /><span><strong>{profile.full_name}</strong></span><ChevronDown size={16} /></button>{showProfile && <div className="profile-menu"><strong>{profile.full_name}</strong><span>{roleLabel} account</span><ProfilePhotoPicker onToast={setToast} size="sm" /><button onClick={() => { setShowProfile(false); setAcctView('profile'); }}><UserCircle2 size={14} /> My profile</button><button onClick={() => void signOut()}><LogOut size={14} /> Logout</button></div>}</div></div></header>
          <AccountantPortal onToast={setToast} />
          {toast && <div className="toast"><Check size={17} /> {toast}</div>}
          {birthdayWishes.open && <BirthdayWishesModal people={birthdayWishes.birthdays} viewerName={profile.full_name} onClose={birthdayWishes.closeBirthdays} />}
          <SchoolAssistant onNavigate={(next) => setAcctView(next as AccountantView)} onToast={setToast} />
        </main>
      </div>
    );
  }

  if (profile.role === 'parent' || profile.role === 'student') {
    const isParent = profile.role === 'parent';
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><div className="brand-mark"><SchoolLogo alt="SchoolDesk" /></div><span>School<span className="brand-accent">Desk</span></span></div>
          <NeonClock />
          <p className="nav-label">{isParent ? 'Parent portal' : 'Student portal'}</p>
          <nav>
            <NavButton item={{ label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' }} active={view === 'dashboard'} onClick={navigate} iconTheme={iconTheme} />
            <button className="nav-button" onClick={() => setShowPassword(true)}><KeyRound size={18} /><span>Change password</span></button>
          </nav>
          <div className="sidebar-footer"><button className="settings-link" onClick={() => void signOut()}><LogOut size={17} /> Sign out</button></div>
        </aside>
        <main className="main-content">
          <header className="topbar"><div className="breadcrumb"><span>SchoolDesk</span><span className="crumb-separator">/</span><strong>{title}</strong></div><div className="topbar-actions"><IconThemeToggleButton iconTheme={iconTheme} onToggle={toggleIconTheme} compact /><ThemeToggleButton theme={theme} onToggle={toggleTheme} compact /><div className="profile-wrap"><button className="profile-button" onClick={() => setShowProfile(!showProfile)}><div className="profile-avatar">{initials}</div><span><small>Welcome</small><strong>{profile.full_name}</strong></span><ChevronDown size={16} /></button>{showProfile && <div className="profile-menu"><strong>{profile.full_name}</strong><button onClick={() => { setShowProfile(false); setShowPassword(true); }}><KeyRound size={14} /> Change password</button><button onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></div>}</div></div></header>
          {isParent ? <ParentDashboard onToast={setToast} /> : <StudentDashboard onToast={setToast} />}
          {toast && <div className="toast"><Check size={17} /> {toast}</div>}
          {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} onToast={setToast} />}
          <SchoolAssistant onNavigate={(next) => navigate(next as View)} onToast={setToast} />
        </main>
      </div>
    );
  }

  const showAdminUsers = view === 'users' && profile.role === 'admin';
  const showStaffManagement = view === 'staff' && profile.role === 'admin';
  // Administrators and the school's own staff share the operational modules.
  const isWorkspaceUser = profile.role === 'admin' || isStaff;
  const showExamination = view === 'exams' && isWorkspaceUser;
  const showHomework = view === 'homework' && isWorkspaceUser;
  const showLiveClasses = view === 'liveclasses' && isWorkspaceUser;
  const showFinance = view === 'finance' && isWorkspaceUser;
  const showUtility = view === 'utility' && isWorkspaceUser;
  const showCertificates = view === 'certificates' && isWorkspaceUser;
  const showSystemSetup = view === 'setup' && profile.role === 'admin';
  // Staff see their whole menu in one group. Administrators see the operational
  // items first, then the student-records group, which starts at Promote Students.
  // Anchoring on that item keeps every operational module added before it — Fee
  // Management, Staff, Examination, Finance — in the top group.
  const recordsStart = roleNavItems.findIndex((item) => item.view === 'promotions');
  const splitPoint = isStaff || recordsStart < 0 ? roleNavItems.length : recordsStart;

  return (
    <div className="app-shell">
      <aside className={`sidebar${minimized ? ' minimized' : ''}`}>
        <div className="brand"><div className="brand-mark"><SchoolLogo alt="SchoolDesk" /></div><span>School<span className="brand-accent">Desk</span></span></div>
        <NeonClock />
        <p className="nav-label">Workspace</p>
        <nav>{roleNavItems.slice(0, splitPoint).map((item) => <NavButton key={item.view} item={item} active={view === item.view} onClick={navigate} iconTheme={iconTheme} badge={item.view === 'sms' ? waitingAlerts : item.view === 'homework' ? waitingHomeworkAlerts : 0} />)}</nav>
        {!isStaff && <><p className="nav-label nav-label-spaced">Student records</p><nav>{roleNavItems.slice(splitPoint).map((item) => <NavButton key={item.view} item={item} active={view === item.view} onClick={navigate} iconTheme={iconTheme} badge={item.view === 'sms' ? waitingAlerts : item.view === 'homework' ? waitingHomeworkAlerts : 0} />)}</nav></>}
        <div className="sidebar-footer"><button className="settings-link" onClick={() => void signOut()}><LogOut size={17} /> Sign out</button></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>SchoolDesk</span><span className="crumb-separator">/</span><strong>{title}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label="Send a student notice" title="Send a student notice" onClick={() => setNoticeSearchOpen(true)}><Search size={20} /></button><BirthdayNavButton count={birthdayWishes.birthdays.length} onClick={birthdayWishes.openBirthdays} /><button className="icon-button notification" aria-label="Notifications"><Bell size={19} /><i /></button><div className="profile-wrap"><button className="profile-button" onClick={() => setShowProfile(!showProfile)}><ProfileAvatar photoUrl={profile.photo_url} name={profile.full_name} /><span><small>Signed in</small><strong>{profile.full_name}</strong></span><ChevronDown size={16} /></button>{showProfile && <div className="profile-menu"><strong>{profile.full_name}</strong><ProfilePhotoPicker onToast={setToast} size="sm" /><button onClick={() => { setShowProfile(false); setShowPassword(true); }}><KeyRound size={14} /> Change password</button><button onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></div>}</div><div className="utility-bar" role="group" aria-label="Window controls"><IconThemeToggleButton iconTheme={iconTheme} onToggle={toggleIconTheme} /><ThemeToggleButton theme={theme} onToggle={toggleTheme} /><button className="utility-bar-btn" type="button" onClick={() => setLocked(true)} title="Lock Screen" aria-label="Lock Screen"><Lock size={15} /><span>Lock Screen</span></button><button className="utility-bar-btn" type="button" onClick={() => setMinimized(v => !v)} title="Minimize sidebar" aria-label="Minimize">{minimized ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}<span>Minimize</span></button></div></div></header>
        {view === 'dashboard' && isStaff ? <TeacherDashboard onNavigate={(v) => navigate(v as View)} onToast={setToast} /> : view === 'myattendance' && isStaff ? <div className="page"><StaffCheckInCard onToast={setToast} /></div> : view === 'dashboard' ? <Dashboard students={students} counts={counts} loading={loading} onNavigate={navigate} theme={theme} iconTheme={iconTheme} /> : showAdminUsers ? <AdminPanel onToast={setToast} /> : showStaffManagement ? <StaffManagement onToast={setToast} /> : showExamination ? <ExaminationModule students={students} onToast={setToast} onRefresh={refresh} /> : showHomework ? <HomeworkModule students={students} onToast={setToast} onQueueChanged={refreshAlertCount} /> : showLiveClasses ? <LiveClassesModule onToast={setToast} /> : showFinance ? <FinanceModule onToast={setToast} /> : showUtility ? <UtilityToolsModule onToast={setToast} students={students} onOpenTemplates={() => navigate('settings')} /> : showCertificates ? <IssueStudentCertificateModule students={students} onToast={setToast} /> : showSystemSetup ? <SystemSetupModule onToast={setToast} iconTheme={iconTheme} /> : <ModuleView view={view} title={title} students={students} filteredStudents={filteredStudents} attendance={attendance} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onAddStudent={addStudent} onCreatedLogin={addCredentials} onAdmissionSaved={addAdmissionWelcome} onRefresh={refresh} onToast={setToast} onAlertsChanged={refreshAlertCount} onSendNotice={openNotice} loading={loading} loadError={dataError} />}
        {toast && <div className="toast"><Check size={17} /> {toast}</div>}
        {credentials && <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />}
        {welcome && <AdmissionWelcomeModal welcome={welcome.welcome} noticeError={welcome.noticeError} onClose={() => setWelcome(null)} onToast={setToast} />}
        {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} onToast={setToast} />}
        {noticeSearchOpen && <NoticeStudentPicker students={students} onClose={() => setNoticeSearchOpen(false)} onPick={(student) => { setNoticeSearchOpen(false); openNotice(student, 'general'); }} />}
        {noticeRequest && <SendStudentNoticeModal student={noticeRequest.student} context={noticeRequest.context} senderName={profile.full_name} onClose={() => setNoticeRequest(null)} onToast={setToast} />}
        {locked && <LockScreen fullName={profile.full_name} onUnlock={() => setLocked(false)} onSignOut={() => void signOut()} />}
        {birthdayWishes.open && <BirthdayWishesModal people={birthdayWishes.birthdays} viewerName={profile.full_name} onClose={birthdayWishes.closeBirthdays} />}
        <SchoolAssistant onNavigate={(next) => navigate(next as View)} onToast={setToast} />
      </main>
    </div>
  );
}

// The top bar action needs a student before a notice can be written, so it opens a
// short roster search rather than jumping to another screen.
function NoticeStudentPicker({ students, onClose, onPick }: { students: Student[]; onClose: () => void; onPick: (student: Student) => void }) {
  const [term, setTerm] = useState('');
  const needle = term.trim().toLowerCase();
  const results = (needle
    ? students.filter((student) => `${student.full_name} ${student.admission_number} ${student.fathers_name ?? ''} ${student.class_name} ${student.section_name}`.toLowerCase().includes(needle))
    : students.filter((student) => student.status === 'active')
  ).slice(0, 60);
  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow">SchoolDesk · Send notice</span>
            <h2 className="send-notice-heading">Who is the notice for?</h2>
            <small className="send-notice-sub">Search the roster, then choose the student.</small>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="template-search mt-4"><Search size={16} /><input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Name, admission number, father's name or class…" /></label>
        <ul className="send-notice-history-list">
          {results.map((student) => (
            <li key={student.id}>
              <div>
                <strong>{student.full_name}</strong>
                <small>{student.admission_number} · {[student.class_name, student.section_name].filter(Boolean).join(' · ')} · {student.fathers_name || student.guardian_name || '—'}</small>
              </div>
              <button type="button" className="primary-button" onClick={() => onPick(student)}><Send size={14} /> Send notice</button>
            </li>
          ))}
          {results.length === 0 ? <li><small>No student matches that search.</small></li> : null}
        </ul>
      </section>
    </div>
  );
}

function IconThemeToggleButton({ iconTheme, onToggle, compact }: { iconTheme: '3d' | 'classic'; onToggle: () => void; compact?: boolean }) {
  const is3d = iconTheme === '3d';
  const label = `Switch to ${is3d ? 'Classic' : '3D'} icons`;
  if (compact) {
    return <button className={`icon-button theme-toggle${is3d ? ' icon-theme-on' : ''}`} type="button" onClick={onToggle} title={label} aria-label={label}>{is3d ? <GlossyIcon name="dashboard" size={19} /> : <LayoutDashboard size={19} />}</button>;
  }
  return <button className={`utility-bar-btn${is3d ? ' icon-theme-on' : ''}`} type="button" onClick={onToggle} title={label} aria-label={label}>{is3d ? <GlossyIcon name="dashboard" size={16} /> : <LayoutDashboard size={15} />}<span>{is3d ? '3D Theme' : 'Classic'}</span></button>;
}

function ThemeToggleButton({ theme, onToggle, compact }: { theme: 'light' | 'dark'; onToggle: () => void; compact?: boolean }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} theme`;
  const Icon = theme === 'dark' ? Sun : Moon;
  if (compact) {
    return <button className="icon-button theme-toggle" type="button" onClick={onToggle} title={label} aria-label={label}><Icon size={19} /></button>;
  }
  return <button className="utility-bar-btn" type="button" onClick={onToggle} title={label} aria-label={label}><Icon size={15} /><span>Theme</span></button>;
}

function NavButton({ item, active, badge, onClick, iconTheme }: { item: typeof adminNavItems[number]; active: boolean; badge?: number; onClick: (view: View) => void; iconTheme?: '3d' | 'classic' }) {
  const Icon = item.icon;
  const glossy = iconTheme === '3d' ? viewGlossyIcons[item.view] : undefined;
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={() => onClick(item.view)}>{glossy ? <span className="nav-glossy-icon"><GlossyIcon name={glossy} size={23} /></span> : <Icon size={18} />}<span>{item.label}</span>{badge ? <span className="nav-count">{badge}</span> : null}</button>;
}

function Dashboard({ students, counts, loading, onNavigate, theme, iconTheme }: { students: Student[]; counts: { present: number; absent: number; late: number; active: number }; loading: boolean; onNavigate: (view: View) => void; theme: 'light' | 'dark'; iconTheme?: '3d' | 'classic' }) {
  const glossy3d = iconTheme === '3d';
  const totalMarked = counts.present + counts.absent + counts.late;
  const presentPercent = totalMarked ? Math.round((counts.present / totalMarked) * 100) : 0;
  const recent = students.slice(0, 4);
  return <div className="page dashboard-page"><HolidayTomorrowBanner /><WelcomeBanner theme={theme} />
    <div className="stats-row"><StatCard label="Total students" value={loading ? '—' : counts.active.toString()} detail="Across 12 sections" tone="blue" icon={glossy3d ? <span className="stat-glossy-icon"><GlossyIcon name="staff" size={26} /></span> : <Users size={20} />} /><StatCard label="Present today" value={loading ? '—' : `${presentPercent}%`} detail={`${counts.present} students checked in`} tone="green" icon={glossy3d ? <span className="stat-glossy-icon"><GlossyIcon name="attendance" size={26} /></span> : <ShieldCheck size={20} />} /><StatCard label="New applications" value="07" detail="4 awaiting review" tone="yellow" icon={glossy3d ? <span className="stat-glossy-icon"><GlossyIcon name="admission" size={26} /></span> : <UserPlus size={20} />} /><StatCard label="Need attention" value={counts.absent.toString().padStart(2, '0')} detail="Absentees to follow up" tone="coral" icon={glossy3d ? <span className="stat-glossy-icon"><GlossyIcon name="reminders" size={26} /></span> : <Bell size={20} />} /></div>
    <div className="section-heading"><div><span className="eyebrow">Quick actions</span><h2>Make today a little easier</h2></div><button className="text-button" onClick={() => onNavigate('other')}>View all tools <span>→</span></button></div>
    <div className="module-grid">{moduleCards.map((card) => <button className={`module-card ${card.tone}`} key={card.title} onClick={() => onNavigate(card.view)}><div className="module-icon">{glossy3d ? <span className="module-glossy-icon"><GlossyIcon name={viewGlossyIcons[card.view]} size={36} /></span> : <card.icon size={28} strokeWidth={1.8} />}</div><div className="module-content"><h3>{card.title}</h3><p>{card.description}</p></div><span className="card-arrow">↗</span></button>)}</div>
    <div className="overview-grid"><section className="panel attendance-panel"><div className="panel-header"><div><span className="eyebrow">Today’s overview</span><h2>Attendance snapshot</h2></div><button className="more-button" onClick={() => onNavigate('attendance')}><MoreHorizontal size={21} /></button></div><div className="attendance-content"><div className="donut-wrap"><div className="donut" style={{ '--present': `${totalMarked ? (counts.present / totalMarked) * 100 : 0}%`, '--absent': `${totalMarked ? (counts.absent / totalMarked) * 100 : 0}%` } as React.CSSProperties}><div className="donut-center"><strong>{presentPercent}%</strong><span>present</span></div></div></div><div className="attendance-copy"><div className="class-select"><span>Class 5-B</span><ChevronDown size={15} /></div><p className="attendance-intro">A bright start to the day. Keep it up!</p><div className="legend"><LegendDot color="mint" label="Present" value={counts.present} /><LegendDot color="coral" label="Absent" value={counts.absent} /><LegendDot color="yellow" label="Late" value={counts.late} /></div></div></div><button className="panel-link" onClick={() => onNavigate('attendance')}>Open attendance register <span>→</span></button></section><section className="panel activity-panel"><div className="panel-header"><div><span className="eyebrow">Roster pulse</span><h2>Recently added</h2></div><button className="text-button" onClick={() => onNavigate('students')}>View roster <span>→</span></button></div><div className="recent-list">{recent.length ? recent.map((student, index) => <div className="recent-item" key={student.id}><div className={`student-avatar avatar-${index % 4}`}>{student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div><div><strong>{student.full_name}</strong><span>{student.class_name} · Section {student.section_name}</span></div><span className="status-pill">Active</span></div>) : <p className="empty-state">Your newest students will appear here.</p>}</div><button className="add-student-button" onClick={() => onNavigate('admission')}><Plus size={17} /> Add a new student</button></section></div>
  </div>;
}

function StatCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: ReactNode }) { return <div className={`stat-card ${tone}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>; }
function LegendDot({ color, label, value }: { color: string; label: string; value: number }) { return <div className="legend-item"><i className={color} /><span>{label}</span><strong>{value}</strong></div>; }

function ModuleView({ view, title, students, filteredStudents, attendance, loading, loadError, searchTerm, setSearchTerm, onAddStudent, onCreatedLogin, onAdmissionSaved, onRefresh, onToast, onAlertsChanged, onSendNotice }: { view: View; title: string; students: Student[]; filteredStudents: Student[]; attendance: Attendance[]; loading: boolean; loadError: string | null; searchTerm: string; setSearchTerm: (value: string) => void; onAddStudent: (student: AdmissionFormState, records: InformationRecord[]) => Promise<AddStudentResult>; onCreatedLogin: (items: PortalCredentials[]) => void; onAdmissionSaved: (result: { welcome: AdmissionWelcome; noticeError: string | null }) => void; onRefresh: () => Promise<void>; onToast: (message: string) => void; onAlertsChanged: () => void; onSendNotice: (student: Student, context: NoticeContext) => void }) {
  const { profile } = useAuth();
  const [formOpen, setFormOpen] = useState(view === 'admission');
  const [form, setForm] = useState<AdmissionFormState>(() => createAdmissionForm(students));
  const [infoRecords, setInfoRecords] = useState<InformationRecord[]>([]);
  const [blankFormOpen, setBlankFormOpen] = useState(false);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  // The blank copy prints the school header, so the profile is fetched the first time
  // the preview is opened rather than on every visit to this screen.
  useEffect(() => {
    if (!blankFormOpen || institution) return;
    void fetchInstitutionProfile().then(({ profile }) => setInstitution(profile));
  }, [blankFormOpen, institution]);
  const [siblingRules, setSiblingRules] = useState<SiblingDiscountRule[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  useEffect(() => {
    void fetchSiblingDiscountRules().then((result) => setSiblingRules(result.rules));
    void fetchFeeStructures().then((result) => setStructures(result.structures));
  }, []);

  // The family groups for a brand new admission come from the roster as it stands, with
  // the form's guardian phone, CNIC and father name filled in for the student being added,
  // so a brother or sister already on the roll is found as the details are typed.
  const siblingContext = useMemo(() => {
    const candidate = { ...form, id: '' } as unknown as Student;
    return siblingContextFor({
      candidate,
      groups: findSiblingGroups([...students, candidate]),
      rules: siblingRules,
    });
  }, [students, form, siblingRules]);

  const familyLedger = useMemo(
    () => buildFamilyLedger(siblingContext.students, siblingContext.candidateIndex, siblingRules, structures),
    [siblingContext, siblingRules, structures],
  );

  const familyStatementInfo = useMemo<FamilyStatementInfo>(() => ({
    guardianName: form.guardian_name.trim() || form.fathers_name.trim(),
    guardianPhone: form.guardian_phone.trim() || form.father_contact_number.trim() || form.messaging_number.trim(),
    guardianCnic: form.guardian_cnic.trim() || form.fathers_cnic.trim(),
    preparedFor: form.full_name.trim(),
    matchedReason: siblingContext.matchedReason,
  }), [form, siblingContext.matchedReason]);
  const saveInfoRecord = async (draft: InformationDraft) => {
    const now = new Date().toISOString();
    setInfoRecords((current) => draft.id
      ? current.map((record) => (record.id === draft.id ? { ...record, information_type: draft.information_type, notes: draft.notes, updated_at: now } : record))
      : [{ id: crypto.randomUUID(), information_type: draft.information_type, notes: draft.notes, updated_at: now }, ...current]);
    return true;
  };
  const deleteInfoRecord = async (id: string) => {
    setInfoRecords((current) => current.filter((record) => record.id !== id));
    return true;
  };
  const clearAdmission = () => { setInfoRecords([]); setForm(createAdmissionForm(students)); };
  const saveAdmission = async (record: AdmissionFormState): Promise<boolean> => {
    const feeError = validateFeeFields(record);
    if (feeError) { onToast(feeError); return false; }
    const result = await onAddStudent(record, infoRecords);
    if (!result.ok || !result.student) return false;

    const saved = result.student;
    const contact = pickAdmissionContact(saved);

    // The family's portal account is the parent's, not the child's: the username is
    // the guardian's WhatsApp number, so every child from the same household shares
    // one sign-in. Administrators create logins; teachers are skipped quietly.
    let parentCredentials: { username: string; password: string } | null = null;
    if (profile?.role === 'admin' && contact.number) {
      const username = parentUsernameFor(saved, contact.number);
      const password = generatePassword();
      const login = await ensureParentLogin({
        username,
        password,
        fullName: guardianNameFor(saved),
        studentId: saved.id,
        mobile: contact.display || contact.number,
      });
      if (!login.error) parentCredentials = { username: login.username, password };
      else onToast(`Admission saved. The parent portal login was not created: ${login.error}`);
    }

    // The child's own portal login keeps the admission number as its username.
    const username = usernameFromAdmissionNumber(saved.admission_number);
    if (profile?.role === 'admin' && username.length >= 3) {
      const password = generatePassword();
      const { error } = await provisionPortalAccount({
        username,
        password,
        fullName: saved.full_name,
        role: 'student',
        studentId: saved.id,
      });
      if (!error) {
        onCreatedLogin([{ username, password, fullName: saved.full_name, role: 'student' }]);
      } else {
        onToast(`Student saved. The portal login was not created: ${error}`);
      }
    }

    // The portal notice and the WhatsApp welcome message that follow a first admission.
    const welcome = await prepareAdmissionWelcome(saved, parentCredentials, profile?.role === 'admin');
    onAdmissionSaved(welcome);

    setForm(createAdmissionForm(students));
    setInfoRecords([]);
    setFormOpen(false);
    return true;
  };
  const submitAdmission = async (event: FormEvent) => { event.preventDefault(); await saveAdmission(form); };
  const addToSession = async () => { await saveAdmission({ ...form, data_source: 'current_session' }); };
  const pageDescription: Record<View, string> = { dashboard: 'Your school overview for a happy, organized day.', myattendance: 'Check in and check out, with your location recorded.', users: 'Create, suspend, or remove user accounts.', settings: 'Write the notices, reminders and warnings every screen sends, in English and Urdu.', students: 'Find a student, check their details, or open their record.', admission: 'Add a new learner to your school roster in a few simple steps.', sections: 'Browse class groups and see who is learning together.', attendance: "Mark today’s attendance and keep your register up to date.", halfday: "Issue a half-day gate pass when a student leaves school early. Attendance is updated and the parent is notified automatically.", homework: "Set homework for a class, publish it, and keep the daily diary parents read.", liveclasses: "Run an online audio or video class after school. An administrator approves each class, and student attendance is recorded automatically when a student joins the room.", sms: 'Send a kind, timely WhatsApp note to guardians of absent students.', promotions: 'Review each student’s next class, record the final term result, and promote with a saved condition where needed.', fees: 'Collect fees, generate challans, follow up on dues and review collection reports.', staff: 'Add and manage the logins for your teachers, office assistants and accountants.', exams: 'Set up examinations and their subjects, enter marks, and review results and report cards.', finance: 'Record expenses and other income, then review the ledger, trial balance, income statement and reports.', utility: 'Visiting cards, job applications, events, announcements, timetables and holidays — everyday school tools in one place.', setup: 'Manage classes, sessions, the school profile, defaults and grading system.', withdrawals: 'Keep your roster tidy when a student leaves the school.', certificates: 'Issue a certificate for a student, then approve it to release it to the family portals.', other: 'Helpful school details and everyday administration tools.', reports: 'See clear summaries for attendance and student records.' };
  return <div className="page module-page"><div className="module-heading"><div><span className="eyebrow">School workspace</span><h1>{title}</h1><p>{pageDescription[view]}</p></div>{view === 'students' && <button className="primary-button" onClick={() => setFormOpen(true)}><Plus size={18} /> New admission</button>}</div>
    {view === 'admission' || (view === 'students' && formOpen) ? <AdmissionForm form={form} setForm={setForm} infoRecords={infoRecords} onSaveInfo={saveInfoRecord} onDeleteInfo={deleteInfoRecord} onClear={clearAdmission} onSubmit={submitAdmission} onAddToSession={addToSession} onCancel={() => setFormOpen(false)} onToast={onToast} siblingContext={siblingContext} familyLedger={familyLedger} familyStatementInfo={familyStatementInfo} recordStudent={view === 'students' ? students.find((student) => student.full_name === form.full_name && student.admission_number === form.admission_number) ?? null : null} onAutoGenerate={() => { void (async () => { const number = await fetchNextAdmissionNumber(); setForm({ ...form, admission_number: number }); onToast(`Admission number ${number} generated`); })(); }} onPrintBlank={() => setBlankFormOpen(true)} /> : null}
    {blankFormOpen && <BlankAdmissionSheet institution={institution} onClose={() => setBlankFormOpen(false)} />}
    {view === 'withdrawals' ? <WithdrawStudentsPanel students={students} onToast={onToast} onRefresh={onRefresh} /> : view === 'settings' ? <NoticeTemplateSettings onToast={onToast} /> : view === 'students' ? <StudentSearch students={students} loading={loading} loadError={loadError} onToast={onToast} onRefresh={onRefresh} onCreatedLogin={onCreatedLogin} onSendNotice={onSendNotice} /> : view === 'attendance' ? <AttendanceManager students={students} onToast={onToast} onSendNotice={onSendNotice} /> : view === 'halfday' ? <HalfDayGatePass students={students} onToast={onToast} /> : view === 'homework' ? <HomeworkModule students={students} onToast={onToast} /> : view === 'sections' ? <SectionManager students={students} onToast={onToast} onRefresh={onRefresh} /> : view === 'reports' ? <Reports students={students} attendance={attendance} /> : view === 'sms' ? <AbsenteeAlertsPanel onToast={onToast} onQueueChanged={onAlertsChanged} /> : view === 'promotions' ? <PromoteStudentsPanel students={students} onToast={onToast} onRefresh={onRefresh} /> : view === 'fees' ? <FeeManagementPanel students={students} onToast={onToast} onRefresh={onRefresh} onSendNotice={onSendNotice} /> : view === 'other' ? <OtherInformation onToast={onToast} /> : <div className="panel roster-panel">{loading ? <div className="empty-state large">Loading students…</div> : loadError ? <div className="empty-state large">{loadError}</div> : <><div className="table-toolbar"><div className="search-field"><Search size={18} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name, admission number or class" /></div><span className="result-count">{filteredStudents.length} students</span></div><StudentTable students={filteredStudents} /></>}</div>}
  </div>;
}


function StudentTable({ students }: { students: Student[] }) { return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Father / Guardian</th><th>Roll no.</th><th>Status</th><th /></tr></thead><tbody>{students.map((student, index) => <tr key={student.id}><td><div className="table-student"><div className={`student-avatar avatar-${index % 4}`}>{student.full_name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div><strong>{student.full_name}</strong></div></td><td className="muted-cell">{student.admission_number}</td><td>{student.class_name} · {student.section_name}</td><td><span>{student.fathers_name || student.guardian_name}</span><small>{student.guardian_phone}</small></td><td className="muted-cell">{student.roll_number || '—'}</td><td><span className="status-pill">{student.status === 'promoted' ? 'Pass Out' : student.status === 'withdrawn' ? 'Inactive' : 'Active'}</span></td><td><button className="row-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{students.length === 0 && <div className="empty-state large">No students match these filters. Try clearing one or two fields.</div>}</div>; }
function Reports({ students, attendance }: { students: Student[]; attendance: Attendance[] }) {
  const present = attendance.filter((item) => item.status === 'present').length;
  const [idCardsOpen, setIdCardsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const onToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3200); };
  return <div className="page module-page"><div className="report-doc-header"><SchoolLogo alt="SchoolDesk" /><div><strong>SchoolDesk</strong><span>Official school report</span></div></div><div className="report-grid"><div className="report-card report-highlight"><span className="eyebrow light">Attendance report</span><h2>A healthy rhythm, day by day.</h2><p>Your school is building a strong attendance habit this term.</p><div className="report-number">{attendance.length ? Math.round((present / attendance.length) * 100) : 0}<small>% overall</small></div></div><div className="report-card"><span className="eyebrow">Student records</span><h2>Enrolment at a glance</h2><div className="bar-stat"><span><b>{students.filter((student) => student.gender === 'Girl').length}</b> Girls</span><i><em style={{ width: `${students.length ? students.filter((student) => student.gender === 'Girl').length / students.length * 100 : 0}%` }} /></i></div><div className="bar-stat"><span><b>{students.filter((student) => student.gender === 'Boy').length}</b> Boys</span><i><em className="coral-bar" style={{ width: `${students.length ? students.filter((student) => student.gender === 'Boy').length / students.length * 100 : 0}%` }} /></i></div><div className="report-foot">{students.length} active students across the school</div></div><div className="report-card report-card-action"><div className="report-card-icon"><CreditCard size={20} /></div><div className="report-card-copy"><strong>Student ID cards</strong><span>Print CR80 cards — 85.6 mm × 54 mm — in horizontal or vertical designs, front and back.</span><button type="button" className="secondary-button" onClick={() => setIdCardsOpen(true)}><CreditCard size={15} /> Open ID card generator</button></div></div></div>{idCardsOpen && <StudentIdCardGenerator students={students} onClose={() => setIdCardsOpen(false)} onToast={onToast} />}{toast && <div className="toast"><Check size={17} /> {toast}</div>}</div>;
}

export default App;
