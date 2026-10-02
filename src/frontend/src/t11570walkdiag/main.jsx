import { createRoot } from 'react-dom/client';
import { useState, useCallback, useRef } from 'react';
import { useGuidedAthletePick } from '../modes/overlay/hooks/useGuidedAthletePick';
import { isDetectionAssigned } from '../modes/overlay/utils/detectionAssignment';
import SpotlightPickGuide from '../modes/overlay/components/SpotlightPickGuide';
import '../index.css';

/**
 * T11570 — DEV-ONLY real-browser harness that LIVE-DRIVES the guided
 * athlete-pick walk's behavior (entry-park, pick -> confirm -> advance,
 * forward-then-wrap, drag-the-circle, cancel-on-play/scrub) with the REAL
 * useGuidedAthletePick hook + the REAL SpotlightPickGuide, against a small
 * in-memory region fixture that stands in for OverlayContainer (which has no
 * dedicated test harness in this codebase to begin with). Mirrors the T9620
 * diag precedent: not a vite build input, never ships in production.
 *
 * 4 markers across 2 regions (r1: markers 1-2, r2: markers 3-4) so
 * forward-then-wrap is exercisable by picking marker 4 (wraps to 1).
 */
const INITIAL_REGIONS = [
  {
    id: 'r1', startTime: 0, endTime: 2, fps: 30, videoWidth: 100, videoHeight: 100,
    keyframes: [],
    detections: [
      { timestamp: 0.5, frame: 15, boxes: [{ x: 1 }] },
      { timestamp: 1.5, frame: 45, boxes: [{ x: 1 }] },
    ],
  },
  {
    id: 'r2', startTime: 10, endTime: 12, fps: 30, videoWidth: 100, videoHeight: 100,
    keyframes: [],
    detections: [
      { timestamp: 10.5, frame: 315, boxes: [{ x: 1 }] },
      { timestamp: 11.5, frame: 345, boxes: [{ x: 1 }] },
    ],
  },
];

// Flat marker list for the UI, same order orderedDetectionMarkers produces.
const MARKERS = [
  { label: 'Marker 1', regionId: 'r1', time: 0.5 },
  { label: 'Marker 2', regionId: 'r1', time: 1.5 },
  { label: 'Marker 3', regionId: 'r2', time: 10.5 },
  { label: 'Marker 4', regionId: 'r2', time: 11.5 },
];

