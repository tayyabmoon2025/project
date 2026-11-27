import { useState } from 'react';
import { UserRound } from 'lucide-react';

const getInitials = (name: string) => name.split(' ').filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase();

export function StudentPhoto({ src, name, className }: { src?: string | null; name: string; className: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  if (showImage) {
    return <img src={src ?? undefined} alt={`${name} photo`} className={`${className} object-cover`} onError={() => setFailedSrc(src ?? null)} />;
  }

  return (
    <div role="img" aria-label={`${name} photo placeholder`} className={`${className} flex items-center justify-center bg-sky-100 text-sky-700`}>
      {getInitials(name) ? <span className="text-sm font-bold">{getInitials(name)}</span> : <UserRound size={28} />}
    </div>
  );
}
