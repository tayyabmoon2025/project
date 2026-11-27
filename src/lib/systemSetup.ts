import { supabase } from '@/lib/supabase';

// ============================================================================
// Types
// ============================================================================

export type AcademicSession = {
  id: string;
  session_name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  created_at: string;
};

export type InstitutionProfile = {
  id: string;
  school_name: string;
  school_name_urdu: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  affiliation_no: string;
  registration_no: string;
  logo_url: string;
  // The registration authority's emblem, shown on the right of an official letterhead.
  // Empty when the school has not uploaded one, in which case the letterhead leaves that
  // corner blank rather than showing a placeholder.
  psra_logo_url: string;
  principal_name: string;
  established_year: string;
  school_latitude: number | null;
  school_longitude: number | null;
  attendance_radius_m: number;
  updated_at: string;
};

// The school's own position plus how far from it still counts as "inside school".
// `configured` is false until somebody saves a latitude and longitude, which is what
// tells the check-in card to ask the office to set the location first.
export type SchoolGeofence = {
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  configured: boolean;
};

export const DEFAULT_ATTENDANCE_RADIUS_M = 100;

export type SystemSetting = {
  id: string;
  category: string;
  value: string;
  updated_at: string;
};

export type GradingScale = {
  id: string;
  grade: string;
  min_percent: number | string;
  max_percent: number | string;
  gpa: number | string;
  remarks: string;
  sort_order: number;
  created_at: string;
};

export type GradingDraft = Omit<GradingScale, 'id' | 'created_at' | 'sort_order'> & { sort_order: string | number };

// ============================================================================
// Helper
// ============================================================================

const genericError = (err: unknown, fallback: string) => {
  console.error(fallback, err);
  return fallback;
};

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ============================================================================
// Academic Sessions
// ============================================================================

export async function fetchSessions(): Promise<{ sessions: AcademicSession[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_academic_sessions')
      .select('id, session_name, start_date, end_date, is_current, created_at')
      .order('start_date', { ascending: false });
    if (error) return { sessions: [], error: error.message };
    return { sessions: (data ?? []) as AcademicSession[], error: null };
  } catch (err) {
    return { sessions: [], error: genericError(err, 'Sessions could not be loaded.') };
  }
}

export async function saveSession(
  draft: { session_name: string; start_date: string | null; end_date: string | null; is_current: boolean },
): Promise<string | null> {
  try {
    const payload = {
      session_name: draft.session_name.trim(),
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
      is_current: draft.is_current,
    };
    if (!payload.session_name) return 'Enter a session name first.';
    const { error } = await supabase.from('school_academic_sessions').insert(payload);
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'The session could not be saved.');
  }
}

export async function setCurrentSession(id: string, isCurrent: boolean): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_academic_sessions').update({ is_current: isCurrent }).eq('id', id);
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'The current session could not be updated.');
  }
}

export async function deleteSession(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_academic_sessions').delete().eq('id', id);
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'That session could not be removed.');
  }
}

// ============================================================================
// Institution Profile
// ============================================================================

export async function fetchInstitutionProfile(): Promise<{ profile: InstitutionProfile | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_institution_profile')
      .select('id, school_name, school_name_urdu, address, city, phone, email, website, affiliation_no, registration_no, logo_url, psra_logo_url, principal_name, established_year, school_latitude, school_longitude, attendance_radius_m, updated_at')
      .eq('id', 'default')
      .maybeSingle();
    if (error) return { profile: null, error: error.message };
    return { profile: (data ?? null) as InstitutionProfile | null, error: null };
  } catch (err) {
    return { profile: null, error: genericError(err, 'The institution profile could not be loaded.') };
  }
}

// Reads only the location fields. The check-in card and the daily register call
// this rather than the whole profile so they do not pull the school's details just
// to draw a distance badge.
export async function fetchSchoolGeofence(): Promise<{ geofence: SchoolGeofence; error: string | null }> {
  const fallback: SchoolGeofence = {
    latitude: null,
    longitude: null,
    radiusM: DEFAULT_ATTENDANCE_RADIUS_M,
    configured: false,
  };
  try {
    const { data, error } = await supabase
      .from('school_institution_profile')
      .select('school_latitude, school_longitude, attendance_radius_m')
      .eq('id', 'default')
      .maybeSingle();
    if (error) return { geofence: fallback, error: error.message };
    if (!data) return { geofence: fallback, error: null };
    const row = data as { school_latitude: number | null; school_longitude: number | null; attendance_radius_m: number | null };
    const latitude = typeof row.school_latitude === 'number' ? row.school_latitude : null;
    const longitude = typeof row.school_longitude === 'number' ? row.school_longitude : null;
    return {
      geofence: {
        latitude,
        longitude,
        radiusM: numberOr(row.attendance_radius_m, DEFAULT_ATTENDANCE_RADIUS_M),
        configured: latitude !== null && longitude !== null,
      },
      error: null,
    };
  } catch (err) {
    return { geofence: fallback, error: genericError(err, 'The school location could not be loaded.') };
  }
}

