import { useMemo, useState } from 'react';
import { Award, Building2, CalendarRange, DatabaseBackup, Layers, MapPin, MoveRight, SlidersHorizontal } from 'lucide-react';
import { SystemClassesSectionsTab } from '@/components/SystemClassesSectionsTab';
import { SystemNewSessionTab } from '@/components/SystemNewSessionTab';
import { SystemInstitutionProfileTab } from '@/components/SystemInstitutionProfileTab';
import { SystemSchoolLocationTab } from '@/components/SystemSchoolLocationTab';
import { SystemDefaultValuesTab } from '@/components/SystemDefaultValuesTab';
import { SystemGradingSystemTab } from '@/components/SystemGradingSystemTab';
import { SystemBackupTab } from '@/components/SystemBackupTab';
import { SystemMigrateDataTab } from '@/components/SystemMigrateDataTab';
import { GlossyIcon, type GlossyIconName } from '@/components/GlossyIcon';

type SystemTab = 'sections' | 'sessions' | 'profile' | 'location' | 'defaults' | 'grading' | 'backup' | 'migrate';

const TABS: { id: SystemTab; label: string; hint: string; icon: typeof Layers }[] = [
  { id: 'sections', label: 'Classes & Sections', hint: 'Class groups and section teachers', icon: Layers },
  { id: 'sessions', label: 'New Session', hint: 'Academic years and current session', icon: CalendarRange },
  { id: 'profile', label: 'Institution Profile', hint: 'School name, contact and identity', icon: Building2 },
  { id: 'location', label: 'School Location', hint: 'GPS coordinates and attendance radius', icon: MapPin },
  { id: 'defaults', label: 'Default Values', hint: 'System-wide default settings', icon: SlidersHorizontal },
  { id: 'grading', label: 'Grading System', hint: 'Grade bands and GPA mapping', icon: Award },
  { id: 'backup', label: 'Backup', hint: 'Data summary and export aids', icon: DatabaseBackup },
  { id: 'migrate', label: 'Migrate Data', hint: 'Import and export workflows', icon: MoveRight },
];

const TAB_ICONS: Record<SystemTab, GlossyIconName> = {
  sections: 'sections', sessions: 'attendance', profile: 'myattendance', location: 'sections',
  defaults: 'utility', grading: 'promotions', backup: 'reports', migrate: 'other',
};

export function SystemSetupModule({ onToast, iconTheme }: { onToast: (message: string) => void; iconTheme?: '3d' | 'classic' }) {
  const [tab, setTab] = useState<SystemTab>('sections');

  const activeTab = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);

  return (
    <div className="admin-panel system-setup-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">System Setup</span>
          <h2>System Setup</h2>
          <p>Configure the building blocks of your school — classes, sessions, institution details, defaults and grading — in one place.</p>
        </div>
      </div>

      <div className="att-tabs" role="tablist">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`att-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {iconTheme === '3d'
                ? <span className="att-tab-glossy"><GlossyIcon name={TAB_ICONS[item.id]} size={22} /></span>
                : <Icon size={15} />}
              <span className="att-tab-label">
                {item.label}
                <small>{item.hint}</small>
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'sections' ? (
        <SystemClassesSectionsTab onToast={onToast} />
      ) : tab === 'sessions' ? (
        <SystemNewSessionTab onToast={onToast} />
      ) : tab === 'profile' ? (
        <SystemInstitutionProfileTab onToast={onToast} />
      ) : tab === 'location' ? (
        <SystemSchoolLocationTab onToast={onToast} />
      ) : tab === 'defaults' ? (
        <SystemDefaultValuesTab onToast={onToast} />
      ) : tab === 'grading' ? (
        <SystemGradingSystemTab onToast={onToast} />
      ) : tab === 'backup' ? (
        <SystemBackupTab onToast={onToast} />
      ) : (
        <SystemMigrateDataTab onToast={onToast} />
      )}

      <p className="fin-hint no-print">
        <strong>{activeTab.label}</strong> — {activeTab.hint}. Changes here shape how the rest of SchoolDesk works, so they apply across the whole system.
      </p>
    </div>
  );
}
