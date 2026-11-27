import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { fetchBackupStats, type BackupMeta } from '@/lib/systemSetup';

export function SystemBackupTab({ onToast }: { onToast: (message: string) => void }) {
  void onToast;
  const [stats, setStats] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const result = await fetchBackupStats();
    setStats(result.stats);
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const total = stats.reduce((sum, s) => sum + s.count, 0);

  // Builds a JSON snapshot of the row counts the school owner can download for
  // their own records. Actual database export is handled by Supabase's dashboard.
  const downloadSummary = () => {
    const payload = { generatedAt: new Date().toISOString(), tables: stats };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'schooldesk-backup-summary.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="fee-empty">Loading backup summary…</p>;

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Backup</span>
          <h2>Data Backup Summary</h2>
        </div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      <div className="util-backup-intro">
        <DatabaseBackup size={16} />
        <p>
          This shows how much data each part of the system currently holds. Full database backups are managed from your
          Supabase dashboard — this screen helps you confirm your record counts before exporting.
        </p>
      </div>

      <div className="fee-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="fee-kpi sky">
          <span className="fee-kpi-icon"><DatabaseBackup size={20} /></span>
          <div><span>Total records</span><strong>{total}</strong></div>
        </div>
        <div className="fee-kpi mint">
          <span className="fee-kpi-icon"><DatabaseBackup size={20} /></span>
          <div><span>Tables tracked</span><strong>{stats.length}</strong></div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Data Area</th><th className="text-right">Record Count</th></tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <tr key={stat.tableName}>
                <td><strong>{stat.tableName}</strong></td>
                <td className="text-right fee-mono">{stat.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="util-form-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="primary-button" onClick={downloadSummary}><Download size={15} /> Download Summary</button>
      </div>
    </div>
  );
}
