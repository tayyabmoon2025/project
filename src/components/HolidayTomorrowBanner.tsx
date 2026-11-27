import { useEffect, useMemo, useState } from 'react';
import { CalendarOff, Check, MessageCircle, PartyPopper, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { todayKey, type CalendarDay } from '@/lib/attendance';
import { publishHolidayNotice } from '@/lib/absenteeAlerts';
import { fetchHolidays, type HolidayRow } from '@/lib/utilityTools';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { formatDisplayDate } from '@/lib/classOffDays';
import {
  holidayBannerDismissKey,
  holidayNoticeSentKey,
  holidayTomorrow,
  holidayWhatsAppLink,
  type UpcomingHoliday,
} from '@/lib/schoolHolidays';

// The one-day-prior alert. It answers a single question on every dashboard: is the school
// closed tomorrow? When it is, the whole school is told once — the notice is written to the
// portal by the database function, which also guarantees a single notice per date, and the
// banner offers the same wording to forward on WhatsApp.
export function HolidayTomorrowBanner() {
  const { profile } = useAuth();
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [dismissed, setDismissed] = useState<string>('');
  const [noticeState, setNoticeState] = useState<'idle' | 'sent' | 'failed'>('idle');

  const today = todayKey();

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void (async () => {
      const { holidays } = await fetchHolidays();
      if (!active) return;
      setDays(holidays.map((row: HolidayRow) => ({
        id: row.id,
        day_date: row.day_date,
        end_date: row.end_date || row.day_date,
        day_type: row.day_type as CalendarDay['day_type'],
        title: row.title,
        notes: row.notes,
      })));
    })();
    return () => { active = false; };
  }, [profile]);

  const tomorrow = useMemo(() => (days ? holidayTomorrow(days, today) : null), [days, today]);

  useEffect(() => {
    if (!tomorrow) return;
    setDismissed(window.localStorage.getItem(holidayBannerDismissKey(tomorrow.dayKey)) ?? '');
  }, [tomorrow]);

  // The notice is raised once per holiday date for every role. The database refuses a
  // second row for the same date, so a reload cannot produce a duplicate — the local flag
  // only saves the round trip.
  useEffect(() => {
    if (!tomorrow || !profile) return;
    const sentKey = holidayNoticeSentKey(tomorrow.dayKey);
    if (window.localStorage.getItem(sentKey) === '1') { setNoticeState('sent'); return; }
    let active = true;
    void (async () => {
      const { error } = await publishHolidayNotice(
        tomorrow.dayKey,
        `Holiday tomorrow — ${tomorrow.title}`,
        `${SCHOOL_NAME} will remain closed tomorrow, ${formatDisplayDate(tomorrow.dayKey)}, on account of ${tomorrow.title}. Regular classes will resume the following working day.`,
      );
      if (!active) return;
      if (error) { setNoticeState('failed'); return; }
      window.localStorage.setItem(sentKey, '1');
      setNoticeState('sent');
    })();
    return () => { active = false; };
  }, [tomorrow, profile]);

  if (!tomorrow || dismissed === 'yes') return null;

  const shareLink = holidayWhatsAppLink(tomorrow);
  const rangeCopy = holidayRangeCopy(tomorrow);

  const dismiss = () => {
    window.localStorage.setItem(holidayBannerDismissKey(tomorrow.dayKey), 'yes');
    setDismissed('yes');
  };

  return (
    <section className="holiday-banner" role="status">
      <span className="holiday-banner-icon" aria-hidden="true">
        {tomorrow.dayType === 'vacation' ? <PartyPopper size={22} /> : <CalendarOff size={22} />}
      </span>
      <div className="holiday-banner-copy">
        <span className="holiday-banner-eyebrow">Holiday tomorrow</span>
        <h3>{tomorrow.title}</h3>
        <p>
          School will remain closed tomorrow, <strong>{formatDisplayDate(tomorrow.dayKey)}</strong>.{rangeCopy}
        </p>
        {tomorrow.notes && <small>{tomorrow.notes}</small>}
      </div>
      <div className="holiday-banner-actions">
        <a className="holiday-banner-share" href={shareLink} target="_blank" rel="noreferrer">
          <MessageCircle size={15} /> Share on WhatsApp
        </a>
        <span className={`holiday-banner-status ${noticeState}`}>
          {noticeState === 'sent' ? <><Check size={13} /> Notice sent to every portal</> : null}
          {noticeState === 'failed' ? 'Notice could not be sent automatically' : null}
        </span>
        <button type="button" className="holiday-banner-close" onClick={dismiss} aria-label="Dismiss this alert">
          <X size={17} />
        </button>
      </div>
      <span className="holiday-banner-note">
        The same notice has been placed in every portal — admin, teachers, accounts office and parents.
      </span>
    </section>
  );
}

// A multi-day closure reads better with its span spelled out than with one date.
function holidayRangeCopy(holiday: UpcomingHoliday): string {
  const start = holiday.day.day_date.slice(0, 10);
  const end = (holiday.day.end_date || holiday.day.day_date).slice(0, 10);
  if (start === end) return '';
  return ` This is part of a closure that runs from ${formatDisplayDate(start)} to ${formatDisplayDate(end)}.`;
}
