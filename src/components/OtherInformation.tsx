import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { InformationRecord } from '@/lib/schoolTypes';
import { InformationRecords, type InformationDraft } from '@/components/InformationRecords';

const recordColumns = 'id, information_type, notes, updated_at';

export function OtherInformation({ onToast }: { onToast: (message: string) => void }) {
  const [records, setRecords] = useState<InformationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [options, setOptions] = useState<string[]>([]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('school_other_information').select(recordColumns).is('student_id', null).order('updated_at', { ascending: false });
    setLoading(false);
    if (error || !data) { setLoadError(true); return; }
    setLoadError(false);
    setRecords(data as InformationRecord[]);
  }, []);

  const loadOptions = useCallback(async () => {
    const { data, error } = await supabase.from('school_admission_options').select('label').eq('category', 'information_type').order('label');
    if (error || !data) { onToast('Information types could not be loaded'); return; }
    setOptions((data as { label: string }[]).map((row) => row.label));
  }, [onToast]);

  useEffect(() => {
    void loadRecords();
    void loadOptions();
  }, [loadRecords, loadOptions]);

  const saveRecord = async (draft: InformationDraft) => {
    const payload = { information_type: draft.information_type, notes: draft.notes, updated_at: new Date().toISOString() };
    const request = draft.id
      ? supabase.from('school_other_information').update(payload).eq('id', draft.id).select(recordColumns).maybeSingle()
      : supabase.from('school_other_information').insert(payload).select(recordColumns).maybeSingle();
    const { data, error } = await request;
    if (error || !data) { onToast('The information could not be saved. Please try again.'); return false; }
    const saved = data as InformationRecord;
    setRecords((current) => draft.id ? current.map((record) => (record.id === saved.id ? saved : record)) : [saved, ...current]);
    onToast('Information saved');
    return true;
  };

  const deleteRecord = async (id: string) => {
    const { error } = await supabase.from('school_other_information').delete().eq('id', id);
    if (error) { onToast('The information could not be deleted. Please try again.'); return false; }
    setRecords((current) => current.filter((record) => record.id !== id));
    onToast('Information deleted');
    return true;
  };

  return (
    <div className="other-information">
      <InformationRecords
        records={records}
        loading={loading}
        loadError={loadError}
        options={options}
        onOptionsChanged={loadOptions}
        onToast={onToast}
        onSave={saveRecord}
        onDelete={deleteRecord}
      />
    </div>
  );
}
