import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/auth';

export type PortalCredentials = {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
};

// Unambiguous alphabet: no 0/O/1/l/I, so passwords survive being read aloud or written down.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generatePassword(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return password;
}

// Mobile numbers arrive with spaces, dashes and country codes; usernames keep only digits.
export function usernameFromMobile(mobile: string): string {
  return mobile.replace(/\D/g, '');
}

export function usernameFromAdmissionNumber(admissionNumber: string): string {
  return admissionNumber.trim().toLowerCase();
}

const FRIENDLY_ERRORS: Record<string, string> = {
  'Username already taken': 'That username is already in use. Please choose another.',
  'This student already has a portal login': 'This student already has a portal login.',
  'That student record no longer exists': 'That student record no longer exists.',
  'A student account must be linked to a student record': 'This student could not be linked to a portal login.',
  'Password must be at least 6 characters': 'The password must be at least 6 characters.',
  'Username must be at least 3 characters': 'The username must be at least 3 characters.',
  'A full name is required': 'A full name is required.',
  'That account type is not allowed': 'That account type is not allowed.',
  'That account no longer exists': 'That account no longer exists.',
  'An administrator password can only be changed by that administrator': 'An administrator password can only be changed by that administrator.',
};

function friendly(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  return FRIENDLY_ERRORS[message] ?? message;
}

export async function provisionPortalAccount(params: {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  studentId?: string | null;
  mobile?: string | null;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_provision_account', {
      p_username: params.username,
      p_password: params.password,
      p_full_name: params.fullName,
      p_role: params.role,
      p_student_id: params.studentId ?? null,
      p_mobile: params.mobile ?? null,
    });
    if (error) return { error: friendly(error.message, 'The account could not be created.') };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export type ParentLoginResult = { error: string | null; created: boolean; username: string };

// Creates the parent's portal login for a new admission, or reuses the one the family
// already has (a brother or sister admitted earlier shares the same account).
export async function ensureParentLogin(params: {
  username: string;
  password: string;
  fullName: string;
  studentId: string;
  mobile?: string | null;
}): Promise<ParentLoginResult> {
  const username = params.username.trim().toLowerCase();
  try {
    const { data, error } = await supabase.rpc('admin_ensure_parent_login', {
      p_username: username,
      p_password: params.password,
      p_full_name: params.fullName,
      p_student_id: params.studentId,
      p_mobile: params.mobile ?? null,
    });
    if (error) return { error: friendly(error.message, 'The parent login could not be created.'), created: false, username };
    const row = (data ?? {}) as { created?: boolean; username?: string };
    return { error: null, created: Boolean(row.created), username: row.username ?? username };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.', created: false, username };
  }
}

export async function setAccountPassword(userId: string, password: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_set_password', { p_user_id: userId, p_password: password });
    if (error) return { error: friendly(error.message, 'The password could not be changed.') };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export type ResetParentPasswordResult = {
  error: string | null;
  username: string;
  fullName: string;
  // False when the family has no portal login yet and one could not be created.
  updated: boolean;
};

// Sets a fresh password for the family's portal login. When the parent has no login yet
// (an admission saved before the parent accounts existed, for instance) one is created
// through the same function the office uses, so the outcome is the same either way.
export async function resetParentPassword(params: {
  username: string;
  password: string;
  fullName: string;
  studentId: string;
  mobile?: string | null;
}): Promise<ResetParentPasswordResult> {
  const username = params.username.trim().toLowerCase();
  const fallback = { username, fullName: params.fullName, updated: false };
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, role')
      .eq('username', username)
      .maybeSingle();
    if (error) return { error: 'The parent login could not be found.', ...fallback };

    const row = data as { id: string; full_name: string; role: string } | null;
    if (row) {
      if (row.role !== 'parent') {
        return { error: 'That username belongs to a different account type.', ...fallback };
      }
      const { error: resetError } = await setAccountPassword(row.id, params.password);
      if (resetError) return { error: resetError, ...fallback };
      return { error: null, username, fullName: row.full_name || params.fullName, updated: true };
    }

    const created = await ensureParentLogin({
      username,
      password: params.password,
      fullName: params.fullName,
      studentId: params.studentId,
      mobile: params.mobile ?? null,
    });
    if (created.error) return { error: created.error, ...fallback };
    return { error: null, username: created.username, fullName: params.fullName, updated: true };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.', ...fallback };
  }
}

export async function setAccountUsername(userId: string, username: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('admin_reset_username', {
      p_user_id: userId,
      p_username: username.trim().toLowerCase(),
    });
    if (error) return { error: friendly(error.message, 'The username could not be changed.') };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function changeOwnPassword(password: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export async function requestPasswordReset(username: string, note: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('school_password_requests')
      .insert({ username: username.trim().toLowerCase(), note: note.trim() || null });
    if (error) return { error: 'Your request could not be sent. Please contact the school office.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}

export type PasswordRequest = {
  id: string;
  username: string;
  note: string | null;
  status: 'pending' | 'resolved';
  created_at: string;
  resolved_at: string | null;
};

export async function fetchPasswordRequests(): Promise<PasswordRequest[]> {
  try {
    const { data } = await supabase
      .from('school_password_requests')
      .select('id, username, note, status, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []) as PasswordRequest[];
  } catch {
    return [];
  }
}

export async function resolvePasswordRequest(id: string, userId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('school_password_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq('id', id);
    if (error) return { error: 'The request could not be updated.' };
    return { error: null };
  } catch {
    return { error: 'Could not reach the school server. Check your connection and try again.' };
  }
}
