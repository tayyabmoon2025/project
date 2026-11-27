import { useEffect, useState } from 'react';
import { Crosshair, ExternalLink, Loader as Loader2, MapPin } from 'lucide-react';
import { AsyncSaveButton } from '@/components/SaveButton';
import {
  DEFAULT_ATTENDANCE_RADIUS_M,
  fetchSchoolGeofence,
  saveSchoolGeofence,
} from '@/lib/systemSetup';
import { formatDistance, mapsUrl, readCurrentPosition } from '@/lib/geofence';
import { useAuth } from '@/lib/auth';

type Draft = { latitude: string; longitude: string; radiusM: string };

const toInput = (value: number | null) => (value === null ? '' : String(value));

const parseCoordinate = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function SystemSchoolLocationTab({ onToast }: { onToast: (message: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [draft, setDraft] = useState<Draft>({ latitude: '', longitude: '', radiusM: String(DEFAULT_ATTENDANCE_RADIUS_M) });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const result = await fetchSchoolGeofence();
    setDraft({
      latitude: toInput(result.geofence.latitude),
      longitude: toInput(result.geofence.longitude),
      radiusM: String(result.geofence.radiusM),
    });
    setError(result.error ?? '');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const latitude = parseCoordinate(draft.latitude);
  const longitude = parseCoordinate(draft.longitude);
  const radiusM = parseCoordinate(draft.radiusM);
  const configured = latitude !== null && longitude !== null;

  const readDeviceLocation = async () => {
    setLocating(true);
    setMessage('');
    const result = await readCurrentPosition();
    setLocating(false);
    if (!result.coords) { setMessage(result.error ?? 'Your location could not be found.'); return; }
    setDraft((current) => ({
      ...current,
      latitude: result.coords!.latitude.toFixed(6),
      longitude: result.coords!.longitude.toFixed(6),
    }));
    setMessage('Location read from this device. Save it to use it as the school gate.');
  };

  const submit = async (): Promise<boolean | void> => {
    setSaving(true);
    const saveError = await saveSchoolGeofence({ latitude, longitude, radiusM: radiusM ?? DEFAULT_ATTENDANCE_RADIUS_M });
    setSaving(false);
    if (saveError) { onToast(saveError); return false; }
    onToast(configured ? 'School location saved.' : 'Radius saved. Add the school coordinates to switch the map on.');
    setMessage('');
    return true;
  };

  const clearLocation = async () => {
    setSaving(true);
    const saveError = await saveSchoolGeofence({ latitude: null, longitude: null, radiusM: radiusM ?? DEFAULT_ATTENDANCE_RADIUS_M });
    setSaving(false);
    if (saveError) { onToast(saveError); return; }
    setDraft((current) => ({ ...current, latitude: '', longitude: '' }));
    onToast('School coordinates cleared. Check-in still works, but without a distance.');
  };

  if (loading) return <p className="fee-empty">Loading the school location…</p>;

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Attendance location</span>
          <h2>School GPS location</h2>
          <p className="fee-hint">
            Save the school gate's position once. Every staff check-in is then measured against it and
            marked inside or outside the allowed radius.
          </p>
        </div>
        {isAdmin && (
          <AsyncSaveButton label="Save location" size={15} disabled={saving} onSave={() => submit()} />
        )}
      </div>

      {error && <div className="fee-alert"><span>{error}</span></div>}

      <div className="util-form">
        <div className="util-form-grid">
          <label className="control-field">School latitude
            <input
              value={draft.latitude}
              onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value }))}
              disabled={!isAdmin}
              inputMode="decimal"
              placeholder="e.g. 31.520370"
            />
          </label>
          <label className="control-field">School longitude
            <input
              value={draft.longitude}
              onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value }))}
              disabled={!isAdmin}
              inputMode="decimal"
              placeholder="e.g. 74.358749"
            />
          </label>
          <label className="control-field">Allowed radius (metres)
            <input
              value={draft.radiusM}
              onChange={(event) => setDraft((current) => ({ ...current, radiusM: event.target.value }))}
              disabled={!isAdmin}
              inputMode="numeric"
              placeholder={String(DEFAULT_ATTENDANCE_RADIUS_M)}
            />
          </label>
        </div>

        <div className="geo-actions">
          <button type="button" className="secondary-button" onClick={() => void readDeviceLocation()} disabled={!isAdmin || locating}>
            {locating ? <Loader2 size={15} className="auth-spinner" /> : <Crosshair size={15} />}
            {locating ? 'Reading this device…' : 'Use current location'}
          </button>
          {configured && (
            <>
              <a className="secondary-button" href={mapsUrl(latitude!, longitude!)} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} /> Check on the map
              </a>
              {isAdmin && (
                <button type="button" className="secondary-button" onClick={() => void clearLocation()} disabled={saving}>
                  Clear coordinates
                </button>
              )}
            </>
          )}
        </div>

        <div className={`geo-status ${configured ? 'ready' : 'pending'}`}>
          <MapPin size={15} />
          <span>
            {configured
              ? `Staff check-ins are measured from ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}. Anything within ${formatDistance(radiusM ?? DEFAULT_ATTENDANCE_RADIUS_M)} counts as inside school.`
              : 'No school coordinates saved yet. Check-in is recorded without a distance until you save them.'}
          </span>
        </div>

        {message && <p className="geo-message">{message}</p>}

        <p className="fin-hint">
          Stand at the school gate, tap “Use current location”, then save. A radius of 100 m covers a
          typical school building and its yard; widen it if the campus is larger.
        </p>
      </div>
    </div>
  );
}
