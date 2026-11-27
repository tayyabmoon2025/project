import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, UserRound } from 'lucide-react';
import { fetchTeacherNames } from '@/lib/classSections';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
};

// The class teacher field: a searchable list of the school's active teachers, with the
// keyboard and a plain typed name both accepted, so a teacher who is not yet on the
// staff list can still be written in.
export function ClassTeacherPicker({ value, onChange, placeholder = 'Search a teacher, or type a name', id }: Props) {
  const [teachers, setTeachers] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void fetchTeacherNames().then(setTeachers); }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const typed = open ? query : value;
  const matches = useMemo(() => {
    const needle = typed.trim().toLowerCase();
    if (!needle) return teachers;
    return teachers.filter((name) => name.toLowerCase().includes(needle));
  }, [teachers, typed]);

  const choose = (name: string) => {
    onChange(name);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') { setOpen(true); setQuery(''); }
      return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0))); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((current) => Math.max(current - 1, 0)); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[highlight]) choose(matches[highlight]);
      else { onChange(query.trim()); setQuery(''); setOpen(false); }
      return;
    }
    if (event.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div className="teacher-picker" ref={wrapRef}>
      <div className="teacher-picker-field">
        <UserRound size={15} />
        <input
          id={id}
          value={open ? query : value}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); if (!open) setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <button
          type="button"
          className="teacher-picker-toggle"
          aria-label={open ? 'Close teacher list' : 'Open teacher list'}
          onClick={() => { setOpen((current) => !current); setQuery(''); }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="teacher-picker-list" role="listbox">
          {matches.length === 0 ? (
            <p className="teacher-picker-empty">
              {teachers.length === 0
                ? 'No teachers on the staff list yet — type the name and it will be used.'
                : 'No teacher matches that name. Type it in full and it will be used.'}
            </p>
          ) : (
            matches.map((name, index) => (
              <button
                type="button"
                key={name}
                role="option"
                aria-selected={index === highlight}
                className={`teacher-picker-option${index === highlight ? ' active' : ''}${name === value ? ' chosen' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(name)}
              >
                <UserRound size={14} />
                <span>{name}</span>
                {name === value && <Check size={14} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
