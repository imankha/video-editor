import { createRoot } from 'react-dom/client';
import SpotlightPickGuide from '../modes/overlay/components/SpotlightPickGuide';
import { useIsMobile, useIsLandscape, useIsPhonePortrait, useIsSmallPhoneViewport } from '../hooks/useIsMobile';
import '../index.css'; // Tailwind

/**
 * T11570 — DEV-ONLY real-browser harness for the guided athlete-pick guide's
 * responsive placement (the artifact's 10-viewport table). Mounts the REAL
 * SpotlightPickGuide with the SAME placement-bucket derivation OverlayModeView
 * uses (same hooks, reacting to the real page viewport), plus two plain boxes
 * standing in for detection boxes (one near the top of the stage, to exercise
 * the flip-to-bottom rule) so a Playwright spec can measure real bounding
 * boxes in a real browser. NOT a vite build input (T9620 precedent) — never
 * ships in production.
 *
 * Query params:
 *   ?fullscreen=1 — simulates the mobile-fullscreen player mode (mobileFs in
 *     OverlayModeView is explicit UI state, not a media query, so it can't be
 *     driven by viewport size alone).
 */
function Harness() {
  const params = new URLSearchParams(window.location.search);
  const forceFullscreen = params.get('fullscreen') === '1';

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
    flipToBottom: placement === 'overlay',
  };

  return (
    <div style={{ margin: 0, padding: 0, background: '#0b1220', minHeight: '100vh' }}>
      <div
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
        {/* Stand-in detection box near the TOP (within the top 20% of the
            frame) — real boxes there must trigger the guide's flip-to-bottom
            rule so the guide never covers them. */}
        <div
          data-testid="detection-box-top"
          style={{
            position: 'absolute', top: '5%', left: '35%', width: '30%', height: '14%',
            border: '2px solid #22c55e', borderRadius: 4,
          }}
        />
        <div
          data-testid="detection-box-mid"
          style={{
            position: 'absolute', top: '48%', left: '35%', width: '30%', height: '14%',
            border: '2px solid #22c55e', borderRadius: 4,
          }}
        />
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
