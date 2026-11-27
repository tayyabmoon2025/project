import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import {
  fetchClassUsage,
  fetchSectionUsage,
  useClassSections,
  type NameUsage,
} from '@/lib/classSections';

type Row = { key: string; value: string; original: string };

type Kind = 'class' | 'section';

const newKey = () => Math.random().toString(36).slice(2);

const toRows = (names: string[]): Row[] => names.map((name) => ({ key: newKey(), value: name, original: name }));

const usageText = (usage: NameUsage | undefined) => {
  const students = usage?.students ?? 0;
  const others = usage?.others ?? 0;
  if (!students && !others) return 'Not used yet';
  const parts: string[] = [];
  if (students) parts.push(`${students} student${students === 1 ? '' : 's'}`);
  if (others) parts.push(`${others} other record${others === 1 ? '' : 's'}`);
  return `Used by ${parts.join(' and ')}`;
};

export function ManageClassSectionsModal({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) {
  const {
    classes, sections, renameClass, renameSection, addClass, addSection,
    removeClass, removeSection, saveClassOrder, saveSectionOrder,
  } = useClassSections();
  const [tab, setTab] = useState<Kind>('class');
  const [classRows, setClassRows] = useState<Row[]>(() => toRows(classes));
  const [sectionRows, setSectionRows] = useState<Row[]>(() => toRows(sections));
  const [classUsage, setClassUsage] = useState<Map<string, NameUsage>>(new Map());
  const [sectionUsage, setSectionUsage] = useState<Map<string, NameUsage>>(new Map());
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const [byClass, bySection] = await Promise.all([fetchClassUsage(), fetchSectionUsage()]);
      setClassUsage(byClass);
      setSectionUsage(bySection);
    })();
  }, []);

  // The list on screen is re-synced whenever the provider's own list changes, so a
  // rename that has already been saved is never shown as an unsaved change. While a
  // save is running the rows are left alone, so a half-finished edit is not wiped.
  useEffect(() => { if (!saving) setClassRows(toRows(classes)); }, [classes, saving]);
  useEffect(() => { if (!saving) setSectionRows(toRows(sections)); }, [sections, saving]);

  const rows = tab === 'class' ? classRows : sectionRows;
  const setRows = tab === 'class' ? setClassRows : setSectionRows;
  const usage = tab === 'class' ? classUsage : sectionUsage;
  const label = tab === 'class' ? 'class' : 'section';

  const dirty = useMemo(() => rows.some((row) => row.value.trim() !== row.original), [rows]);

  const updateRow = (key: string, value: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, value } : row)));

  const move = (index: number, direction: -1 | 1) => {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const dropRow = async (row: Row) => {
    const name = row.value.trim();
    if (row.original === '') {
      setRows((current) => current.filter((item) => item.key !== row.key));
      return;
    }
    if (rows.length <= 1) { setError(`At least one ${label} has to stay in the list.`); return; }
    const used = usage.get(name);
    if (used && (used.students > 0 || used.others > 0)) {
      setError(`${name} cannot be removed because it is still used by ${usageText(used).replace('Used by ', '')}. Rename it instead, or move those records first.`);
      return;
    }
    if (!window.confirm(`Remove ${name} from the list?`)) return;
    const message = tab === 'class' ? await removeClass(name) : await removeSection(name);
    if (message) { setError(message); return; }
    setError('');
    onToast(`${name} removed from the list.`);
  };

  const save = async (): Promise<boolean | void> => {
    setError('');
    const trimmed = rows.map((row) => row.value.trim());
    if (trimmed.some((name) => !name)) { setError(`Every ${label} needs a name.`); return false; }
    const seen = new Set<string>();
    for (const name of trimmed) {
      const key = name.toLowerCase();
      if (seen.has(key)) { setError(`"${name}" is listed twice. Please give each ${label} its own name.`); return false; }
      seen.add(key);
    }

    setSaving(true);
    let renamed = 0;
    let moved = 0;
    try {
      for (const row of rows) {
        const name = row.value.trim();
        if (row.original === '') {
          const message = tab === 'class' ? await addClass(name) : await addSection(name);
          if (message) { setError(message); return false; }
          continue;
        }
        if (name === row.original) continue;
        const result = tab === 'class' ? await renameClass(row.original, name) : await renameSection(row.original, name);
        if (result.error) { setError(result.error); return false; }
        renamed += 1;
        moved += result.students + result.others;
      }
      const orderMessage = tab === 'class' ? await saveClassOrder(trimmed) : await saveSectionOrder(trimmed);
      if (orderMessage) { setError(orderMessage); return false; }

      onToast(
        renamed
          ? `${renamed} ${label}${renamed === 1 ? '' : 's'} renamed, and ${moved} record${moved === 1 ? '' : 's'} updated across the school.`
          : `The ${label} list is saved.`,
      );
      setNewName('');
      onClose();
      return true;
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    const name = newName.trim();
    if (!name) { setError(`Type a name for the new ${label} first.`); return; }
    if (rows.some((row) => row.value.trim().toLowerCase() === name.toLowerCase())) { setError(`"${name}" is already in the list.`); return; }
    setRows((current) => [...current, { key: newKey(), value: name, original: '' }]);
    setNewName('');
    setError('');
  };

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal manage-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <div>
            <span className="eyebrow"><Pencil size={14} /> Classes &amp; Sections</span>
            <h2>Manage the school&apos;s own names</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <p className="manage-intro">
          Rename a class or section to whatever the school calls it, add your own, or remove one you do not use.
          A rename is applied to every record in the school at once, so nothing is left under the old name.
        </p>

        <div className="manage-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'class'} className={tab === 'class' ? 'active' : ''} onClick={() => { setTab('class'); setError(''); setNewName(''); }}>
            <Layers size={15} /> Classes <span className="manage-tab-count">{classRows.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'section'} className={tab === 'section' ? 'active' : ''} onClick={() => { setTab('section'); setError(''); setNewName(''); }}>
            <Layers size={15} /> Sections <span className="manage-tab-count">{sectionRows.length}</span>
          </button>
        </div>

        <div className="manage-list">
          {rows.map((row, index) => {
            const changed = row.value.trim() !== row.original;
            const used = usage.get(row.original);
            const blocked = Boolean(used && (used.students > 0 || used.others > 0));
            return (
              <div className={`manage-row${changed ? ' changed' : ''}`} key={row.key}>
                <span className="manage-order">{index + 1}</span>
                <div className="manage-row-main">
                  <input
                    value={row.value}
                    onChange={(event) => updateRow(row.key, event.target.value)}
                    placeholder={`${label} name`}
                    aria-label={`${label} name`}
                  />
                  <small className="manage-usage">
                    {row.original === '' ? 'New — saved when you press Save' : usageText(used)}
                  </small>
                </div>
                <div className="manage-row-actions">
                  <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={15} /></button>
                  <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label="Move down"><ArrowDown size={15} /></button>
                  <button
                    type="button"
                    className={`icon-button${blocked ? '' : ' danger'}`}
                    onClick={() => void dropRow(row)}
                    title={blocked ? 'Still in use — rename it instead' : `Remove this ${label}`}
                    aria-label={`Remove this ${label}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="manage-add">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={tab === 'class' ? 'New class name, for example Prep' : 'New section name, for example Blue'}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRow(); } }}
          />
          <button type="button" className="secondary-button" onClick={addRow}><Plus size={15} /> Add {label}</button>
        </div>

        {error && <div className="auth-error"><AlertTriangle size={15} /><span>{error}</span></div>}

        <div className="notice-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <AsyncSaveButton
            label={dirty ? 'Save changes' : 'Save'}
            size={15}
            disabled={saving}
            onSave={() => save()}
          />
        </div>
      </section>
    </div>
  );
}
