import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { PersonAvatar } from '@/components/PersonAvatar';
import { designationFor, certificateStaffCode, isServingStaff, type CertificateStaff } from '@/lib/staffCertificates';

// The staff chooser for the certificate form. A dropdown rather than a plain select, so
// each option can carry the face, the Staff ID and the role — which is what the office
// needs to be sure they have picked the right person before a certificate is printed.
export function StaffPicker({ staff, value, onChange, placeholder = 'Search by name, Staff ID, CNIC or phone' }: {
  staff: CertificateStaff[];
  value: string;
  onChange: (staff: CertificateStaff) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const selected = staff.find((member) => member.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return staff;
    const digits = needle.replace(/\D/g, '');
    return staff.filter((member) => {
      const text = [
        member.full_name,
        certificateStaffCode(member),
        designationFor(member.role),
        member.cnic ?? '',
        member.mobile_number ?? '',
      ].join(' ').toLowerCase();
      if (text.includes(needle)) return true;
      if (!digits) return false;
      return (member.mobile_number ?? '').replace(/\D/g, '').includes(digits)
        || (member.cnic ?? '').replace(/\D/g, '').includes(digits);
    });
  }, [staff, query]);

  const choose = (member: CertificateStaff) => {
    onChange(member);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { setOpen(false); setQuery(''); return; }
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') { setOpen(true); setQuery(''); }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[highlight]) choose(matches[highlight]);
    }
  };

  return (
    <div className="staff-picker" ref={wrapRef}>
      <div className="staff-picker-field">
        {selected ? (
          <PersonAvatar photoUrl={selected.photo_url} name={selected.full_name} />
        ) : (
          <Search size={16} />
        )}
        <input
          value={open ? query : selected?.full_name ?? ''}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); if (!open) setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {selected && !open && (
          <button type="button" className="staff-picker-clear" aria-label="Clear the chosen staff member" onClick={() => setOpen(true)}>
            <X size={15} />
          </button>
        )}
        <button
          type="button"
          className="staff-picker-toggle"
          aria-label={open ? 'Close the staff list' : 'Open the staff list'}
          onClick={() => { setOpen((current) => !current); setQuery(''); }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="staff-picker-list" role="listbox">
          {matches.length === 0 ? (
            <p className="staff-picker-empty">
              {staff.length === 0
                ? 'No staff members on record yet. Add one from the Staff directory tab first.'
                : 'No staff member matches that search.'}
            </p>
          ) : (
            matches.map((member, index) => (
              <button
                type="button"
                key={member.id}
                role="option"
                aria-selected={index === highlight}
                className={`staff-picker-option${index === highlight ? ' active' : ''}${member.id === value ? ' chosen' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(member)}
              >
                <PersonAvatar photoUrl={member.photo_url} name={member.full_name} />
                <span className="staff-picker-option-copy">
                  <strong>{member.full_name}</strong>
                  <small>
                    {certificateStaffCode(member)} · {designationFor(member.role)}
                    {isServingStaff(member) ? '' : ' · Former staff'}
                  </small>
                </span>
                {member.id === value && <Check size={15} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
