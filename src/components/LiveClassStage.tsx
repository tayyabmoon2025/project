import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Mic, MicOff, MonitorUp, RefreshCw, Video, VideoOff } from 'lucide-react';
import { modeLabel, type LiveClassMode } from '@/lib/liveClasses';

type StageError = { title: string; detail: string } | null;

// The classroom stage plays the local camera, microphone and screen share straight
// through the browser — nothing is embedded from an outside meeting service, so the
// room can never be blocked by the school network or the browser.
export function LiveClassStage({ mode, meetingUrl, meetingLabel }: {
  mode: LiveClassMode;
  meetingUrl: string;
  meetingLabel: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(mode === 'video');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<StageError>(null);

  const stopEverything = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  const attachStream = (stream: MediaStream | null) => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      streamRef.current = stream;
      setMicOn(true);
      setCamOn(mode === 'video');
      attachStream(sharing ? screenRef.current : stream);
      setStarted(true);
    } catch (caught) {
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'SecurityError');
      setError(denied
        ? {
            title: 'Camera and microphone were blocked',
            detail: 'Allow camera and microphone for this site in your browser (tap the lock icon near the address bar), then press Try again.',
          }
        : {
            title: 'Camera and microphone could not start',
            detail: 'No camera or microphone was found, or another app is using it. Close other apps and press Try again.',
          });
    } finally {
      setStarting(false);
    }
  };

  const toggleMic = () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) { setCamOn(false); return; }
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const stopShare = useCallback(() => {
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setSharing(false);
    attachStream(streamRef.current);
  }, []);

  const toggleShare = async () => {
    if (sharing) { stopShare(); return; }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenRef.current = screen;
      setSharing(true);
      attachStream(screen);
      screen.getVideoTracks()[0]?.addEventListener('ended', stopShare);
      setError(null);
    } catch {
      setError({
        title: 'Screen share was cancelled or blocked',
        detail: 'The browser did not hand over the screen. Press Share screen and pick a window or the whole screen, then allow it.',
      });
    }
  };

  const camTrack = streamRef.current?.getVideoTracks()[0];
  const showCamera = started && !sharing && mode === 'video' && camOn && camTrack;

  return (
    <div className="live-stage-native">
      <div className="live-stage-view">
        {showCamera || sharing ? (
          <video
            className="live-stage-video"
            ref={videoRef}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="live-stage-idle">
            {started ? (
              mode === 'audio' ? (
                <>
                  <span className="live-stage-orb"><Mic size={34} strokeWidth={1.6} /></span>
                  <strong>{micOn ? 'Your microphone is open' : 'Your microphone is muted'}</strong>
                  <small>Audio-only lesson — the camera stays off. Speak normally; families on the portal hear you live.</small>
                </>
              ) : (
                <>
                  <span className="live-stage-orb"><VideoOff size={34} strokeWidth={1.6} /></span>
                  <strong>Camera is off</strong>
                  <small>Turn the camera on with the button below, or share your screen to show the lesson.</small>
                </>
              )
            ) : (
              <>
                <span className="live-stage-orb"><Video size={34} strokeWidth={1.6} /></span>
                <strong>Classroom stage ready</strong>
                <small>
                  Start the camera and microphone to go live in this room. Nothing is sent to an outside
                  meeting site — the lesson runs right here in the school app.
                </small>
                <button type="button" className="live-go-live" onClick={() => void start()} disabled={starting}>
                  {starting ? 'Starting…' : mode === 'audio' ? 'Open microphone' : 'Start camera & microphone'}
                </button>
              </>
            )}
          </div>
        )}
        {sharing && (
          <div className="live-pip" aria-hidden="true">
            <video ref={(node) => { if (node && node.srcObject !== streamRef.current) node.srcObject = streamRef.current; }} autoPlay playsInline muted />
            <span>You</span>
          </div>
        )}
        {started && (
          <span className={`live-stage-status${micOn ? '' : ' muted'}`}>
            {sharing ? <><MonitorUp size={13} /> Sharing your screen</> : micOn ? <><Mic size={13} /> Microphone on</> : <><MicOff size={13} /> Microphone muted</>}
            {' · '}{modeLabel(mode)}
          </span>
        )}
      </div>

      {error && (
        <div className="live-stage-error" role="alert">
          <strong>{error.title}</strong>
          <p>{error.detail}</p>
          <button type="button" className="live-secondary" onClick={() => void start()} disabled={starting}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      <div className="live-stage-controls">
        <button
          type="button"
          className={`live-ctl${started && micOn ? ' on' : ''}`}
          onClick={toggleMic}
          disabled={!started}
        >
          {started && micOn ? <Mic size={16} /> : <MicOff size={16} />}
          {started && micOn ? 'Mute mic' : 'Unmute mic'}
        </button>
        {mode === 'video' && (
          <button
            type="button"
            className={`live-ctl${camOn ? ' on' : ''}`}
            onClick={toggleCam}
            disabled={!started}
          >
            {camOn ? <Video size={16} /> : <VideoOff size={16} />}
            {camOn ? 'Camera off' : 'Camera on'}
          </button>
        )}
        <button
          type="button"
          className={`live-ctl share${sharing ? ' on' : ''}`}
          onClick={() => void toggleShare()}
          disabled={!started}
        >
          <MonitorUp size={16} />
          {sharing ? 'Stop sharing' : 'Share screen'}
        </button>
        <a className="live-ctl link" href={meetingUrl} target="_blank" rel="noreferrer" title={meetingLabel}>
          <ExternalLink size={16} /> Open meeting in new tab
        </a>
      </div>
    </div>
  );
}
