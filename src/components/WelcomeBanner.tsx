import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';

// The dashboard hero banner: six flat-vector school scenes that rotate every
// 15 minutes, each drawn twice — a daytime and a nighttime version — so the
// banner always matches the app's Light (Day) or Dark (Night) theme.

type Theme = 'light' | 'dark';

type Slide = {
  id: string;
  subtitle: string;
  day: string;
  night: string;
  art: (night: boolean) => JSX.Element;
};

const TEXT = { fill: '#ffffff', fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif" } as const;

const Sun = ({ night }: { night: boolean }) => night ? (
  <g>
    <mask id="sd-moon">
      <rect x="620" y="0" width="160" height="120" fill="#fff" />
      <circle cx="716" cy="46" r="24" fill="#000" />
    </mask>
    <circle cx="700" cy="55" r="26" fill="#f2dc9b" mask="url(#sd-moon)" />
    <g fill="#e8f0ff" opacity="0.85">
      <circle cx="560" cy="30" r="2.5" /><circle cx="610" cy="80" r="2" /><circle cx="760" cy="30" r="2.5" />
      <circle cx="640" cy="14" r="1.6" /><circle cx="745" cy="90" r="1.8" /><circle cx="520" cy="70" r="1.6" />
    </g>
  </g>
) : (
  <g>
    <circle cx="700" cy="55" r="30" fill="#ffe69a" opacity="0.9" />
    <circle cx="700" cy="55" r="21" fill="#ffd35e" />
  </g>
);

const Cloud = ({ x, y, night }: { x: number; y: number; night: boolean }) => night ? null : (
  <g transform={`translate(${x},${y})`} fill="#ffffff" opacity="0.85">
    <rect x="0" y="8" width="64" height="12" rx="6" />
    <circle cx="20" cy="8" r="12" /><circle cx="42" cy="6" r="10" />
  </g>
);

const Tree = ({ x, s = 1, night }: { x: number; s?: number; night: boolean }) => (
  <g transform={`translate(${x},150) scale(${s})`}>
    <rect x="-4" y="24" width="8" height="32" fill="#a47156" />
    <circle cx="0" cy="10" r="24" fill={night ? '#2e5a4a' : '#8ebd75'} />
    <circle cx="-14" cy="20" r="15" fill={night ? '#27503f' : '#9dc985'} />
    <circle cx="14" cy="20" r="15" fill={night ? '#27503f' : '#abd084'} />
  </g>
);

const Ground = ({ night }: { night: boolean }) => (
  <rect x="0" y="178" width="800" height="82" fill={night ? '#1c3a3a' : '#7cc46f'} opacity={night ? 0.9 : 1} />
);

const Building = ({ night }: { night: boolean }) => (
  <g transform="translate(440,42)">
    <path d="M-14 46 L92 -8 L198 46 Z" fill={night ? '#3d2f55' : '#e78c68'} />
    <rect x="0" y="46" width="184" height="132" rx="4" fill={night ? '#2b3a55' : '#ffe3b7'} />
    <rect x="78" y="122" width="30" height="56" rx="13" fill={night ? '#5a4a35' : '#e5a16f'} />
    {[0, 1, 2, 3].map((column) => [0, 1].map((row) => (
      <rect
        key={`${column}-${row}`}
        x={14 + column * 42}
        y={60 + row * 40}
        width="26"
        height="26"
        rx="3"
        fill={night ? '#ffd76a' : '#8bc7d8'}
        stroke={night ? 'none' : '#ffffff'}
        strokeWidth="2.5"
        opacity={night ? 0.95 : 1}
      />
    )))}
  </g>
);

const Students = ({ xs, night }: { xs: number[]; night: boolean }) => (
  <g>
    {xs.map((x, index) => (
      <g key={x} transform={`translate(${x},196)`}>
        <circle cx="0" cy="0" r="7" fill="#e8b48c" />
        <rect x="-9" y="8" width="18" height="32" rx="8" fill={night ? ['#3f6f9a', '#4a7d6a', '#8a6a9e'][index % 3] : ['#2d729a', '#4a8a5f', '#c2764f'][index % 3]} />
      </g>
    ))}
  </g>
);

const Spark = ({ x, y, night }: { x: number; y: number; night: boolean }) => (
  <path
    d={`M${x} ${y - 9} L${x + 2.4} ${y - 2.4} L${x + 9} ${y} L${x + 2.4} ${y + 2.4} L${x} ${y + 9} L${x - 2.4} ${y + 2.4} L${x - 9} ${y} L${x - 2.4} ${y - 2.4} Z`}
    fill={night ? '#f2dc9b' : '#ffffff'}
    opacity={night ? 0.9 : 0.75}
  />
);

const campusArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <Cloud x={470} y={26} night={night} />
    <Cloud x={560} y={96} night={night} />
    <Building night={night} />
    <Tree x={350} s={1.15} night={night} />
    <Tree x={700} s={0.9} night={night} />
    <Students xs={[60, 105, 150, 195, 240]} night={night} />
  </svg>
);

const libraryArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <Tree x={90} s={1.1} night={night} />
    <Tree x={710} s={0.95} night={night} />
    <g transform="translate(400,168)">
      <rect x="-150" y="26" width="70" height="16" rx="4" fill={night ? '#7a4f4f' : '#e78c68'} />
      <rect x="-142" y="10" width="70" height="16" rx="4" fill={night ? '#4a6d8a' : '#5aa9d6'} transform="rotate(-4)" />
      <rect x="-146" y="-4" width="66" height="16" rx="4" fill={night ? '#6a7a4a' : '#8ebd75'} transform="rotate(3)" />
      <path d="M30 46 C70 22 130 22 170 40 L170 116 C130 98 70 98 30 116 Z" fill={night ? '#31435f' : '#ffffff'} />
      <path d="M310 46 C270 22 210 22 170 40 L170 116 C210 98 270 98 310 116 Z" fill={night ? '#3a4d6e' : '#f3f8fa'} />
      <rect x="165" y="34" width="10" height="84" fill={night ? '#202c40' : '#d7e4ea'} />
      <path d="M52 62 C90 48 130 50 158 60 M52 84 C90 70 130 72 158 82" stroke={night ? '#8fa9d6' : '#9db8c4'} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M288 62 C250 48 210 50 182 60 M288 84 C250 70 210 72 182 82" stroke={night ? '#8fa9d6' : '#9db8c4'} strokeWidth="5" fill="none" strokeLinecap="round" />
    </g>
    <Students xs={[120, 165]} night={night} />
  </svg>
);

const scienceArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <g transform="translate(690,70)" stroke={night ? '#f2dc9b' : '#ffffff'} fill="none" strokeWidth="3" opacity="0.9">
      <ellipse rx="58" ry="20" />
      <ellipse rx="58" ry="20" transform="rotate(60)" />
      <ellipse rx="58" ry="20" transform="rotate(120)" />
      <circle r="11" fill={night ? '#f2dc9b' : '#ffe69a'} stroke="none" />
    </g>
    <g transform="translate(470,90)">
      <path d="M-14 0 h28 v34 l30 52 a10 10 0 0 1 -9 15 h-70 a10 10 0 0 1 -9 -15 l30 -52 Z" fill={night ? '#31435f' : '#ffffff'} opacity="0.95" />
      <path d="M-38 76 h76 l14 24 a6 6 0 0 1 -5 10 h-94 a6 6 0 0 1 -5 -10 Z" fill={night ? '#3fae9f' : '#5ac2b2'} />
      <circle cx="-14" cy="60" r="4" fill={night ? '#8fe3da' : '#a7e6dd'} />
      <circle cx="8" cy="50" r="3" fill={night ? '#8fe3da' : '#a7e6dd'} />
      <circle cx="20" cy="68" r="2.5" fill={night ? '#8fe3da' : '#a7e6dd'} />
    </g>
    <g transform="translate(600,178)">
      <circle r="34" fill={night ? '#4a6d8a' : '#8bc7d8'} />
      <ellipse rx="52" ry="12" transform="rotate(-16)" fill="none" stroke={night ? '#8fa9d6' : '#e78c68'} strokeWidth="5" opacity="0.9" />
    </g>
    <Spark x={380} y={60} night={night} />
    <Spark x={540} y={40} night={night} />
    <Students xs={[100, 145, 190]} night={night} />
  </svg>
);

const classroomArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <Tree x={110} s={1.05} night={night} />
    <g transform="translate(560,58)">
      <rect x="-160" y="0" width="320" height="118" rx="10" fill={night ? '#22354a' : '#2f5d50'} stroke={night ? '#8a6a4a' : '#a47156'} strokeWidth="10" />
      <rect x="-8" y="118" width="16" height="64" fill={night ? '#5a4a35' : '#a47156'} />
      <path d="M-150 108 L-40 108 M40 108 L150 108" stroke="#ffffff" strokeWidth="4" opacity="0.85" strokeLinecap="round" />
      <path d="M-130 40 C-110 22 -96 40 -80 26 M-130 66 L-86 66" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.9" />
      <text x="52" y="76" fontSize="58" {...TEXT} opacity="0.95">Aa</text>
      <text x="150" y="76" fontSize="58" {...TEXT} opacity="0.7">Bc</text>
    </g>
    <g transform="translate(330,190) rotate(-24)">
      <rect x="0" y="-9" width="98" height="18" rx="4" fill={night ? '#7a5a3f' : '#f0b25a'} />
      <path d="M98 -9 L122 0 L98 9 Z" fill={night ? '#c9b28a' : '#ffe3b7'} />
      <path d="M112 -4 L122 0 L112 4 Z" fill={night ? '#3a3530' : '#5a4a3f'} />
      <rect x="16" y="-9" width="14" height="18" fill={night ? '#8a6a9e' : '#e78c68'} />
    </g>
    <Students xs={[70, 115, 160, 205]} night={night} />
  </svg>
);

const achievementArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <g transform="translate(580,60)">
      <path d="M-42 0 h84 v22 a42 42 0 0 1 -84 0 Z" fill={night ? '#e3c06a' : '#f5c04e'} />
      <path d="M-42 8 h-18 a4 4 0 0 0 -4 4 v6 a20 20 0 0 0 20 20 h8 M42 8 h18 a4 4 0 0 1 4 4 v6 a20 20 0 0 1 -20 20 h-8" stroke={night ? '#e3c06a' : '#f5c04e'} strokeWidth="8" fill="none" strokeLinecap="round" />
      <rect x="-10" y="60" width="20" height="26" fill={night ? '#c9a44e' : '#dd9f30'} />
      <rect x="-34" y="86" width="68" height="12" rx="4" fill={night ? '#e3c06a' : '#f5c04e'} />
      <path d="M-14 18 L-4 30 L16 6" stroke={night ? '#4a3f2a' : '#a8791f'} strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g transform="translate(400,190)">
      <rect x="-150" y="0" width="100" height="60" rx="6" fill={night ? '#31435f' : '#8bc7d8'} />
      <rect x="-50" y="-24" width="100" height="84" rx="6" fill={night ? '#4a6d8a' : '#5aa9d6'} />
      <rect x="50" y="-48" width="100" height="108" rx="6" fill={night ? '#e3c06a' : '#f5c04e'} />
      <text x="0" y="26" textAnchor="middle" fontSize="30" {...TEXT} fill={night ? '#c9d8ea' : '#ffffff'}>2</text>
      <text x="100" y="2" textAnchor="middle" fontSize="30" {...TEXT}>1</text>
      <text x="-100" y="42" textAnchor="middle" fontSize="30" {...TEXT} fill={night ? '#c9d8ea' : '#ffffff'}>3</text>
    </g>
    <Spark x={430} y={70} night={night} />
    <Spark x={720} y={150} night={night} />
    <Spark x={340} y={130} night={night} />
    <Students xs={[110, 155, 200]} night={night} />
  </svg>
);

