import { useCallback, useEffect, useRef, useState } from 'react';
import { Cake, PartyPopper, Send, X } from 'lucide-react';
import {
  fetchTodaysBirthdays,
  hasSeenBirthdaysToday,
  markBirthdaysSeen,
  runDailyBirthdayCheck,
  type BirthdayPerson,
} from '@/lib/birthdays';
import { todayKey } from '@/lib/attendance';

export type BirthdayWishesValue = {
  birthdays: BirthdayPerson[];
  open: boolean;
  openBirthdays: () => void;
  closeBirthdays: () => void;
};

// Runs the daily check once per day per signed-in staff member. The database is what
// actually records the wishes (and refuses duplicates), so several staff opening the
// system on the same morning still produce exactly one notice per birthday person.
export function useBirthdayWishes(params: { userId: string | null; enabled: boolean }): BirthdayWishesValue {
  const { userId, enabled } = params;
  const [birthdays, setBirthdays] = useState<BirthdayPerson[]>([]);
  const [open, setOpen] = useState(false);
  const runRef = useRef('');

  useEffect(() => {
    if (!enabled || !userId) {
      setBirthdays([]);
      setOpen(false);
      return;
    }

    const dateKey = todayKey();
    const stamp = `${userId}:${dateKey}`;
    if (runRef.current === stamp) return;
    runRef.current = stamp;

    let cancelled = false;
    void (async () => {
      const seen = hasSeenBirthdaysToday(userId, dateKey);
      const people = seen ? await fetchTodaysBirthdays(dateKey) : await runDailyBirthdayCheck(dateKey);
      if (cancelled) return;
      setBirthdays(people);
      // The popup greets them on the first visit of the day only; after that the
      // "Birthdays" button in the top bar reopens the same list on demand.
      if (!seen && people.length > 0) {
        markBirthdaysSeen(userId, dateKey);
        setOpen(true);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, userId]);

  const openBirthdays = useCallback(() => setOpen(true), []);
  const closeBirthdays = useCallback(() => setOpen(false), []);

  return { birthdays, open, openBirthdays, closeBirthdays };
}

export function BirthdayWishesModal({ people, viewerName, onClose }: { people: BirthdayPerson[]; viewerName?: string; onClose: () => void }) {
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const ownBirthday = Boolean(viewerName && people.some((person) => person.kind === 'staff' && person.name === viewerName));

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal birthday-modal" onClick={(event) => event.stopPropagation()}>
        <div className="birthday-modal-top">
          <div className="birthday-modal-title">
            <span className="birthday-modal-icon"><Cake size={22} /></span>
            <div>
              <span className="eyebrow">Daily birthday check</span>
              <h2>Today’s birthdays</h2>
              <p>{todayLabel}</p>
            </div>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {ownBirthday && (
          <div className="birthday-self">
            <PartyPopper size={18} />
            <span>Happy Birthday, {viewerName}! Warmest birthday wishes from The Ujala School family.</span>
          </div>
        )}

        {people.length === 0 ? (
          <div className="birthday-empty">
            <PartyPopper size={26} />
            <strong>No birthdays today</strong>
            <span>Nobody on the register or the staff list has a birthday today. We will check again tomorrow morning.</span>
          </div>
        ) : (
          <>
            <p className="birthday-intro">
              {people.length === 1
                ? 'One person is celebrating a birthday today. Send them a warm wish in one click.'
                : `${people.length} people are celebrating birthdays today. Send them a warm wish in one click.`}
            </p>
            <ul className="birthday-list">
              {people.map((person) => (
                <li key={`${person.kind}-${person.id}`} className="birthday-row">
                  <div className={`birthday-avatar ${person.kind}`}>
                    {person.name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="birthday-details">
                    <strong>{person.name}</strong>
                    <span className="birthday-meta">
                      <em className={`birthday-tag ${person.kind}`}>{person.kind === 'student' ? 'Student' : 'Staff'}</em>
                      {person.label}
                    </span>
                    <span className={`birthday-number${person.display ? '' : ' missing'}`}>
                      {person.display || 'No WhatsApp number on record'}
                    </span>
                  </div>
                  <a
                    className="birthday-wa"
                    href={person.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={person.display ? `Open a WhatsApp chat with ${person.name}` : 'Open WhatsApp — no number saved, choose the recipient in WhatsApp'}
                  >
                    <Send size={15} /> Wish on WhatsApp
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

export function BirthdayNavButton({ count, onClick }: { count: number; onClick: () => void }) {
  const label = count ? `Today's birthdays (${count})` : "Today's birthdays";
  return (
    <button
      className={`icon-button birthday-button${count ? ' has-birthdays' : ''}`}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Cake size={19} />
      {count ? <i className="birthday-count">{count}</i> : null}
    </button>
  );
}
