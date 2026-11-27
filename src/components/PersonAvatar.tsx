import { useState } from 'react';

// The face of a staff member where their initials would otherwise go. Every list that names
// a person uses this, so a photo uploaded once appears in all of them.
export function PersonAvatar({ photoUrl, name, className = 'student-avatar' }: {
  photoUrl?: string | null;
  name: string;
  className?: string;
}) {
  // A photo stored as a link can stop working, and a broken picture is worse than initials.
  const [failed, setFailed] = useState(false);
  const initials = name.trim()
    ? name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2)
    : '?';

  if (!photoUrl || failed) return <div className={className}>{initials}</div>;

  return (
    <div className={`${className} person-avatar`}>
      <img src={photoUrl} alt={name} className="person-avatar-photo" onError={() => setFailed(true)} />
    </div>
  );
}
