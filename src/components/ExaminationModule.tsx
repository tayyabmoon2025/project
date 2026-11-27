import { useState } from 'react';
import { Award, CalendarDays, ClipboardList, FileSpreadsheet, MessageSquareQuote, PencilRuler, SquarePen } from 'lucide-react';
import type { Student } from '@/lib/schoolTypes';
import { useAutoRollNumbers } from '@/lib/studentRoll';
import { ExamsSetupTab } from '@/components/ExamsSetupTab';
import { MarksEntryTab } from '@/components/MarksEntryTab';
import { ResultsTab } from '@/components/ResultsTab';
import { DateSheetTab } from '@/components/DateSheetTab';
import { RemarksConditionalTab } from '@/components/RemarksConditionalTab';
import { TestsBoardTab } from '@/components/TestsBoardTab';
import { ExamReportsTab } from '@/components/ExamReportsTab';

type ExamTab = 'setup' | 'marks' | 'results' | 'datesheet' | 'remarks' | 'tests' | 'reports';

const TABS: { id: ExamTab; label: string; hint: string; icon: typeof ClipboardList }[] = [
  { id: 'setup', label: 'Exams Setup', hint: 'Exams and their subjects', icon: PencilRuler },
  { id: 'marks', label: 'Marks Entry', hint: 'Enter marks class by class', icon: SquarePen },
  { id: 'results', label: 'Results / Report Cards', hint: 'Positions, grades and printing', icon: ClipboardList },
  { id: 'datesheet', label: 'Date Sheet', hint: 'Schedule & roll no. slips', icon: CalendarDays },
  { id: 'remarks', label: 'Remarks & Conditional Pass', hint: 'Grade remarks and principal decisions', icon: MessageSquareQuote },
  { id: 'tests', label: 'Tests & Board Results', hint: 'Class tests and official results', icon: Award },
  { id: 'reports', label: 'Exam Reports', hint: 'Broadsheets, award lists and merit', icon: FileSpreadsheet },
];

export function ExaminationModule({ students, onToast, onRefresh }: { students: Student[]; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<ExamTab>('setup');

  // Every class is numbered as soon as the module is opened, so roll numbers are
  // already on the sheets before the first marks are entered.
  useAutoRollNumbers('', students, onRefresh);

  return (
    <div className="admin-panel examination-module">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Examination</span>
          <h2>Examinations</h2>
          <p>Set up each examination, schedule its papers, enter the marks, then review results, decisions and print everything.</p>
        </div>
      </div>

      <div className="att-tabs" role="tablist">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`att-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={15} />
              <span className="att-tab-label">
                {item.label}
                <small>{item.hint}</small>
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'setup' && <ExamsSetupTab onToast={onToast} />}
      {tab === 'marks' && <MarksEntryTab students={students} onToast={onToast} onRefresh={onRefresh} />}
      {tab === 'results' && <ResultsTab students={students} onToast={onToast} />}
      {tab === 'datesheet' && <DateSheetTab students={students} onToast={onToast} />}
      {tab === 'remarks' && <RemarksConditionalTab students={students} onToast={onToast} />}
      {tab === 'tests' && <TestsBoardTab students={students} onToast={onToast} />}
      {tab === 'reports' && <ExamReportsTab students={students} onToast={onToast} />}
    </div>
  );
}
