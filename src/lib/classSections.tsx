import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

// The names the app ships with. They are used until the school's own list has loaded,
// and as the fallback when the list cannot be reached, so a dropdown is never empty.
export const DEFAULT_CLASS_NAMES = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
  'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
];

export const DEFAULT_SECTION_NAMES = ['A', 'B', 'C', 'D'];

const CLASS_CACHE_KEY = 'schooldesk_class_names';
const SECTION_CACHE_KEY = 'schooldesk_section_names';

export type NameUsage = { name: string; students: number; others: number };

export type RenameResult = { error: string | null; students: number; others: number };

type ClassSectionValue = {
  classes: string[];
  sections: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  renameClass: (from: string, to: string) => Promise<RenameResult>;
  renameSection: (from: string, to: string) => Promise<RenameResult>;
  addClass: (name: string) => Promise<string | null>;
  addSection: (name: string) => Promise<string | null>;
  removeClass: (name: string) => Promise<string | null>;
  removeSection: (name: string) => Promise<string | null>;
  saveClassOrder: (names: string[]) => Promise<string | null>;
  saveSectionOrder: (names: string[]) => Promise<string | null>;
};

const ClassSectionContext = createContext<ClassSectionValue | undefined>(undefined);

// The names the school has chosen are kept in the browser as well as the database, so
// they are already correct on the first paint after a reload instead of flickering
// through the built-in list while the server is asked.
const readCache = (key: string, fallback: string[]): string[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const names = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return names.length ? names : fallback;
  } catch {
    return fallback;
  }
};

const writeCache = (key: string, names: string[]) => {
  try { window.localStorage.setItem(key, JSON.stringify(names)); } catch { /* a full or blocked store is not worth interrupting the app for */ }
};

const clean = (names: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  names.forEach((name) => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out;
};

// A plain, readable reason from the database's own checks; anything else is reported
// generically so a raw server message never reaches the office.
const messageFrom = (error: { message?: string; code?: string } | null, fallback: string): string => {
  if (error?.code === 'P0001' && error.message) return error.message;
  return fallback;
};

export function ClassSectionProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading } = useAuth();
  const userId = profile?.id ?? null;
  const [classes, setClasses] = useState<string[]>(() => readCache(CLASS_CACHE_KEY, DEFAULT_CLASS_NAMES));
  const [sections, setSections] = useState<string[]>(() => readCache(SECTION_CACHE_KEY, DEFAULT_SECTION_NAMES));
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [classResult, sectionResult] = await Promise.all([
      supabase.from('school_class_names').select('class_name, sort_order').order('sort_order').order('class_name'),
      supabase.from('school_section_names').select('section_name, sort_order').order('sort_order').order('section_name'),
    ]);

    if (!classResult.error && classResult.data) {
      const names = clean(classResult.data.map((row) => String((row as { class_name: string }).class_name)));
      if (names.length) { setClasses(names); writeCache(CLASS_CACHE_KEY, names); }
    }
    if (!sectionResult.error && sectionResult.data) {
      const names = clean(sectionResult.data.map((row) => String((row as { section_name: string }).section_name)));
      if (names.length) { setSections(names); writeCache(SECTION_CACHE_KEY, names); }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) { setLoading(false); return; }
    void load();
  }, [authLoading, userId, load]);

  const renameClass = useCallback(async (from: string, to: string): Promise<RenameResult> => {
    const { data, error } = await supabase.rpc('rename_school_class', { p_from: from, p_to: to });
    if (error) return { error: messageFrom(error, 'The class could not be renamed. Please try again.'), students: 0, others: 0 };
    await load();
    const payload = (data ?? {}) as { students?: number; others?: number };
    return { error: null, students: Number(payload.students ?? 0), others: Number(payload.others ?? 0) };
  }, [load]);

  const renameSection = useCallback(async (from: string, to: string): Promise<RenameResult> => {
    const { data, error } = await supabase.rpc('rename_school_section', { p_from: from, p_to: to });
    if (error) return { error: messageFrom(error, 'The section could not be renamed. Please try again.'), students: 0, others: 0 };
    await load();
    const payload = (data ?? {}) as { students?: number; others?: number };
    return { error: null, students: Number(payload.students ?? 0), others: Number(payload.others ?? 0) };
  }, [load]);

  const addClass = useCallback(async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a class name.';
    const nextOrder = classes.length ? classes.length + 1 : 1;
    const { error } = await supabase.from('school_class_names').insert({ class_name: trimmed, sort_order: nextOrder });
    if (error) return error.code === '23505' ? 'A class with that name already exists.' : 'The class could not be added. Please try again.';
    await load();
    return null;
  }, [classes.length, load]);

  const addSection = useCallback(async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a section name.';
    const nextOrder = sections.length ? sections.length + 1 : 1;
    const { error } = await supabase.from('school_section_names').insert({ section_name: trimmed, sort_order: nextOrder });
    if (error) return error.code === '23505' ? 'A section with that name already exists.' : 'The section could not be added. Please try again.';
    await load();
    return null;
  }, [sections.length, load]);

  const removeClass = useCallback(async (name: string): Promise<string | null> => {
    const { error } = await supabase.from('school_class_names').delete().eq('class_name', name.trim());
    if (error) return 'The class could not be removed. Please try again.';
    await load();
    return null;
  }, [load]);

  const removeSection = useCallback(async (name: string): Promise<string | null> => {
    const { error } = await supabase.from('school_section_names').delete().eq('section_name', name.trim());
    if (error) return 'The section could not be removed. Please try again.';
    await load();
    return null;
  }, [load]);

  const saveClassOrder = useCallback(async (names: string[]): Promise<string | null> => {
    const { error } = await supabase.rpc('set_school_class_order', { p_names: names });
    if (error) return messageFrom(error, 'The class order could not be saved.');
    await load();
    return null;
  }, [load]);

  const saveSectionOrder = useCallback(async (names: string[]): Promise<string | null> => {
    const { error } = await supabase.rpc('set_school_section_order', { p_names: names });
    if (error) return messageFrom(error, 'The section order could not be saved.');
    await load();
    return null;
  }, [load]);

  const value = useMemo<ClassSectionValue>(() => ({
    classes, sections, loading, refresh: load,
    renameClass, renameSection, addClass, addSection, removeClass, removeSection,
    saveClassOrder, saveSectionOrder,
  }), [classes, sections, loading, load, renameClass, renameSection, addClass, addSection, removeClass, removeSection, saveClassOrder, saveSectionOrder]);

  return <ClassSectionContext.Provider value={value}>{children}</ClassSectionContext.Provider>;
}

