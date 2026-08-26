import { useEffect, useState } from 'react';
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
 * re-rendered layout. The `status` readout exposes the region count and the
 * first region's start/end/enabled so the spec can assert a drag actually
 * moved a boundary (and whether it snapped).
 *
 * T7730: the hook + TextLayer moved to the T6630 REGION/element model
 * (addText/moveTextStart/... -> addRegion/moveRegionStart/..., `blocks` ->
 * `regions`, per-region `enabled` -> per-element `enabled`). This harness was
 * still calling the pre-T6630 API, so it threw on mount and NO text block ever
 * rendered -- the root cause of the T5225/T6610 lever/body-drag failures. It
 * now mirrors OverlayMode.jsx's real wiring 1:1.
 *
 * NOT shipped: textdiag.html is not a vite build input. jsdom is insufficient
 * for a pointer/touch fix (memory: real_browser_for_pointer_fixes) -- the
 * Playwright spec drives real touch (CDP Input.dispatchTouchEvent) in a
 * coarse context and a real mouse in a fine one, mirroring T5644's harness.
 */

const DURATION = 10;
const CLIP_BOUNDARIES = [5.0]; // one interior cut-point at 5s, mirrors a 2-clip reel
const BLOCK_START = 2; // addRegion(2, spec) -> a 2s block [2, 4]

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
    textOverlays,
    textOverlaysWithLayout,
    duration,
    selectedRegionId,
    selectRegion,
    initializeWithDuration,
    addRegion,
    moveRegionStart,
    moveRegionEnd,
    moveRegionBlock,
    deleteRegion,
  } = useTextOverlays();

  // T6610: count the SINGLE surgical persist that a completed body drag / keyboard
  // nudge should fire (commit=true). In the real app this is
  // OverlayScreen.wrappedMoveTextBody's dispatchOverlayAction; here we mirror the
  // commit path locally so the spec can assert "exactly one write per drag" the
  // same way it would count network requests.
  const [commits, setCommits] = useState(0);
  const handleMoveTextBody = (id, newStart, commit) => {
    moveRegionBlock(id, newStart);
    if (commit) setCommits((c) => c + 1);
  };

  useEffect(() => {
    initializeWithDuration(DURATION);
  }, [initializeWithDuration]);

  useEffect(() => {
    if (duration && textOverlays.length === 0) {
      addRegion(BLOCK_START, DEFAULT_SPEC);
    }
  }, [duration, textOverlays.length, addRegion]);

  const block = textOverlaysWithLayout[0];
  // A region has no scalar `enabled` since T6630 -- enablement is per-element.
  // The harness seeds one region with one element, so the region reads as
  // enabled when any of its elements is enabled (matches TextLayer's own
  // `allDisabled` derivation, inverted).
  const blockEnabled = block ? block.elements.some((el) => el.enabled !== false) : null;

  return (
    <div style={{ margin: 40, width: 1000 }}>
      <div
        data-testid="status"
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {block
          ? `count=${textOverlaysWithLayout.length} start=${block.startTime.toFixed(3)} end=${block.endTime.toFixed(3)} enabled=${blockEnabled} selected=${selectedRegionId === block.id ? 'yes' : 'no'} commits=${commits}`
          : `count=${textOverlaysWithLayout.length} no-block commits=${commits}`}
      </div>

      {/* Fixed-width host so the track's bounding rect (and thus lever hit-tests
          and snap-pixel math) is deterministic across viewports. */}
      <div style={{ width: 1000 }}>
        <TextLayer
          regions={textOverlaysWithLayout}
          duration={duration}
          visualDuration={duration}
          clipBoundaries={CLIP_BOUNDARIES}
          selectedRegionId={selectedRegionId}
          onAddRegion={(t) => addRegion(t, DEFAULT_SPEC)}
          onMoveTextStart={moveRegionStart}
          onMoveTextEnd={moveRegionEnd}
          onMoveTextBody={handleMoveTextBody}
          onSelectRegion={selectRegion}
          onDeleteTextRegion={deleteRegion}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('textdiag-root')).render(<TextDiagHarness />);
