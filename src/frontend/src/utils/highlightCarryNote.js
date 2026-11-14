import { SPOTLIGHT_COPY } from '../config/displayNames';
// T4350: map the backend `highlight_carry_note` code to user-facing copy.
//
// A framing re-export preserves the user's overlay-edited highlights, but when it
// can't map some of them onto the new timeline it flags the loss LOUDLY rather than
// silently. The backend stamps one of these codes on the new working video
// (working_videos.highlight_carry_note); it is surfaced as an export-complete toast
// and as a persistent banner on the Overlay screen (both read the same code).
//
// Codes (keep in sync with app/services/highlight_carry.py):
//   null              -> nothing to surface (carried cleanly / verbatim)
//   "dropped:N"       -> N highlights fell outside the new trim
//   "legacy_uncertain"-> re-exported without a prior framing snapshot; positions unverified

export function describeHighlightCarryNote(note) {
  if (!note || typeof note !== 'string') return null;

  if (note.startsWith('dropped:')) {
    const n = parseInt(note.slice('dropped:'.length), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return SPOTLIGHT_COPY.carryDropped(n);
  }

  switch (note) {
    case 'legacy_uncertain':
      return SPOTLIGHT_COPY.CARRY_CHECK;
    default:
      return null;
  }
}
