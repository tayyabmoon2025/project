import { useEffect, useState } from 'react';
import { DEFAULT_LOGO, useSchoolLogo } from '@/lib/schoolLogo';

// The school logo as drawn everywhere in the app. The logo uploaded in School
// Settings is shown whenever one is saved; the bundled emblem appears only while
// nothing is saved yet or the saved logo fails to load, and if even that fails the
// image disappears rather than showing a broken-image icon.
export function SchoolLogo({ alt, className, onLoad }: { alt: string; className?: string; onLoad?: () => void }) {
  const saved = useSchoolLogo();
  const [fallback, setFallback] = useState(false);
  const [unrenderable, setUnrenderable] = useState(false);

  useEffect(() => {
    setFallback(false);
  }, [saved]);

  if (unrenderable) return null;

  const src = !saved || fallback ? DEFAULT_LOGO : saved;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onLoad={onLoad}
      onError={src === DEFAULT_LOGO ? () => setUnrenderable(true) : () => setFallback(true)}
    />
  );
}
