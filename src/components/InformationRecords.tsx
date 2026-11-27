import { useState } from 'react';
import { Check, RotateCcw, Trash2 } from 'lucide-react';
import type { InformationRecord } from '@/lib/schoolTypes';
import { DropdownWithAdd } from '@/components/DropdownWithAdd';

export type InformationDraft = { id: string | null; information_type: string; notes: string };

export function InformationRecords({ records, loading = false, loadError = false, options, onOptionsChanged, onToast, onSave, onDelete }: {
  records: InformationRecord[];
  loading?: boolean;
  loadError?: boolean;
  options: string[];
  onOptionsChanged: () => void;
  onToast: (message: string) => void;
  onSave: (draft: InformationDraft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [informationType, setInformationType] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;

  const clearForm = () => {
    setSelectedId(null);
    setInformationType('');
    setNotes('');
  };

  const selectRecord = (record: InformationRecord) => {
    setSelectedId(record.id);
    setInformationType(record.information_type);
    setNotes(record.notes);
  };

  const saveRecord = async () => {
    const trimmedNotes = notes.trim();
    if (!informationType) { onToast('Choose an Information Type before saving'); return; }
    if (!trimmedNotes) { onToast('Enter some notes before saving'); return; }
    setSaving(true);
    const saved = await onSave({ id: selectedRecord ? selectedRecord.id : null, information_type: informationType, notes: trimmedNotes });
    setSaving(false);
    if (saved) clearForm();
  };

  const deleteRecord = async () => {
    if (!selectedRecord) return;
    if (!window.confirm('Delete this information entry? This cannot be undone.')) return;
    setDeleting(true);
    const deleted = await onDelete(selectedRecord.id);
    setDeleting(false);
    if (deleted) clearForm();
  };

  return (
    <div className="grid gap-5">
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <span className="eyebrow">Other information</span>
            <h2 className="text-lg font-bold text-slate-800">{records.length} {records.length === 1 ? 'entry' : 'entries'}</h2>
          </div>
        </div>
        {loadError ? (
          <div className="empty-state large">The saved information could not be loaded. Refresh the page to try again.</div>
        ) : loading ? (
          <div className="empty-state large">Loading saved information…</div>
        ) : records.length === 0 ? (
          <div className="empty-state large">No information added yet. Choose a type, write your notes, and press Save.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Information Type</th>
                  <th>Notes</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr
                    key={record.id}
                    onClick={() => selectRecord(record)}
                    className={`cursor-pointer transition-colors hover:bg-sky-50/60 ${selectedRecord?.id === record.id ? 'bg-sky-50' : ''}`}
                  >
                    <td><strong>{record.information_type}</strong></td>
                    <td className="max-w-md whitespace-pre-line text-slate-600">{record.notes.length > 140 ? `${record.notes.slice(0, 140)}…` : record.notes}</td>
                    <td className="muted-cell">{new Date(record.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="panel grid gap-5 p-6">
        <div>
          <span className="eyebrow">{selectedRecord ? 'Editing entry' : 'New entry'}</span>
          <h2 className="text-lg font-bold text-slate-800">{selectedRecord ? 'Update the selected information' : 'Add other information'}</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DropdownWithAdd category="information_type" label="Information Type" value={informationType} options={options} onChange={setInformationType} onOptionsChanged={onOptionsChanged} onToast={onToast} />
        </div>
        <label className="control-field">
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={10}
            placeholder="Write the details here"
            className="min-h-48 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="secondary-button" onClick={clearForm}><RotateCcw size={16} /> Clear</button>
          <button type="button" className="secondary-button text-rose-600" onClick={() => void deleteRecord()} disabled={!selectedRecord || deleting}><Trash2 size={16} /> {deleting ? 'Deleting…' : 'Delete'}</button>
          <button type="button" className="primary-button" onClick={() => void saveRecord()} disabled={saving}><Check size={16} /> {saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
