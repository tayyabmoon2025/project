import { useEffect, useRef, useState } from 'react';
import { Camera, Check, CircleAlert as AlertCircle, Loader as Loader2, RotateCcw, SwitchCamera, X } from 'lucide-react';
import { photoDataUrlFromVideo } from '@/lib/photoImage';

// A live picture taken with whatever camera the machine has: the webcam on a desktop, the
// front or back camera on a phone. The stream is released the moment the window closes, so
// the camera light does not stay on.
export function CameraCaptureModal({ onCapture, onClose, onToast }: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStarting(true);
    setReady(false);
    setError('');
    setShot(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStarting(false);
      setError('This browser cannot open a camera. Use "Upload photo" instead.');
      return;
    }

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        // The window may have been closed while the browser was asking for permission, in
        // which case the stream has to be stopped rather than attached to nothing.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => {});
        }
        setCanSwitch(stream.getVideoTracks().length > 0);
        setStarting(false);
      })
      .catch(() => {
        if (cancelled) return;
        setStarting(false);
        setError('The camera could not be opened. Check that this site is allowed to use the camera, then try again.');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      setShot(photoDataUrlFromVideo(video));
    } catch {
      onToast('The camera was not ready. Wait a moment and press the button again.');
    }
  };

  const usePhoto = () => {
    if (!shot) return;
    onCapture(shot);
    onClose();
  };

  // The live view is mirrored the way a mirror behaves, so the face lines up with what the
  // person sees. The saved frame is flipped to match. The still is already the right way
  // round, so it is never flipped twice.
  const flipLive = facing === 'user';

  return (
    <div className="notice-overlay" onClick={onClose}>
      <section className="notice-modal camera-modal" onClick={(event) => event.stopPropagation()}>
        <div className="notice-preview-top">
          <span className="eyebrow"><Camera size={14} /> Take photo</span>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close camera"><X size={18} /></button>
        </div>

        <h2 className="payroll-modal-title">Take a photo</h2>
        <p className="payroll-modal-sub">Line the face up in the ring, then capture. The picture is squared off and shrunk.</p>

        <div className="camera-stage">
          {error ? (
            <div className="camera-message">
              <AlertCircle size={22} />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* The live video stays mounted while a still is being reviewed: taking the
                  element out would detach the camera stream and retaking would go black. */}
              <video
                ref={videoRef}
                className={`camera-media${flipLive ? ' mirrored' : ''}`}
                playsInline
                muted
                autoPlay
                onLoadedMetadata={() => setReady(true)}
              />
              {shot && <img src={shot} alt="Captured" className="camera-media camera-shot" />}
              {starting && (
                <div className="camera-message">
                  <Loader2 size={22} className="auth-spinner" />
                  <span>Starting the camera…</span>
                </div>
              )}
              {!starting && !shot && <span className="camera-guide" aria-hidden="true" />}
            </>
          )}
        </div>

        <div className="notice-preview-actions">
          {shot ? (
            <>
              <button type="button" className="secondary-button" onClick={() => setShot(null)}>
                <RotateCcw size={15} /> Retake
              </button>
              <button type="button" className="primary-button" onClick={usePhoto}>
                <Check size={16} /> Use this photo
              </button>
            </>
          ) : (
            <>
              {canSwitch && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
                >
                  <SwitchCamera size={15} /> Switch camera
                </button>
              )}
              <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
              <button type="button" className="primary-button" onClick={capture} disabled={starting || !ready}>
                {starting ? <Loader2 size={16} className="auth-spinner" /> : <Camera size={16} />} Capture photo
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
