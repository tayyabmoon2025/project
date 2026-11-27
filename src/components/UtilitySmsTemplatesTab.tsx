import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Save, Search, Send } from 'lucide-react';
import { fetchAllSmsTemplates, saveSmsTemplate, type SmsTemplate } from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';
import { SendStudentNoticeModal } from '@/components/SendStudentNoticeModal';
import type { Student } from '@/lib/schoolTypes';

type Props = {
  onToast: (message: string) => void;
  // The roster is only needed by the notice composer, which is opened from a student.
  students?: Student[];
  onOpenTemplates?: () => void;
};

// The wording itself is written in Settings → Message & Notice Templates. This tab
// reads the same saved messages, lets a line be corrected in place, and sends one
// student's notice with the full WhatsApp / slip / portal flow.
export function UtilitySmsTemplatesTab({ onToast, students = [], onOpenTemplates }: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'office_assistant';
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [studentTerm, setStudentTerm] = useState('');
  const [pickedStudent, setPickedStudent] = useState<Student | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await fetchAllSmsTemplates();
    setTemplates(result.templates);
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) => [t.title, t.category, t.notice_type, t.template_text, t.language].join(' ').toLowerCase().includes(q));
  }, [templates, search]);

  const studentResults = useMemo(() => {
    const needle = studentTerm.trim().toLowerCase();
    const pool = needle
      ? students.filter((student) => `${student.full_name} ${student.admission_number} ${student.fathers_name ?? ''} ${student.class_name} ${student.section_name}`.toLowerCase().includes(needle))
      : students.filter((student) => student.status === 'active');
    return pool.slice(0, 40);
  }, [students, studentTerm]);

  const startEdit = (template: SmsTemplate) => setEditing((prev) => ({ ...prev, [template.id]: template.template_text }));

  const save = async (template: SmsTemplate) => {
    const text = editing[template.id];
    if (text === undefined) return;
    const error = await saveSmsTemplate({ id: template.id, language: template.language, template_text: text });
    if (error) { onToast(error); return; }
    onToast(`${template.title} (${template.language}) saved`);
    setEditing((prev) => { const next = { ...prev }; delete next[template.id]; return next; });
    void load();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">SMS &amp; notices</span>
          <h2>Message &amp; Notice Templates</h2>
          <p className="fee-sub">Every saved notice, reminder and warning. Correct a line here, or send one to a student below.</p>
        </div>
        {onOpenTemplates ? <button className="secondary-button" onClick={onOpenTemplates}><ExternalLink size={15} /> Open in Settings</button> : null}
      </div>

      <div className="fee-card">
        <div className="fee-card-head">
          <div>
            <span className="eyebrow">Send a notice</span>
            <h2>Send Notice / Warning</h2>
            <p className="fee-sub">Pick a student, then send by WhatsApp, print the slip, or post it to the parent portal.</p>
          </div>
        </div>
        <div className="fee-filters">
          <label className="control-field"><span>Find a student</span>
            <input value={studentTerm} onChange={(e) => setStudentTerm(e.target.value)} placeholder="Name, admission number or father's name…" />
          </label>
        </div>
        {students.length === 0 ? (
          <p className="fee-empty">The student roster could not be read on this screen.</p>
        ) : (
          <div className="util-sms-list">
            {studentResults.map((student) => (
              <div key={student.id} className="util-sms-card">
                <div className="util-sms-head">
                  <div className="util-sms-title">
                    <strong>{student.full_name}</strong>
                    <span className="fee-status neutral">{student.admission_number}</span>
                  </div>
                  <button className="primary-button" onClick={() => { setPickedStudent(student); setNoticeOpen(true); }}><Send size={14} /> Send Notice / Warning</button>
                </div>
                <p className="util-sms-text">{[student.class_name, student.section_name].filter(Boolean).join(' · ')} · Father {student.fathers_name || student.guardian_name || '—'} · {student.guardian_phone || 'No contact number'}</p>
              </div>
            ))}
            {studentResults.length === 0 ? <p className="fee-empty">No student matches that search.</p> : null}
          </div>
        )}
      </div>

      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Saved wording</span>
          <h2>All templates</h2>
        </div>
        <span className="template-count">{loading ? 'Loading…' : `${filtered.length} of ${templates.length}`}</span>
      </div>

      <div className="fee-filters">
        <label className="control-field">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, category or wording…" />
        </label>
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      {loading ? (
        <p className="fee-empty">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No templates{search ? ' match your search' : ''}.</p>
      ) : (
        <div className="util-sms-list">
          {filtered.map((template) => {
            const isEditing = editing[template.id] !== undefined;
            const isUrdu = template.language === 'Urdu';
            return (
              <div key={template.id} className="util-sms-card">
                <div className="util-sms-head">
                  <div className="util-sms-title">
                    <strong>{template.title}</strong>
                    <span className={`template-badge ${template.category.toLowerCase()}`}>{template.category}</span>
                    <span className="fee-status neutral">{template.language}</span>
                  </div>
                  {canEdit && !isEditing && (
                    <button className="fee-link" onClick={() => startEdit(template)}>Edit</button>
                  )}
                </div>
                {isEditing ? (
                  <div className="util-sms-edit">
                    <textarea
                      className={isUrdu ? 'urdu-input' : undefined}
                      dir={isUrdu ? 'rtl' : 'ltr'}
                      value={editing[template.id]}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [template.id]: e.target.value }))}
                      rows={3}
                    />
                    <div className="fee-row-actions">
                      <button className="secondary-button" onClick={() => setEditing((prev) => { const next = { ...prev }; delete next[template.id]; return next; })}>Cancel</button>
                      <button className="primary-button" onClick={() => void save(template)}><Save size={14} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <p className={isUrdu ? 'util-sms-text urdu-text' : 'util-sms-text'} dir={isUrdu ? 'rtl' : 'ltr'}>{template.template_text || 'Not written yet in this language.'}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {noticeOpen && pickedStudent ? (
        <SendStudentNoticeModal
          student={pickedStudent}
          context="general"
          senderName={profile?.full_name ?? ''}
          onClose={() => { setNoticeOpen(false); setPickedStudent(null); }}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}
