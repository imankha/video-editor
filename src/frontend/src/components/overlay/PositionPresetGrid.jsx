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
 */
export default function PositionPresetGrid({ spec, onChange }) {
  const matched = matchPreset(spec.position, spec.align);

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
              onClick={() => onChange({ ...spec, position: { x: p.x, y: p.y }, align: p.align })}
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