const sportsArt = (night: boolean) => (
  <svg viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice">
    <Ground night={night} />
    <Sun night={night} />
    <Tree x={90} s={1.1} night={night} />
    <Tree x={740} s={0.85} night={night} />
    <g transform="translate(600,120)" stroke={night ? '#8fa9d6' : '#ffffff'} strokeWidth="6" fill="none" strokeLinecap="round">
      <rect x="-120" y="-16" width="10" height="112" fill={night ? '#8fa9d6' : '#ffffff'} stroke="none" />
      <rect x="86" y="-16" width="10" height="112" fill={night ? '#8fa9d6' : '#ffffff'} stroke="none" />
      <path d="M-120 -12 h216" />
      <path d="M-110 20 h190 M-110 56 h190" opacity="0.6" />
    </g>
    <g transform="translate(430,182)">
      <circle r="42" fill={night ? '#e8eef5' : '#ffffff'} />
      <path d="M0 -42 C-16 -20 -16 20 0 42 M-40 -12 C-14 -2 14 -2 40 -12 M-40 12 C-14 2 14 2 40 12" stroke={night ? '#31435f' : '#2d729a'} strokeWidth="4" fill="none" />
    </g>
    <g transform="translate(250,150)">
      <rect x="-4" y="-70" width="8" height="118" rx="4" fill={night ? '#5a7a5a' : '#4a8a5f'} />
      <path d="M0 -40 C-26 -46 -34 -66 -30 -84 C-8 -80 2 -62 0 -40 Z" fill={night ? '#2e5a4a' : '#8ebd75'} />
      <path d="M0 -22 C26 -30 34 -50 28 -66 C6 -60 -4 -42 0 -22 Z" fill={night ? '#27503f' : '#abd084'} />
      <path d="M-16 48 h32 l-6 40 h-20 Z" fill={night ? '#7a6a55' : '#a47156'} />
    </g>
    <Students xs={[110, 155, 200, 245]} night={night} />
  </svg>
);

const SLIDES: Slide[] = [
  { id: 'campus', subtitle: 'A new day to learn, play and grow together.', day: 'linear-gradient(105deg, #5aa9d6, #7fc6df)', night: 'linear-gradient(105deg, #16324e, #1f4a63)', art: campusArt },
  { id: 'library', subtitle: 'Every book you open opens a new world.', day: 'linear-gradient(105deg, #3fae9f, #6fc7bd)', night: 'linear-gradient(105deg, #0f3d3e, #14554f)', art: libraryArt },
  { id: 'science', subtitle: 'Curious minds today, bright futures tomorrow.', day: 'linear-gradient(105deg, #f0a75a, #f2c078)', night: 'linear-gradient(105deg, #4a2e3f, #6b3f52)', art: scienceArt },
  { id: 'classroom', subtitle: 'Great teachers build great futures.', day: 'linear-gradient(105deg, #6b8fc3, #8fa9d6)', night: 'linear-gradient(105deg, #232a4d, #34406e)', art: classroomArt },
  { id: 'achievement', subtitle: 'Celebrating every milestone, big or small.', day: 'linear-gradient(105deg, #e8956d, #f3b98a)', night: 'linear-gradient(105deg, #3a2745, #553a5e)', art: achievementArt },
  { id: 'sports', subtitle: 'Play hard, grow strong, dream big.', day: 'linear-gradient(105deg, #58b77c, #7fcf98)', night: 'linear-gradient(105deg, #1d3a2f, #2a5240)', art: sportsArt },
];

const ROTATE_MS = 15 * 60 * 1000;

export function WelcomeBanner({ theme }: { theme: Theme }) {
  const [active, setActive] = useState(0);
  const night = theme === 'dark';

  useEffect(() => {
    const id = window.setInterval(() => setActive((current) => (current + 1) % SLIDES.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const slide = SLIDES[active];
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <section className="welcome-banner" style={{ background: night ? slide.night : slide.day }}>
      <div className="banner-layer" key={slide.id}>
        <div className="banner-art" aria-hidden="true">{slide.art(night)}</div>
        <div className="welcome-copy">
          <span className="eyebrow light"><Sparkles size={14} /> {todayLabel}</span>
          <h1>Hello, {SCHOOL_NAME}</h1>
          <p>{slide.subtitle}</p>
        </div>
      </div>
      <div className="banner-dots" role="tablist" aria-label="Banner slides">
        {SLIDES.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={`Show banner ${index + 1}`}
            className={`banner-dot ${index === active ? 'active' : ''}`}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
    </section>
  );
}
