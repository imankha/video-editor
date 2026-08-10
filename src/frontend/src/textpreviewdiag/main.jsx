import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Tailwind utilities: without this the harness renders layout classes inert.
import '../index.css';
import TextOverlayPreview from '../modes/overlay/overlays/TextOverlayPreview';
import useTextOverlays from '../modes/overlay/hooks/useTextOverlays';

/**
 * T6720 -- DEV-ONLY real-browser harness for the Overlay text SPATIAL drag.
 *
 * Mounts the REAL <TextOverlayPreview> wired to the REAL useTextOverlays hook,
 * inside a fixed-size `.video-container` with a real (source-less) <video> and
 * explicit videoMetadata, so useVideoDisplayRect computes a deterministic
 * letterbox rect. A drag on the grab frame therefore runs genuine code
 * end-to-end: pointer handlers -> clampAnchorToFrame -> onMoveTextPosition ->
 * updateElementSpec -> re-rendered <RichText>.
 *
 * The `status` readout exposes the selected element's live position + the
 * commit count (commit=true calls = the ONE surgical persist a real drag
 * fires, mirroring OverlayScreen.wrappedMoveTextPosition) so the spec can
 * assert "the first gesture moved it", "it clamped on-frame", and "exactly one
 * write per drag" without a network tap.
 *
 * jsdom is insufficient for a pointer/layout fix (no real getBoundingClientRect,
 * T5380) -- the Playwright spec drives a real mouse against this harness.
 */

const DURATION = 10;
// Container smaller than the native frame so the aspect-fit rect is a real
// letterbox (exercises the offset/scale transform, not an identity map).
const CONTAINER_W = 640;
const CONTAINER_H = 360;
const VIDEO_META = { width: 1280, height: 720 }; // 16:9, same aspect -> pillar/letterbox none, clean 0.5 scale
// Stable identities: useVideoDisplayRect keys its layout effect on panOffset, so
// a fresh object each render would re-run it forever (the real app passes stable
// values from useZoom -- the harness must too).
const PAN = { x: 0, y: 0 };

const SHORT_TEXT = 'GO';
const LONG_TEXT = 'LONGER OVERLAY CAPTION LINE';

const BASE_SPEC = {
  text: SHORT_TEXT,
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

function TextPreviewDiagHarness() {
  const videoRef = useRef(null);
  const {
    textOverlays,
    selectedRegionId,
    selectedElementId,
    initializeWithDuration,
    addRegion,
    selectElement,
    updateElementSpec,
  } = useTextOverlays();

  const [elementId, setElementId] = useState(null);
  const [commits, setCommits] = useState(0);

  // Mirror OverlayScreen.wrappedMoveTextPosition: local update on every tick,
  // count the commit=true persist so the spec can assert one-write-per-drag.
  const handleMoveTextPosition = (id, nextSpec, commit) => {
    updateElementSpec(id, nextSpec);
    if (commit) setCommits((c) => c + 1);
  };

  useEffect(() => {
    initializeWithDuration(DURATION);
  }, [initializeWithDuration]);

  const [regionId, setRegionId] = useState(null);
  const normalizedRef = useRef(false);

  // Step 1: create exactly one region+element (addRegion overrides text/position
  // with its own "N.M" + top-right-preset defaults).
  useEffect(() => {
    if (elementId || textOverlays.length > 0) return;
    const region = addRegion(2, BASE_SPEC); // region window [2,4]
    setElementId(region.elements[0].id);
    setRegionId(region.id);
  }, [elementId, textOverlays.length, addRegion]);

  // Step 2 (SEPARATE tick): once the region is committed to state, normalize the
  // element to a KNOWN center position + short text and select it. This must NOT
  // share addRegion's tick -- updateElementSpec closes over `textOverlays`, which
  // is still empty in the creating tick (the T5644 stale-closure trap), so an
  // in-tick call is a silent no-op.
  useEffect(() => {
    if (!elementId || normalizedRef.current) return;
    const el = textOverlays.flatMap((r) => r.elements).find((e) => e.id === elementId);
    if (!el) return;
    normalizedRef.current = true;
    updateElementSpec(elementId, { ...BASE_SPEC });
    selectElement(elementId, regionId);
  }, [elementId, regionId, textOverlays, updateElementSpec, selectElement]);

  const selected = textOverlays
    .flatMap((r) => r.elements)
    .find((el) => el.id === elementId);
  const pos = selected ? selected.spec.position : null;
  const textLen = selected ? selected.spec.text.length : 0;

  const setText = (text) => {
    if (selected) updateElementSpec(elementId, { ...selected.spec, text });
  };
  const resetPos = () => {
    if (selected) updateElementSpec(elementId, { ...selected.spec, position: { x: 0.5, y: 0.5 } });
  };

  return (
    <div style={{ margin: 40 }}>
      <div
        data-testid="status"
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {pos
          ? `x=${pos.x.toFixed(3)} y=${pos.y.toFixed(3)} textlen=${textLen} commits=${commits} selected=${selectedElementId === elementId ? 'yes' : 'no'}`
          : `no-element commits=${commits}`}
      </div>

      <div style={{ marginBottom: 12 }}>
        <button type="button" data-testid="set-short" onClick={() => setText(SHORT_TEXT)}>short</button>
        <button type="button" data-testid="set-long" onClick={() => setText(LONG_TEXT)}>long</button>
        <button type="button" data-testid="reset-pos" onClick={resetPos}>reset</button>
      </div>

      {/* Fixed-size video container so the aspect-fit rect (and thus the grab
          frame's on-screen position) is deterministic across viewports. */}
      <div
        className="video-container"
        style={{ position: 'relative', width: CONTAINER_W, height: CONTAINER_H, background: '#000' }}
      >
        <video
          ref={videoRef}
          width={CONTAINER_W}
          height={CONTAINER_H}
          style={{ display: 'block', width: '100%', height: '100%' }}
          muted
        />
        <TextOverlayPreview
          videoRef={videoRef}
          videoMetadata={VIDEO_META}
          textOverlays={textOverlays}
          currentTime={3}
          selectedRegionId={selectedRegionId}
          selectedElementId={selectedElementId}
          onMoveTextPosition={handleMoveTextPosition}
          zoom={1}
          panOffset={PAN}
          isFullscreen={false}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('textpreviewdiag-root')).render(<TextPreviewDiagHarness />);
