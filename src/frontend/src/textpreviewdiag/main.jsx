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
 *
 * Round 2: a SECOND element (`elementId2`) lives in the SAME region as the
 * first, unselected, so the click-to-select hit-target (only rendered for
 * NON-selected elements) has something to click -- its id is exposed via the
 * status div's `data-el2-id` attribute (not the text, since it's a
 * dynamically-generated id the spec can't hardcode). `onSelectElement`
 * wires straight to the real `selectElement` from `useTextOverlays`.
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
    addElement,
    selectElement,
    updateElementSpec,
  } = useTextOverlays();

  const [elementId, setElementId] = useState(null);
  const [elementId2, setElementId2] = useState(null);
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

  // T6720 round 2 -- a SECOND element in the SAME region, so the click-to-select
  // hit-target (only rendered for NON-selected elements) has something to click.
  // addElement auto-picks a preset position distinct from the first element's, so
  // the two never overlap on-screen.
  //
  // MUST wait for step 2's normalize to be OBSERVABLE in `textOverlays` (checked
  // below via the element's actual landed position), not just `normalizedRef`.
  // Both this effect and step 2 close over `textOverlays` and call a mutator that
  // computes its updated region from that SAME closure snapshot before queuing a
  // functional setState -- if both effects fire in the SAME render's effect
  // flush, addElement's `{...region, elements: [...region.elements, el2]}` is
  // built from the PRE-normalize elements array, so its setTextOverlays call
  // (applied AFTER step 2's) clobbers element 1's just-set BASE_SPEC position
  // with addRegion's original default (the exact T5644 class of bug this
  // codebase's mutators are built to avoid for a SINGLE call -- two DIFFERENT
  // mutators keyed off one same-tick closure need the caller to sequence them,
  // which is what this extra gate does). Confirmed live: without it, this
  // harness's element 1 loaded at x=0.92 (addRegion's default) instead of 0.5.
  const addedSecondRef = useRef(false);
  useEffect(() => {
    if (!regionId || addedSecondRef.current) return;
    const el = textOverlays.flatMap((r) => r.elements).find((e) => e.id === elementId);
    if (!el || el.spec.position.x !== BASE_SPEC.position.x) return; // step 2 not landed yet
    addedSecondRef.current = true;
    const el2 = addElement(regionId, { ...BASE_SPEC, text: 'SECOND' });
    setElementId2(el2.id);
  }, [regionId, elementId, textOverlays, addElement]);

  // T6880 -- ghost-state controls. The region window is [2,4] (addRegion(2,...)),
  // so currentTime=3 is IN range (real output) and currentTime=8 is OUT of range
  // (candidate for the paused-only editing ghost). Defaults preserve the T6720
  // spec's setup exactly (in-range, paused, Text tab active).
  const [currentTime, setCurrentTime] = useState(3);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTextTabActive, setIsTextTabActive] = useState(true);

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
        // el2-id exposed as a data attribute (not readable text) so the qa spec
        // can target the SECOND element's dynamically-generated id without
        // parsing it out of the monospace status line.
        data-el2-id={elementId2 || ''}
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {pos
          ? `x=${pos.x.toFixed(3)} y=${pos.y.toFixed(3)} textlen=${textLen} commits=${commits} selected=${selectedElementId === elementId ? 'yes' : 'no'} selectedId=${selectedElementId || 'none'}`
          : `no-element commits=${commits}`}
      </div>

      <div style={{ marginBottom: 12 }}>
        <button type="button" data-testid="set-short" onClick={() => setText(SHORT_TEXT)}>short</button>
        <button type="button" data-testid="set-long" onClick={() => setText(LONG_TEXT)}>long</button>
        <button type="button" data-testid="reset-pos" onClick={resetPos}>reset</button>
      </div>

      {/* T6880 -- ghost-state controls (playhead in/out of the region window,
          play/pause, Text tab active) so the qa spec can drive the exact
          reported setup: select a region, move the playhead past its end. */}
      <div data-testid="t6880-state" data-time={currentTime} data-playing={isPlaying ? 'yes' : 'no'} data-texttab={isTextTabActive ? 'yes' : 'no'} style={{ marginBottom: 12 }}>
        <button type="button" data-testid="time-in" onClick={() => setCurrentTime(3)}>playhead in-range</button>
        <button type="button" data-testid="time-out" onClick={() => setCurrentTime(8)}>playhead out-of-range</button>
        <button type="button" data-testid="toggle-play" onClick={() => setIsPlaying((p) => !p)}>toggle play</button>
        <button type="button" data-testid="toggle-texttab" onClick={() => setIsTextTabActive((a) => !a)}>toggle text tab</button>
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
          currentTime={currentTime}
          selectedRegionId={selectedRegionId}
          selectedElementId={selectedElementId}
          onMoveTextPosition={handleMoveTextPosition}
          onSelectElement={selectElement}
          zoom={1}
          panOffset={PAN}
          isFullscreen={false}
          isPlaying={isPlaying}
          isTextTabActive={isTextTabActive}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('textpreviewdiag-root')).render(<TextPreviewDiagHarness />);
