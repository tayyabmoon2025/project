import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { FeeTransaction } from '@/lib/schoolTypes';

export function useFeeTransactions(studentId: string) {
  const [entries, setEntries] = useState<FeeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase
      .from('school_fee_transactions')
      .select('id, kind, amount, balance_after, created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        setLoading(false);
        if (queryError || !Array.isArray(data)) {
          setError('Fee history could not be loaded.');
          return;
        }
        setEntries(data as FeeTransaction[]);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  return { entries, loading, error };
}