export function useClassSections() {
  const ctx = useContext(ClassSectionContext);
  if (!ctx) throw new Error('useClassSections must be used within ClassSectionProvider');
  return ctx;
}

export const useClassOptions = () => useClassSections().classes;

export const useSectionOptions = () => useClassSections().sections;

// An existing record may carry a name that is no longer in the list, because the school
// renamed it after the record was written. The current value is added back so a dropdown
// never shows blank and saving does not silently erase it.
export const withCurrent = (names: string[], value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed || names.some((name) => name.toLowerCase() === trimmed.toLowerCase())) return names;
  return [...names, trimmed];
};

// How many records already use each name. The manage screen uses these counts to warn
// before a name is removed, and to refuse a removal that would strand a record.
export async function fetchClassUsage(): Promise<Map<string, NameUsage>> {
  const { data, error } = await supabase.rpc('school_class_usage');
  if (error || !data) return new Map();
  const map = new Map<string, NameUsage>();
  (data as { class_name: string; students: number; others: number }[]).forEach((row) => {
    map.set(String(row.class_name), { name: String(row.class_name), students: Number(row.students ?? 0), others: Number(row.others ?? 0) });
  });
  return map;
}

export async function fetchSectionUsage(): Promise<Map<string, NameUsage>> {
  const { data, error } = await supabase.rpc('school_section_usage');
  if (error || !data) return new Map();
  const map = new Map<string, NameUsage>();
  (data as { section_name: string; students: number; others: number }[]).forEach((row) => {
    map.set(String(row.section_name), { name: String(row.section_name), students: Number(row.students ?? 0), others: Number(row.others ?? 0) });
  });
  return map;
}

// The staff who can be named as a class teacher: everyone whose role is Teacher and who
// is still active.
export async function fetchTeacherNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('full_name, role, status')
    .eq('role', 'teacher')
    .eq('status', 'active')
    .order('full_name');
  if (error || !data) return [];
  return clean((data as { full_name: string | null }[]).map((row) => String(row.full_name ?? '')));
}
