import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, Printer, Save, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/schoolTypes';
import { StudentPhoto } from '@/components/StudentPhoto';
import { ClassTeacherPicker } from '@/components/ClassTeacherPicker';
import { useClassOptions, useSectionOptions } from '@/lib/classSections';

type SectionKey = { class_name: string; section_name: string };
type SectionRecord = { id: string; class_name: string; section_name: string; class_teacher: string | null; capacity: number | null };

export function SectionManager({ students, onToast, onRefresh }: { students: Student[]; onToast: (message: string) => void; onRefresh: () => void }) {
  const classOptions = useClassOptions();
  const sectionOptions = useSectionOptions();
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [sectionList, setSectionList] = useState<SectionRecord[]>([]);
  const [teacherName, setTeacherName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [targetClass, setTargetClass] = useState('');
  const [targetSection, setTargetSection] = useState('');
  const [changeBusy, setChangeBusy] = useState(false);

  const loadSections = async () => {
    const { data } = await supabase.from('school_sections').select('id, class_name, section_name, class_teacher, capacity').order('class_name').order('section_name');
    if (data) setSectionList(data as SectionRecord[]);
  };

  useEffect(() => { void loadSections(); }, []);

  const distinctSections = useMemo(() => {
    const map = new Map<string, SectionKey>();
    for (const student of students) {
      const key = `${student.class_name}|||${student.section_name}`;
      if (!map.has(key)) map.set(key, { class_name: student.class_name, section_name: student.section_name });
    }
    return Array.from(map.values()).sort((a, b) => a.class_name.localeCompare(b.class_name) || a.section_name.localeCompare(b.section_name));
  }, [students]);

  const selectedClass = classFilter || distinctSections[0]?.class_name || '';
  const availableSections = useMemo(() => distinctSections.filter((s) => s.class_name === selectedClass).map((s) => s.section_name), [distinctSections, selectedClass]);

  const selectedKey: SectionKey | null = selectedClass && sectionFilter
    ? { class_name: selectedClass, section_name: sectionFilter }
    : selectedClass && availableSections[0]
      ? { class_name: selectedClass, section_name: availableSections[0] }
      : null;

  useEffect(() => {
    if (sectionFilter && !availableSections.includes(sectionFilter)) setSectionFilter(availableSections[0] ?? '');
  }, [availableSections, sectionFilter]);

  useEffect(() => {
    if (selectedKey) {
      const record = sectionList.find((r) => r.class_name === selectedKey.class_name && r.section_name === selectedKey.section_name);
      setTeacherName(record?.class_teacher ?? '');
      setCapacity(record?.capacity != null ? String(record.capacity) : '');
      setBulkIds([]);
    }
  }, [selectedKey?.class_name, selectedKey?.section_name, sectionList]);

  const sectionStudents = selectedKey
    ? students
      .filter((s) => s.class_name === selectedKey.class_name && s.section_name === selectedKey.section_name)
      .filter((s) => (teacherFilter ? (s.full_name ?? '').toLowerCase().includes(teacherFilter.toLowerCase()) || (s.fathers_name ?? '').toLowerCase().includes(teacherFilter.toLowerCase()) : true))
    : [];

  const toggleSelect = (id: string) => setBulkIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const selectAllVisible = (checked: boolean) => setBulkIds(checked ? sectionStudents.map((s) => s.id) : []);

  const saveSection = async () => {
    if (!selectedKey) { onToast('Select a section first'); return; }
    setBusy(true);
    const capacityValue = capacity.trim() === '' ? null : Number(capacity);
    if (capacityValue !== null && (!Number.isFinite(capacityValue) || capacityValue < 0)) {
      setBusy(false);
      onToast('Capacity must be a valid number');
      return;
    }
    const existing = sectionList.find((r) => r.class_name === selectedKey.class_name && r.section_name === selectedKey.section_name);
    const payload = { class_name: selectedKey.class_name, section_name: selectedKey.section_name, class_teacher: teacherName.trim() || null, capacity: capacityValue };
    const { error } = existing
      ? await supabase.from('school_sections').update(payload).eq('id', existing.id)
      : await supabase.from('school_sections').insert(payload);
    setBusy(false);
    if (error) { onToast('The section could not be saved. Please try again.'); return; }
    onToast(`${selectedKey.class_name} · Section ${selectedKey.section_name} saved`);
    await loadSections();
  };

  const applySectionChange = async () => {
    if (!window.confirm(`Move ${bulkIds.length} selected students to ${targetClass} · Section ${targetSection}?`)) return;
    setChangeBusy(true);
    const { error } = await supabase
      .from('school_students')
      .update({ class_name: targetClass, section_name: targetSection })
      .in('id', bulkIds);
    setChangeBusy(false);
    if (error) { onToast('The students could not be moved. Please try again.'); return; }
    onToast(`Moved ${bulkIds.length} students to ${targetClass} · Section ${targetSection}`);
    setBulkIds([]);
    setChangeOpen(false);
    setTargetClass('');
    setTargetSection('');
    onRefresh();
  };

  return (
    <div className="page module-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">School workspace</span>
          <h1>Search Section</h1>
          <p>Work on one section at a time — set its teacher and capacity, move students, or print the roster.</p>
        </div>
      </div>

      <div className="section-workspace section-workspace-single">
        <div className="panel section-editor">
          <div className="section-editor-heading">
            <div>
              <span className="eyebrow">Selected section</span>
              <h2>{selectedKey ? `${selectedKey.class_name} · Section ${selectedKey.section_name}` : 'No section available'}</h2>
            </div>
            <button type="button" className="close-button" onClick={() => window.print()} aria-label="Print section"><Printer size={18} /></button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <label className="control-field">Class
              <select value={selectedClass} onChange={(e) => { setClassFilter(e.target.value); setSectionFilter(''); }}>
                {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="control-field">Section
              <select value={sectionFilter || availableSections[0] || ''} onChange={(e) => setSectionFilter(e.target.value)} disabled={availableSections.length === 0}>
                {availableSections.length === 0 && <option value="">No section</option>}
                {availableSections.map((section) => <option key={section} value={section}>Section {section}</option>)}
              </select>
            </label>
            <div className="control-field"><span>Class Teacher</span>
              <ClassTeacherPicker value={teacherName} onChange={setTeacherName} />
            </div>
            <label className="control-field">Capacity
              <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 40" />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="primary-button" onClick={() => void saveSection()} disabled={busy || !selectedKey}><Save size={16} /> {busy ? 'Saving…' : 'Save'}</button>
            <button className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Print</button>
            <button className="secondary-button" onClick={() => setChangeOpen(true)} disabled={bulkIds.length === 0}><ArrowRightLeft size={16} /> Change Section ({bulkIds.length})</button>
          </div>
        </div>

        <div className="panel roster-panel section-students-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Users size={18} />
              <input value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)} placeholder="Filter by student or father name" />
            </div>
            <span className="result-count">{sectionStudents.length} students · {bulkIds.length} selected</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" className="h-4 w-4 accent-sky-600" checked={sectionStudents.length > 0 && bulkIds.length === sectionStudents.length} onChange={(e) => selectAllVisible(e.target.checked)} /></th>
                  <th>Photo</th>
                  <th>Admission No.</th>
                  <th>Student Name</th>
                  <th>Father Name</th>
                  <th>SMS Alert No.</th>
                  <th>Area</th>
                  <th>Class-Section</th>
                </tr>
              </thead>
              <tbody>
                {sectionStudents.map((student) => (
                  <tr key={student.id}>
                    <td><input type="checkbox" className="h-4 w-4 accent-sky-600" checked={bulkIds.includes(student.id)} onChange={() => toggleSelect(student.id)} /></td>
                    <td><StudentPhoto src={student.photo_url} name={student.full_name} className="h-9 w-9 rounded-lg" /></td>
                    <td className="muted-cell">{student.admission_number}</td>
                    <td><strong>{student.full_name}</strong></td>
                    <td>{student.fathers_name || '—'}</td>
                    <td>{student.messaging_number || student.guardian_phone}</td>
                    <td>{student.area || '—'}</td>
                    <td>{student.class_name} · {student.section_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sectionStudents.length === 0 && <div className="empty-state large">{selectedKey ? 'No students in this section yet.' : 'Select a class and section to see its students.'}</div>}
          </div>
        </div>
      </div>

      {changeOpen && (
        <div className="notice-overlay" onClick={() => setChangeOpen(false)}>
          <form className="notice-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void applySectionChange(); }}>
            <div className="notice-preview-top">
              <div>
                <span className="eyebrow">Bulk change section</span>
                <h2 className="mt-1 text-xl font-bold text-slate-800">Move {bulkIds.length} students</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setChangeOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="mt-3 text-sm text-slate-500">Choose the new class and section for the selected students. This updates their record immediately.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-5">
              <label className="control-field">New Class
                <select value={targetClass} onChange={(e) => setTargetClass(e.target.value)} required>
                  <option value="" disabled>Select class</option>
                  {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="control-field">New Section
                <select value={targetSection} onChange={(e) => setTargetSection(e.target.value)} required>
                  <option value="" disabled>Select section</option>
                  {sectionOptions.map((option) => <option key={option} value={option}>Section {option}</option>)}
                </select>
              </label>
            </div>
            <div className="notice-preview-actions">
              <button type="button" className="secondary-button" onClick={() => setChangeOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={changeBusy || !targetClass || !targetSection}><Check size={16} /> {changeBusy ? 'Moving…' : 'Move students'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
