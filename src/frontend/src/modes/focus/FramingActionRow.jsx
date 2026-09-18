import { Undo2, Maximize2, Eye, EyeOff } from 'lucide-react';
import { EDITOR_PANELS } from '../../config/displayNames';

/**
 * FramingActionRow (T9950) — [Undo] [Use a wider frame] [Preview highlight].
 * Pure presentational: props in, callbacks out, no store reads (design doc
 * §5 Slice 2).
 *
 * Preview highlight is wired in Slice 3 — `onTogglePreview` is undefined until
 * then, and the button stays unrendered so Slice 2 ships independently
 * (design doc §5: "each slice independently reviewable and shippable").
 */
export default function FramingActionRow({
  canUndo,
  onUndo,
  isWideFraming,
  onWidenFraming,
  previewing = false,
  onTogglePreview,
  isMultiClip = false,
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="framing-undo"
        onClick={onUndo}
        disabled={!canUndo}
        title={canUndo ? 'Undo the last framing edit' : EDITOR_PANELS.UNDO_NOTHING}
        aria-disabled={!canUndo}
        className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-800 coarse-pointer:min-h-11"
      >
        <Undo2 size={14} aria-hidden="true" />
        {EDITOR_PANELS.UNDO}
      </button>

      <button
        type="button"
        data-testid="framing-widen"
        onClick={onWidenFraming}
        aria-pressed={isWideFraming}
        title={EDITOR_PANELS.WIDER_FRAME_HINT}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors coarse-pointer:min-h-11 ${
          isWideFraming
            ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500'
            : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
        }`}
      >
        <Maximize2 size={14} aria-hidden="true" />
        {isWideFraming ? EDITOR_PANELS.WIDER_FRAME_ON : EDITOR_PANELS.WIDER_FRAME}
      </button>

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
          for crop/timing/format/audio, approximate for image quality and
          multi-clip concatenation; shown only while the preview is active. */}
      {previewing && (
        <span className="w-full text-xs text-gray-500" data-testid="preview-disclosure">
          {EDITOR_PANELS.PREVIEW_DISCLOSURE}
          {isMultiClip && ` ${EDITOR_PANELS.PREVIEW_MULTI_CLIP_DISCLOSURE}`}
        </span>
      )}
    </div>
  );
}
