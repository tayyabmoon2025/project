import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import type { AdmissionFormState } from '@/lib/schoolTypes';
import {
  applyClassTuitionFee, concessionAmountFor, concessionPercentageFor, netTuitionAfterDiscounts, siblingDiscountAmountFor,
  tuitionFeeForClass, type FeeStructureRow,
} from '@/lib/admissionFees';
import { fetchFeeStructures } from '@/lib/fees';
import type { SiblingContext } from '@/lib/feeDiscountRules';
import type { FamilyLedger } from '@/lib/familyLedger';
import type { FamilyStatementInfo } from '@/lib/familyStatement';
import { FamilyLedgerPanel } from '@/components/FamilyLedgerPanel';
import { DropdownWithAdd } from '@/components/DropdownWithAdd';
import { CONCESSION_CATEGORY_OPTIONS, concessionCategoryLabel, concessionCategoryTheme, concessionNeedsApproval } from '@/lib/concessionCategories';
import { Percent, ShieldCheck, Clock, Circle as XCircle, KeyRound, Copy } from 'lucide-react';
import { maskCnic } from '@/lib/formatters';

type TextField = 'current_address' | 'permanent_address' | 'father_contact_number' | 'messaging_number' | 'whatsapp_number' | 'guardian_relationship' | 'guardian_cnic';

const textareaClass = 'mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100';

