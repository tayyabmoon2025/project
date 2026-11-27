import { useId } from 'react';

type GlossyIconName =
  | 'dashboard' | 'students' | 'admission' | 'sections' | 'attendance' | 'halfday'
  | 'homework' | 'liveclasses' | 'sms' | 'fees' | 'staff' | 'exams' | 'finance'
  | 'utility' | 'promotions' | 'withdrawals' | 'certificates' | 'other' | 'reports'
  | 'users' | 'setup' | 'settings' | 'myattendance' | 'receive' | 'ledger'
  | 'defaulters' | 'closing' | 'search' | 'reminders' | 'profile';

type Props = { name: GlossyIconName; size?: number };

const PALETTES: Record<string, [string, string, string]> = {
  blue: ['#3858d8', '#4e9bea', '#aee9ff'],
  sky: ['#1986d4', '#54c9f2', '#d5f7ff'],
  green: ['#1b9d6b', '#83d78e', '#fff0a1'],
  teal: ['#119b9a', '#4fd6cf', '#c4fff0'],
  amber: ['#d7891b', '#ffd85e', '#fff4b1'],
  coral: ['#d85e4f', '#ff9d87', '#ffe2b4'],
  violet: ['#754cc9', '#b178e6', '#f1b9ff'],
  crimson: ['#c52e58', '#f26c7f', '#ffc4b8'],
  whatsapp: ['#119b63', '#57d88c', '#d9ffb2'],
  gold: ['#b77913', '#eaca57', '#fff0a2'],
  slate: ['#3b6384', '#78b5d6', '#e3f7ff'],
  rose: ['#b84d76', '#e98daf', '#ffd6d9'],
};

