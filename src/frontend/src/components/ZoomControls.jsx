import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from './shared/Button';

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
      <Button
        variant="secondary"
        size="sm"
        icon={ZoomOut}
        iconOnly
        onClick={onZoomOut}
        disabled={!canZoomOut}
        title="Zoom Out (Scroll Down)"
      />

      {/* Zoom Percentage Display */}
      <div className="min-w-[60px] text-center">
        <span className="text-sm font-mono text-white">
          {zoomPercentage}%
        </span>
      </div>

      {/* Zoom In Button */}
      <Button
        variant="secondary"
        size="sm"
        icon={ZoomIn}
        iconOnly
        onClick={onZoomIn}
        disabled={!canZoomIn}
        title="Zoom In (Scroll Up)"
      />

      {/* Reset Zoom Button */}
      {isZoomed && (
        <Button
          variant="primary"
          size="sm"
          icon={Maximize2}
          iconOnly
          onClick={onResetZoom}
          className="ml-1"
          title="Reset to 100%"
        />
      )}

      <div className="ml-2 text-xs text-gray-500">
        Scroll to zoom
      </div>
    </div>
  );
}
