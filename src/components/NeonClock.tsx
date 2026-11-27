import { useEffect, useState } from 'react';

function two(value: number): string {
  return String(value).padStart(2, '0');
}

function parts(now: Date) {
  const hours24 = now.getHours();
  return {
    hours: two(hours24 % 12 === 0 ? 12 : hours24 % 12),
    minutes: two(now.getMinutes()),
    seconds: two(now.getSeconds()),
    meridiem: hours24 < 12 ? 'AM' : 'PM',
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    date: now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

// The live clock in the header. It re-renders once a second and clears its timer
// when it leaves the page, so no interval is left running behind the scenes.
export function NeonClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = parts(now);

  return (
    <div className="neon-clock" role="timer" aria-label={`Current time ${time.hours}:${time.minutes}:${time.seconds} ${time.meridiem}`}>
      <span className="neon-clock-glow" aria-hidden="true" />
      <span className="neon-clock-face">
        <span className="neon-clock-time">
          {time.hours}
          <i className="neon-clock-colon">:</i>
          {time.minutes}
          <i className="neon-clock-colon">:</i>
          <span className="neon-clock-seconds">{time.seconds}</span>
          <em className="neon-clock-meridiem">{time.meridiem}</em>
        </span>
        <span className="neon-clock-date">
          <b>{time.weekday}</b>
          <span className="neon-clock-dot" aria-hidden="true" />
          <span>{time.date}</span>
        </span>
      </span>
    </div>
  );
}
