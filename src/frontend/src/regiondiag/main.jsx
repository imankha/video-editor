import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import RegionLayer from '../components/timeline/RegionLayer';
import useHighlightRegions from '../modes/overlay/hooks/useHighlightRegions';
import '../index.css'; // Tailwind — the levers' rounded-full / touch-none classes need it

/**
 * T5644 — DEV-ONLY real-browser harness for the overlay timeline region trim levers.
 *
 * Mounts the REAL RegionLayer (highlight mode) wired to the REAL useHighlightRegions
 * hook, so a lever drag runs genuine code end-to-end: the pointer handler in
 * RegionLayer -> `moveRegionStart` / `moveRegionEnd` in the hook (with its clamp +
 * frame-snap logic) -> re-rendered region layout. The `status` readout exposes the
 * region's current start/end so the spec can assert the drag actually moved the
 * boundary.
 *
 * NOT shipped: regiondiag.html is not a vite build input, so this never enters the
 * production bundle. jsdom is insufficient for a pointer/touch fix (memory:
 * real_browser_for_pointer_fixes) — the Playwright spec drives real touch (CDP
 * Input.dispatchTouchEvent) in a coarse context and a real mouse in a fine one.
 */

const VIDEO_METADATA = { width: 640, height: 360, duration: 10, fps: 30 };
const DURATION = 10;
const REGION_START = 3; // addRegion(3) -> a 2s region [3, 5]

function RegionDiagHarness() {
  const {
    regions,
    boundaries,
    keyframes,
    framerate,
    duration,
    initializeWithDuration,
    addRegion,
    moveRegionStart,
    moveRegionEnd,
  } = useHighlightRegions(VIDEO_METADATA);

  // Seed the duration first; addRegion closes over `duration` state so it must run
  // on a later tick once duration is set (else it early-returns null).
  useEffect(() => {
    initializeWithDuration(DURATION);
  }, [initializeWithDuration]);

  useEffect(() => {
    if (duration && regions.length === 0) {
      addRegion(REGION_START);
    }
  }, [duration, regions.length, addRegion]);

  const region = regions[0];

  return (
    <div style={{ margin: 40, width: 800 }}>
      <div
        data-testid="status"
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {region
          ? `start=${region.startTime.toFixed(3)} end=${region.endTime.toFixed(3)}`
          : 'no-region'}
      </div>

      {/* Fixed-width host so the track's bounding rect (and thus lever hit-tests)
          is deterministic across viewports. */}
      <div style={{ width: 800 }}>
        <RegionLayer
          mode="highlight"
          regions={regions}
          boundaries={boundaries}
          keyframes={keyframes}
          framerate={framerate}
          duration={duration}
          currentTime={0}
          onAddRegion={addRegion}
          onMoveRegionStart={moveRegionStart}
          onMoveRegionEnd={moveRegionEnd}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('regiondiag-root')).render(<RegionDiagHarness />);
