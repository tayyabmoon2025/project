import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

function compressToDataUrl(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image failed to load'));
    };
    img.src = url;
  });
}

export function ProfileAvatar({
  photoUrl,
  name,
  size = 'md',
}: {
  photoUrl?: string | null;
  name: string;
  size?: 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim()
    ? name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const show = Boolean(photoUrl && !failed);

  return (
    <div className={`profile-avatar${size === 'lg' ? ' profile-avatar-lg' : ''}`}>
      {show ? (
        <img src={photoUrl ?? ''} alt={name} className="profile-avatar-photo" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </div>
  );
}

export function ProfilePhotoPicker({
  onToast,
  size = 'sm',
}: {
  onToast: (message: string) => void;
  size?: 'sm' | 'lg';
}) {
  const { profile, updateProfilePhoto } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('Please choose an image file.');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressToDataUrl(file, 256);
      const result = await updateProfilePhoto(dataUrl);
      if (result.error) onToast(result.error);
      else onToast('Profile photo updated.');
    } catch {
      onToast('Could not read that image. Please try another.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    const result = await updateProfilePhoto('');
    setBusy(false);
    if (result.error) onToast(result.error);
    else onToast('Profile photo removed.');
  };

  const hasPhoto = Boolean(profile?.photo_url);

  return (
    <div className={`profile-photo-picker profile-photo-picker-${size}`}>
      <ProfileAvatar photoUrl={profile?.photo_url ?? null} name={profile?.full_name ?? ''} size={size === 'lg' ? 'lg' : 'md'} />
      <div className="profile-photo-actions">
        <span className="profile-photo-caption">{hasPhoto ? 'Profile photo' : 'No photo yet'}</span>
        <button type="button" className="profile-photo-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Camera size={14} /> {busy ? 'Saving…' : hasPhoto ? 'Change photo' : 'Add photo'}
        </button>
        {hasPhoto && (
          <button type="button" className="profile-photo-btn remove" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
