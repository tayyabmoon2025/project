import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Pencil, X } from 'lucide-react';
import { saveStudentWhatsappNumber } from '@/lib/studentContacts';
import {
  resolveWhatsAppNumber, whatsappNumberProblem,
  type WhatsAppSiblingCandidate,
} from '@/lib/whatsapp';

// One row's WhatsApp number in the reminder tables. The number shown is the resolved
// one — the student's own WhatsApp Number when it is usable, otherwise a brother's or
// sister's saved number — and it can be corrected in place so a reminder is not blocked
// by a blank or mistyped entry. Family is the whole family group for a sibling table, or
// the full roster where there is no family grouping.
export function WhatsappNumberCell({ student, family = [], onSaved, onToast }: {
  student: WhatsAppSiblingCandidate & { id: string; full_name: string };
  family?: readonly WhatsAppSiblingCandidate[];
  onSaved?: () => void | Promise<void>;
  onToast: (message: string) => void;
}) {
  const resolution = resolveWhatsAppNumber(student, family);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(resolution.display);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The roster reloads after a save, so the box follows the stored value until the
  // office starts typing again.
  useEffect(() => { if (!editing) setValue(resolution.display); }, [resolution.display, editing]);

  const startEdit = () => { setValue(resolution.display); setError(''); setEditing(true); };
  const cancel = () => { setEditing(false); setError(''); setValue(resolution.display); };

  const save = async () => {
    const problem = whatsappNumberProblem(value);
    if (problem) { setError(problem.message); return; }
    setSaving(true);
    const result = await saveStudentWhatsappNumber(student.id, value);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setEditing(false);
    setError('');
    onToast(result.message);
    await onSaved?.();
  };

  if (editing) {
    return (
      <div className="wa-cell">
        <div className="wa-edit">
          <input
            value={value}
            onChange={(event) => { setValue(event.target.value); setError(''); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void save(); }
              if (event.key === 'Escape') cancel();
            }}
            placeholder="0300 1234567"
            inputMode="tel"
            autoFocus
            aria-label={`WhatsApp number for ${student.full_name}`}
          />
          <button type="button" className="wa-icon save" onClick={() => void save()} disabled={saving} title="Save" aria-label="Save WhatsApp number">
            <Check size={14} />
          </button>
          <button type="button" className="wa-icon" onClick={cancel} disabled={saving} title="Cancel" aria-label="Cancel">
            <X size={14} />
          </button>
        </div>
        {error ? (
          <small className="fee-warn">{error}</small>
        ) : (
          <small className="wa-hint">Leave it blank to clear the saved number.</small>
        )}
      </div>
    );
  }

  if (!resolution.number) {
    return (
      <div className="wa-cell">
        <span className="wa-none"><AlertTriangle size={13} /> No WhatsApp no.</span>
        <small className="fee-warn">No working number on this record or on a brother or sister's record.</small>
        <button type="button" className="fee-link" onClick={startEdit}><Pencil size={13} /> Add number</button>
      </div>
    );
  }

  return (
    <div className="wa-cell">
      <span className="wa-number">{resolution.display}</span>
      <small className="wa-source">
        {resolution.borrowed
          ? `From ${resolution.siblingName ? `${resolution.siblingName}'s record` : 'a sibling record'}`
          : resolution.source}
      </small>
      <button type="button" className="fee-link" onClick={startEdit}><Pencil size={13} /> Edit</button>
    </div>
  );
}
