import { ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * SkipRipple - YouTube-style feedback for a double-tap skip (T14350).
 *
 * Shades the tapped half of the video with a rounded inner edge and shows
 * chevrons plus the burst's running total ("5 seconds", "10 seconds", ...).
 * `feedback.id` changes on every tap, so the keyed ripple restarts its
 * animation. The ripple animation is off under prefers-reduced-motion (index.css);
 * the label always shows. Never intercepts pointer events.
 */
export function SkipRipple({ feedback }) {
  if (!feedback) return null;
  const isLeft = feedback.side === 'left';
  const Chevrons = isLeft ? ChevronsLeft : ChevronsRight;
  return (
    <div
      data-testid="skip-ripple"
      data-side={feedback.side}
      className={`absolute inset-y-0 w-1/2 z-40 pointer-events-none overflow-hidden flex items-center justify-center bg-black/25 ${
        isLeft ? 'left-0 rounded-r-[50%]' : 'right-0 rounded-l-[50%]'
      }`}
    >
      <span key={feedback.id} className="skip-ripple-circle absolute w-40 h-40 rounded-full bg-white/20" />
      <div className="relative flex flex-col items-center text-white drop-shadow">
        <Chevrons size={28} />
        <span className="text-sm font-semibold">{feedback.seconds} seconds</span>
      </div>
    </div>
  );
}
