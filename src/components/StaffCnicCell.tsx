import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cnicProblem, formatCnic } from '@/lib/staffDirectory';

// The CNIC is typed into the directory row itself, so the office does not have to open a
// form for each person. It is written only when the field is left, and only when the value
// actually changed, so a row of typing does not become a row of saves.
export function StaffCnicCell({ userId, value, onSaved, onToast }: {
  userId: string;
  value: string | null;
  onSaved: (cnic: string | null) => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => formatCnic(value));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A reload or another row's change is the truth; keep the field in step with it.
  useEffect(() => { setDraft(formatCnic(value)); setProblem(null); }, [value]);

  const save = async () => {
    if (saving) return;
    if (draft.trim() === formatCnic(value).trim()) return;

    const issue = cnicProblem(draft);
    if (issue) { setProblem(issue); return; }

    setProblem(null);
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_set_staff_cnic', {
      p_user_id: userId,
      p_cnic: draft.trim() || null,
    });
    setSaving(false);

    if (error) {
      onToast(
        error.message === 'A CNIC must be exactly 13 digits'
          ? 'A CNIC must be exactly 13 digits.'
          : error.message === 'Only administrators can change staff CNIC'
            ? 'Only administrators can change a staff CNIC.'
            : 'The CNIC could not be saved.',
      );
      setDraft(formatCnic(value));
      return;
    }

    const saved = (data as { cnic?: string | null } | null)?.cnic ?? null;
    onSaved(saved);
    onToast(saved ? 'The CNIC was saved.' : 'The CNIC was cleared.');
  };

  return (
    <div className="staff-contact-cell">
      <label className={`staff-cnic-cell${problem ? ' invalid' : ''}`} title="Staff CNIC, 13 digits">
        <CreditCard size={14} />
        <input
          className="staff-cnic-input"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setProblem(null); }}
          onBlur={() => void save()}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          placeholder="Not recorded"
          inputMode="numeric"
          aria-label="Staff CNIC"
        />
        {saving ? <span className="staff-cnic-saving">saving…</span> : null}
      </label>
      {problem ? <small className="staff-cnic-problem">{problem}</small> : null}
    </div>
  );
}