function GradientDefs({ id, palette }: { id: string; palette: [string, string, string] }) {
  return (
    <defs>
      <linearGradient id={`${id}-main`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={palette[2]} />
        <stop offset="0.28" stopColor={palette[1]} />
        <stop offset="1" stopColor={palette[0]} />
      </linearGradient>
      <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={palette[1]} />
        <stop offset="1" stopColor={palette[0]} />
      </linearGradient>
      <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.18" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0.5" dy="2" stdDeviation="1.5" floodColor="#173a53" floodOpacity="0.28" />
      </filter>
    </defs>
  );
}

export function GlossyIcon({ name, size = 24 }: Props) {
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const paletteName = name === 'dashboard' ? 'blue'
    : name === 'students' || name === 'search' ? 'sky'
      : name === 'admission' ? 'green'
        : name === 'sections' ? 'teal'
          : name === 'attendance' ? 'amber'
            : name === 'halfday' ? 'coral'
              : name === 'homework' ? 'violet'
                : name === 'liveclasses' ? 'crimson'
                  : name === 'sms' ? 'whatsapp'
                    : name === 'fees' || name === 'receive' || name === 'ledger' || name === 'defaulters' || name === 'closing' ? 'gold'
                      : name === 'staff' || name === 'users' || name === 'setup' ? 'slate'
                        : name === 'withdrawals' || name === 'certificates' ? 'rose'
                          : 'teal';
  const palette = PALETTES[paletteName];
  const main = `url(#${id}-main)`;
  const dark = `url(#${id}-dark)`;
  const shine = `url(#${id}-shine)`;
  const shadow = `url(#${id}-shadow)`;

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <GradientDefs id={id} palette={palette} />
      <g filter={shadow} stroke="#ffffff" strokeOpacity="0.48" strokeWidth="0.8" strokeLinejoin="round">
        {name === 'dashboard' && <>
          <path d="M5 14 17 7l12 7-12 7L5 14Z" fill={shine} /><path d="m5 14 12 7v13L5 27V14Z" fill={main} /><path d="m17 21 12-7v13l-12 7V21Z" fill={dark} />
          <path d="m19 28 12-7 12 7-12 7-12-7Z" fill={shine} /><path d="m19 28 12 7v9l-12-7v-9Z" fill={main} /><path d="m31 35 12-7v9l-12 7v-9Z" fill={dark} />
        </>}
        {name === 'students' || name === 'search' ? <><circle cx="21" cy="21" r="12" fill={main} /><path d="M30 30 42 42" stroke={dark} strokeWidth="6" strokeLinecap="round" /><path d="M14 17c3-5 9-7 14-3" stroke={shine} strokeWidth="3" strokeLinecap="round" /></> : null}
        {name === 'admission' && <><circle cx="23" cy="15" r="8" fill={shine} /><path d="M10 38c1-9 7-14 13-14s12 5 13 14H10Z" fill={main} /><circle cx="37" cy="35" r="8" fill={palette[2]} /><path d="M37 30v10M32 35h10" stroke={palette[0]} strokeWidth="3" strokeLinecap="round" /></>}
        {name === 'sections' && <><circle cx="24" cy="14" r="7" fill={main} /><circle cx="11" cy="18" r="5" fill={dark} /><circle cx="37" cy="18" r="5" fill={dark} /><path d="M12 38c1-8 5-13 12-13s11 5 12 13H12Z" fill={main} /><path d="M2 37c1-6 4-9 9-9 3 0 5 1 7 4-3 2-5 5-5 8H2ZM46 37c-1-6-4-9-9-9-3 0-5 1-7 4 3 2 5 5 5 8h11Z" fill={dark} /></>}
        {name === 'attendance' && <><rect x="8" y="8" width="29" height="31" rx="5" fill={main} /><path d="M8 17h29" stroke={palette[0]} strokeWidth="3" /><path d="M15 5v7M30 5v7" stroke={dark} strokeWidth="4" strokeLinecap="round" /><path d="m30 32 4 4 8-9" stroke="#35ad72" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></>}
        {name === 'halfday' && <><path d="M10 7h22a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H10V7Z" fill={main} /><path d="M10 7 22 13v22L10 41V7Z" fill={dark} /><circle cx="25" cy="25" r="2" fill={palette[2]} /><path d="m35 17 7 7-7 7" stroke={palette[2]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></>}
        {name === 'homework' && <><path d="M6 13c6-4 12-4 18 1v27c-6-5-12-5-18-1V13Z" fill={main} /><path d="M42 13c-6-4-12-4-18 1v27c6-5 12-5 18-1V13Z" fill={dark} /><path d="m27 11 12-7 5 8-12 7-5-8Z" fill={palette[2]} /><path d="m30 13 8-5" stroke={palette[0]} strokeWidth="2" /></>}
        {name === 'liveclasses' && <><rect x="5" y="12" width="29" height="24" rx="6" fill={main} /><path d="m34 19 9-6v22l-9-6V19Z" fill={dark} /><circle cx="12" cy="18" r="3" fill="#ff5252" /><path d="M12 18h.1" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><path d="M13 31h13" stroke={shine} strokeWidth="2" strokeLinecap="round" /></>}
        {name === 'sms' && <><path d="M6 9h30a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H20l-9 7 2-7H6a6 6 0 0 1-6-6V15a6 6 0 0 1 6-6Z" fill={main} /><path d="M11 20c2-4 6-6 10-4l3 3-4 4c2 3 5 5 8 6l4-4 3 3c-2 5-6 6-10 5-7-2-12-7-14-13Z" fill={shine} stroke="none" /></>}
        {name === 'fees' || name === 'receive' || name === 'ledger' || name === 'defaulters' || name === 'closing' ? <><path d="M8 19h25v21H8z" fill={main} /><path d="M8 19 15 11h25l-7 8H8Z" fill={shine} /><path d="M31 22h10v12H31c-4 0-6-2-6-6s2-6 6-6Z" fill={dark} /><circle cx="32" cy="28" r="2" fill={palette[2]} /><circle cx="12" cy="11" r="5" fill={palette[2]} /><circle cx="22" cy="7" r="5" fill={main} /><path d="M9 11h6M19 7h6" stroke={palette[0]} strokeWidth="2" /></> : null}
        {name === 'staff' || name === 'users' ? <><circle cx="24" cy="14" r="7" fill={main} /><path d="M11 38c1-8 6-13 13-13s12 5 13 13H11Z" fill={dark} /><circle cx="10" cy="18" r="5" fill={palette[1]} /><circle cx="38" cy="18" r="5" fill={palette[1]} /><path d="M2 37c1-5 4-8 8-8M46 37c-1-5-4-8-8-8" stroke={shine} strokeWidth="4" strokeLinecap="round" /></> : null}
        {name === 'exams' || name === 'certificates' ? <><path d="M10 7h28v34H10z" fill={main} /><path d="M16 15h16M16 22h16M16 29h10" stroke={shine} strokeWidth="3" strokeLinecap="round" /><path d="m29 34 4 4 9-11" stroke={palette[0]} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></> : null}
        {name === 'finance' || name === 'reports' ? <><path d="M8 40V22h8v18H8ZM20 40V12h8v28h-8ZM32 40V5h8v35h-8Z" fill={main} /><path d="M8 22h8v5H8zM20 12h8v5h-8zM32 5h8v5h-8z" fill={shine} stroke="none" /></> : null}
        {name === 'utility' || name === 'setup' || name === 'settings' ? <><path d="m24 5 4 5 7-1 1 7 6 4-4 6 3 6-7 2-3 6-7-3-6 3-3-6-7-2 3-6-4-6 6-4 1-7 7 1 4-5Z" fill={main} /><circle cx="24" cy="24" r="7" fill={shine} /><circle cx="24" cy="24" r="3" fill={dark} /></> : null}
        {name === 'promotions' && <><path d="M24 7 39 14v12L24 33 9 26V14L24 7Z" fill={main} /><path d="m24 33 15-7v9l-15 7-15-7v-9l15 7Z" fill={dark} /><path d="m24 7 15 7-15 7-15-7 15-7Z" fill={shine} /></>}
        {name === 'withdrawals' && <><path d="M8 9h26v30H8z" fill={main} /><path d="M34 18h8v12h-8" fill={dark} /><path d="M25 24H8M25 24l-6-6M25 24l-6 6" stroke={palette[2]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></>}
        {name === 'other' || name === 'profile' || name === 'myattendance' ? <><circle cx="24" cy="17" r="9" fill={main} /><path d="M8 42c1-11 7-16 16-16s15 5 16 16H8Z" fill={dark} /><path d="M17 14c2-4 8-6 13-2" stroke={shine} strokeWidth="3" strokeLinecap="round" /></> : null}
        {name === 'search' && null}
        {name === 'reminders' && <><path d="M12 35h24l-3-5V20a9 9 0 0 0-18 0v10l-3 5Z" fill={main} /><path d="M20 40h8" stroke={palette[0]} strokeWidth="4" strokeLinecap="round" /><circle cx="37" cy="11" r="6" fill="#f05c63" /><path d="M37 8v6M34 11h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></>}
      </g>
    </svg>
  );
}

export type { GlossyIconName };
