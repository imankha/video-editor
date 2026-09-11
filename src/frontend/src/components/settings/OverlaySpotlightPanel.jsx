import { Check } from 'lucide-react';
import { HIGHLIGHT_COLOR_ORDER, HIGHLIGHT_COLOR_LABELS } from '../../constants/highlightColors';
import { HighlightEffect } from '../../constants/highlightEffects';
import { EDITOR_PANELS } from '../../config/displayNames';
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
}) {
  return (
    <SettingsPanel title="This spotlight">
      {/* Spotlight color — the six swatches stack under the label (wide control). */}
      <SettingRow
        label={EDITOR_PANELS.SPOTLIGHT_COLOR}
        value={HIGHLIGHT_COLOR_LABELS[highlightColor] || 'White'}
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
