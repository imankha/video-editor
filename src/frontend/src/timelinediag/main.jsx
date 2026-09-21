import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TimelineBase } from '../components/timeline/TimelineBase';
import '../index.css'; // Tailwind - timeline-scroll-container / playhead classes need it

/**
 * T5647 - DEV-ONLY real-browser harness for the follow-playhead auto-scroll fix.
 *
 * Mounts the REAL TimelineBase, driven by a simulated playback clock (no <video>
 * element required) so a Playwright spec can zoom the timeline past 100%, hit Play,
 * and watch the actual auto-scroll effect + handleScroll wiring run end-to-end.
 * `PLAY_SPEED` compresses a full pass over `DURATION` into a few real seconds so the
 * spec doesn't need to wait through simulated playback in real time.
 *
 * NOT shipped: timelinediag.html is not a vite build input, so this never enters the
 * production bundle.
 */

const DURATION = 60; // seconds of simulated video
const PLAY_SPEED = 6; // simulated seconds per real second -> ~10s full pass

function getScaleFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const scale = parseFloat(params.get('scale'));
  return Number.isFinite(scale) && scale > 0 ? scale : 1.93;
}

// T10780: optional query knobs, both DEFAULT-OFF so the T5647 run
// (?scale=1.93, no other params) stays byte-identical.
//  - anchor=page-forward -> exercise the mobile-Annotate follow (re-anchor 1/3
//    in on a forward crossing + scroll a non-playback/mount off-screen playhead
//    into view). Absent -> undefined -> TimelineBase's default 'margin'.
//  - fluid=1 -> let the harness fill the viewport width (maxWidth 900) so a phone
//    viewport actually constrains the scroll container's clientWidth. The T5647
//    run keeps the fixed 900px width.
function getFollowAnchorFromQuery() {
  const a = new URLSearchParams(window.location.search).get('anchor');
  return a === 'page-forward' ? 'page-forward' : undefined;
}
function getFluidFromQuery() {
  return new URLSearchParams(window.location.search).get('fluid') === '1';
}

function TimelineDiagHarness() {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [scrollPosition, setScrollPosition] = useState(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const scale = getScaleFromQuery();
  const followAnchor = getFollowAnchorFromQuery();
  const fluid = getFluidFromQuery();

  const tick = useCallback((ts) => {
    if (lastTsRef.current == null) lastTsRef.current = ts;
    const dt = (ts - lastTsRef.current) / 1000;
    lastTsRef.current = ts;
    setCurrentTime((t) => {
      const next = t + dt * PLAY_SPEED;
      if (next >= DURATION) {
        setIsPlaying(false);
        lastTsRef.current = null;
        return DURATION;
      }
      rafRef.current = requestAnimationFrame(tick);
      return next;
    });
  }, []);

  const handlePlay = () => {
    if (currentTime >= DURATION) setCurrentTime(0);
    lastTsRef.current = null;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const handleSeek = (t) => {
    setCurrentTime(Math.max(0, Math.min(t, DURATION)));
  };

  const outerStyle = fluid
    ? { margin: '24px auto', width: '100%', maxWidth: 900 }
    : { margin: '24px auto', width: 900 };
  const innerStyle = fluid ? { width: '100%' } : { width: 900 };

  return (
    <div style={outerStyle}>
      <div
        data-testid="status"
        style={{ color: '#d1d5db', fontSize: 13, marginBottom: 16, fontFamily: 'monospace' }}
      >
        {`t=${currentTime.toFixed(2)} playing=${isPlaying} scale=${scale}`}
      </div>
      <div style={{ marginBottom: 16 }}>
        <button data-testid="play-btn" onClick={handlePlay} style={{ marginRight: 8 }}>
          Play
        </button>
        <button data-testid="pause-btn" onClick={handlePause}>
          Pause
        </button>
      </div>
      {/* T10780: sentinel below the timeline so a spec can measure the gap from
          the scrollbar bottom to the next control (>= 12px via mb-3). */}
      <div style={innerStyle}>
        <TimelineBase
          currentTime={currentTime}
          duration={DURATION}
          visualDuration={DURATION}
          onSeek={handleSeek}
          timelineScale={scale}
          timelineZoom={scale * 100}
          timelineScrollPosition={scrollPosition}
          onTimelineScrollPositionChange={setScrollPosition}
          selectedLayer={selectedLayer}
          onLayerSelect={setSelectedLayer}
          layerLabels={<div style={{ color: '#9ca3af', fontSize: 11, padding: 4 }}>Video</div>}
          isPlaying={isPlaying}
          followAnchor={followAnchor}
        />
      </div>
      <div
        data-testid="below-timeline-sentinel"
        style={{ height: 24, background: '#374151', color: '#9ca3af', fontSize: 11, padding: 4 }}
      >
        (next control)
      </div>
    </div>
  );
}

createRoot(document.getElementById('timelinediag-root')).render(<TimelineDiagHarness />);
