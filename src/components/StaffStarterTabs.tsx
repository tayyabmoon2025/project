import { BookOpen } from 'lucide-react';
import { StaffTabIntro } from '@/components/StaffTabIntro';

// The staff tab whose feature is still to be built. It is a named, explained
// starter screen rather than a blank panel, so the tab bar is honest about what
// is coming and nothing here is a dead end.

export function ClassSubjectsTab() {
  return (
    <StaffTabIntro
      icon={<BookOpen size={26} />}
      eyebrow="Class & subjects"
      title="Who teaches what, and where"
      description="This tab will hold the class and subject side of staff management, so the timetable and the exam setup can both read it."
      points={[
        'The classes and sections each staff member is responsible for',
        'The subjects taught in every class and section',
        'Periods a week for each subject, ready to build the timetable from',
        'A quick list of staff members who still have no class assigned',
      ]}
      note="Nothing is recorded here yet. Tell me how your classes, sections and subjects are named and this tab can be built first."
    />
  );
}
