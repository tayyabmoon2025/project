import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert as AlertCircle, Briefcase, CalendarDays, Clock, CreditCard, FileText, Megaphone, MessageSquare, CalendarOff } from 'lucide-react';
import {
  fetchAnnouncements,
  fetchEvents,
  fetchJobApplications,
  fetchVisitingCards,
  type Announcement,
  type JobApplication,
  type SchoolEvent,
  type VisitingCard,
} from '@/lib/utilityTools';
import { UtilityVisitingCardsTab } from '@/components/UtilityVisitingCardsTab';
import { UtilityJobApplicationsTab } from '@/components/UtilityJobApplicationsTab';
import { UtilityEventsTab } from '@/components/UtilityEventsTab';
import { UtilitySmsTemplatesTab } from '@/components/UtilitySmsTemplatesTab';
import type { Student } from '@/lib/schoolTypes';
import { UtilityAnnouncementsTab } from '@/components/UtilityAnnouncementsTab';
import { UtilityTimetableTab } from '@/components/UtilityTimetableTab';
import { UtilityHolidaysTab } from '@/components/UtilityHolidaysTab';
import { UtilityReportsTab } from '@/components/UtilityReportsTab';

type UtilityTab = 'cards' | 'jobs' | 'events' | 'sms' | 'announcements' | 'timetable' | 'holidays' | 'reports';

const TABS: { id: UtilityTab; label: string; hint: string; icon: typeof CreditCard }[] = [
  { id: 'cards', label: 'Visiting Cards', hint: 'Print cards for staff and visitors', icon: CreditCard },
  { id: 'jobs', label: 'Job Applications', hint: 'Track applications received', icon: Briefcase },
  { id: 'events', label: 'Events', hint: 'School events and functions', icon: CalendarDays },
  { id: 'sms', label: 'SMS Templates', hint: 'Message wording for notices', icon: MessageSquare },
  { id: 'announcements', label: 'Announcements', hint: 'School-wide notices', icon: Megaphone },
  { id: 'timetable', label: 'Timetable', hint: 'Class schedules by day', icon: Clock },
  { id: 'holidays', label: 'Holidays', hint: 'Closed days from the calendar', icon: CalendarOff },
  { id: 'reports', label: 'Reports', hint: 'Summary across all tools', icon: FileText },
];

export function UtilityToolsModule({ onToast, students, onOpenTemplates }: { onToast: (message: string) => void; students?: Student[]; onOpenTemplates?: () => void }) {
  const [tab, setTab] = useState<UtilityTab>('cards');
  const [cards, setCards] = useState<VisitingCard[]>([]);
  const [jobs, setJobs] = useState<JobApplication[]>([]);
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    const [cardsR, jobsR, eventsR, annR] = await Promise.all([
      fetchVisitingCards(),
      fetchJobApplications(),
      fetchEvents(),
      fetchAnnouncements(),
    ]);
    setCards(cardsR.cards);
    setJobs(jobsR.jobs);
    setEvents(eventsR.events);
    setAnnouncements(annR.announcements);
    setError(cardsR.error ?? jobsR.error ?? eventsR.error ?? annR.error ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const reload = useCallback(async () => { await loadRecords(); }, [loadRecords]);

  const activeTab = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);

  return (
    <div className="admin-panel utility-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Utility &amp; Tools</span>
          <h2>School Utility Tools</h2>
          <p>Everyday administration tools — visiting cards, job applications, events, announcements, timetables and holidays — all in one place.</p>
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
              <Icon size={15} />
              <span className="att-tab-label">
                {item.label}
                <small>{item.hint}</small>
              </span>
            </button>
          );
        })}
      </div>

      {error && <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>}

      {tab === 'cards' ? (
        <UtilityVisitingCardsTab cards={cards} loading={loading} onReload={reload} onToast={onToast} />
      ) : tab === 'jobs' ? (
        <UtilityJobApplicationsTab jobs={jobs} loading={loading} onReload={reload} onToast={onToast} />
      ) : tab === 'events' ? (
        <UtilityEventsTab events={events} loading={loading} onReload={reload} onToast={onToast} />
      ) : tab === 'sms' ? (
        <UtilitySmsTemplatesTab onToast={onToast} students={students} onOpenTemplates={onOpenTemplates} />
      ) : tab === 'announcements' ? (
        <UtilityAnnouncementsTab announcements={announcements} loading={loading} onReload={reload} onToast={onToast} />
      ) : tab === 'timetable' ? (
        <UtilityTimetableTab onToast={onToast} />
      ) : tab === 'holidays' ? (
        <UtilityHolidaysTab onToast={onToast} />
      ) : (
        <UtilityReportsTab onToast={onToast} />
      )}

      <p className="fin-hint no-print">
        <strong>{activeTab.label}</strong> — {activeTab.hint}.
      </p>
    </div>
  );
}
