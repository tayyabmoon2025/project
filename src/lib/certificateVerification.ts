import { supabase } from '@/lib/supabase';

// --------------------------------------------------------------- the link on the paper

// The address the QR code printed on a certificate opens. It points at the app's own
// origin and puts the certificate number and its printed code in the query string, so a
// scanner lands straight on the answer without anybody typing anything. Because the
// origin is read at the moment of printing, the same certificate verifies correctly from
// a preview address and from the school's own domain.
export function certificateVerificationUrl(
  certificateNumber: string | null | undefined,
  verificationCode: string | null | undefined,
): string {
  const number = (certificateNumber ?? '').trim();
  const code = (verificationCode ?? '').trim();
  if (!number || !code || typeof window === 'undefined') return '';
  const origin = window.location.origin;
  return `${origin}${window.location.pathname}?verify=${encodeURIComponent(number)}&code=${encodeURIComponent(code)}`;
}

// --------------------------------------------------------------- reading it back

export type CertificateVerificationRequest = { number: string; code: string };

// Reads the certificate number and code out of the address bar. Returns null on an
// ordinary visit, so the app shows its normal sign-in screen instead.
export function readVerificationRequest(search: string): CertificateVerificationRequest | null {
  const params = new URLSearchParams(search);
  const number = (params.get('verify') ?? '').trim();
  const code = (params.get('code') ?? '').trim();
  if (!number || !code) return null;
  return { number, code };
}

// Puts the address bar back to the plain app address once the visitor closes the
// verification page, so a reload does not reopen it.
export function clearVerificationRequest(): void {
  window.history.replaceState(null, '', window.location.pathname);
}

// --------------------------------------------------------------- the check itself

// The narrow set of facts the database is willing to confirm about a certificate. The
// wording, the student's date of birth, the guardian's details and the certificate's
// internal id are deliberately not part of this: the page confirms the certificate is
// genuine, it does not republish the record.
export type CertificateVerification = {
  certificate_number: string | null;
  certificate_type: string;
  title: string;
  issued_on: string | null;
  approval_status: string;
  student_name: string;
  admission_number: string | null;
  class_name: string | null;
  section_name: string | null;
  school_name: string;
  verified_at: string;
};

export type CertificateVerificationResult =
  | { status: 'verified'; record: CertificateVerification }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// Asks the school's database whether this number and code belong to a certificate that an
// administrator has released. A certificate still awaiting approval comes back as
// "not found", because a held certificate must not be confirmable from its paper copy.
export async function verifyCertificate(number: string, code: string): Promise<CertificateVerificationResult> {
  const trimmedNumber = number.trim();
  const trimmedCode = code.trim();
  if (!trimmedNumber || !trimmedCode) return { status: 'not_found' };
  try {
    const { data, error } = await supabase.rpc('verify_student_certificate', {
      p_number: trimmedNumber,
      p_code: trimmedCode,
    });
    if (error) {
      return { status: 'error', message: 'The school records could not be reached just now.' };
    }
    if (!data) return { status: 'not_found' };
    return { status: 'verified', record: data as CertificateVerification };
  } catch {
    return { status: 'error', message: 'The school records could not be reached. Check your connection and try again.' };
  }
}
