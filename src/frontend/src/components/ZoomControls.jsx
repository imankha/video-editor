import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/**
 * ZoomControls component - UI controls for video zoom
 */
export default function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  minZoom,
  maxZoom
}) {
  const zoomPercentage = Math.round(zoom * 100);
  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;
  const isZoomed = zoom !== 1;

  return (
    <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
      <span className="text-xs text-gray-400 mr-1">Zoom:</span>

      {/* Zoom Out Button */}
      <button
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className={`p-2 rounded transition-colors ${
          canZoomOut
            ? 'bg-gray-700 hover:bg-gray-600 text-white'
            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
        }`}
        title="Zoom Out (Scroll Down)"
      >
        <ZoomOut size={16} />
      </button>

      {/* Zoom Percentage Display */}
      <div className="min-w-[60px] text-center">
        <span className="text-sm font-mono text-white">
          {zoomPercentage}%
        </span>
      </div>

      {/* Zoom In Button */}
      <button
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className={`p-2 rounded transition-colors ${
          canZoomIn
            ? 'bg-gray-700 hover:bg-gray-600 text-white'
            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
        }`}
        title="Zoom In (Scroll Up)"
      >
        <ZoomIn size={16} />
      </button>

      {/* Reset Zoom Button */}
      {isZoomed && (
        <button
          onClick={onResetZoom}
          className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors ml-1"
          title="Reset to 100%"
        >
          <Maximize2 size={16} />
        </button>
      )}

      <div className="ml-2 text-xs text-gray-500">
        Scroll to zoom
      </div>
    </div>
  );
}
