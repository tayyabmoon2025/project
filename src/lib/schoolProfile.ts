import { useEffect, useState } from 'react';
import { fetchInstitutionProfile, type InstitutionProfile } from '@/lib/systemSetup';

// The school profile, read once and shared.
//
// The letterhead printed on a certificate, a challan, a report card or a salary slip needs
// the school's name, Urdu name, address, phone and registration numbers. Reading that row
// again for every printed document would be a request per sheet, so it is read once here
// and every letterhead subscribes to the same copy. Saving the profile in School Settings
// pushes the new values to every open letterhead immediately.
//
// Nothing is cached to storage: unlike the logo, this row is small and its fields change
// rarely, so a fresh read per page load keeps it correct without the risk of a stale name
// being printed on a certificate.

let cachedProfile: InstitutionProfile | null = null;
let loadedOnce = false;
let pendingLoad: Promise<InstitutionProfile | null> | null = null;
const listeners = new Set<(profile: InstitutionProfile | null) => void>();

const notifyProfileListeners = () => {
  listeners.forEach((listener) => listener(cachedProfile));
};

// Synchronous read for places that build a document without a React tree, such as the
// standalone gate-pass print window. Null until the first read has finished.
export function getCachedSchoolProfile(): InstitutionProfile | null {
  return cachedProfile;
}

// Called after a save in School Settings, so every letterhead already on screen redraws
// with the new details without waiting for a reload.
export function setCachedSchoolProfile(profile: InstitutionProfile | null) {
  cachedProfile = profile;
  loadedOnce = true;
  notifyProfileListeners();
}

export function loadSchoolProfile(force = false): Promise<InstitutionProfile | null> {
  if (!force && loadedOnce) return Promise.resolve(cachedProfile);
  if (!force && pendingLoad) return pendingLoad;
  pendingLoad = fetchInstitutionProfile()
    .then(({ profile }) => {
      pendingLoad = null;
      loadedOnce = true;
      cachedProfile = profile;
      notifyProfileListeners();
      return profile;
    })
    .catch(() => {
      pendingLoad = null;
      return cachedProfile;
    });
  return pendingLoad;
}

// React hook: the saved school profile, or null while it is still being read or when the
// signed-in account is not allowed to see it.
export function useSchoolProfile(): InstitutionProfile | null {
  const [profile, setProfile] = useState<InstitutionProfile | null>(() => cachedProfile);
  useEffect(() => {
    setProfile(cachedProfile);
    listeners.add(setProfile);
    void loadSchoolProfile();
    return () => {
      listeners.delete(setProfile);
    };
  }, []);
  return profile;
}

// ============================================================================
// The lines a letterhead prints
// ============================================================================

const clean = (value: string | null | undefined) => (value ?? '').trim();

// Address, city, phone, email and website, in the order a reader expects them, with any
// field the school has left blank simply omitted rather than printed as a gap.
export function profileContactLine(profile: InstitutionProfile | null): string {
  return [
    clean(profile?.address),
    clean(profile?.city),
    clean(profile?.phone) ? `Phone: ${clean(profile?.phone)}` : '',
    clean(profile?.email),
    clean(profile?.website),
  ].filter(Boolean).join('  ·  ');
}

// The single strip under the school name: "Est. 2003 | Reg. No: 123321 | Affiliation No: 1425411".
export function profileRegistrationLine(profile: InstitutionProfile | null): string {
  return [
    clean(profile?.established_year) ? `Est. ${clean(profile?.established_year)}` : '',
    clean(profile?.registration_no) ? `Reg. No: ${clean(profile?.registration_no)}` : '',
    clean(profile?.affiliation_no) ? `Affiliation No: ${clean(profile?.affiliation_no)}` : '',
  ].filter(Boolean).join('  |  ');
}
