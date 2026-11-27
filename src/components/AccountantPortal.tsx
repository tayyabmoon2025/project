import { useEffect, useMemo, useState } from 'react';
import { CircleAlert as AlertCircle, CalendarCheck2, Coins, FileSpreadsheet, Gauge, LayoutDashboard, Receipt, RefreshCw, CircleUser as UserCircle2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todayKey } from '@/lib/attendance';
import { fetchAccountantOverview } from '@/lib/accountant';
import {
  formatMoney, monthKey, type FeePayment, type FeeStructure,
} from '@/lib/fees';
import type { Student } from '@/lib/schoolTypes';
import { AccountantDashboard } from '@/components/AccountantDashboard';
import { AccountantReceiveFee } from '@/components/AccountantReceiveFee';
import { AccountantLedger } from '@/components/AccountantLedger';
import { AccountantDefaulters } from '@/components/AccountantDefaulters';
import { AccountantReports } from '@/components/AccountantReports';
import { AccountantDailyClosing } from '@/components/AccountantDailyClosing';
import { AccountantAttendanceReport } from '@/components/AccountantAttendanceReport';
import { StudentSearch } from '@/components/StudentSearch';
import { ProfilePhotoPicker } from '@/components/ProfilePhoto';
import { HolidayTomorrowBanner } from '@/components/HolidayTomorrowBanner';

export type AccountantView =
  | 'dashboard' | 'fees' | 'receive' | 'ledger' | 'defaulters'
  | 'reports' | 'closing' | 'search' | 'attendance' | 'reminders' | 'profile';

export const accountantNavItems: { label: string; icon: typeof LayoutDashboard; view: AccountantView }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Fee Management', icon: Coins, view: 'fees' },
  { label: 'Receive Fee', icon: Receipt, view: 'receive' },
  { label: 'Student Fee Ledger', icon: FileSpreadsheet, view: 'ledger' },
  { label: 'Fee Defaulters', icon: AlertCircle, view: 'defaulters' },
  { label: 'Fee Reports', icon: Gauge, view: 'reports' },
  { label: 'Daily Cash Closing', icon: Coins, view: 'closing' },
  { label: 'Student Search', icon: Users, view: 'search' },
  { label: 'Attendance Reports', icon: CalendarCheck2, view: 'attendance' },
  { label: 'Fee Reminder Messages', icon: AlertCircle, view: 'reminders' },
  { label: 'My Profile', icon: UserCircle2, view: 'profile' },
];

