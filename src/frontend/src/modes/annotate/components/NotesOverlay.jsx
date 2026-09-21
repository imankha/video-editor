import React from 'react';
import { CheckCircle2, Film } from 'lucide-react';
import { RATING_NOTATION, RATING_BADGE_COLORS, UNRATED_BADGE_COLOR, getRatingLabel } from '../../../components/shared/clipConstants';
import { RatingIcon } from '../../../components/shared/RatingIcon';
import { CLIP_STAGE } from '../clipStage';

// T10920: upper-right corner mark for what became of this play. Two states
// only -- PUBLISHED (check) and "a clip exists but is not published yet"
// (film glyph: FOCUS / SPOTLIGHT / FINAL). NO_PROJECT draws nothing.
const CLIP_STATE_MARK = {
  [CLIP_STAGE.PUBLISHED]: { Icon: CheckCircle2, color: '#16a34a', label: 'Published clip', testId: 'notes-overlay-published' },
  [CLIP_STAGE.FINAL]: { Icon: Film, color: '#0891b2', label: 'Clip created, not published yet', testId: 'notes-overlay-clipped' },
  [CLIP_STAGE.SPOTLIGHT]: { Icon: Film, color: '#0891b2', label: 'Clip created, not published yet', testId: 'notes-overlay-clipped' },
  [CLIP_STAGE.FOCUS]: { Icon: Film, color: '#0891b2', label: 'Clip created, not published yet', testId: 'notes-overlay-clipped' },
};

// Border colors come from the ONE rating palette in clipConstants (was a local copy).
const RATING_COLORS = RATING_BADGE_COLORS;

/**
 * NotesOverlay - Displays clip name, rating notation, and notes as text overlay on the video
 *
 * Styling per spec:
 * - Position: absolute, top of video
 * - Background: white (95% opacity) with colored border
 * - Border color matches rating (red→amber→blue→green→light green)
 * - Text: black
 * - Width: 80% centered
 * - Rounded corners
 * - Rating notation + Name: centered, first line, bold
 * - Notes: below name
 * - More vertical padding in fullscreen mode
 *
 * Only visible when playhead is in a clip region with a name or notes.
 */
export function NotesOverlay({ name, notes, rating, gameClock = null, clipStage = null, isVisible, isFullscreen = false }) {
  if (!isVisible || (!name && !notes)) {
    return null;
  }

  const notation = rating ? RATING_NOTATION[rating] || '' : '';
  const clipMark = clipStage ? CLIP_STATE_MARK[clipStage] || null : null;
  // T10690: an unrated clip's border is neutral, not a borrowed "Interesting"
  // blue — a NULL rating is a real state, never a value to substitute.
  const borderColor = rating ? RATING_COLORS[rating] : UNRATED_BADGE_COLOR;

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 w-4/5 max-w-2xl z-50 pointer-events-none ${
        isFullscreen ? 'top-16' : 'top-2'
      }`}
      style={{
        // Using inline styles for precise control per spec
        background: 'rgba(255, 255, 255, 0.95)',
        color: '#000000',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        lineHeight: '1.4',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        border: `4px solid ${borderColor}`,
      }}
    >
      {clipMark && (
        <span
          className="absolute top-1.5 right-2 inline-flex"
          style={{ color: clipMark.color }}
          role="img"
          aria-label={clipMark.label}
          data-testid={clipMark.testId}
        >
          <clipMark.Icon size={18} aria-hidden="true" />
        </span>
      )}
      {name && (
        // T5290: below sm the narrow pill laid the absolutely-positioned game clock
        // over the centered name (`8'56"Good Control`). Below sm, lay time + notation
        // + name out inline with a gap so they read as `8'56" ! Good Control`; at sm+
        // the original absolute-left clock / centered name returns (byte-identical).
        // Pure Tailwind sm: treatment (640px) — matches the recap layout breakpoint,
        // no JS, and stays consistent across every NotesOverlay consumer.
        <div
          className="font-bold flex flex-wrap items-baseline justify-center gap-1.5 sm:block sm:relative sm:text-center"
          style={{ marginBottom: notes ? '4px' : 0 }}
        >
          {/* T4070: in-match time (soccer notation) on the left, name centered. */}
          {gameClock && (
            <span className="tabular-nums text-[#666] sm:absolute sm:left-0 sm:top-0">{gameClock}</span>
          )}
          {notation && (
            <span className="inline-flex self-center sm:mr-1.5 sm:align-middle" aria-label={getRatingLabel(rating)}>
              <RatingIcon rating={rating} size={18} />
            </span>
          )}
          <span>{name}</span>
        </div>
      )}
      {notes && <div>{notes}</div>}
    </div>
  );
}

export default NotesOverlay;
