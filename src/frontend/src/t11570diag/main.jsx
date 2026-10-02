import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import SpotlightPickGuide from '../modes/overlay/components/SpotlightPickGuide';
import { useIsMobile, useIsLandscape, useIsPhonePortrait, useIsSmallPhoneViewport } from '../hooks/useIsMobile';
import '../index.css'; // Tailwind

/**
 * T11570 — DEV-ONLY real-browser harness for the guided athlete-pick guide's
 * responsive placement (the artifact's 10-viewport table). Mounts the REAL
 * SpotlightPickGuide with the SAME placement-bucket derivation AND the SAME
 * real-measurement flip logic OverlayModeView uses (same hooks reacting to
 * the real page viewport, a real `stageRef` the guide measures via
 * `getBoundingClientRect`, and real obstacle boxes in video-pixel space) --
 * no hardcoded placement stand-in, so a Playwright spec exercises the exact
 * production decision. NOT a vite build input (T9620 precedent) — never
 * ships in production.
 *
 * Query params:
 *   ?fullscreen=1 — simulates the mobile-fullscreen player mode (mobileFs in
 *     OverlayModeView is explicit UI state, not a media query, so it can't be
 *     driven by viewport size alone).
 *   ?obstacle=top|bottom|both — which band the stand-in detection box(es)
 *     occupy (video-pixel space, videoHeight=1000): 'top' (default) sits in
 *     the top 20%, forcing a flip to bottom; 'bottom' sits in the bottom
 *     20%, forcing the guide to STAY top; 'both' blocks nearly the whole
 *     frame, exercising the compact-fallback-then-give-up path.
 */
const VIDEO_HEIGHT = 1000;
const OBSTACLE_SETS = {
  top: [{ y: 120, height: 140 }, { y: 550, height: 140 }],
  bottom: [{ y: 450, height: 140 }, { y: 880, height: 140 }],
  both: [{ y: 500, height: 1000 }],
};

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const forceFullscreen = params.get('fullscreen') === '1';
  const obstacleKey = OBSTACLE_SETS[params.get('obstacle')] ? params.get('obstacle') : 'top';
  const obstacleBoxes = OBSTACLE_SETS[obstacleKey];
  const stageRef = useRef(null);

  const isMobile = useIsMobile();
  const isLandscapePhone = useIsLandscape();
  const isPhonePortrait = useIsPhonePortrait();
  const isSmallPhoneViewport = useIsSmallPhoneViewport();
  const mobileFs = isMobile && forceFullscreen;

  // SAME bucket derivation as OverlayModeView.jsx (T11570) — kept in sync by
  // the e2e spec's assertions, not re-exported, mirroring the T9620 diag
  // harness's "recreate the exact markup" precedent.
  const pickGuideVariant =
    (isLandscapePhone || mobileFs) ? 'pill-safearea'
    : isSmallPhoneViewport ? 'strip-compact'
    : isPhonePortrait ? 'strip'
    : 'pill';
  const placement = pickGuideVariant.startsWith('pill') ? 'overlay' : 'strip';
  const compact = pickGuideVariant === 'strip-compact' || pickGuideVariant === 'pill-safearea';
  const safeArea = pickGuideVariant === 'pill-safearea';

  const guideProps = {
    phase: 'parked',
    step: 2,
    total: 4,
    assignedCount: 1,
    progress: [true, false, false, false],
    placement,
    compact,
    safeArea,
    isTouch: isMobile,
    stageRef,
    obstacleBoxes,
    videoHeight: VIDEO_HEIGHT,
  };

  // Stand-in boxes rendered at the SAME screen position the real
  // measurement will check against (converted from video-pixel space to a
  // CSS percentage of the stage, matching how PlayerDetectionOverlay scales
  // boxes onto the video element).
  const boxStyle = (box) => ({
    position: 'absolute',
    top: `${((box.y - box.height / 2) / VIDEO_HEIGHT) * 100}%`,
    height: `${(box.height / VIDEO_HEIGHT) * 100}%`,
    left: '35%', width: '30%',
    border: '2px solid #22c55e', borderRadius: 4,
  });

  return (
    <div style={{ margin: 0, padding: 0, background: '#0b1220', minHeight: '100dvh' }}>
      <div
        ref={stageRef}
        data-testid="stage"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 900,
          aspectRatio: isLandscapePhone || !isMobile ? '16/9' : '9/16',
          background: '#111827',
          overflow: 'hidden',
        }}
      >
        {obstacleBoxes.map((box, i) => (
          <div key={i} data-testid={`detection-box-${i}`} style={boxStyle(box)} />
        ))}
        {placement === 'overlay' && <SpotlightPickGuide {...guideProps} />}
      </div>
      {/* "strip" placement is a SIBLING below the stage, never drawn over the
          video — structurally non-overlapping by DOM position, matching
          OverlayModeView's actual layout (controls, then the strip, then the
          timeline). */}
      {placement === 'strip' && (
        <div data-testid="strip-wrapper" style={{ width: '100%', maxWidth: 900 }}>
          <SpotlightPickGuide {...guideProps} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('t11570diag-root')).render(<Harness />);
