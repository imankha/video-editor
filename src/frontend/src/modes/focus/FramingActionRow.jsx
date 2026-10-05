import { Eye, EyeOff, Plus, Check } from 'lucide-react';
import { EDITOR_PANELS, FOCUS_EDITOR } from '../../config/displayNames';

/**
 * FramingActionRow (T9950, T10310) — [Set focus point] + [Preview highlight].
 * "Use a wider frame" was removed 2026-09-18 per user request.
 * Pure presentational: props in, callbacks out, no store reads (design doc
 * §5 Slice 2).
 *
 * T11700: the "Set focus point" button sits FIRST (left of Preview highlight)
 * on desktop/tablet (`hidden sm:flex`; portrait phones render the same control
 * full-width under the stage in FocusModeView). It commits the crop box exactly
 * where it is now through `onSetFocusPoint` — the SAME onCropComplete write path
 * a drag uses. Amber call-to-attention at 0 focus points, gray secondary once
 * one exists. Disabled while a crop drag is in progress (the live crop box is
 * still moving). The transient "Focus point set at m:ss" confirmation is owned
 * upstream and passed in as `justSetLabel`.
 *
 * Preview highlight is wired in Slice 3 — `onTogglePreview` is undefined until
 * then, and the button stays unrendered so Slice 2 ships independently
 * (design doc §5: "each slice independently reviewable and shippable").
 */
export default function FramingActionRow({
  previewing = false,
  onTogglePreview,
  // T11700
  onSetFocusPoint,
  focusPointCount = 0,
  setFocusPointDisabled = false,
  justSetLabel = null,
}) {
  const hasFocusPoints = focusPointCount > 0;
  const setFocusPointClasses = hasFocusPoints
    ? 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
    : 'border-amber-500/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {/* T11700: Set / Add focus point — desktop/tablet only (portrait renders it
          under the stage). Hidden below sm via the wrapper so the two placements
          never both show. */}
      {onSetFocusPoint && (
        <span className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            data-testid="set-focus-point-button"
            onClick={onSetFocusPoint}
            disabled={setFocusPointDisabled}
            title={FOCUS_EDITOR.SET_FOCUS_POINT_TOOLTIP}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors coarse-pointer:min-h-11 disabled:opacity-50 disabled:cursor-not-allowed ${setFocusPointClasses}`}
          >
            <Plus size={16} aria-hidden="true" />
            {hasFocusPoints ? FOCUS_EDITOR.ADD_FOCUS_POINT : FOCUS_EDITOR.SET_FOCUS_POINT}
          </button>
          {justSetLabel && (
            <span
              data-testid="focus-point-set-confirm"
              className="flex items-center gap-1 text-xs text-green-400"
            >
              <Check size={14} aria-hidden="true" />
              {justSetLabel}
            </span>
          )}
        </span>
      )}

      {onTogglePreview && (
        <button
          type="button"
          data-testid="framing-preview-toggle"
          onClick={onTogglePreview}
          aria-pressed={previewing}
          title={EDITOR_PANELS.PREVIEW_DISCLOSURE}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors coarse-pointer:min-h-11 ${
            previewing
              ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500'
              : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {previewing ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
        </button>
      )}

      {/* T9950 Slice 3 -- approximation disclosure (design doc §4, AC2). Exact
          for crop/timing/format/audio, approximate for image quality; shown
          only while the preview is active. */}
      {previewing && (
        <span className="w-full text-xs text-gray-500" data-testid="preview-disclosure">
          {EDITOR_PANELS.PREVIEW_DISCLOSURE}
        </span>
      )}
    </div>
  );
}
