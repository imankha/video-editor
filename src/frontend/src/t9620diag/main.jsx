import { createRoot } from 'react-dom/client';
import { MousePointerClick } from 'lucide-react';
import OverlaySpotlightPanel from '../components/settings/OverlaySpotlightPanel';
import DetectionMarkerLayer from '../modes/overlay/layers/DetectionMarkerLayer';
import { EDITOR_PANELS } from '../config/displayNames';
import '../index.css'; // Tailwind

/**
 * T9620 — DEV-ONLY real-browser harness for player-selection-first sequencing.
 *
 * Mounts the REAL OverlaySpotlightPanel (pre- and post-selection) and the REAL
 * DetectionMarkerLayer (unassigned counts vs assigned checks), plus the exact
 * "Click your player" prompt markup OverlayModeView paints over the stage, so a
 * Playwright spec can screenshot each acceptance criterion with real Tailwind.
 * NOT a vite build input — never ships in production (T5450/T9100 precedent).
 */

const PANEL_PROPS = {
  highlightColor: 'white',
  highlightShape: 'body',
  strokeWidth: 3,
  fillOpacity: 0,
  dimStrength: 0.15,
  isHighlightEnabled: true,
  onHighlightColorChange: () => {},
  onHighlightShapeChange: () => {},
  onStrokeWidthChange: () => {},
  onFillEnabledChange: () => {},
  onFillOpacityChange: () => {},
  onDimStrengthChange: () => {},
  onHighlightEffectTypeChange: () => {},
};

// Detection frames with varying player COUNTS — the digits that used to read as
// jersey numbers (10/13/14). Now paired with a Users glyph.
const boxes = (n) => Array.from({ length: n }, (_, i) => ({ x: i }));
const REGION_UNASSIGNED = {
  id: 'r1', startTime: 0, endTime: 6, fps: 30, videoWidth: 1920, videoHeight: 1080,
  keyframes: [],
  detections: [
    { timestamp: 0.5, frame: 15, boxes: boxes(10) },
    { timestamp: 2.5, frame: 75, boxes: boxes(13) },
    { timestamp: 4.5, frame: 135, boxes: boxes(14) },
  ],
};
const REGION_PARTIAL = {
  ...REGION_UNASSIGNED,
  keyframes: [{ frame: 15, origin: 'user', fromDetection: true, x: 0, y: 0, radiusX: 1, radiusY: 1 }],
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ color: '#93c5fd', fontSize: 12, marginBottom: 8, fontFamily: 'monospace' }}>{title}</div>
      {children}
    </div>
  );
}

function Harness() {
  return (
    <div style={{ margin: 32, maxWidth: 900 }}>
      <Section title="1. Primary task stated on screen (banner over the video stage)">
        <div data-testid="stage" style={{ position: 'relative', width: 340, height: 200, background: '#111827', borderRadius: 8 }}>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[90%]">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600/95 text-white text-sm font-semibold shadow-lg ring-1 ring-white/20">
              <MousePointerClick size={16} aria-hidden="true" className="shrink-0" />
              <span>{EDITOR_PANELS.SELECT_PLAYER_CLICK}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="2. Panel BEFORE selection — styling hidden, pick-your-player guidance">
        <div data-testid="panel-awaiting" style={{ width: 300 }}>
          <OverlaySpotlightPanel {...PANEL_PROPS} awaitingPlayerSelection assignedCount={0} totalDetections={3} />
        </div>
      </Section>

      <Section title="3. Panel AFTER first pick — styling revealed + remaining-players progress">
        <div data-testid="panel-partial" style={{ width: 300 }}>
          <OverlaySpotlightPanel {...PANEL_PROPS} awaitingPlayerSelection={false} assignedCount={1} totalDetections={3} />
        </div>
      </Section>

      <Section title="4. Detection markers — counts paired with a Users glyph (not jersey numbers)">
        <div data-testid="markers-unassigned" style={{ width: 700, background: '#1f2937', padding: 16, borderRadius: 8 }}>
          <DetectionMarkerLayer regions={[REGION_UNASSIGNED]} duration={6} onSeek={() => {}} />
        </div>
      </Section>

      <Section title="5. Detection markers — assigned frame shows a check">
        <div data-testid="markers-partial" style={{ width: 700, background: '#1f2937', padding: 16, borderRadius: 8 }}>
          <DetectionMarkerLayer regions={[REGION_PARTIAL]} duration={6} onSeek={() => {}} />
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('t9620diag-root')).render(<Harness />);
