import type { Student } from '@/lib/schoolTypes';

export type CollectStatusFilter = 'active' | 'inactive' | 'all';
export type CollectClassFilter = 'all' | 'class' | 'classSection';
export type CollectCriteria = 'name' | 'father' | 'mobile';

export type CollectSearchState = {
  status: CollectStatusFilter;
  classMode: CollectClassFilter;
  className: string;
  sectionName: string;
  criteria: CollectCriteria;
  term: string;
};

export const COLLECT_STATUS_OPTIONS: { value: CollectStatusFilter; label: string; hint: string }[] = [
  { value: 'active', label: 'Active', hint: 'Students enrolled in the current session' },
  { value: 'inactive', label: 'Inactive', hint: 'Students who left, withdrew or passed out' },
  { value: 'all', label: 'All', hint: 'Active and inactive records together' },
];

export const COLLECT_CLASS_OPTIONS: { value: CollectClassFilter; label: string }[] = [
  { value: 'all', label: 'Search All' },
  { value: 'class', label: 'Search By Class' },
  { value: 'classSection', label: 'Search By Class-Section' },
];

export const COLLECT_CRITERIA_OPTIONS: { value: CollectCriteria; label: string; placeholder: string }[] = [
  { value: 'name', label: 'Search By Student Name', placeholder: 'Type a student name' },
  { value: 'father', label: 'Search By Father Name', placeholder: 'Type a father or guardian name' },
  { value: 'mobile', label: 'Search By Father Mobile No', placeholder: 'Type a mobile number, e.g. 0300 1234567' },
];

// A student counts as inactive once they have left the roll: withdrawn, or promoted out
// of the current session. Anything still on the active roll is Active.
export const isActiveStudent = (student: Student) => student.status === 'active';

export const studentStatusLabel = (student: Student) => (isActiveStudent(student) ? 'Active' : 'Inactive');

const phoneFieldsOf = (student: Student) => [
  student.whatsapp_number, student.messaging_number, student.father_contact_number,
  student.guardian_phone, student.mother_number,
].map((value) => (value ?? '').replace(/\D/g, '')).filter(Boolean);

// The whole search as one pure step, so the rules are readable in one place: the status
// narrows the roll, the class filter narrows the class, then the chosen criteria matches
// the typed text. Sorted by the number inside the admission number, the way the office
// thinks about the roll.
export function filterCollectStudents(roster: Student[], state: CollectSearchState): Student[] {
  const needle = state.term.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  return roster
    .filter((student) => {
      if (state.status === 'active') return isActiveStudent(student);
      if (state.status === 'inactive') return !isActiveStudent(student);
      return true;
    })
    .filter((student) => {
      if (state.classMode === 'all') return true;
      if (!state.className || student.class_name !== state.className) return false;
      if (state.classMode === 'classSection' && state.sectionName) return student.section_name === state.sectionName;
      return true;
    })
    .filter((student) => {
      if (!needle) return true;
      if (state.criteria === 'name') return student.full_name.toLowerCase().includes(needle);
      if (state.criteria === 'father') return [student.fathers_name, student.guardian_name].some((value) => (value ?? '').toLowerCase().includes(needle));
      if (!digits) return false;
      return phoneFieldsOf(student).some((value) => value.includes(digits));
    })
    .sort((a, b) => (Number(a.admission_number.match(/(\d+)$/)?.[1] ?? 0) - Number(b.admission_number.match(/(\d+)$/)?.[1] ?? 0)));
}
