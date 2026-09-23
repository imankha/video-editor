import { Check, MousePointerClick, Pipette } from 'lucide-react';
import { HIGHLIGHT_COLOR_ORDER, HIGHLIGHT_COLOR_LABELS, highlightColorLabel } from '../../constants/highlightColors';
import { HighlightEffect } from '../../constants/highlightEffects';
import { EDITOR_PANELS } from '../../config/displayNames';
import { formatLength, PRECISION } from '../../utils/timeFormat';
import SettingRow from './SettingRow';
import SettingsPanel from './SettingsPanel';

/**
 * OverlaySpotlightPanel (T9270) — the Overlay "Spotlight" tab body, ported from the
 * old OverlaySettingsCard onto the shared SettingRow / SettingsPanel anatomy.
 *
 * Grouped by WHAT A CONTROL CHANGES: everything here tunes the CURRENT spotlight, so
 * it is one "This spotlight" group. The single accent is blue-600 (segmented on
 * state) — retiring the old competing accents. Presentational; every value/handler
 * is a prop, `disabled` locks inputs while an export is in flight.
 */
export default function OverlaySpotlightPanel({
  highlightColor,
  onHighlightColorChange,
  highlightShape,
  onHighlightShapeChange,
  strokeWidth,
  onStrokeWidthChange,
  fillOpacity,
  onFillEnabledChange,
  onFillOpacityChange,
  dimStrength,
  onDimStrengthChange,
  onHighlightEffectTypeChange,
  isHighlightEnabled,
  disabled = false,
  // T9620 (UX-10): player-selection-first sequencing. While a player is still
  // unpicked the styling controls are hidden behind the "pick your player"
  // guidance; once assignment begins they appear.
  awaitingPlayerSelection = false,
  assignedCount = 0,
  totalDetections = 0,
  // T9960 (EP05): the current effect interval length (seconds), derived from the
  // region span in OverlayModeView. Surfaced as the PRIMARY readout above the
  // advanced styling controls; null hides the row (no region / unknown length).
  spotlightDurationSeconds = null,
}) {
  // Pre-selection: no styling controls, just the stated next step (on-screen
  // text, not a tooltip). Detection COUNT copy always says "player(s)" so the
  // number can't be mistaken for a jersey identity.
  if (awaitingPlayerSelection) {
    return (
      <SettingsPanel title={EDITOR_PANELS.SELECT_PLAYER_TITLE}>
        <div className="flex flex-col items-center text-center gap-2 py-4">
          <MousePointerClick size={22} className="text-blue-400" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-100">
            {EDITOR_PANELS.SELECT_PLAYER_CLICK}
          </p>
          <p className="text-xs text-gray-400">
            {EDITOR_PANELS.SELECT_PLAYER_STYLING_HINT}
          </p>
          {/* T9960: Spotlight never blocks the framed result — say so up front so a
              parent knows picking is optional, not a required gate. */}
          <p className="text-xs text-gray-500">
            {EDITOR_PANELS.SELECT_PLAYER_OPTIONAL}
          </p>
        </div>
      </SettingsPanel>
    );
  }

  // T9960 (EP05): one selected athlete SATISFIES the step. After the first pick,
  // affirm completion; only when other detection frames remain do we mention that
  // adding more is OPTIONAL — never an instruction to select "the remaining
  // players". Derived from the same assignment counts, never a second stored copy.
  const hasSelection = assignedCount > 0;
  const moreAvailable = totalDetections - assignedCount > 0;
  // The effect interval, surfaced as the primary readout. It's a LENGTH, so it
  // rounds half-up (T9480 rule); hidden when unknown/non-positive.
  const durationLabel =
    spotlightDurationSeconds > 0
      ? formatLength(spotlightDurationSeconds, PRECISION.TENTH, { style: 'unit' })
      : null;

  // T11020: a custom color is anything the user picked that isn't one of the 5
  // named presets (or the "none" sentinel) — the spectrum picker and eyedropper
  // both write an arbitrary hex through the same onHighlightColorChange handler.
  const isCustomColor = Boolean(highlightColor) && !HIGHLIGHT_COLOR_ORDER.includes(highlightColor);
  // <input type="color"> needs a valid 6-digit hex; fall back to the current
  // custom value or white when the active color is a preset/"none".
  const customColorInputValue = isCustomColor ? highlightColor : '#FFFFFF';
  const colorControlsDisabled = disabled || !isHighlightEnabled;
  const supportsEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const handleEyedropper = async () => {
    if (colorControlsDisabled || !supportsEyedropper) return;
    try {
      const result = await new window.EyeDropper().open();
      if (result?.sRGBHex) {
        onHighlightColorChange?.(result.sRGBHex.toUpperCase());
      }
    } catch (err) {
      // User cancelling (Escape / click-away) throws AbortError -- expected, not
      // an error. Anything else (insecure context, picker-already-open, ...)
      // still shouldn't crash the panel, but must not vanish silently either.
      if (err?.name !== 'AbortError') {
        console.warn('[OverlaySpotlightPanel] Eyedropper failed:', err);
      }
    }
  };

  return (
    <SettingsPanel title="This spotlight">
      {hasSelection && (
        <p data-testid="player-selected-status" className="text-xs text-blue-300">
          {EDITOR_PANELS.SELECT_PLAYER_DONE}
          {moreAvailable ? ` ${EDITOR_PANELS.SELECT_PLAYER_ADD_MORE}` : ''}
        </p>
      )}
      {/* T9960: the (already adjustable) effect interval, named and shown as the
          PRIMARY control — the advanced styling sliders stay secondary below. */}
      {durationLabel && (
        <SettingRow label={EDITOR_PANELS.SPOTLIGHT_DURATION} value={durationLabel} stack>
          <p data-testid="spotlight-duration-hint" className="text-xs text-gray-400">
            {EDITOR_PANELS.SPOTLIGHT_DURATION_HINT}
          </p>
        </SettingRow>
      )}
      {/* Spotlight color — the six swatches stack under the label (wide control). */}
      <SettingRow
        label={EDITOR_PANELS.SPOTLIGHT_COLOR}
        value={highlightColorLabel(highlightColor)}
        stack
      >
        {HIGHLIGHT_COLOR_ORDER.map((color) => {
          const isNone = color === 'none';
          const isColorValue = color && !isNone;
          return (
            <button
              key={color}
              onClick={() => onHighlightColorChange?.(color)}
              disabled={disabled || !isHighlightEnabled}
              aria-label={HIGHLIGHT_COLOR_LABELS[color]}
              className={`flex items-center justify-center transition-all w-8 h-8 coarse-pointer:w-12 coarse-pointer:h-12 ${
                (disabled || !isHighlightEnabled) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              title={HIGHLIGHT_COLOR_LABELS[color]}
            >
              <span
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  highlightColor === color
                    ? 'border-white ring-2 ring-white/30'
                    : 'border-gray-600 hover:border-gray-400'
                }`}
                style={{
                  backgroundColor: isColorValue ? color : 'transparent',
                  backgroundImage: isNone
                    ? 'linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)'
                    : 'none',
                }}
              >
                {highlightColor === color && isColorValue && (
                  <Check size={12} className="text-gray-800" strokeWidth={3} />
                )}
                {highlightColor === color && isNone && (
                  <Check size={12} className="text-white" strokeWidth={3} />
                )}
              </span>
            </button>
          );
        })}
        {/* Full spectrum — native color input styled as a conic-gradient swatch,
            same pattern as TextSpecEditor's "Custom color" picker. */}
        <label
          className={`relative flex items-center justify-center w-8 h-8 coarse-pointer:w-12 coarse-pointer:h-12 rounded-full focus-within:ring-2 focus-within:ring-blue-500 ${
            colorControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
          title={EDITOR_PANELS.SPOTLIGHT_CUSTOM_COLOR}
        >
          <span
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center overflow-hidden ${
              isCustomColor ? 'border-white ring-2 ring-white/30' : 'border-gray-600 hover:border-gray-400'
            }`}
            style={{
              background: isCustomColor
                ? highlightColor
                : 'conic-gradient(#ef4444,#f59e0b,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)',
            }}
          >
            {isCustomColor && <Check size={12} className="text-white drop-shadow" strokeWidth={3} />}
          </span>
          <input
            type="color"
            aria-label={EDITOR_PANELS.SPOTLIGHT_CUSTOM_COLOR}
            value={customColorInputValue}
            onChange={(e) => onHighlightColorChange?.(e.target.value.toUpperCase())}
            disabled={colorControlsDisabled}
            className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </label>
        {/* Eyedropper — samples a color from anywhere on screen (the video frame
            included), so a parent can match the spotlight to the uniform exactly.
            Chromium-only API; feature-detected out on Firefox/Safari (T11020). */}
        {supportsEyedropper && (
          <button
            type="button"
            onClick={handleEyedropper}
            disabled={colorControlsDisabled}
            aria-label={EDITOR_PANELS.SPOTLIGHT_MATCH_UNIFORM}
            title={EDITOR_PANELS.SPOTLIGHT_MATCH_UNIFORM}
            className={`flex items-center justify-center w-8 h-8 coarse-pointer:w-12 coarse-pointer:h-12 rounded-full border-2 border-gray-600 bg-gray-700 text-gray-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              colorControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-600 hover:border-gray-400'
            }`}
          >
            <Pipette size={14} />
          </button>
        )}
      </SettingRow>

      {isHighlightEnabled ? (
        <>
          {/* Shape — segmented control saying WHERE the spotlight sits vs the player. */}
          <SettingRow
            label="Shape"
            value={highlightShape === 'ground'
              ? EDITOR_PANELS.SPOTLIGHT_UNDER_PLAYER
              : EDITOR_PANELS.SPOTLIGHT_AROUND_PLAYER}
          >
            {[
              { id: 'body', label: EDITOR_PANELS.SPOTLIGHT_AROUND_PLAYER },
              { id: 'ground', label: EDITOR_PANELS.SPOTLIGHT_UNDER_PLAYER },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onHighlightShapeChange?.(id)}
                disabled={disabled}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all coarse-pointer:min-h-11 ${
                  highlightShape === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {label}
              </button>
            ))}
          </SettingRow>

          {/* Outline thickness */}
          <SettingRow label={EDITOR_PANELS.OUTLINE_THICKNESS} value={`${strokeWidth ?? 3}px`}>
            <input
              type="range"
              min="1"
              max="3"
              step="1"
              value={strokeWidth ?? 3}
              onChange={(e) => onStrokeWidthChange?.(Number(e.target.value))}
              disabled={disabled}
              className="w-24 accent-blue-500"
            />
          </SettingRow>

          {/* Spotlight fill opacity */}
          <SettingRow label={EDITOR_PANELS.SPOTLIGHT_FILL} value={`${Math.round((fillOpacity ?? 0) * 100)}%`}>
            <input
              type="range"
              min="0"
              max="40"
              step="5"
              value={Math.round((fillOpacity ?? 0) * 100)}
              onChange={(e) => {
                const val = Number(e.target.value) / 100;
                onFillOpacityChange?.(val);
                onFillEnabledChange?.(val > 0);
              }}
              disabled={disabled}
              className="w-24 accent-blue-500"
            />
          </SettingRow>

          {/* Dim background strength */}
          <SettingRow label={EDITOR_PANELS.DIM_BACKGROUND} value={`${Math.round((dimStrength ?? 0) * 100)}%`}>
            <input
              type="range"
              min="0"
              max="40"
              step="5"
              value={Math.round((dimStrength ?? 0) * 100)}
              onChange={(e) => {
                const val = Number(e.target.value) / 100;
                onDimStrengthChange?.(val);
                onHighlightEffectTypeChange?.(
                  val > 0 ? HighlightEffect.DARK_OVERLAY : HighlightEffect.BRIGHTNESS_BOOST
                );
              }}
              disabled={disabled}
              className="w-24 accent-blue-500"
            />
          </SettingRow>
        </>
      ) : (
        <p className="text-xs text-gray-500">
          Add a spotlight on the timeline to tune its color, shape, and dimming here.
        </p>
      )}
    </SettingsPanel>
  );
}
