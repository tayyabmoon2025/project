// Distance and geofence helpers shared by the staff check-in card, the daily
// attendance register and School Settings. The very same haversine formula runs
// in the database (public.school_geofence_distance_m), so the distance shown on
// screen and the verdict saved on the attendance row always agree.

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

export type Coordinates = { latitude: number; longitude: number };

export const isCoordinate = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) && Number.isFinite(longitude)
  && latitude >= -90 && latitude <= 90
  && longitude >= -180 && longitude <= 180;

// Great-circle distance in metres between two points on the earth's surface.
export function distanceInMeters(from: Coordinates, to: Coordinates): number {
  const dLat = (to.latitude - from.latitude) * DEG_TO_RAD;
  const dLng = (to.longitude - from.longitude) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(from.latitude * DEG_TO_RAD) * Math.cos(to.latitude * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

export type GeofenceVerdict =
  | { state: 'inside'; distanceM: number }
  | { state: 'outside'; distanceM: number }
  | { state: 'unknown' };

// "Unknown" is a real answer, not an error: it is what we say when the school
// location has not been saved yet or the device refused to give a position.
export function geofenceVerdict(
  here: Coordinates | null,
  school: Coordinates | null,
  radiusM: number,
): GeofenceVerdict {
  if (!here || !school || !Number.isFinite(radiusM)) return { state: 'unknown' };
  const distanceM = distanceInMeters(here, school);
  return distanceM <= radiusM ? { state: 'inside', distanceM } : { state: 'outside', distanceM };
}

// The verdict as stored on the row, rebuilt from the saved numbers so the screen
// never has to trust a flag over the coordinates it was written from.
export function verdictFromRow(
  inside: boolean | null,
  distanceM: number | null,
): GeofenceVerdict {
  if (distanceM === null || inside === null) return { state: 'unknown' };
  return inside ? { state: 'inside', distanceM } : { state: 'outside', distanceM };
}

export function formatDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM)) return '—';
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(distanceM < 10000 ? 1 : 0)} km`;
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export type PositionResult = { coords: Coordinates | null; error: string | null };

// One reading, with a clear reason when it cannot be taken. The timeout is long
// enough for a phone to get its first fix indoors but short enough that the
// screen never looks frozen.
export function readCurrentPosition(timeoutMs = 12000): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ coords: null, error: 'This device cannot report a location.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
        error: null,
      }),
      (error) => {
        const reason = error.code === error.PERMISSION_DENIED
          ? 'Location permission was blocked. Allow it in the browser address bar and try again.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Your location could not be found. Move near a window or switch on GPS.'
            : 'Finding your location took too long. Try again.';
        resolve({ coords: null, error: reason });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}
