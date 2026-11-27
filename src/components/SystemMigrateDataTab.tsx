import { Database, FileUp, HardDriveDownload } from 'lucide-react';

export function SystemMigrateDataTab({ onToast }: { onToast: (message: string) => void }) {
  void onToast;
  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Migrate Data</span>
          <h2>Data Migration</h2>
        </div>
      </div>

      <div className="util-migrate-grid">
        <button className="util-migrate-card" disabled title="Export is prepared from Supabase">
          <div className="util-migrate-icon"><HardDriveDownload size={22} /></div>
          <strong>Export Data</strong>
          <p>Download your school data as a file for safekeeping or moving to another system.</p>
          <span className="fee-status neutral">Prepared externally</span>
        </button>
        <button className="util-migrate-card" disabled title="Import is prepared from Supabase">
          <div className="util-migrate-icon"><FileUp size={22} /></div>
          <strong>Import Data</strong>
          <p>Bring records into SchoolDesk from a backup file or a previous system.</p>
          <span className="fee-status neutral">Prepared externally</span>
        </button>
        <button className="util-migrate-card" disabled title="Sync is prepared from Supabase">
          <div className="util-migrate-icon"><Database size={22} /></div>
          <strong>Sync with Other System</strong>
          <p>Connect SchoolDesk to another platform to keep records in step.</p>
          <span className="fee-status neutral">Prepared externally</span>
        </button>
      </div>

      <p className="fee-hint" style={{ marginTop: 16 }}>
        Data migration is handled safely from your Supabase dashboard to avoid accidental changes. This screen is ready
        to be wired to a guided import/export flow when you need it.
      </p>
    </div>
  );
}
