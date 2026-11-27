import { useCallback, useEffect, useState } from 'react';
import { CircleCheck as CheckCircle2, CircleAlert, ExternalLink, LogIn, LogOut, Loader as Loader2, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  fetchStaffAttendance,
  selfCheckIn,
  selfCheckOut,
  type StaffAttendanceRecord,
} from '@/lib/staffAttendance';
import { fetchSchoolGeofence, type SchoolGeofence } from '@/lib/systemSetup';
import { formatDistance, geofenceVerdict, mapsUrl, readCurrentPosition, type Coordinates } from '@/lib/geofence';
import { todayKey } from '@/lib/attendance';

const timeOf = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const place = (latitude: number | null, longitude: number | null) =>
  latitude !== null && longitude !== null ? { latitude, longitude } : null;

export function StaffCheckInCard({ onToast }: { onToast: (message: string) => void }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [record, setRecord] = useState<StaffAttendanceRecord | null>(null);
  const [geofence, setGeofence] = useState<SchoolGeofence | null>(null);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'in' | 'out' | 'locate' | 'refresh' | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (id: string) => {
    const [records, fence] = await Promise.all([fetchStaffAttendance(todayKey()), fetchSchoolGeofence()]);
    setRecord(records.find((row) => row.staff_user_id === id) ?? null);
    setGeofence(fence.geofence);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id ?? null;
      if (cancelled) return;
      setUserId(id);
      if (id) await load(id);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [load]);

  // Returns the position it read, or the one already held, so a failed reading
  // never blocks a check-in — the day is still recorded, just without a distance.
  const locate = async () => {
    setBusy('locate');
    setNotice('');
    const result = await readCurrentPosition();
    setBusy(null);
    if (!result.coords) { setNotice(result.error ?? 'Your location could not be found.'); return null; }
    setPosition(result.coords);
    return result.coords;
  };

  const mark = async (kind: 'in' | 'out') => {
    setBusy(kind);
    setNotice('');
    const coords = position ?? await locate();
    const result = kind === 'in' ? await selfCheckIn(coords) : await selfCheckOut(coords);
    setBusy(null);
    if (!result.ok) { setNotice(result.message); return; }
    if (userId) await load(userId);
    onToast(result.message);
  };

  const refresh = async () => {
    if (!userId) return;
    setBusy('refresh');
    await load(userId);
    setBusy(null);
  };

  if (loading) {
    return (
      <section className="fee-card staff-checkin-card">
        <p className="fee-empty"><Loader2 size={15} className="auth-spinner" /> Checking today's attendance…</p>
      </section>
    );
  }

  const checkInAt = record?.check_in_at ?? null;
  const checkOutAt = record?.check_out_at ?? null;
  const officeRecorded = record !== null && checkInAt === null;
  const checkInSpot = place(record?.check_in_lat ?? null, record?.check_in_lng ?? null);
  const checkOutSpot = place(record?.check_out_lat ?? null, record?.check_out_lng ?? null);
  const liveVerdict = geofence?.configured && position && geofence.latitude !== null && geofence.longitude !== null
    ? geofenceVerdict(position, { latitude: geofence.latitude, longitude: geofence.longitude }, geofence.radiusM)
    : null;

  const distanceText = (inside: boolean | null, distanceM: number | null) =>
    distanceM === null
      ? 'Location not recorded'
      : `${inside ? 'Inside school' : 'Outside school'} — ${formatDistance(distanceM)} from the gate`;

  return (
    <section className="fee-card staff-checkin-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">My attendance</span>
          <h2>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long' })}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy !== null || !userId}>
          {busy === 'refresh' ? <Loader2 size={14} className="auth-spinner" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="staff-checkin-grid">
        <div className={`staff-checkin-slot ${checkInAt ? 'done' : ''}`}>
          <span className="staff-checkin-icon"><LogIn size={18} /></span>
          <div>
            <span className="staff-checkin-label">Check-in</span>
            <strong>{timeOf(checkInAt)}</strong>
            {checkInAt ? distanceText(record?.check_in_inside ?? null, record?.check_in_distance_m ?? null) : 'Not marked yet'}
          </div>
          {checkInSpot && (
            <a className="map-badge" href={mapsUrl(checkInSpot.latitude, checkInSpot.longitude)} target="_blank" rel="noopener noreferrer">
              <MapPin size={12} /> View Map <ExternalLink size={11} />
            </a>
          )}
        </div>

        <div className={`staff-checkin-slot ${checkOutAt ? 'done' : ''}`}>
          <span className="staff-checkin-icon"><LogOut size={18} /></span>
          <div>
            <span className="staff-checkin-label">Check-out</span>
            <strong>{timeOf(checkOutAt)}</strong>
            <small>{checkOutAt ? distanceText(record?.check_out_inside ?? null, record?.check_out_distance_m ?? null) : 'Not marked yet'}</small>
          </div>
          {checkOutSpot && (
            <a className="map-badge" href={mapsUrl(checkOutSpot.latitude, checkOutSpot.longitude)} target="_blank" rel="noopener noreferrer">
              <MapPin size={12} /> View Map <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {officeRecorded && (
        <div className="geo-status pending">
          <CircleAlert size={15} />
          <span>The school office has already recorded today's attendance for you, so self check-in is closed for today.</span>
        </div>
      )}

      {!officeRecorded && (
        <div className="staff-checkin-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void mark('in')}
            disabled={busy !== null || checkInAt !== null}
          >
            {busy === 'in' ? <Loader2 size={15} className="auth-spinner" /> : <LogIn size={15} />}
            {checkInAt ? 'Checked in' : 'Check in now'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void mark('out')}
            disabled={busy !== null || checkInAt === null || checkOutAt !== null}
          >
            {busy === 'out' ? <Loader2 size={15} className="auth-spinner" /> : <LogOut size={15} />}
            {checkOutAt ? 'Checked out' : 'Check out'}
          </button>
          <button type="button" className="secondary-button" onClick={() => void locate()} disabled={busy !== null}>
            {busy === 'locate' ? <Loader2 size={15} className="auth-spinner" /> : <MapPin size={15} />}
            Update my location
          </button>
        </div>
      )}

      {position && (
        <div className={`geo-status ${liveVerdict?.state === 'inside' ? 'ready' : 'pending'}`}>
          {liveVerdict?.state === 'inside' ? <CheckCircle2 size={15} /> : <MapPin size={15} />}
          <span>
            Your device reports {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
            {liveVerdict && liveVerdict.state !== 'unknown'
              ? ` — ${liveVerdict.state === 'inside' ? 'inside' : 'outside'} school, ${formatDistance(liveVerdict.distanceM)} from the gate.`
              : ' — the school location is not saved yet, so no distance can be shown.'}
          </span>
          <a className="map-badge" href={mapsUrl(position.latitude, position.longitude)} target="_blank" rel="noopener noreferrer">
            <MapPin size={12} /> View Map <ExternalLink size={11} />
          </a>
        </div>
      )}

      {notice && <p className="geo-message">{notice}</p>}

      <p className="fin-hint">
        Your check-in is stamped with the time and the location your device reports. The school office
        can see whether you were inside the school grounds when you marked it.
      </p>
    </section>
  );
}
