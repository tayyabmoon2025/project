import { useEffect, useState } from 'react';
import { Award, Trash2 } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { deleteGradingScale, fetchGradingScales, saveGradingScale, type GradingDraft, type GradingScale } from '@/lib/systemSetup';
import { useAuth } from '@/lib/auth';

type Draft = { grade: string; min_percent: string; max_percent: string; gpa: string; remarks: string; sort_order: string };

const emptyForm = (): Draft => ({ grade: '', min_percent: '', max_percent: '', gpa: '', remarks: '', sort_order: '' });

export function SystemGradingSystemTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [scales, setScales] = useState<GradingScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await fetchGradingScales();
    setScales(result.scales);
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const submit = async (): Promise<boolean | void> => {
    if (!draft.grade.trim()) { onToast('Enter a grade letter first.'); return false; }
    const payload: GradingDraft = {
      grade: draft.grade.trim(),
      min_percent: draft.min_percent,
      max_percent: draft.max_percent,
      gpa: draft.gpa,
      remarks: draft.remarks.trim(),
      sort_order: draft.sort_order,
    };
    // GradingDraft expects numeric/string unions; saveGradingScale normalizes them.
    setSaving(true);
    const error = await saveGradingScale(payload);
    setSaving(false);
    if (error) { onToast(error); return false; }
    onToast('Grade saved.');
    setDraft(emptyForm());
    void load();
    return true;
  };

  const remove = async (id: string) => {
    const error = await deleteGradingScale(id);
    if (error) { onToast(error); return; }
    onToast('Grade removed.');
    void load();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Grading System</span>
          <h2>Grade Bands</h2>
        </div>
      </div>

      {isAdmin && (
        <div className="util-form">
          <div className="util-form-grid util-form-grid-6">
            <label className="control-field">Grade
              <input value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} placeholder="A+" />
            </label>
            <label className="control-field">Min %
              <input type="number" min={0} max={100} step="0.01" value={draft.min_percent} onChange={(e) => setDraft({ ...draft, min_percent: e.target.value })} placeholder="0" />
            </label>
            <label className="control-field">Max %
              <input type="number" min={0} max={100} step="0.01" value={draft.max_percent} onChange={(e) => setDraft({ ...draft, max_percent: e.target.value })} placeholder="100" />
            </label>
            <label className="control-field">GPA
              <input type="number" min={0} max={5} step="0.01" value={draft.gpa} onChange={(e) => setDraft({ ...draft, gpa: e.target.value })} placeholder="4.00" />
            </label>
            <label className="control-field">Remarks
              <input value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} placeholder="Outstanding…" />
            </label>
            <label className="control-field">Order
              <input type="number" min={1} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} placeholder="1" />
            </label>
          </div>
          <div className="util-form-actions">
            <AsyncSaveButton
              label="Add Grade"
              size={15}
              disabled={saving}
              onSave={() => submit()}
            />
          </div>
        </div>
      )}

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {loading ? (
        <p className="fee-empty">Loading grading system…</p>
      ) : scales.length === 0 ? (
        <p className="fee-empty">No grades configured yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Grade</th><th>Min %</th><th>Max %</th><th>GPA</th><th>Remarks</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {scales.map((scale) => (
                <tr key={scale.id}>
                  <td><div className="table-student"><Award size={14} /><strong>{scale.grade}</strong></div></td>
                  <td className="fee-mono">{scale.min_percent}</td>
                  <td className="fee-mono">{scale.max_percent}</td>
                  <td className="fee-mono">{scale.gpa}</td>
                  <td>{scale.remarks || '—'}</td>
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link danger" onClick={() => remove(scale.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
