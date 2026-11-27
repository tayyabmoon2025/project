import type { AdmissionFormState } from '@/lib/schoolTypes';
import { concessionNeedsApproval } from '@/lib/concessionCategories';

const parseAmount = (value: string) => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateOrNull = (value: string) => (value.trim() === '' ? null : value.trim());

const formatInputAmount = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

// Class names come from the admission form's fixed list; the fee structure uses the
// same wording, so a trimmed, case-insensitive comparison lines them up.
const normalizeClassName = (value: string) => value.trim().toLowerCase();

export type FeeStructureRow = { class_name: string; tuition_fee: number | string | null };

// The class tuition fee is the only figure the admission form cares about. Lab,
// transport, admission/misc and exam fees stay out of it — those are charged on the
// challan, not agreed with the parent at admission.
export function tuitionFeeForClass(classList: FeeStructureRow[], className: string): number | null {
  const wanted = normalizeClassName(className);
  if (!wanted) return null;
  const row = classList.find((entry) => normalizeClassName(entry.class_name) === wanted);
  if (!row) return null;
  const value = Number(row.tuition_fee ?? 0);
  return Number.isFinite(value) ? value : null;
}

// A concession can never take more than the tuition fee, and never goes below zero.
const clampConcession = (tuition: number, amount: number) => Math.min(Math.max(amount, 0), Math.max(tuition, 0));

// Both concession fields describe the same money, so each recalculates the other from
// the tuition fee: typing a percentage fills the amount, typing an amount fills the percentage.
export function concessionAmountFor(tuitionFee: string, percentage: string) {
  const tuition = parseAmount(tuitionFee);
  const percent = parseAmount(percentage);
  if (tuition === null || percent === null) return '';
  return clampConcession(tuition, (tuition * percent) / 100).toFixed(2);
}

export function concessionPercentageFor(tuitionFee: string, amount: string) {
  const tuition = parseAmount(tuitionFee);
  const value = parseAmount(amount);
  if (tuition === null || value === null || tuition <= 0) return '';
  return ((clampConcession(tuition, value) / tuition) * 100).toFixed(2);
}

// The sibling discount is a share of the tuition fee granted from the second child in a
// family onwards. It is capped by whatever tuition is left after the family's own
// concession, so the two reductions together never take the payable tuition below zero.
export function siblingDiscountAmountFor(tuitionFee: string, percentage: string) {
  const tuition = Math.max(0, parseAmount(tuitionFee) ?? 0);
  const percent = parseAmount(percentage);
  if (percent === null || percent <= 0) return 0;
  return Math.min(tuition, (tuition * Math.min(percent, 100)) / 100);
}

// What the family actually pays for tuition each month, after the concession and the
// sibling discount.
export function netTuitionAfterDiscounts(tuitionFee: string, concession: string, siblingPercentage: string) {
  const tuition = parseAmount(tuitionFee);
  if (tuition === null) return null;
  const remaining = Math.max(0, tuition - (parseAmount(concession) ?? 0));
  return Math.max(0, remaining - Math.min(siblingDiscountAmountFor(tuitionFee, siblingPercentage), remaining));
}

const netValue = (tuition: string, concession: string, siblingPercentage: string) => {
  const net = netTuitionAfterDiscounts(tuition, concession, siblingPercentage);
  return net === null ? '' : String(net);
};

// Called when the class changes. The class rate replaces the tuition fee and whatever
// concession is already recorded is re-applied, so the net figure stays consistent.
export function applyClassTuitionFee(form: AdmissionFormState, classList: FeeStructureRow[]): Partial<AdmissionFormState> {
  const classTuition = tuitionFeeForClass(classList, form.class_name);
  if (classTuition === null) return {};

  const tuition = formatInputAmount(classTuition);
  const percent = parseAmount(form.fee_concession_percentage);
  const amount = parseAmount(form.fee_concession_amount);

  let concession = '';
  let percentage = '';
  if (percent !== null) {
    concession = concessionAmountFor(tuition, form.fee_concession_percentage);
    percentage = form.fee_concession_percentage;
  } else if (amount !== null) {
    concession = formatInputAmount(clampConcession(classTuition, amount));
    percentage = concessionPercentageFor(tuition, concession);
  }

  return {
    tuition_fee: tuition,
    fee_concession_amount: concession,
    fee_concession_percentage: percentage,
    net_tuition_fee: netValue(tuition, concession, form.sibling_discount_percentage),
  };
}

export function validateFeeFields(form: AdmissionFormState) {
  const tuition = parseAmount(form.tuition_fee);
  const percentage = parseAmount(form.fee_concession_percentage);
  const amount = parseAmount(form.fee_concession_amount);
  if ([tuition, percentage, amount].some((value) => value !== null && value < 0)) return 'Fee amounts cannot be negative';
  if (percentage !== null && percentage > 100) return 'Fee concession percentage cannot be more than 100';
  if (tuition !== null && amount !== null && amount > tuition) return 'Fee concession cannot be more than the tuition fee';
  return null;
}

export function toStudentFeePayload(form: AdmissionFormState) {
  const tuition = parseAmount(form.tuition_fee);
  const concession = parseAmount(form.fee_concession_amount);
  return {
    ...form,
    date_of_birth: dateOrNull(form.date_of_birth),
    admission_date: dateOrNull(form.admission_date),
    leaving_date: dateOrNull(form.leaving_date),
    issued_tc_date: dateOrNull(form.issued_tc_date),
    leaving_certificate_date: dateOrNull(form.leaving_certificate_date),
    // The leaving record is either complete or absent, so a blank box is stored as null.
    // That keeps "never left" and "leaving record cleared" the same state, which is what
    // lets the Withdraw Students screen and the admission form agree.
    leaving_status: form.leaving_status.trim() || null,
    leaving_class: form.leaving_class.trim() || null,
    leaving_reason: form.leaving_reason.trim() || null,
    leaving_remarks: form.leaving_remarks.trim() || null,
    leaving_certificate_number: form.leaving_certificate_number.trim() || null,
    progress: form.progress.trim() || null,
    conduct: form.conduct.trim() || null,
    fee_paid_upto: form.fee_paid_upto.trim() || null,
    attendance_summary: form.attendance_summary.trim() || null,
    slc_serial_number: form.slc_serial_number.trim() || null,
    tuition_fee: tuition,
    fee_concession_percentage: parseAmount(form.fee_concession_percentage),
    fee_concession_amount: concession,
    // An empty choice is stored as null so the report treats "no category" and "category
    // cleared" the same way, rather than reading an empty string as a named category.
    fee_concession_category: form.fee_concession_category.trim() || null,
    // A special concession (orphan, scholarship, staff) is held as pending until an
    // administrator signs off. Clearing or switching to a non-special category drops the
    // status back to null so it no longer appears in the approval queue.
    concession_approval_status: concessionNeedsApproval(form.fee_concession_category)
      ? (form.concession_approval_status === 'approved' || form.concession_approval_status === 'rejected'
        ? form.concession_approval_status
        : 'pending')
      : null,
    net_tuition_fee: netTuitionAfterDiscounts(form.tuition_fee, form.fee_concession_amount, form.sibling_discount_percentage),
    sibling_discount_percentage: parseAmount(form.sibling_discount_percentage),
  };
}
