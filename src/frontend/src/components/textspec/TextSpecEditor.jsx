// T5225 -- the SHARED TextSpec editing rail.
//
// Design: docs/plans/tasks/T5225-design.md §4.1. Pure presentational, exactly
// like RichText (T5180): props in, no store access, no fetch/API call, no
// persistence opinion. The HOST owns what happens with the edited spec --
// this component only ever emits a COMPLETE, valid TextSpec via onChange,
// never a partial delta, so a host can persist it atomically (design O4:
// whole-spec-per-block, debounced by the host).
//
// This is the FIRST consumer (T5225, the Overlay text rail) but it is written
// to be reused verbatim by T5205's card editor -- one editing UI for one
// shared TextSpec, matching the "exactly one preview component" rule the
// epic sets for RichText/text_render.
//
// <TextSpecEditor spec={TextSpec} onChange={(nextSpec) => void} fonts={FontKey[]} />

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

export function TextSpecEditor({ spec, onChange, fonts }) {
  const emit = (patch) => onChange({ ...spec, ...patch });

  return (
    <div className="flex flex-col gap-3 text-sm text-gray-200">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Text</span>
        <input
          type="text"
          value={spec.text}
          onChange={(e) => emit({ text: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
        />
      </label>

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

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Color</span>
        <input
          type="color"
          aria-label="Color"
          value={spec.color}
          onChange={(e) => emit({ color: e.target.value })}
          className="h-8 w-full bg-gray-800 border border-gray-700 rounded"
        />
      </label>

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

      <p className="text-xs text-amber-400/90 leading-snug">
        Overlay text is burned into the exported video -- changing it means
        re-exporting, like spotlights.
      </p>
    </div>
  );
}

export default TextSpecEditor;
