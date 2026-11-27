// The school logo used across the whole app — navbar, login screen, admission forms,
// certificates, salary slips, receipts and generated quiz papers.
//
// The uploaded logo lives in the institution profile (`logo_url`) so it is saved once
// and every screen picks it up. Writing that row is admin-only, so the save goes
// through a server function that allows staff and writes only this one field. The
// stored value is a data URL, which means print sheets need no network request and the
// Word export can read the image bytes directly.
//
// Every screen reads the same cached copy: it is primed from localStorage so it paints
// instantly and survives reloads, refreshed from the database once, and updated
// everywhere the moment it is saved.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// The bundled logo, used until the school uploads one of its own. The file on disk is
// named with a lowercase ".png", so the path must match exactly.
export const DEFAULT_LOGO = '/New_LOGO_Final.png';

// Longest edge kept when a picture is prepared, in pixels. A logo is only ever drawn a
// few centimetres wide, so anything larger is wasted bytes in the database.
const MAX_EDGE = 400;
const MAX_DATA_URL = 800000;

export async function fetchSchoolLogo(): Promise<{ src: string; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('school_institution_profile')
      .select('logo_url')
      .eq('id', 'default')
      .maybeSingle();
    if (error) return { src: '', error: 'The school logo could not be loaded.' };
    return { src: ((data as { logo_url?: string } | null)?.logo_url ?? '').trim(), error: null };
  } catch {
    return { src: '', error: 'The school logo could not be loaded.' };
  }
}

export async function saveSchoolLogo(dataUrl: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_institution_logo', { p_data_url: dataUrl });
    if (!error) {
      setCachedSchoolLogo(dataUrl);
      return { error: null };
    }
    // The function's own wording is friendly, but anything unexpected is mapped to a
    // generic message rather than shown as a database error.
    if (error.message.includes('PNG, JPEG')) return { error: 'Choose a PNG, JPEG or WebP image.' };
    if (error.message.includes('too large')) return { error: 'That image is too large. Try a smaller one.' };
    if (error.message.includes('Not authorized')) return { error: 'Only school staff can change the logo.' };
    return { error: 'The logo could not be saved. Please try again.' };
  } catch {
    return { error: 'The logo could not be saved. Check your connection and try again.' };
  }
}

// Shrinks a chosen picture and returns it as a PNG data URL, so what reaches the
// database is small and is always a format Word can embed.
export async function prepareLogoFile(
  file: File,
): Promise<{ dataUrl: string } | { error: string }> {
  if (!file.type.startsWith('image/')) {
    return { error: 'Choose an image file (PNG, JPEG or WebP).' };
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { error: 'That image could not be read. Try another file.' };

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { error: 'The logo could not be prepared. Try another file.' };
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_DATA_URL) {
      return { error: 'That image is too large. Try a smaller one.' };
    }
    return { dataUrl };
  } finally {
    bitmap.close();
  }
}

// ============================================================================
// Shared logo store
// ============================================================================

const LOGO_CACHE_KEY = 'schooldesk_school_logo';
let cachedLogo: string | null = null;
let pendingLoad: Promise<string> | null = null;
let loadedOnce = false;
const listeners = new Set<(logo: string) => void>();

const readCachedLogo = (): string => {
  if (cachedLogo === null) {
    try {
      cachedLogo = localStorage.getItem(LOGO_CACHE_KEY) ?? '';
    } catch {
      cachedLogo = '';
    }
  }
  return cachedLogo;
};

const persistCachedLogo = (value: string) => {
  cachedLogo = value;
  try {
    if (value) localStorage.setItem(LOGO_CACHE_KEY, value);
    else localStorage.removeItem(LOGO_CACHE_KEY);
  } catch {
    // The data URL can exceed the storage quota; the in-memory cache still works.
  }
};

const notifyLogoListeners = () => {
  const value = cachedLogo ?? '';
  listeners.forEach((listener) => listener(value));
};

// Synchronous read for places that cannot wait for a round trip, such as the
// gate-pass print window built as a standalone HTML document.
export function getCachedSchoolLogo(): string {
  return readCachedLogo();
}

// Updates the cached copy after a direct save (the School Settings "Save Profile"
// path writes the profile row itself rather than calling the logo function).
export function setCachedSchoolLogo(value: string) {
  persistCachedLogo(value.trim());
  loadedOnce = true;
  notifyLogoListeners();
}

export function loadSchoolLogo(force = false): Promise<string> {
  if (!force && loadedOnce) return Promise.resolve(readCachedLogo());
  if (!force && pendingLoad) return pendingLoad;
  pendingLoad = fetchSchoolLogo()
    .then(({ src }) => {
      pendingLoad = null;
      loadedOnce = true;
      persistCachedLogo(src.trim());
      notifyLogoListeners();
      return src.trim();
    })
    .catch(() => {
      pendingLoad = null;
      return readCachedLogo();
    });
  return pendingLoad;
}

// React hook: the current saved logo ('' when none has been uploaded yet).
export function useSchoolLogo(): string {
  const [logo, setLogo] = useState<string>(() => readCachedLogo());
  useEffect(() => {
    setLogo(readCachedLogo());
    listeners.add(setLogo);
    void loadSchoolLogo();
    return () => {
      listeners.delete(setLogo);
    };
  }, []);
  return logo;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The logo could not be loaded.'));
    image.src = src;
  });
}

export type DocxLogo = { base64: string; widthPx: number; heightPx: number };

// Reads whatever the logo currently is — an uploaded data URL or the bundled file — and
// returns PNG bytes sized for the top of a Word page. Returns null when there is no
// logo, so the paper simply prints without one.
export async function logoForDocx(src: string, maxHeight = 72): Promise<DocxLogo | null> {
  if (!src) return null;
  try {
    const image = await loadImage(src);
    const naturalHeight = image.naturalHeight || maxHeight;
    const naturalWidth = image.naturalWidth || maxHeight;
    const scale = Math.min(1, maxHeight / naturalHeight);
    const widthPx = Math.max(1, Math.round(naturalWidth * scale));
    const heightPx = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, widthPx, heightPx);
    const base64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
    if (!base64) return null;
    return { base64, widthPx, heightPx };
  } catch {
    return null;
  }
}
