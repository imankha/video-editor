import { Check } from 'lucide-react';
import { HIGHLIGHT_COLOR_ORDER, HIGHLIGHT_COLOR_LABELS } from '../constants/highlightColors';
import { HighlightEffect } from '../constants/highlightEffects';

/**
 * OverlaySettingsCard - Pure presentational card of Overlay-mode tuning controls.
 *
 * Extracted from ExportButtonView (T5676) so the Overlay screen can place the
 * settings BESIDE the aspect-fit video on desktop (reclaimed pillarbox width)
 * while the "Add Spotlight" export button + progress stay full-width at the
 * bottom. Framing keeps its own inline settings card in ExportButtonView; this
 * component is Overlay-only.
 *
 * Presentational only — every value/handler is a prop. `disabled` mirrors the
 * export container's `isCurrentlyExporting` (threaded from OverlayScreen) so the
 * controls lock while an overlay export is in flight.
 *
 * @param {Object} props
 * @param {boolean} props.isHighlightEnabled - Whether at least one region exists
 * @param {boolean} props.disabled - Lock inputs (export in progress)
 * @param {string} props.className - Extra classes for the card wrapper
 */
export default function OverlaySettingsCard({
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
  className = '',
}) {
  return (
    <div className={`bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4 ${className}`}>
      <div className="text-sm font-medium text-gray-300 mb-3">Overlay Settings</div>

      {/* Highlight Color */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-200">Highlight Color</span>
          <span className="text-xs text-gray-400">
            {HIGHLIGHT_COLOR_LABELS[highlightColor] || 'White'}
          </span>
        </div>

        {/* flex-wrap so the wider 44px coarse-pointer targets (T5430) can wrap
            on narrow phones instead of overflowing; on desktop they fit one
            row so wrap is a no-op (layout byte-identical). */}
        <div className="flex flex-wrap justify-end gap-1.5">
          {HIGHLIGHT_COLOR_ORDER.map((color) => {
            const isNone = color === 'none';
            const isColorValue = color && !isNone;
            return (
              <button
                key={color}
                onClick={() => onHighlightColorChange?.(color)}
                disabled={disabled || !isHighlightEnabled}
                aria-label={HIGHLIGHT_COLOR_LABELS[color]}
                className={`
                  flex items-center justify-center transition-all
                  w-6 h-6 coarse-pointer:w-11 coarse-pointer:h-11
                  ${(disabled || !isHighlightEnabled) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
                title={HIGHLIGHT_COLOR_LABELS[color]}
              >
                {/* Visible swatch stays 24px on every pointer; the button around
                    it grows to a 44px touch target on coarse pointers (T5430),
                    keeping the swatch centered. */}
                <span
                  className={`
                    w-6 h-6 rounded-full border-2 flex items-center justify-center
                    ${highlightColor === color
                      ? 'border-white ring-2 ring-white/30'
                      : 'border-gray-600 hover:border-gray-400'}
                  `}
                  style={{
                    backgroundColor: isColorValue ? color : 'transparent',
                    backgroundImage: isNone ? 'linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' : 'none'
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
        </div>
      </div>

      {/* Overlay Tuning Controls - only when a region exists */}
      {isHighlightEnabled && (
        <>
          {/* Highlight Shape */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Shape</span>
              <span className="text-xs text-gray-400">
                {highlightShape === 'ground' ? 'Ground spotlight' : 'Body ellipse'}
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => onHighlightShapeChange?.('body')}
                disabled={disabled}
                className={`
                  px-2.5 py-1 rounded text-xs font-medium transition-all
                  ${highlightShape === 'body'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                Body
              </button>
              <button
                onClick={() => onHighlightShapeChange?.('ground')}
                disabled={disabled}
                className={`
                  px-2.5 py-1 rounded text-xs font-medium transition-all
                  ${highlightShape === 'ground'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                Ground
              </button>
            </div>
          </div>

          {/* Stroke Width */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Stroke Width</span>
              <span className="text-xs text-gray-400">{strokeWidth}px</span>
            </div>
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
          </div>

          {/* Fill Opacity */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Fill</span>
              <span className="text-xs text-gray-400">
                {Math.round((fillOpacity ?? 0) * 100)}%
              </span>
            </div>
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
          </div>

          {/* Outside Dim Strength */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Outside Dim</span>
              <span className="text-xs text-gray-400">{Math.round((dimStrength ?? 0) * 100)}%</span>
            </div>
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
          </div>
        </>
      )}

      {/* Export Info */}
      <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
        Applies highlight overlay (H.264)
      </div>
    </div>
  );
}
