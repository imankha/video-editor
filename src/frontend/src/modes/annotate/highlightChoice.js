// T11130: the rating that makes a play a Highlight (5). Done on a play rated
// this and not yet a highlight (no autoProjectId) opens the Highlight choice
// card instead of closing. Distinct from the removed playProgress
// CLIP_NUDGE_RATING — that drove a badge nudge.
export const HIGHLIGHT_RATING = 5;

/**
 * Whether Done on this play offers the Highlight choice card ("Make highlight
 * now" / "Back to editing"). Never while the game is still uploading: its source
 * isn't in storage yet, so a highlight can't be made from it (staging 2026-10-17,
 * "Make highlight now" opened Focus on a missing source).
 */
export function offersHighlightChoice(region, { gameUploading }) {
  return !!region && !gameUploading && region.rating === HIGHLIGHT_RATING && !region.autoProjectId;
}
