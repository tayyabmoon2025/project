import { useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DropdownWithAddProps = {
  category: 'student_group' | 'subject_group' | 'house' | 'religion' | 'information_type' | 'father_profession' | 'mother_tongue';
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onOptionsChanged: () => void;
  onToast: (message: string) => void;
};

export function DropdownWithAdd({ category, label, value, options, onChange, onOptionsChanged, onToast }: DropdownWithAddProps) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const saveOption = async () => {
    const trimmed = newValue.trim();
    if (!trimmed) { onToast('Enter a name before adding'); return; }
    if (options.some((option) => option.toLowerCase() === trimmed.toLowerCase())) { onToast('That option already exists'); return; }
    setSaving(true);
    const { error } = await supabase.from('school_admission_options').insert({ category, label: trimmed });
    setSaving(false);
    if (error) { onToast('The option could not be saved. Please try again.'); return; }
    onChange(trimmed);
    setNewValue('');
    setAdding(false);
    onToast(`${label} option added`);
    onOptionsChanged();
  };

  return (
    <label className="dropdown-add-field">
      {label}
      {!adding ? (
        <div className="dropdown-add-row">
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select {label}</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <button type="button" className="secondary-button dropdown-add-button" onClick={() => setAdding(true)} aria-label={`Add ${label} option`}><Plus size={15} /></button>
        </div>
      ) : (
        <div className="dropdown-add-row">
          <input autoFocus value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder={`New ${label.toLowerCase()}`} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveOption(); } }} />
          <button type="button" className="secondary-button" onClick={() => { setAdding(false); setNewValue(''); }}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void saveOption()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </label>
  );
}