const formatRupees = (value: number) => `Rs ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function AdmissionOtherInfoFields({ form, update, patch, dropdownOptions, onOptionsChanged, onToast, siblingContext = null, familyLedger = null, familyStatementInfo = null, onResetParentPassword }: {
  form: AdmissionFormState;
  update: (key: keyof AdmissionFormState, value: string) => void;
  patch: (changes: Partial<AdmissionFormState>) => void;
  dropdownOptions: Record<string, string[]>;
  onOptionsChanged: () => void;
  onToast: (message: string) => void;
  siblingContext?: SiblingContext | null;
  familyLedger?: FamilyLedger | null;
  familyStatementInfo?: FamilyStatementInfo | null;
  // Only supplied while an existing student is being edited, and only for administrators,
  // who are the only accounts allowed to change a portal password.
  onResetParentPassword?: () => void;
}) {
  const text = (key: TextField, label: string) => (
    <label key={key}>{label}<input value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>
  );

  const [structures, setStructures] = useState<FeeStructureRow[]>([]);
  const [structuresLoading, setStructuresLoading] = useState(true);
  const [structuresError, setStructuresError] = useState('');
  const lastClassRef = useRef(form.class_name);

  const loadStructures = async () => {
    setStructuresLoading(true);
    const result = await fetchFeeStructures();
    setStructuresLoading(false);
    setStructuresError(result.error ?? '');
    setStructures(result.structures);
  };

  useEffect(() => { void loadStructures(); }, []);

  // The class rate is applied when the class changes, and once when the structure
  // first arrives for a student who has no tuition fee saved yet. Manual edits after
  // that are kept as typed.
  useEffect(() => {
    const classChanged = lastClassRef.current !== form.class_name;
    lastClassRef.current = form.class_name;
    if (structures.length === 0) return;
    if (!classChanged && form.tuition_fee.trim() !== '') return;
    const patchValues = applyClassTuitionFee(form, structures);
    if (Object.keys(patchValues).length > 0) patch(patchValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.class_name, structures]);

  // The sibling discount is applied by the admission form itself as soon as the family
  // details change, so the banner here only reads the figure that has already been set.
  const siblingPercentage = siblingContext && siblingContext.discountPercentage > 0 ? String(siblingContext.discountPercentage) : '';

  const classRate = tuitionFeeForClass(structures, form.class_name);
  const concessionValue = Number(form.fee_concession_amount) || 0;
  const concessionPercentValue = Number(form.fee_concession_percentage) || 0;
  const siblingPercentValue = Number(siblingPercentage) || 0;
  const siblingValue = siblingDiscountAmountFor(form.tuition_fee, siblingPercentage);
  const net = netTuitionAfterDiscounts(form.tuition_fee, form.fee_concession_amount, siblingPercentage);
  const tuitionValue = Number(form.tuition_fee) || 0;
  const overConcession = form.tuition_fee.trim() !== '' && concessionValue > tuitionValue;
  const familyDetected = Boolean(siblingContext && siblingContext.siblingOrder > 1);

  // Every change to the tuition fee or the concession also refreshes the net tuition fee,
  // always using the sibling percentage the family rules decided.
  const withTotals = (changes: Partial<AdmissionFormState>): Partial<AdmissionFormState> => {
    const tuition = changes.tuition_fee ?? form.tuition_fee;
    const concession = changes.fee_concession_amount ?? form.fee_concession_amount;
    const net = netTuitionAfterDiscounts(tuition, concession, siblingPercentage);
    return { ...changes, net_tuition_fee: net === null ? '' : String(net) };
  };

  // Editing the tuition fee re-applies the recorded concession to it, keeping whichever
  // of the two concession fields the office typed in as the source of truth.
  const changeTuition = (value: string) => {
    const tuition = Number(value) || 0;
    const enteredAmount = Number(form.fee_concession_amount) || 0;
    const hasPercent = form.fee_concession_percentage.trim() !== '';
    const hasAmount = form.fee_concession_amount.trim() !== '';

    if (hasPercent) {
      patch(withTotals({ tuition_fee: value, fee_concession_amount: concessionAmountFor(value, form.fee_concession_percentage) }));
      return;
    }
    if (hasAmount) {
      const clamped = Math.min(Math.max(enteredAmount, 0), Math.max(tuition, 0));
      patch(withTotals({
        tuition_fee: value,
        fee_concession_amount: String(clamped),
        fee_concession_percentage: concessionPercentageFor(value, String(clamped)),
      }));
      return;
    }
    patch(withTotals({ tuition_fee: value }));
  };

  const changePercentage = (value: string) => {
    patch(withTotals({
      fee_concession_percentage: value,
      fee_concession_amount: concessionAmountFor(form.tuition_fee, value),
    }));
  };

  const changeAmount = (value: string) => {
    patch(withTotals({
      fee_concession_amount: value,
      fee_concession_percentage: concessionPercentageFor(form.tuition_fee, value),
    }));
  };

  return (
    <div className="form-grid admission-info-grid">
      <div className="form-section-title">Addresses</div>
      <label className="col-span-full">Current Address
        <textarea rows={3} value={form.current_address} onChange={(event) => update('current_address', event.target.value)} className={textareaClass} />
      </label>
      <div className="col-span-full">
        <div className="addr-label-row"><label>Permanent Address</label><button type="button" className="get-pill" onClick={() => {
          if (!form.current_address.trim()) { onToast('Type the current address first'); return; }
          patch({ permanent_address: form.current_address });
          onToast('Permanent address copied from current address');
        }}><Copy size={13} /> Same as Current Address</button></div>
        <textarea rows={3} value={form.permanent_address} onChange={(event) => update('permanent_address', event.target.value)} className={textareaClass} />
      </div>

      <div className="form-section-title">Parent and messaging contacts</div>
      {text('father_contact_number', 'Father Contact No.')}
      {text('messaging_number', 'Messaging Number')}
      <div className="parent-login-field">
        <label>WhatsApp Number<input value={form.whatsapp_number} onChange={(event) => update('whatsapp_number', event.target.value)} /></label>
        {onResetParentPassword && (
          <button type="button" className="secondary-button parent-login-button" onClick={onResetParentPassword}>
            <KeyRound size={14} /> Reset Parent Password
          </button>
        )}
      </div>

      <div className="form-section-title">Parent profile</div>
      <DropdownWithAdd category="father_profession" label="Father’s Profession" value={form.father_profession} options={dropdownOptions.father_profession} onChange={(value) => update('father_profession', value)} onOptionsChanged={onOptionsChanged} onToast={onToast} />
      <label>Blood Group<select value={form.blood_group} onChange={(event) => update('blood_group', event.target.value)}><option value="">Select</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option></select></label>
      <DropdownWithAdd category="mother_tongue" label="Mother Tongue" value={form.mother_tongue} options={dropdownOptions.mother_tongue} onChange={(value) => update('mother_tongue', value)} onOptionsChanged={onOptionsChanged} onToast={onToast} />

      <div className="form-section-title">Guardian details</div>
      {text('guardian_relationship', 'Relationship to Student')}
      <label>Guardian CNIC<input inputMode="numeric" value={form.guardian_cnic} onChange={(event) => update('guardian_cnic', maskCnic(event.target.value))} placeholder="35202-1234567-1" /></label>

      <div className="form-section-title">Fees and concessions</div>
      <label>Monthly Tuition Fee (Rs)
        <input type="number" min="0" step="0.01" value={form.tuition_fee} onChange={(event) => changeTuition(event.target.value)} />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          {structuresLoading
            ? 'Checking the fee structure for this class…'
            : classRate === null
              ? `No tuition fee is set for ${form.class_name || 'this class'} in the Fee Structure. You can type one in.`
              : `Filled from ${form.class_name} in the Fee Structure (${formatRupees(classRate)}). You can change it.`}
        </span>
        {structuresError && (
          <button type="button" className="secondary-button mt-2" onClick={() => void loadStructures()}>
            <RefreshCw size={14} /> Retry
          </button>
        )}
      </label>
      <label className="col-span-full">Concession category
        <select value={form.fee_concession_category} onChange={(event) => {
          const category = event.target.value;
          const needsApproval = concessionNeedsApproval(category);
          const previousNeededApproval = concessionNeedsApproval(form.fee_concession_category);
          // Moving between two approval-required categories keeps an existing decision;
          // moving to or away from a non-approval category clears it.
          const nextStatus = needsApproval
            ? (previousNeededApproval && form.concession_approval_status ? form.concession_approval_status : 'pending')
            : '';
          update('fee_concession_category', category);
          patch({ concession_approval_status: nextStatus as AdmissionFormState['concession_approval_status'] });
        }}>
          <option value="">No category — a plain concession</option>
          {CONCESSION_CATEGORY_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">
          {concessionValue > 0
            ? `This reduction will be listed as ${form.fee_concession_category ? concessionCategoryLabel(form.fee_concession_category) : 'a standing concession'} in Fee Concessions & Discounts.`
            : 'Names this student\u2019s standing reduction so it is reported under the right category. A brother or sister discount is not chosen here \u2014 it follows the Fee Structure rules.'}
        </span>
      </label>

      {(() => {
        const theme = concessionCategoryTheme(form.fee_concession_category);
        const categoryName = form.fee_concession_category ? concessionCategoryLabel(form.fee_concession_category) : 'Plain concession';
        const needsApproval = concessionNeedsApproval(form.fee_concession_category);
        const approvalStatus = form.concession_approval_status;
        return (
          <div className={`col-span-full rounded-xl border ${theme.border} ${theme.bg} p-4`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Percent size={16} className={theme.icon} />
                <strong className={`text-sm ${theme.title}`}>{categoryName}</strong>
              </div>
              {concessionValue > 0 && (
                <strong className={`text-sm tabular-nums ${theme.title}`}>
                  {formatRupees(concessionValue)}{concessionPercentValue > 0 ? ` (${concessionPercentValue}%)` : ''}
                </strong>
              )}
            </div>
            {needsApproval && (
              <div className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                approvalStatus === 'approved'
                  ? 'border-emerald-300 bg-emerald-100/80 text-emerald-800'
                  : approvalStatus === 'rejected'
                    ? 'border-rose-300 bg-rose-100/80 text-rose-800'
                    : 'border-amber-300 bg-amber-100/80 text-amber-800'
              }`}>
                {approvalStatus === 'approved' ? (
                  <><ShieldCheck size={14} /> Approved by the principal — this concession is active.</>
                ) : approvalStatus === 'rejected' ? (
                  <><XCircle size={14} /> The principal declined this concession{form.concession_rejection_reason ? `: ${form.concession_rejection_reason}` : ''}. Edit the category or concession before saving.</>
                ) : (
                  <><Clock size={14} /> This category needs the principal&rsquo;s sign-off. It will be saved as pending approval.</>
                )}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label>Concession (%)
                <input type="number" min="0" max="100" step="0.01" value={form.fee_concession_percentage} onChange={(event) => changePercentage(event.target.value)} />
              </label>
              <label>Concession (Rs)
                <input type="number" min="0" step="0.01" value={form.fee_concession_amount} onChange={(event) => changeAmount(event.target.value)} />
              </label>
            </div>
            <p className={`mt-2 text-xs ${theme.sub}`}>
              Type in either field — the other one is worked out for you. The concession applies to the tuition fee only and is taken off before the sibling discount.
            </p>
            {overConcession && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                The concession is more than the tuition fee, so the net tuition fee is shown as Rs 0.
              </p>
            )}
          </div>
        );
      })()}

      <div className="col-span-full flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
        <Users size={18} className="mt-0.5 shrink-0 text-emerald-700" />
        <div className="flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <strong className="block text-sm text-emerald-900">Sibling discount</strong>
            <strong className="text-sm tabular-nums text-emerald-900">{siblingValue > 0 ? formatRupees(siblingValue) : 'None'}</strong>
          </div>
          {familyDetected ? (
            <span className="mt-0.5 block text-xs text-emerald-800">
              {siblingContext?.matchedReason ? `Family found (${siblingContext.matchedReason}). ` : 'Family found. '}
              {`This is child ${siblingContext?.siblingOrder} of ${siblingContext?.groupSize}`}
              {siblingContext?.ruleLabel ? ` — ${siblingContext.ruleLabel}` : ''}
              {siblingPercentValue > 0 ? `, so ${siblingPercentValue}% is taken off the tuition fee.` : ', which carries no sibling discount.'}
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-emerald-800">
              No brothers or sisters are on the roll yet for this family. The discount is applied automatically once a match is found on guardian phone, CNIC, or father / guardian name.
            </span>
          )}
          <span className="mt-1.5 block text-xs text-emerald-700/80">
            Set from Fee Structure → Brothers and sisters. It follows the family, so it is not typed in here.
          </span>
        </div>
      </div>

      <div className="col-span-full grid grid-cols-1 gap-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4 sm:grid-cols-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tuition fee</span>
          <strong className="mt-1 block text-base text-slate-800">{form.tuition_fee ? formatRupees(tuitionValue) : '—'}</strong>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Concession{concessionValue > 0 && concessionPercentValue > 0 ? ` (${concessionPercentValue}%)` : ''}
          </span>
          <strong className={`mt-1 block text-base ${concessionValue > 0 && form.concession_approval_status === 'pending' ? 'text-amber-600' : 'text-slate-800'}`}>
            {concessionValue > 0 ? formatRupees(concessionValue) : 'None'}
          </strong>
          {concessionValue > 0 && form.concession_approval_status === 'pending' && (
            <span className="mt-0.5 block text-xs font-medium text-amber-600">Pending approval — not applied to billing yet</span>
          )}
          {concessionValue > 0 && form.concession_approval_status === 'rejected' && (
            <span className="mt-0.5 block text-xs font-medium text-rose-600">Rejected — not applied to billing</span>
          )}
          {concessionValue > 0 && form.fee_concession_category && form.concession_approval_status !== 'pending' && form.concession_approval_status !== 'rejected' && (
            <span className="mt-0.5 block text-xs text-slate-500">{concessionCategoryLabel(form.fee_concession_category)}</span>
          )}
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sibling discount{siblingPercentValue > 0 ? ` (${siblingPercentValue}%)` : ''}
          </span>
          <strong className="mt-1 block text-base text-slate-800">{siblingValue > 0 ? formatRupees(siblingValue) : 'None'}</strong>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {concessionValue > 0 && form.concession_approval_status === 'pending' ? 'Billed tuition (pending approval)' : 'Actual / Net Tuition Fee'}
          </span>
          <strong className={`mt-1 block text-base ${overConcession ? 'text-rose-600' : 'text-sky-700'}`}>
            {net === null
              ? 'Enter a tuition fee'
              : concessionValue > 0 && form.concession_approval_status === 'pending'
                ? formatRupees(Math.max(0, tuitionValue - siblingValue))
                : formatRupees(net)}
          </strong>
          {concessionValue > 0 && form.concession_approval_status === 'pending' && (
            <span className="mt-0.5 block text-xs font-medium text-amber-600">
              {formatRupees(concessionValue)} held back until approved
            </span>
          )}
        </div>
      </div>

      {familyLedger && familyStatementInfo && (
        <FamilyLedgerPanel
          ledger={familyLedger}
          statementInfo={familyStatementInfo}
          onToast={onToast}
          familyLabel={siblingContext?.matchedReason
            ? `Matched on ${siblingContext.matchedReason}. Brothers and sisters are listed oldest admission first.`
            : 'Brothers and sisters are listed oldest admission first.'}
        />
      )}
      <div className="col-span-full flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
        <div>
          <strong className="block text-sm text-slate-800">Fine exemption</strong>
          <span className="text-xs text-slate-500">{form.fine_exempt ? 'Late fines are waived for this student' : 'Late fines apply to this student'}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.fine_exempt}
          aria-label="Fine exemption"
          onClick={() => patch({ fine_exempt: !form.fine_exempt })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.fine_exempt ? 'bg-sky-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.fine_exempt ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </div>
  );
}
