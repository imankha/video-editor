// T6710 — MotionPreview stopped self-completing via setTimeout(onDone); it is
// now purely currentTimeMs-driven/seekable (design §4(i)), and end-of-intro
// ownership for the owner in-app composite moved to useIntroPlayback. Three
// OTHER callers still want the old "mount, play once, tell me when it's
// done" behavior and are out of this task's scope to restructure:
//   - IntroPreRoll.jsx (SharedVideoOverlay / SharedCollectionView pre-roll)
//   - IntroCardCarousel.jsx (attachment picker's tap-to-preview)
//   - IntroCardStage.jsx (editor's Play/Stop motion-preview button)
// This hook is their shared, self-contained fallback clock: ticks a local
// currentTimeMs 0 -> durationMs via rAF while `active`, fires `onDone` once at
// the end. NOT a second "real" intro clock — useIntroPlayback remains the
// one owner-in-app composite clock; this is a small legacy-compat shim used
// by three simple, single-shot preview surfaces.
import { useEffect, useRef, useState } from 'react';

export function useMotionPreviewAutoplay(durationMs, { active, onDone }) {
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const doneFiredRef = useRef(false);
  const rafRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active) return undefined;
    setCurrentTimeMs(0);
    doneFiredRef.current = false;
    let elapsedMs = 0;
    let lastFrameTime = performance.now();
    let cancelled = false;
    const tick = (now) => {
      if (cancelled) return;
      elapsedMs += now - lastFrameTime;
      lastFrameTime = now;
      setCurrentTimeMs(Math.min(elapsedMs, durationMs));
      if (elapsedMs >= durationMs) {
        if (!doneFiredRef.current) {
          doneFiredRef.current = true;
          onDoneRef.current?.();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, durationMs]);

  return currentTimeMs;
}

export default useMotionPreviewAutoplay;
