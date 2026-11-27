import { useEffect, useMemo, useState } from 'react';
import { Save, SlidersHorizontal } from 'lucide-react';
import { fetchSystemSettings, saveSystemSetting, type SystemSetting } from '@/lib/systemSetup';
import { useAuth } from '@/lib/auth';

export function SystemDefaultValuesTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const result = await fetchSystemSettings();
    setSettings(result.settings);
    setDrafts(Object.fromEntries(result.settings.map((s) => [s.id, s.value])));
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const categories = useMemo(() => {
    const map = new Map<string, SystemSetting[]>();
    for (const setting of settings) {
      if (!map.has(setting.category)) map.set(setting.category, []);
      map.get(setting.category)!.push(setting);
    }
    return Array.from(map.entries());
  }, [settings]);

  const setDraft = (id: string, value: string) => setDrafts((prev) => ({ ...prev, [id]: value }));

  const save = async (id: string) => {
    const error = await saveSystemSetting(id, drafts[id] ?? '');
    if (error) { onToast(error); return; }
    onToast('Default value saved.');
    void load();
  };

  const prettyKey = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (loading) return <p className="fee-empty">Loading default values…</p>;

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Default Values</span>
          <h2>System Defaults</h2>
        </div>
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {categories.length === 0 ? (
        <p className="fee-empty">No default values configured.</p>
      ) : (
        <div className="util-defaults">
          {categories.map(([category, items]) => (
            <section key={category} className="util-defaults-group">
              <div className="util-defaults-head">
                <SlidersHorizontal size={14} />
                <strong>{category}</strong>
              </div>
              <div className="util-defaults-list">
                {items.map((item) => (
                  <div key={item.id} className="util-default-row">
                    <div className="util-default-copy">
                      <strong>{prettyKey(item.id)}</strong>
                      <small className="fee-mono">{item.id}</small>
                    </div>
                    <div className="util-default-input">
                      <input
                        value={drafts[item.id] ?? ''}
                        onChange={(e) => setDraft(item.id, e.target.value)}
                        disabled={!isAdmin}
                      />
                      {isAdmin && (
                        <button className="fee-link" onClick={() => save(item.id)}><Save size={13} /> Save</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