// The accountant's own workspace. It loads the student list, the fee structure and the
// recent receipts once, then hands them to each panel. Everything the accountant can do
// is also enforced in the database, so this screen is a view of their permissions, not
// the source of them.
export function AccountantPortal({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const [view, setView] = useState<AccountantView>('dashboard');
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [month, setMonth] = useState(monthKey());
  const [collectFor, setCollectFor] = useState<string | null>(null);

  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [overview, structureResult] = await Promise.all([
        fetchAccountantOverview(500),
        supabase.from('school_fee_structures').select('class_name, tuition_fee, admission_misc, exam_lab, transport, late_fine').order('class_name'),
      ]);
      if (cancelled) return;
      setStudents(overview.students);
      setPayments(overview.payments);
      setStructures((structureResult.data ?? []) as FeeStructure[]);
      setError(overview.error ?? (structureResult.error ? 'The fee structure could not be loaded.' : ''));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const reload = async () => { setReloadToken((token) => token + 1); };
  const activeStudents = useMemo(() => students.filter((student) => student.status === 'active'), [students]);

  const openCollect = (studentId: string) => { setCollectFor(studentId); setView('receive'); };

  const refreshButton = (
    <button className="secondary-button no-print" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
  );

  return (
    <div className="page accountant-page">
      <HolidayTomorrowBanner />
      <div className="module-heading">
        <div>
          <span className="eyebrow">Accounts office</span>
          <h1>{accountantNavItems.find((item) => item.view === view)?.label ?? 'Dashboard'}</h1>
          <p>Collect fees, follow up on dues and close the day, all from one place.</p>
        </div>
        {view !== 'dashboard' && refreshButton}
      </div>

      {error && view !== 'dashboard' && (
        <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span>{refreshButton}</div>
      )}

      {view === 'dashboard' && (
        <AccountantDashboard
          students={students}
          payments={payments}
          loading={loading}
          error={error}
          today={today}
          month={monthKey()}
          onNavigate={setView}
          onCollect={openCollect}
        />
      )}

      {view === 'fees' && (
        <div className="fee-section">
          <div className="fee-card">
            <div className="fee-card-head"><div><span className="eyebrow">Fee management</span><h2>Money collected this month</h2></div>{refreshButton}</div>
            <div className="acct-mini-stats">
              <div><span>Students on the roster</span><strong>{activeStudents.length}</strong></div>
              <div><span>Outstanding balance</span><strong className="text-rose-600">{formatMoney(activeStudents.reduce((total, student) => total + Math.max(0, Number(student.fee_balance ?? 0)), 0))}</strong></div>
              <div><span>Receipts recorded</span><strong>{payments.filter((payment) => !payment.voided).length}</strong></div>
            </div>
            <div className="acct-quick-actions">
              <button className="acct-action mint" onClick={() => setView('receive')}><Coins size={22} /><strong>Receive Fee</strong><span>Record a payment</span></button>
              <button className="acct-action sky" onClick={() => setView('ledger')}><FileSpreadsheet size={22} /><strong>Student Fee Ledger</strong><span>Balances and history</span></button>
              <button className="acct-action sun" onClick={() => setView('defaulters')}><AlertCircle size={22} /><strong>Fee Defaulters</strong><span>Who still owes</span></button>
              <button className="acct-action coral" onClick={() => setView('reports')}><Gauge size={22} /><strong>Fee Reports</strong><span>Class, date and month</span></button>
            </div>
          </div>
        </div>
      )}

      {view === 'receive' && (
        <AccountantReceiveFee
          students={activeStudents}
          payments={payments}
          loading={loading}
          today={today}
          onToast={onToast}
          onSaved={reload}
          preselect={collectFor}
        />
      )}

      {view === 'ledger' && (
        <AccountantLedger
          students={activeStudents}
          structures={structures}
          payments={payments}
          loading={loading}
          error={error}
          month={monthKey()}
          onToast={onToast}
          onChanged={reload}
          onCollect={openCollect}
        />
      )}

      {view === 'defaulters' && (
        <AccountantDefaulters
          students={activeStudents}
          payments={payments}
          month={monthKey()}
          today={today}
          onToast={onToast}
          onCollect={openCollect}
          onRefresh={reload}
        />
      )}

      {view === 'reports' && (
        <AccountantReports
          students={activeStudents}
          payments={payments}
          month={month}
          setMonth={setMonth}
          onToast={onToast}
        />
      )}

      {view === 'closing' && <AccountantDailyClosing payments={payments} today={today} onToast={onToast} />}

      {view === 'search' && (
        <StudentSearch
          students={students}
          loading={loading}
          loadError={error || null}
          onToast={onToast}
          onRefresh={reload}
          onCreatedLogin={() => onToast('Only an administrator can create portal logins.')}
        />
      )}

      {view === 'attendance' && <AccountantAttendanceReport students={activeStudents} onToast={onToast} />}

      {view === 'reminders' && (
        <AccountantDefaulters
          students={activeStudents}
          payments={payments}
          month={monthKey()}
          today={today}
          onToast={onToast}
          onCollect={openCollect}
          onRefresh={reload}
        />
      )}

      {view === 'profile' && (
        <section className="fee-card">
          <div className="fee-card-head"><div><span className="eyebrow">Read-only</span><h2>My account</h2></div></div>
          <div className="profile-photo-panel"><ProfilePhotoPicker onToast={onToast} size="lg" /></div>
          <dl className="fee-summary">
            <div><dt>Full name</dt><dd>{profile?.full_name ?? '—'}</dd></div>
            <div><dt>Username</dt><dd>{profile?.username ?? '—'}</dd></div>
            <div><dt>Role</dt><dd>Accountant</dd></div>
            <div><dt>Account status</dt><dd>{profile?.status === 'active' ? 'Active' : 'Suspended'}</dd></div>
            <div><dt>Account created</dt><dd>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</dd></div>
          </dl>
          <p className="fee-hint">
            Your username, password and account status are managed by the school administrator. Ask the office to make any change.
          </p>
        </section>
      )}
    </div>
  );
}
