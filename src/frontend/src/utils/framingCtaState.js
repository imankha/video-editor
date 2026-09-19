/**
 * T10650 — pure derivation of Focus's action-band CTA state.
 *
 * When the current framing is already rendered, the primary CTA becomes
 * "Back to Preview" (mode: 'preview') instead of "Generate Framing"
 * (mode: 'generate'), so the user can reopen the render they already paid for
 * instead of re-rendering byte-identical framing. Once framing changes, the CTA
 * flips back to 'generate' and a secondary ghost "Back to Preview" link appears
 * (showBackToPreview) so the previous render is still reachable.
 *
 * Staleness is DURABLE, not merely in-memory: clips.py mints a NEW working_clips
 * version with exported_at NULL whenever an exported clip's framing is edited,
 * and a freshly added clip starts NULL. A NULL exported_at in the latest clip
 * list therefore means the render does not reflect current framing, and this
 * survives a reload where the in-memory framingChangedSinceExport flag is false.
 *
 * No fallbacks (per the task file): if `clips` is missing we cannot confirm the
 * render is current, so we return today's behavior ('generate', no ghost)
 * rather than guessing 'preview'. Entering 'preview' or offering the ghost link
 * both require a known clip array.
 *
 * @param {{ workingVideoId: (number|null|undefined),
 *           clips: (Array|null|undefined),
 *           framingChangedSinceExport: (boolean|undefined) }} params
 * @returns {{ mode: ('generate'|'preview'), showBackToPreview: boolean, renderedAt: (string|null) }}
 */
export function deriveFramingCtaState({ workingVideoId, clips, framingChangedSinceExport }) {
  const hasRender = !!workingVideoId;
  const clipsKnown = Array.isArray(clips);
  const hasUnrenderedEdits = clipsKnown && clips.some((c) => !c.exported_at);
  const stale = !!framingChangedSinceExport || hasUnrenderedEdits;
  return {
    mode: hasRender && clipsKnown && !stale ? 'preview' : 'generate',
    showBackToPreview: hasRender && clipsKnown && stale,
    renderedAt: hasRender && clipsKnown ? maxExportedAt(clips) : null,
  };
}

/** Most recent exported_at across the clip list (ISO strings sort lexically), or null. */
function maxExportedAt(clips) {
  const stamps = clips.map((c) => c.exported_at).filter(Boolean);
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (a > b ? a : b));
}