export async function saveSchoolGeofence(
  draft: { latitude: number | null; longitude: number | null; radiusM: number },
): Promise<string | null> {
  try {
    if (draft.latitude !== null && (draft.latitude < -90 || draft.latitude > 90)) return 'Latitude must be between -90 and 90.';
    if (draft.longitude !== null && (draft.longitude < -180 || draft.longitude > 180)) return 'Longitude must be between -180 and 180.';
    if (!Number.isFinite(draft.radiusM) || draft.radiusM < 10 || draft.radiusM > 5000) return 'The allowed radius must be between 10 and 5000 metres.';
    const { error } = await supabase
      .from('school_institution_profile')
      .update({
        school_latitude: draft.latitude,
        school_longitude: draft.longitude,
        attendance_radius_m: Math.round(draft.radiusM),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'default');
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'The school location could not be saved.');
  }
}

export async function saveInstitutionProfile(draft: Omit<InstitutionProfile, 'id' | 'updated_at'>): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_institution_profile')
      .upsert({ id: 'default', ...draft, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'The institution profile could not be saved.');
  }
}

// ============================================================================
// Default Values (system settings)
// ============================================================================

export async function fetchSystemSettings(): Promise<{ settings: SystemSetting[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_system_settings')
      .select('id, category, value, updated_at')
      .order('category', { ascending: true })
      .order('id', { ascending: true });
    if (error) return { settings: [], error: error.message };
    return { settings: (data ?? []) as SystemSetting[], error: null };
  } catch (err) {
    return { settings: [], error: genericError(err, 'Default values could not be loaded.') };
  }
}

export async function saveSystemSetting(id: string, value: string): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('school_system_settings')
      .upsert({ id, value, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'That value could not be saved.');
  }
}

// ============================================================================
// Grading System
// ============================================================================

export async function fetchGradingScales(): Promise<{ scales: GradingScale[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_grading_scales')
      .select('id, grade, min_percent, max_percent, gpa, remarks, sort_order, created_at')
      .order('sort_order', { ascending: true });
    if (error) return { scales: [], error: error.message };
    return { scales: (data ?? []) as GradingScale[], error: null };
  } catch (err) {
    return { scales: [], error: genericError(err, 'The grading system could not be loaded.') };
  }
}

export async function saveGradingScale(draft: GradingDraft): Promise<string | null> {
  try {
    const payload = {
      grade: draft.grade.trim(),
      min_percent: numberOr(draft.min_percent),
      max_percent: numberOr(draft.max_percent),
      gpa: numberOr(draft.gpa),
      remarks: draft.remarks.trim(),
      sort_order: numberOr(draft.sort_order, 0),
    };
    if (!payload.grade) return 'Enter a grade letter first.';
    const { error } = await supabase.from('school_grading_scales').insert(payload);
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'The grade could not be saved.');
  }
}

export async function deleteGradingScale(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.from('school_grading_scales').delete().eq('id', id);
    return error ? error.message : null;
  } catch (err) {
    return genericError(err, 'That grade could not be removed.');
  }
}

// ============================================================================
// Backup metadata (single summary row)
// ============================================================================

export type BackupMeta = {
  tableName: string;
  count: number;
};

// Returns row counts for the system's main data tables so the Backup tab can
// show how much data would be captured.
export async function fetchBackupStats(): Promise<{ stats: BackupMeta[]; error: string | null }> {
  const tables = [
    { tableName: 'Students', ref: 'school_students' },
    { tableName: 'Fee Payments', ref: 'school_fee_payments' },
    { tableName: 'Fee Challans', ref: 'school_fee_challans' },
    { tableName: 'Attendance', ref: 'school_attendance' },
    { tableName: 'Examination Subjects', ref: 'school_exam_subjects' },
    { tableName: 'Exam Marks', ref: 'school_exam_marks' },
    { tableName: 'Staff Attendance', ref: 'school_staff_attendance' },
    { tableName: 'Finance Expenses', ref: 'school_expenses' },
    { tableName: 'Finance Other Income', ref: 'school_other_income' },
    { tableName: 'Portal Notifications', ref: 'school_portal_notifications' },
  ];
  try {
    const results = await Promise.all(
      tables.map(async (t) => {
        const { count, error } = await supabase.from(t.ref).select('id', { count: 'exact', head: true });
        return { tableName: t.tableName, count: error ? 0 : (count ?? 0) };
      }),
    );
    return { stats: results, error: null };
  } catch (err) {
    return { stats: [], error: genericError(err, 'Backup summary could not be loaded.') };
  }
}
