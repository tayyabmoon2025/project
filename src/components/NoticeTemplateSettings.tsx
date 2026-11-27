import { useEffect, useMemo, useState } from 'react';
import { Bell, FileText, MessageSquare, Pencil, Plus, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { deleteNoticeTemplate, fetchNoticeTemplates, saveNoticeTemplate } from '@/lib/sentNotices';
import { AsyncSaveButton } from '@/components/SaveButton';
import { NOTICE_CATEGORIES, type NoticeCategory, type NoticeTemplate } from '@/lib/schoolTypes';

type Props = {
  onToast: (message: string) => void;
};

type Draft = {
  title: string;
  category: NoticeCategory;
  body_english: string;
  body_urdu: string;
  is_active: boolean;
};

const draftFrom = (template: NoticeTemplate): Draft => ({
  title: template.title,
  category: template.category,
  body_english: template.body_english,
  body_urdu: template.body_urdu,
  is_active: template.is_active,
});

const emptyDraft: Draft = { title: '', category: 'NOTICE', body_english: '', body_urdu: '', is_active: true };

// The library of saved messages. Every other screen pulls its wording from here, so this
// is the one place a school writes its notices, reminders and warnings.
export function NoticeTemplateSettings({ onToast }: Props) {
  const [templates, setTemplates] = useState<NoticeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<NoticeTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; template: NoticeTemplate | null; draft: Draft; saving: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await fetchNoticeTemplates();
    setTemplates(result.templates);
    setLoadError(result.error ?? '');
    setDrafts(Object.fromEntries(result.templates.map((template) => [template.id, draftFrom(template)])));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((template) => [template.title, template.category, template.notice_type, template.body_english, template.body_urdu].join(' ').toLowerCase().includes(needle));
  }, [templates, search]);

  const patchDraft = (id: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const isDirty = (template: NoticeTemplate) => {
    const draft = drafts[template.id];
    if (!draft) return false;
    const saved = draftFrom(template);
    return (Object.keys(saved) as (keyof Draft)[]).some((key) => saved[key] !== draft[key]);
  };

  const saveCard = async (template: NoticeTemplate): Promise<boolean | void> => {
    const draft = drafts[template.id];
    if (!draft) return false;
    if (!draft.title.trim()) { onToast('Give the template a title first.'); return false; }
    if (!draft.body_english.trim() && !draft.body_urdu.trim()) { onToast('Write the message in English, Urdu, or both.'); return false; }
    setSavingId(template.id);
    const result = await saveNoticeTemplate({
      id: template.id,
      title: draft.title,
      category: draft.category,
      noticeType: template.notice_type,
      bodyEnglish: draft.body_english,
      bodyUrdu: draft.body_urdu,
      isActive: draft.is_active,
    });
    setSavingId('');
    if (result.error) { onToast(result.error); return false; }
    onToast(`${draft.title.trim()} saved`);
    await load();
    return true;
  };

  const openNew = () => setEditor({ open: true, template: null, draft: emptyDraft, saving: false });
  const openEdit = (template: NoticeTemplate) => setEditor({ open: true, template, draft: drafts[template.id] ?? draftFrom(template), saving: false });

  const saveEditor = async (): Promise<boolean | void> => {
    if (!editor) return false;
    const draft = editor.draft;
    if (!draft.title.trim()) { onToast('Give the template a title first.'); return false; }
    if (!draft.body_english.trim() && !draft.body_urdu.trim()) { onToast('Write the message in English, Urdu, or both.'); return false; }
    setEditor({ ...editor, saving: true });
    const result = await saveNoticeTemplate({
      id: editor.template?.id ?? null,
      title: draft.title,
      category: draft.category,
      noticeType: editor.template?.notice_type ?? '',
      bodyEnglish: draft.body_english,
      bodyUrdu: draft.body_urdu,
      isActive: draft.is_active,
    });
    if (result.error) { setEditor({ ...editor, saving: false }); onToast(result.error); return false; }
    onToast(editor.template ? `${draft.title.trim()} saved` : `${draft.title.trim()} added`);
    setEditor(null);
    await load();
    return true;
  };

  const removeTemplate = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const error = await deleteNoticeTemplate(confirmDelete.id);
    setDeleting(false);
    if (error) { onToast(error); return; }
    onToast(`${confirmDelete.title} deleted`);
    setConfirmDelete(null);
    await load();
  };

  return (
    <div className="template-settings">
      <div className="settings-intro panel">
        <div className="settings-intro-icon"><MessageSquare size={23} /></div>
        <div>
          <span className="eyebrow">Notice settings</span>
          <h2>Message &amp; Notice Templates</h2>
          <p>Write your notices, reminders and warnings once. Every screen that sends a student notice fills these in automatically.</p>
        </div>
        <button className="primary-button" onClick={openNew}><Plus size={17} /> Add New Template</button>
      </div>

      <div className="placeholder-note">
        <FileText size={16} />
        <span>Placeholders are filled with the student's own details: {['student_name', 'father_name', 'class_name', 'roll_no', 'due_amount', 'date', 'school_name'].map((key) => <code key={key}>{`{{${key}}}`}</code>)}</span>
      </div>

      <div className="template-toolbar">
        <div className="template-toolbar-left">
          <label className="template-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates by title, category or wording…" /></label>
          <span className="template-count">{loading ? 'Loading…' : `${filtered.length} of ${templates.length} templates`}</span>
        </div>
      </div>

      {loadError ? <div className="send-notice-error"><ShieldAlert size={16} /> {loadError}</div> : null}

      {loading ? (
        <p className="fee-empty">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <div className="panel empty-state large">{templates.length === 0 ? 'No templates yet. Add your first one to get started.' : 'No template matches that search.'}</div>
      ) : (
        <div className="template-card-grid">
          {filtered.map((template) => {
            const draft = drafts[template.id] ?? draftFrom(template);
            const dirty = isDirty(template);
            return (
              <section className={`panel template-card${draft.is_active ? '' : ' inactive'}`} key={template.id}>
                <div className="template-card-heading">
                  <div>
                    <span className={`template-badge ${template.category.toLowerCase()}`}><Bell size={11} /> {template.category}</span>
                    <h2>{draft.title || 'Untitled template'}</h2>
                    <p>Saved as <code>{template.notice_type}</code> · used by {template.category === 'FEE' ? 'Fee Management and fee follow-up' : template.category === 'WARNING' ? 'warning notices' : template.category === 'ATTENDANCE' ? 'daily attendance' : 'general notices'}</p>
                  </div>
                  <div className="template-card-actions">
                    <button type="button" className="secondary-button" onClick={() => openEdit(template)}><Pencil size={14} /> Edit</button>
                    <button type="button" className="secondary-button danger" onClick={() => setConfirmDelete(template)}><Trash2 size={14} /> Delete</button>
                  </div>
                </div>

                <div className="template-language-grid">
                  <label>
                    <span>English text <small>the wording the parent reads on WhatsApp and on the slip</small></span>
                    <textarea value={draft.body_english} onChange={(event) => patchDraft(template.id, { body_english: event.target.value })} placeholder="Dear Parent, the fee account for {{student_name}} of {{class_name}} has an outstanding balance of {{due_amount}}." rows={5} />
                  </label>
                  <label>
                    <span>Urdu text <small dir="rtl">{"اردو متن — {{student_name}} جیسے خانے خود بھر جاتے ہیں"}</small></span>
                    <textarea className="urdu-box" dir="rtl" value={draft.body_urdu} onChange={(event) => patchDraft(template.id, { body_urdu: event.target.value })} placeholder="محترم والدین، {{student_name}} کی فیس {{due_amount}} باقی ہے۔" rows={5} />
                  </label>
                </div>

                <div className="template-card-foot">
                  <small className="template-updated">
                    {template.updated_at ? `Last saved ${new Date(template.updated_at).toLocaleDateString()}` : 'New template'}
                  </small>
                  <div className="template-card-actions">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                      <input type="checkbox" checked={draft.is_active} onChange={(event) => patchDraft(template.id, { is_active: event.target.checked })} className="h-4 w-4 accent-sky-600" />
                      Offered when sending a notice
                    </label>
                    <AsyncSaveButton
                      label={dirty ? 'Save changes' : 'Saved'}
                      size={14}
                      disabled={!dirty || savingId === template.id}
                      onSave={() => saveCard(template)}
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editor ? (
        <div className="notice-overlay" onClick={() => setEditor(null)}>
          <section className="notice-modal template-modal" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <div>
                <span className="eyebrow">{editor.template ? 'Edit template' : 'New template'}</span>
                <h2 className="send-notice-heading">{editor.template ? editor.template.title : 'Add a new template'}</h2>
                <small className="send-notice-sub">Give it a title and a category, then write it in English, Urdu, or both.</small>
              </div>
              <button className="close-button" onClick={() => setEditor(null)} aria-label="Close"><X size={18} /></button>
            </div>

            <div className="send-notice-controls">
              <label className="control-field" style={{ flex: '2 1 260px' }}><span>Title</span>
                <input value={editor.draft.title} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, title: event.target.value } })} placeholder="Fee clearance reminder" />
              </label>
              <label className="control-field"><span>Category tag</span>
                <select value={editor.draft.category} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, category: event.target.value as NoticeCategory } })}>
                  {NOTICE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            </div>

            <label className="control-field full"><span>English text</span>
              <textarea value={editor.draft.body_english} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, body_english: event.target.value } })} rows={6} placeholder="Dear Parent, the fee account for {{student_name}} of {{class_name}} has an outstanding balance of {{due_amount}}." />
            </label>

            <label className="control-field full"><span>Urdu text <small dir="rtl">اردو متن</small></span>
              <textarea className="urdu-box" dir="rtl" value={editor.draft.body_urdu} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, body_urdu: event.target.value } })} rows={6} placeholder="محترم والدین، {{student_name}} کی فیس {{due_amount}} باقی ہے۔" />
            </label>

            <div className="send-notice-placeholders">
              <FileText size={15} />
              <span>{['student_name', 'father_name', 'class_name', 'roll_no', 'due_amount', 'date', 'school_name'].map((key) => <code key={key}>{`{{${key}}}`}</code>)}</span>
            </div>

            <div className="template-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditor(null)}>Cancel</button>
              <AsyncSaveButton
                label={editor.template ? 'Save template' : 'Add template'}
                size={15}
                disabled={editor.saving}
                onSave={() => saveEditor()}
              />
            </div>
          </section>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="notice-overlay" onClick={() => setConfirmDelete(null)}>
          <section className="notice-preview" onClick={(event) => event.stopPropagation()}>
            <div className="notice-preview-top">
              <span className="eyebrow">Delete template</span>
              <button className="close-button" onClick={() => setConfirmDelete(null)} aria-label="Cancel"><X size={18} /></button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-800">Delete {confirmDelete.title}?</h2>
            <p className="mt-2 text-sm text-slate-600">Screens that offer this template will stop offering it. Notices already sent keep their own copy of the wording, so the sent history is not affected.</p>
            <div className="notice-preview-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="primary-button bg-rose-600 hover:bg-rose-700" onClick={() => void removeTemplate()} disabled={deleting}><Trash2 size={16} /> {deleting ? 'Deleting…' : 'Delete template'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
