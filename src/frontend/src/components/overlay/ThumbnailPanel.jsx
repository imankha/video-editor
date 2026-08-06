import { ImageOff } from 'lucide-react';
import PosterFramePreview from '../PosterFramePreview';

/**
 * ThumbnailPanel (T6590) — the "Thumbnail" tab body. Shows the still a share link
 * unfurls to, as FEEDBACK, not as a control.
 *
 * NOTE ON NAMING: the UI says "thumbnail" everywhere on Overlay (T6590); the data
 * model still calls this datum `poster_frame_time` / `poster_filename` (poster_*)
 * — a model rename carries migration cost and is out of scope. This one boundary
 * comment is the bridge; props keep the `poster*` names to match the model.
 *
 * T6590 deleted the "Use current frame" button: the ONLY way to set the frame is
 * dragging the marker on the timeline. This panel therefore has no frame-setting
 * control — it displays the chosen frame and its time so the user sees the result
 * of dragging. A grandfathered custom upload keeps its one-way "Use a frame
 * instead" switch (that reverts an upload; it is not a frame-picker).
 */
export default function ThumbnailPanel({
  posterMarkerTimeLabel,   // formatted time of the current marker, or null
  posterUploaded = false,  // grandfathered custom upload in use (read-only)
  posterPreviewVideoUrl,
  posterPreviewTime = 0,
  onRemoveUpload,
  disabled = false,
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col">
        <span
          className="text-sm font-medium text-gray-200"
          title="The thumbnail is what people see when you share the link."
        >
          Thumbnail
        </span>
        <span className="text-xs text-gray-400">
          {posterUploaded
            ? 'Custom image in use'
            : posterMarkerTimeLabel
              ? `Frame you picked · ${posterMarkerTimeLabel}`
              : 'The middle of the open-play slow-mo. Drag the thumbnail marker on the timeline to change it.'}
        </span>
      </div>

      {posterUploaded ? (
        <div
          data-testid="poster-custom-placeholder"
          className="w-full aspect-video rounded-md bg-gray-900 border border-gray-700 flex flex-col items-center justify-center gap-1 text-gray-500"
        >
          <ImageOff size={20} />
          <span className="text-xs">Custom image in use</span>
        </div>
      ) : (
        <PosterFramePreview videoUrl={posterPreviewVideoUrl} sourceTime={posterPreviewTime} />
      )}

      {/* Feedback caption: no frame-setting control here — the marker owns that. */}
      {!posterUploaded && (
        <p className="text-xs text-gray-500">
          Drag the thumbnail marker on the timeline to choose the frame.
        </p>
      )}

      {posterUploaded && (
        <button
          onClick={() => onRemoveUpload?.()}
          disabled={disabled}
          className={`px-2.5 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 coarse-pointer:min-h-11 transition-all ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
        >
          Use a frame instead
        </button>
      )}
    </div>
  );
}
