import { useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import CropOverlay from '../modes/framing/overlays/CropOverlay';
import useCrop from '../modes/framing/hooks/useCrop';
import { VideoPlayer } from '../components/VideoPlayer';
import '../index.css'; // Tailwind — the box's `absolute`/`pointer-events-auto` classes need it

/**
 * T5380b — DEV-ONLY real-browser harness for the CropOverlay first-drag bug.
 *
 * Renders the REAL VideoPlayer + CropOverlay + useCrop keyframe parent, the same way
 * FramingModeView does (overlays={[<CropOverlay key="crop"/>]} inside VideoPlayer's
 * `.video-container`, currentCrop = dragCrop || interpolateCrop(t)). This is the
 * closest non-app reproduction of the staging Framing editor.
 *
 * `#loading` sets VideoPlayer's `isVideoElementLoading` so it renders the detailed
 * <VideoLoadingOverlay> — the buffering state that, pre-fix, sits on top of the crop
 * reticule and swallows the FIRST drag (T5380b root cause). See the E2E spec header.
 *
 * NOT shipped: cropdiag.html is not a vite build input, so this never enters the
 * production bundle. Params are captured by an inline script in cropdiag.html into
 * window.__CROPDIAG before this module runs (an imported app module pushState-
 * redirects to /framing, which would otherwise wipe a URL hash/query).
 */
const DIAG_PARAMS = new URLSearchParams(window.__CROPDIAG || '');

// 16:9 video inside a 16:9 container => clean 0.5 scale, no letterbox offset.
const VIDEO_METADATA = { width: 1600, height: 900, duration: 10, framerate: 30 };
const CONTAINER = { width: 800, height: 450 };

// Stable zoom/pan like FramingScreen passes (module constants so useVideoDisplayRect's
// layout-effect deps don't churn).
const ZOOM = 1;
const PAN_OFFSET = { x: 0, y: 0 };

// A pre-existing draft keyframe (like a real staging draft) so useCrop restores real
// keyframes and interpolateCrop yields a centered box, comfortably away from bounds.
const SAVED_KEYFRAMES = [{ frame: 30, x: 697, y: 267, width: 205, height: 365, origin: 'user' }];
const CURRENT_TIME = 1.0; // frame 30 at 30fps — right on the saved keyframe.

function FramingHarness() {
  const videoRef = useRef(null);
  const [dragCrop, setDragCrop] = useState(null);

  const { framerate, interpolateCrop, addOrUpdateKeyframe } = useCrop(
    VIDEO_METADATA, null, SAVED_KEYFRAMES
  );

  // Exactly FramingScreen: currentCropState = dragCrop || interpolateCrop(currentTime).
  const currentCropState = dragCrop || interpolateCrop(CURRENT_TIME);

  const onCropChange = useCallback((c) => setDragCrop(c), []);
  // FramingContainer.handleCropComplete (backend persistence stripped).
  const onCropComplete = useCallback((cropData) => {
    addOrUpdateKeyframe(CURRENT_TIME, cropData, VIDEO_METADATA.duration);
    setDragCrop(null);
  }, [framerate, addOrUpdateKeyframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // #loading → VideoPlayer renders the detailed VideoLoadingOverlay (video still
  // buffering) — the exact staging condition that dropped the first gesture.
  const loading = DIAG_PARAMS.has('loading');

  return (
    <div style={{ width: CONTAINER.width, margin: '40px' }}>
      <VideoPlayer
        videoRef={videoRef}
        videoUrl="/__cropdiag_no_video.mp4"
        handlers={{}}
        allowUpload={false}
        isVideoElementLoading={loading}
        zoom={ZOOM}
        panOffset={PAN_OFFSET}
        overlays={[
          currentCropState && (
            <CropOverlay
              key="crop"
              videoRef={videoRef}
              videoMetadata={VIDEO_METADATA}
              currentCrop={currentCropState}
              aspectRatio="9:16"
              onCropChange={onCropChange}
              onCropComplete={onCropComplete}
              zoom={ZOOM}
              panOffset={PAN_OFFSET}
            />
          ),
        ].filter(Boolean)}
      />
    </div>
  );
}

createRoot(document.getElementById('cropdiag-root')).render(<FramingHarness />);
