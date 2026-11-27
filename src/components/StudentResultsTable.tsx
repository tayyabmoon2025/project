import type { Student } from '@/lib/schoolTypes';
import { Bell, Eye, KeyRound, MessageCircle, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { StudentPhoto } from '@/components/StudentPhoto';
import { DOCUMENT_GAP_LABELS, studentDocumentGaps, type DocumentGap } from '@/lib/documentGaps';

export type RowAction = 'fee' | 'view' | 'print' | 'delete' | 'add' | 'login' | 'notice';

const rowActions: { action: RowAction; label: string; icon: typeof Eye; tone: string }[] = [
  { action: 'fee', label: 'Fee', icon: Wallet, tone: 'text-sky-700 hover:bg-sky-50' },
  { action: 'notice', label: 'Notice', icon: Bell, tone: 'text-amber-700 hover:bg-amber-50' },
  { action: 'view', label: 'View', icon: Eye, tone: 'text-slate-700 hover:bg-slate-100' },
  { action: 'login', label: 'Login', icon: KeyRound, tone: 'text-teal-700 hover:bg-teal-50' },
  { action: 'print', label: 'Print', icon: Printer, tone: 'text-slate-700 hover:bg-slate-100' },
  { action: 'delete', label: 'Delete', icon: Trash2, tone: 'text-rose-600 hover:bg-rose-50' },
  { action: 'add', label: 'Add', icon: Plus, tone: 'text-emerald-700 hover:bg-emerald-50' },
];

export function StudentResultsTable({ students, onAction, onRemind }: {
  students: Student[];
  onAction: (action: RowAction, student: Student) => void;
  onRemind: (student: Student, gaps: DocumentGap[]) => void | Promise<void>;
}) {
  if (students.length === 0) {
    return <div className="empty-state large">No students match these filters. Try clearing one or two fields.</div>;
  }
  return (
    <div className="table-wrap">
      <table className="min-w-[1180px]">
        <tbody>
          {students.map((student) => {
            const gaps = studentDocumentGaps(student);
            return (
              <tr key={student.id} className="transition-colors hover:bg-sky-50/40">
                <td>
                  <StudentPhoto src={student.photo_url} name={student.full_name} className="student-photo-thumb h-10 w-10 rounded-lg" />
                </td>
                <td className="muted-cell">{student.admission_number}</td>
                <td className="muted-cell">{new Date(student.admission_date).toLocaleDateString()}</td>
                <td><strong>{student.full_name}</strong></td>
                <td>{student.fathers_name || student.guardian_name}</td>
                <td>{student.class_name} · {student.section_name}</td>
                <td className="muted-cell">{student.guardian_phone}</td>
                <td className={`text-right font-semibold tabular-nums ${Number(student.fee_balance) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>Rs {Number(student.fee_balance).toLocaleString()}</td>
                <td>
                  {gaps.length === 0 ? (
                    <span className="doc-status clear">Complete</span>
                  ) : (
                    <div className="doc-status-list">
                      {gaps.map((gap) => <span key={gap} className={`doc-status ${gap}`}>{DOCUMENT_GAP_LABELS[gap]}</span>)}
                      <button type="button" className="doc-remind" onClick={() => void onRemind(student, gaps)} title={`Send a WhatsApp reminder to ${student.full_name}`}>
                        <MessageCircle size={13} /> Send Reminder
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {rowActions.map(({ action, label, icon: Icon, tone }) => (
                      <button key={action} type="button" onClick={() => onAction(action, student)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${tone}`}>
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
