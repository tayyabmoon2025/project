import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Clock, Eye, Loader2, RefreshCw } from 'lucide-react';
import {
  fetchHomeworkViews,
  fetchStaffDirectory,
  markHomeworkSeen,
  type HomeworkView,
  type StaffDirectoryEntry,
} from '@/lib/homework';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  teacher: 'Teacher',
  office_assistant: 'Office assistant',
  accountant: 'Accountant',
};

function formatSeenAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Seen';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Who among the school's staff has opened this assignment, and who has not. The
// reading record is written only for the signed-in account, so nobody can mark it
// on someone else's behalf.
export function HomeworkSeenPanel({
  homeworkId,
  currentUserId,
  compact = false,
  refreshKey = 0,
  onToast,
}: {
  homeworkId: string;
  currentUserId: string | null;
  compact?: boolean;
  refreshKey?: number;
  onToast?: (message: string) => void;
}) {
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [views, setViews] = useState<HomeworkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [directory, seen] = await Promise.all([
      fetchStaffDirectory(),
      fetchHomeworkViews([homeworkId]),
    ]);
    setStaff(directory.staff);
    setViews(seen.views);
    setError(directory.error ?? seen.error);
    setLoading(false);
  }, [homeworkId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const seenAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const view of views) map.set(view.user_id, view.seen_at);
    return map;
  }, [views]);

  const seenCount = useMemo(
    () => staff.filter((member) => seenAt.has(member.id)).length,
    [staff, seenAt],
  );

  const markMe = async () => {
    setMarking(true);
    const failure = await markHomeworkSeen(homeworkId);
    setMarking(false);
    if (failure) { setError(failure); return; }
    onToast?.('Marked as seen for your account');
    await load();
  };

  if (loading) {
    return (
      <p className="fee-empty"><Loader2 size={15} className="assistant-spin" /> Loading who has seen this…</p>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="hw-seen">
        {error
          ? <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>
          : <p className="fee-empty">No active staff account is on record yet, so there is nobody to show here.</p>}
      </div>
    );
  }

  return (
    <div className={`hw-seen ${compact ? 'compact' : ''}`}>
      <div className="hw-seen-head">
        <div>
          <span className="eyebrow">Seen by staff</span>
          <strong>{seenCount} of {staff.length} have seen this</strong>
        </div>
        <div className="hw-seen-actions">
          {currentUserId && !seenAt.has(currentUserId) && (
            <button className="ghost-button" type="button" onClick={() => void markMe()} disabled={marking}>
              {marking ? <Loader2 size={14} className="assistant-spin" /> : <Eye size={14} />} Mark as seen
            </button>
          )}
          <button className="ghost-button" type="button" onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <ul className="hw-seen-list">
        {staff.map((member) => {
          const at = seenAt.get(member.id);
          return (
            <li key={member.id} className={at ? 'seen' : 'unseen'}>
              <span className="hw-seen-mark">{at ? <Check size={13} /> : <Clock size={13} />}</span>
              <span className="hw-seen-name">{member.full_name || 'Unnamed account'}</span>
              <span className="hw-seen-role">{ROLE_LABELS[member.role] ?? member.role}</span>
              <span className="hw-seen-time">{at ? formatSeenAt(at) : 'Not seen yet'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
