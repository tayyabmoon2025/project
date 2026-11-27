import type { ReactNode } from 'react';

// A starter layout for a staff tab whose features are still to be built: it names the
// tab, explains what will live there and lists what is planned, so the tab is never a
// blank screen or a dead end.
export function StaffTabIntro({ icon, eyebrow, title, description, points, note }: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
  note?: string;
}) {
  return (
    <div className="payroll-tab">
      <div className="panel staff-tab-intro">
        <span className="staff-tab-icon">{icon}</span>
        <div className="staff-tab-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
          <ul className="staff-tab-points">
            {points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          {note ? <p className="staff-tab-note">{note}</p> : null}
        </div>
      </div>
    </div>
  );
}
