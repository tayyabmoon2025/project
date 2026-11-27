import { useEffect, useState } from 'react';
import { Layers, Pencil, Trash2 } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClassSections } from '@/lib/classSections';
import { ManageClassSectionsModal } from '@/components/ManageClassSectionsModal';
import { ClassTeacherPicker } from '@/components/ClassTeacherPicker';

type SectionRecord = { id: string; class_name: string; section_name: string; class_teacher: string | null; capacity: number | null };

type Draft = {
  id: string | null;
  class_name: string;
  section_name: string;
  class_teacher: string;
  capacity: string;
};

export function SystemClassesSectionsTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const { classes, sections: sectionNames } = useClassSections();
  const isAdmin = profile?.role === 'admin';
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({ id: null, class_name: classes[0] ?? '', section_name: sectionNames[0] ?? '', class_teacher: '', capacity: '' }));
  const [saving, setSaving] = useState(false);

  const emptyDraft = (): Draft => ({ id: null, class_name: classes[0] ?? '', section_name: sectionNames[0] ?? '', class_teacher: '', capacity: '' });

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('school_sections').select('id, class_name, section_name, class_teacher, capacity').order('class_name').order('section_name');
      if (error) throw error;
      setSections((data ?? []) as SectionRecord[]);
      setError('');
    } catch {
      setError('Classes and sections could not be loaded.');
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const startEdit = (row: SectionRecord) => setDraft({
    id: row.id,
    class_name: row.class_name,
    section_name: row.section_name,
    class_teacher: row.class_teacher ?? '',
    capacity: row.capacity != null ? String(row.capacity) : '',
  });

  const submit = async (): Promise<boolean | void> => {
    if (!draft.class_name || !draft.section_name) { onToast('Choose a class and section.'); return false; }
    const capacity = draft.capacity.trim() === '' ? null : Number(draft.capacity);
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) { onToast('Capacity must be a valid number.'); return false; }
    setSaving(true);
    try {
      const payload = {
        class_name: draft.class_name,
        section_name: draft.section_name,
        class_teacher: draft.class_teacher.trim() || null,
        capacity,
      };
      const { error } = draft.id
        ? await supabase.from('school_sections').update(payload).eq('id', draft.id)
        : await supabase.from('school_sections').insert(payload);
      if (error) throw error;
      onToast(draft.id ? 'Section updated.' : 'Section added.');
      setDraft(emptyDraft());
      void load();
      return true;
    } catch {
      onToast('The section could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this section? Class teachers and capacity for it will be cleared.')) return;
    const { error } = await supabase.from('school_sections').delete().eq('id', id);
    if (error) { onToast('The section could not be removed.'); return; }
    onToast('Section removed.');
    void load();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Classes &amp; Sections</span>
          <h2>Class Sections</h2>
        </div>
        {isAdmin && (
          <button className="secondary-button" type="button" onClick={() => setManaging(true)}>
            <Pencil size={15} /> Edit / Manage names
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Class
              <div className="manage-field-row">
                <select value={draft.class_name} onChange={(e) => setDraft({ ...draft, class_name: e.target.value })}>
                  {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" className="icon-button" title="Edit class names" aria-label="Edit class names" onClick={() => setManaging(true)}><Pencil size={15} /></button>
              </div>
            </label>
            <label className="control-field">Section
              <div className="manage-field-row">
                <select value={draft.section_name} onChange={(e) => setDraft({ ...draft, section_name: e.target.value })}>
                  {sectionNames.map((s) => <option key={s} value={s}>Section {s}</option>)}
                </select>
                <button type="button" className="icon-button" title="Edit section names" aria-label="Edit section names" onClick={() => setManaging(true)}><Pencil size={15} /></button>
              </div>
            </label>
            <div className="control-field"><span>Class Teacher</span>
              <ClassTeacherPicker value={draft.class_teacher} onChange={(value) => setDraft({ ...draft, class_teacher: value })} />
            </div>
            <label className="control-field">Capacity
              <input type="number" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="e.g. 40" />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => setDraft(emptyDraft())}>Clear</button>
            <AsyncSaveButton
              className="primary-button"
              label={draft.id ? 'Update Section' : 'Add Section'}
              size={15}
              disabled={saving}
              onSave={() => submit()}
            />
          </div>
        </div>
      )}

      {managing && <ManageClassSectionsModal onClose={() => setManaging(false)} onToast={onToast} />}

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {loading ? (
        <p className="fee-empty">Loading sections…</p>
      ) : sections.length === 0 ? (
        <p className="fee-empty">No sections recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Class</th><th>Section</th><th>Class Teacher</th><th>Capacity</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {sections.map((row) => (
                <tr key={row.id}>
                  <td><div className="table-student"><Layers size={14} /><strong>{row.class_name}</strong></div></td>
                  <td>{row.section_name}</td>
                  <td>{row.class_teacher || '—'}</td>
                  <td className="fee-mono">{row.capacity ?? '—'}</td>
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link" onClick={() => startEdit(row)}>Edit</button>
                        <button className="fee-link danger" onClick={() => remove(row.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
