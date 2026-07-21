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

function TimelineDiagHarness() {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [scrollPosition, setScrollPosition] = useState(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const scale = getScaleFromQuery();

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

  return (
    <div style={{ margin: '24px auto', width: 900 }}>
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
      <div style={{ width: 900 }}>
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
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('timelinediag-root')).render(<TimelineDiagHarness />);