function Harness() {
  const [regions, setRegions] = useState(INITIAL_REGIONS);
  const [clickedDetection, setClickedDetection] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [log, setLog] = useState([]);
  const seekRef = useRef(null);

  const appendLog = useCallback((msg) => setLog((l) => [...l, msg]), []);

  // Stand-in for OverlayContainer.parkOnDetection: shows "boxes" (clickedDetection)
  // + records the seek target. Real seek is ephemeral playback control; here it's
  // just a log line for the human/Playwright evidence to read.
  const parkOnDetection = useCallback((marker) => {
    setClickedDetection(marker);
    seekRef.current = marker.timestamp;
    appendLog(`parkOnDetection -> regionId=${marker.regionId} t=${marker.timestamp}`);
  }, [appendLog]);

  const guidedPick = useGuidedAthletePick({
    active: true,
    highlightRegions: regions,
    isPlaying,
    clickedDetection,
    parkOnDetection,
  });

  // Stand-in for handlePlayerSelect (tap a box): adds a keyframe (the ONLY
  // persistence in the real flow -- here, in-memory) then schedules the
  // guided advance exactly like OverlayContainer does.
  const pickMarker = useCallback((marker) => {
    setRegions((prev) => prev.map((r) => r.id === marker.regionId
      ? { ...r, keyframes: [...r.keyframes, { frame: Math.round(marker.time * 30), fromDetection: true }] }
      : r));
    appendLog(`PICK (tap box) -> regionId=${marker.regionId} t=${marker.time}`);
    guidedPick.scheduleGuidedAdvance(marker.regionId, marker.time);
  }, [guidedPick, appendLog]);

  // Stand-in for handleHighlightComplete (AC5: "Not boxed? Drag the circle") --
  // SAME effect as pickMarker (a keyframe write + the same scheduleGuidedAdvance
  // call), just a different entry gesture, exactly mirroring OverlayContainer.
  const dragCircleOntoActiveMarker = useCallback(() => {
    if (!clickedDetection) { appendLog('DRAG ignored -- no active marker parked'); return; }
    const marker = { regionId: clickedDetection.regionId, time: clickedDetection.timestamp };
    setRegions((prev) => prev.map((r) => r.id === marker.regionId
      ? { ...r, keyframes: [...r.keyframes, { frame: Math.round(marker.time * 30), fromDetection: true }] }
      : r));
    appendLog(`PICK (drag circle) -> regionId=${marker.regionId} t=${marker.time}`);
    guidedPick.scheduleGuidedAdvance(marker.regionId, marker.time);
  }, [clickedDetection, guidedPick, appendLog]);

  const tapMarkerDirectly = useCallback((marker) => {
    appendLog(`DIRECT TAP -> regionId=${marker.regionId} t=${marker.time}`);
    guidedPick.handleDetectionMarkerTap({
      regionId: marker.regionId, frame: Math.round(marker.time * 30), fps: 30,
      timestamp: marker.time, boxes: [{ x: 1 }],
    });
  }, [guidedPick, appendLog]);

  const startPlaying = useCallback(() => {
    setIsPlaying(true);
    setClickedDetection(null); // mirrors OverlayContainer's clear-on-play effect
    appendLog('PLAY (clickedDetection cleared, as OverlayContainer does on isPlaying)');
  }, [appendLog]);
  const stopPlaying = useCallback(() => { setIsPlaying(false); appendLog('PAUSE'); }, [appendLog]);
  const scrubAway = useCallback(() => {
    setClickedDetection(null); // mirrors OverlayContainer's clear-on-scrub-away effect
    appendLog('SCRUB AWAY (clickedDetection cleared, as OverlayContainer does >2 frames away)');
  }, [appendLog]);

  const isPicked = (marker) => isDetectionAssigned(
    regions.find((r) => r.id === marker.regionId),
    { timestamp: marker.time }
  );
  const isActive = (marker) => clickedDetection?.regionId === marker.regionId &&
    Math.abs(clickedDetection.timestamp - marker.time) < 0.01;

  return (
    <div style={{ margin: 0, padding: 24, background: '#0b1220', minHeight: '100vh', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 16 }}>T11570 guided-pick walk — live-drive harness</h1>

      {/* The guide pill floats top-4 and can grow to ~110px tall (sub-line +
          "Not boxed?" + progress dots) -- markers sit well below it so this
          harness's OWN layout never blocks clicks (a harness-only concern;
          the real app's no-overlap placement is proven separately by
          T11570-spotlight-pick-guide-responsive.qa.spec.js). */}
      <div data-testid="stage" style={{ position: 'relative', width: 500, height: 260, background: '#111827', marginTop: 16 }}>
        {MARKERS.map((m) => (
          <button
            key={m.label}
            data-testid={`marker-${m.label.replace(/\s/g, '-').toLowerCase()}`}
            onClick={() => tapMarkerDirectly(m)}
            style={{
              position: 'absolute', top: 140, left: 20 + MARKERS.indexOf(m) * 110,
              width: 90, height: 90,
              background: isPicked(m) ? '#16a34a' : isActive(m) ? '#2563eb' : '#374151',
              border: isActive(m) ? '3px solid white' : '1px solid #6b7280',
              color: 'white', fontSize: 12, cursor: 'pointer',
            }}
          >
            {m.label}{isPicked(m) ? ' ✓' : ''}
          </button>
        ))}
        <SpotlightPickGuide
          phase={guidedPick.phase}
          step={guidedPick.step}
          total={guidedPick.total}
          progress={regions.flatMap((r) => r.detections.map((d) => isDetectionAssigned(r, d)))}
          placement="overlay"
          isTouch={false}
          flipToBottom={false}
        />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button data-testid="tap-active-box" onClick={() => clickedDetection && pickMarker({ regionId: clickedDetection.regionId, time: clickedDetection.timestamp })} disabled={!clickedDetection}>
          Tap the active box (pick it)
        </button>
        <button data-testid="drag-circle" onClick={dragCircleOntoActiveMarker} disabled={!clickedDetection}>
          Not boxed? Drag the circle (pick the active marker)
        </button>
        <button data-testid="play-btn" onClick={startPlaying}>Play</button>
        <button data-testid="pause-btn" onClick={stopPlaying}>Pause</button>
        <button data-testid="scrub-away-btn" onClick={scrubAway}>Scrub away</button>
      </div>

      <div data-testid="guide-phase" style={{ marginTop: 16 }}>
        phase={String(guidedPick.phase)} step={String(guidedPick.step)} total={String(guidedPick.total)}
      </div>

      <pre data-testid="action-log" style={{ marginTop: 16, fontSize: 11, color: '#9ca3af', maxHeight: 200, overflow: 'auto' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}

createRoot(document.getElementById('t11570walkdiag-root')).render(<Harness />);
