import { useEffect, useState } from 'react';
import { fetchGradeRemarks, type GradeRemark } from '@/lib/examExtras';

// One shared copy of the Grade Remarks Bank for the whole app.
//
// Report cards read the bank while they are open, and the Remarks & Conditional Pass
// screen writes to it. Keeping a single cached copy with a version counter means an
// edited remark reaches every open report card at once, without either screen knowing
// about the other.

let cache: GradeRemark[] = [];
let version = 0;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

const notify = () => { version += 1; listeners.forEach((listener) => listener()); };

const load = async (): Promise<void> => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { remarks } = await fetchGradeRemarks();
      cache = remarks;
    } catch {
      // A failed refresh keeps the previous wording rather than blanking the cards.
    } finally {
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
};

export function refreshGradeRemarks(): Promise<void> {
  return load();
}

export function useGradeRemarks(): { remarks: GradeRemark[]; version: number; reload: () => Promise<void> } {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((current) => current + 1);
    listeners.add(listener);
    if (version === 0) void load();
    return () => { listeners.delete(listener); };
  }, []);

  return { remarks: cache, version, reload: load };
}
