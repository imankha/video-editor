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
// (T5225 passes none and keeps every control; T5205's card rail opts in):
//   hideText      -- omit the Text field (the card editor edits the title/fact
//                    text outside the styling rail, since a fact's text comes
//                    from the profile, not this spec).
//   hideSize      -- omit the Size control. The card editor hides it because
//                    font SIZE is LAYOUT-OWNED there (composition-derived via the
//                    T5210 geometry contract), not user styling.
//   hideAlign     -- omit the Align control (same reason: alignment is
//                    composition-derived in the card editor).
//   colorSwatches -- [hex]; render quick-pick swatches beside the custom picker.
//   collapseEffects-- tuck Shadow blur + Stroke width behind a collapsed
//                    "Effects" disclosure (progressive disclosure). The card
//                    editor opts in because those are expert dials that were
//                    competing at equal weight with the primary Font/Colour
//                    choices; the overlay host leaves them inline (default off).

import { ChevronRight } from 'lucide-react';
import { Align, FontKey } from '../../constants/textSpec';

const FONT_LABELS = {
  [FontKey.ANTON]: 'Anton',
  [FontKey.OSWALD]: 'Oswald',
  [FontKey.GRADUATE]: 'Graduate',
  [FontKey.PLAYFAIR]: 'Playfair',
  [FontKey.INTER]: 'Inter',
  [FontKey.ARCHIVOBLACK]: 'Archivo Black',
};

const ALIGN_LABELS = {
  [Align.LEFT]: 'Left',
  [Align.CENTER]: 'Center',
  [Align.RIGHT]: 'Right',
};

// T6980: `inputRef` (optional) lets a host focus/caret the Text field
// imperatively (the inline-edit panel focus), and `onCommitEnd` (optional) lets
// it end inline edit on blur/Escape/Enter. Both are ADDITIVE -- existing callers
// pass neither and are unaffected (the field commits via the host's debounced
// onChange exactly as before).
export function TextSpecEditor({ spec, onChange, fonts, hideText = false, hideSize = false, hideAlign = false, colorSwatches = null, collapseEffects = false, inputRef = null, onCommitEnd = null }) {
  const emit = (patch) => onChange({ ...spec, ...patch });

  const shadowControl = (
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
  );

  const strokeControl = (
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
  );

  return (
    <div className="flex flex-col gap-3 text-sm text-gray-200">
      {!hideText && (
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Text</span>
          <input
            ref={inputRef}
            type="text"
            data-testid="text-spec-text-input"
            value={spec.text}
            onChange={(e) => emit({ text: e.target.value })}
            onBlur={onCommitEnd || undefined}
            onKeyDown={onCommitEnd ? (e) => {
              // T6980: blur/Escape/Enter end inline edit (commit is unchanged --
              // the host's 250ms debounce already fired on the last keystroke).
              if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onCommitEnd(); }
            } : undefined}
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

      {/* Quick picks and the custom picker sit on ONE row (T6510 UX pass). The
          picker used to render full-width BELOW the swatches, where a native
          <input type="color"> reads as a second, redundant "current colour"
          display rather than a control - two affordances for one value. Inline
          and swatch-sized, it reads as "one more colour, but any colour". */}
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Color</span>
        {/* Deliberately NOT aria-labelled "Color" at the group level: each control
            inside is named precisely ("Color #RRGGBB" per swatch, "Custom color"
            for the picker), and a group named "Color" as well would make
            getByLabelText(/color/i) ambiguous for both users and tests. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {colorSwatches && colorSwatches.length > 0 && colorSwatches.map((hex) => {
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
          <label
            className="relative w-6 h-6 rounded border border-gray-600 overflow-hidden cursor-pointer shrink-0"
            title="Custom color"
            style={{
              background:
                'conic-gradient(#ef4444,#f59e0b,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)',
            }}
          >
            <input
              type="color"
              aria-label="Custom color"
              value={spec.color}
              onChange={(e) => emit({ color: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {!hideAlign && (
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
      )}

      {!hideSize && (
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

      {collapseEffects ? (
        <details className="group border-t border-gray-700/70 pt-3">
          <summary className="flex items-center gap-1 cursor-pointer select-none list-none text-xs uppercase tracking-wide text-gray-400 hover:text-gray-300 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Effects
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {shadowControl}
            {strokeControl}
          </div>
        </details>
      ) : (
        <>
          {shadowControl}
          {strokeControl}
        </>
      )}
    </div>
  );
}

export default TextSpecEditor;
