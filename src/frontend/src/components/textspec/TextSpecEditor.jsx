// T5225 -- the SHARED TextSpec editing rail.
//
// Design: docs/plans/tasks/T5225-design.md §4.1. Pure presentational, exactly
// like RichText (T5180): props in, no store access, no fetch/API call, no
// persistence opinion. The HOST owns what happens with the edited spec --
// this component only ever emits a COMPLETE, valid TextSpec via onChange,
// never a partial delta, so a host can persist it atomically (design O4:
// whole-spec-per-block, debounced by the host).
//
// This is the FIRST consumer (T5225, the Overlay text rail) but it is reused by
// T5205's card editor rail -- one editing UI for one shared TextSpec, matching
// the "exactly one preview component" rule the epic sets for RichText/text_render.
//
// <TextSpecEditor spec={TextSpec} onChange={(nextSpec) => void} fonts={FontKey[]} />
//
// Optional props let a host tailor the SAME editor without a second component
// (T5205 opts into all three; T5225 passes none and keeps its raw controls):
//   hideText      -- omit the Text field (the card editor edits the title/fact
//                    text outside the styling rail, since a fact's text comes
//                    from the profile, not this spec).
//   sizePresets   -- [{key,label,value}]; render Size as preset buttons
//                    (S/M/L/XL) instead of the raw range.
//   colorSwatches -- [hex]; render quick-pick swatches beside the custom picker.

import { Align, FontKey } from '../../constants/textSpec';

const FONT_LABELS = {
  [FontKey.ANTON]: 'Anton',
  [FontKey.OSWALD]: 'Oswald',
  [FontKey.GRADUATE]: 'Graduate',
  [FontKey.PLAYFAIR]: 'Playfair',
};

const ALIGN_LABELS = {
  [Align.LEFT]: 'Left',
  [Align.CENTER]: 'Center',
  [Align.RIGHT]: 'Right',
};

export function TextSpecEditor({ spec, onChange, fonts, hideText = false, sizePresets = null, colorSwatches = null, hideFooterNote = false }) {
  const emit = (patch) => onChange({ ...spec, ...patch });

  return (
    <div className="flex flex-col gap-3 text-sm text-gray-200">
      {!hideText && (
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Text</span>
          <input
            type="text"
            value={spec.text}
            onChange={(e) => emit({ text: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Font</span>
        <select
          aria-label="Font"
          value={spec.font}
          onChange={(e) => emit({ font: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
        >
          {(fonts || Object.values(FontKey)).map((key) => (
            <option key={key} value={key}>{FONT_LABELS[key] || key}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Color</span>
        {colorSwatches && colorSwatches.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {colorSwatches.map((hex) => {
              const active = (spec.color || '').toUpperCase() === hex.toUpperCase();
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Color ${hex}`}
                  aria-pressed={active}
                  onClick={() => emit({ color: hex })}
                  style={{ backgroundColor: hex }}
                  className={`w-6 h-6 rounded border ${active ? 'border-white ring-2 ring-blue-500' : 'border-gray-600'}`}
                />
              );
            })}
          </div>
        )}
        <input
          type="color"
          aria-label="Color"
          value={spec.color}
          onChange={(e) => emit({ color: e.target.value })}
          className="h-8 w-full bg-gray-800 border border-gray-700 rounded"
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Align</span>
        <select
          aria-label="Align"
          value={spec.align}
          onChange={(e) => emit({ align: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
        >
          {Object.values(Align).map((value) => (
            <option key={value} value={value}>{ALIGN_LABELS[value] || value}</option>
          ))}
        </select>
      </label>

      {sizePresets && sizePresets.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Size</span>
          <div className="flex gap-1.5" role="group" aria-label="Size">
            {sizePresets.map((preset) => {
              const active = nearestPresetKey(sizePresets, spec.size) === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  aria-label={`Size ${preset.label}`}
                  aria-pressed={active}
                  onClick={() => emit({ size: preset.value })}
                  className={`flex-1 py-1.5 rounded text-sm font-medium border transition-colors ${
                    active
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Size</span>
          <input
            type="range"
            aria-label="Size"
            min={0.02}
            max={0.5}
            step={0.005}
            value={spec.size}
            onChange={(e) => emit({ size: parseFloat(e.target.value) })}
            className="w-full"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Shadow blur</span>
        <input
          type="range"
          aria-label="Shadow blur"
          min={0}
          max={0.5}
          step={0.01}
          value={spec.shadow?.blur ?? 0}
          onChange={(e) => emit({ shadow: { ...spec.shadow, blur: parseFloat(e.target.value) } })}
          className="w-full"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Stroke width</span>
        <input
          type="range"
          aria-label="Stroke width"
          min={0}
          max={0.15}
          step={0.005}
          value={spec.stroke?.width ?? 0}
          onChange={(e) => emit({ stroke: { ...spec.stroke, width: parseFloat(e.target.value) } })}
          className="w-full"
        />
      </label>

      {!hideFooterNote && (
        <p className="text-xs text-amber-400/90 leading-snug">
          Overlay text is burned into the exported video -- changing it means
          re-exporting, like spotlights.
        </p>
      )}
    </div>
  );
}

// Nearest preset key for a normalised size, so the active preset button reads
// correctly even after the value was set elsewhere (e.g. a duplicated card).
function nearestPresetKey(presets, sizeValue) {
  let bestKey = presets[0]?.key;
  let bestDelta = Infinity;
  for (const preset of presets) {
    const delta = Math.abs(preset.value - sizeValue);
    if (delta < bestDelta) {
      bestKey = preset.key;
      bestDelta = delta;
    }
  }
  return bestKey;
}

export default TextSpecEditor;
