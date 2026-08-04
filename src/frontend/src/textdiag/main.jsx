import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// Tailwind utilities: without this the harness renders EVERY layout class inert
// (position/height/flex all unset), so the levers measure 0px tall and every
// visibility assertion fails against correct component code.
import '../index.css';
import TextLayer from '../components/timeline/TextLayer';
import useTextOverlays from '../modes/overlay/hooks/useTextOverlays';

/**
 * T5225 -- DEV-ONLY real-browser harness for the Overlay text layer's range
 * levers, clip-boundary snapping, add/delete/toggle.
 *
 * Mounts the REAL TextLayer wired to the REAL useTextOverlays hook, so a
 * lever drag runs genuine code end-to-end: TextLayer's pointer handler ->
 * snapToBoundary -> onMoveTextStart/onMoveTextEnd -> the hook's clamp logic ->
 * re-rendered layout. The `status` readout exposes the block count and the
 * first block's start/end/enabled so the spec can assert a drag actually
 * moved a boundary (and whether it snapped).
 *
 * NOT shipped: textdiag.html is not a vite build input. jsdom is insufficient
 * for a pointer/touch fix (memory: real_browser_for_pointer_fixes) -- the
 * Playwright spec drives real touch (CDP Input.dispatchTouchEvent) in a
 * coarse context and a real mouse in a fine one, mirroring T5644's harness.
 */

const DURATION = 10;
const CLIP_BOUNDARIES = [5.0]; // one interior cut-point at 5s, mirrors a 2-clip reel
const BLOCK_START = 2; // addText(2, spec) -> a 2s block [2, 4]

const DEFAULT_SPEC = {
  text: 'GOAL',
  font: 'anton',
  size: 0.08,
  color: '#FFFFFF',
  align: 'center',
  position: { x: 0.5, y: 0.5 },
  maxWidth: 0.8,
  shadow: { blur: 0, color: '#000000', opacity: 0 },
  stroke: { width: 0, color: '#000000' },
  animation: 'none',
};

function TextDiagHarness() {
  const {
    textOverlaysWithLayout,
    duration,
    selectedTextId,
    setSelectedTextId,
    initializeWithDuration,
    addText,
    moveTextStart,
    moveTextEnd,
    toggleText,
    deleteText,
  } = useTextOverlays();

  useEffect(() => {
    initializeWithDuration(DURATION);
  }, [initializeWithDuration]);

  useEffect(() => {
    if (duration && textOverlaysWithLayout.length === 0) {
      addText(BLOCK_START, DEFAULT_SPEC);
    }
  }, [duration, textOverlaysWithLayout.length, addText]);

  const block = textOverlaysWithLayout[0];

  return (
    <div style={{ margin: 40, width: 1000 }}>
      <div
        data-testid="status"
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {block
          ? `count=${textOverlaysWithLayout.length} start=${block.startTime.toFixed(3)} end=${block.endTime.toFixed(3)} enabled=${block.enabled}`
          : `count=${textOverlaysWithLayout.length} no-block`}
      </div>

      {/* Fixed-width host so the track's bounding rect (and thus lever hit-tests
          and snap-pixel math) is deterministic across viewports. */}
      <div style={{ width: 1000 }}>
        <TextLayer
          blocks={textOverlaysWithLayout}
          duration={duration}
          visualDuration={duration}
          clipBoundaries={CLIP_BOUNDARIES}
          selectedTextId={selectedTextId}
          onAddText={(t) => addText(t, DEFAULT_SPEC)}
          onMoveTextStart={moveTextStart}
          onMoveTextEnd={moveTextEnd}
          onSelectText={setSelectedTextId}
          onDeleteText={deleteText}
          onToggleText={toggleText}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('textdiag-root')).render(<TextDiagHarness />);
