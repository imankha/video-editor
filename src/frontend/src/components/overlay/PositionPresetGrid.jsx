import { POSITION_PRESETS, matchPreset, presetKey } from '../../constants/textPositionPresets';

/**
 * PositionPresetGrid (T6630 round 3) -- replaces free-dragging a text block on
 * the video stage with 3 vertical x 3 horizontal anchor presets (user
 * direction). Emits a COMPLETE spec patch (position + align) through the SAME
 * onChange the settings editor already uses, so persistence is the existing
 * single surgical write -- no second write path, no schema change.
 *
 * Highlights a slot ONLY when the spec's stored position/align exactly matches
 * a preset (via the shared `matchPreset`, epsilon-tolerant for float drift).
 * An arbitrary stored position (e.g. a pre-round-3 block) highlights NOTHING --
 * never silently snapped or migrated (project rule: no persisted runtime
 * fixups).
 *
 * T10790: presets are FULL-FRAME fractions (0.08/0.92 insets from each edge --
 * textPositionPresets.js), but the video preview has its own independent
 * zoom/pan (framing/spotlight precision editing) that can crop the visible
 * viewport down to the center of the frame. A user who zoomed in for other
 * work, then clicks e.g. "top right", gets a CORRECTLY-placed element that
 * lands outside the current cropped view -- reading as "the preset put it way
 * off in the corner" when it's actually just out of frame in the zoomed
 * preview (confirmed live: the same preset sits with comfortable margin at
 * 100% zoom, and is pushed fully off-screen by ~150%). A preset click implies
 * "show me where this lands in my frame", so it snaps the preview back to
 * 100%/centered via `onResetZoom` -- the same full-frame view the fractions
 * are defined against -- rather than leaving the result apparently invisible.
 * `onResetZoom` (useZoom.js's `resetZoom`) is idempotent, so this calls it
 * unconditionally rather than re-deriving useZoom's own `isZoomed` here.
 */
export default function PositionPresetGrid({ spec, onChange, onResetZoom }) {
  const matched = matchPreset(spec.position, spec.align);

  const handlePresetClick = (p) => {
    onChange({ ...spec, position: { x: p.x, y: p.y }, align: p.align });
    onResetZoom?.();
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">Position</span>
      <div className="grid grid-cols-3 gap-1 w-fit" data-testid="text-position-grid">
        {POSITION_PRESETS.map((p) => {
          const key = presetKey(p.vertical, p.horizontal);
          const isActive = !!matched && matched.vertical === p.vertical && matched.horizontal === p.horizontal;
          return (
            <button
              key={key}
              type="button"
              data-testid={`text-position-${key}`}
              aria-pressed={isActive}
              aria-label={`Position: ${p.vertical} ${p.horizontal}`}
              title={`${p.vertical} ${p.horizontal}`}
              onClick={() => handlePresetClick(p)}
              className={`w-8 h-8 rounded border flex items-center justify-center transition-colors coarse-pointer:w-11 coarse-pointer:h-11 ${
                isActive
                  ? 'bg-cyan-500 border-cyan-300'
                  : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
              }`}
            >
              <span className={`block w-2 h-2 rounded-full ${isActive ? 'bg-white' : 'bg-gray-500'}`} />
            </button>
          );
        })}
      </div>
      {!matched && (
        <span className="text-[11px] text-gray-500">Custom position (no preset selected)</span>
      )}
    </div>
  );
}
