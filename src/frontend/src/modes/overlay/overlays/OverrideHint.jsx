import { useEffect, useState } from 'react';

/**
 * OverrideHint (T5610) — a subtle, one-time teach that the spotlight circle can be
 * manually overridden. Rendered directly under the "N players detected" count badge
 * (top-right of the video area, T5643), low z (below the edit handles/grip), and
 * NON-interactive (`pointer-events-none`) so it never steals a tap from the circle, a
 * player box, or video tap-nav.
 *
 * It names BOTH override paths per the approved UX: tapping the spotlight AND hiding
 * the tracking layer, so users also learn the toggle exists.
 *
 * Visibility is driven by the `visible` prop (owned by OverlayModeView as ephemeral
 * view state — NOT persisted, NOT reel data). When `visible` flips false (the user has
 * used an override for the first time) the pill FADES OUT over 300ms, then unmounts and
 * stays gone for the session. This component only animates; it never decides when to
 * show — that logic (tracking ON + a region exists + not yet overridden + no tracking
 * keyframe selected, T5643) lives in the parent so the "seen" flag stays view-state.
 */
export default function OverrideHint({ visible, text }) {
  // Keep the node mounted through the fade-out so the opacity transition can play.
  const [present, setPresent] = useState(visible);

  useEffect(() => {
    if (visible) {
      setPresent(true);
      return undefined;
    }
    // Fading out: unmount after the transition finishes.
    const timer = setTimeout(() => setPresent(false), 300);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!present) return null;

  return (
    <div
      data-testid="override-hint"
      aria-hidden="true"
      className={`pointer-events-none absolute top-14 right-4 z-[5] max-w-[220px] px-3 py-1.5 rounded-full text-xs text-center text-white/70 bg-black/40 backdrop-blur transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {text}
    </div>
  );
}
