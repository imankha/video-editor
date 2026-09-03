import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { RichText } from './components/RichText.jsx'
import { IntroCardPreview } from './components/introcards/IntroCardPreview.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import { UpdateGateModal } from './components/UpdateGateModal.jsx'
import { AuthErrorBanner } from './components/AuthErrorBanner.jsx'
import { ReportProblemButton } from './components/ReportProblemButton.jsx'
import { useEditorStore, EDITOR_MODES } from './stores/editorStore.js'
import { useProjectsStore } from './stores/projectsStore.js'
import { ToastContainer } from './components/shared'
import './index.css'
import { installResponsivenessMonitor } from './utils/responsiveness.js'
import { installClientLogger } from './utils/clientLogger.js'
import { installSessionBreadcrumbs } from './utils/uiTelemetry.js'
import { setupActionTracking } from './utils/analytics.js'
import { setupPwaUpdatePrompt, evictStaleDevServiceWorker } from './utils/pwaUpdate.js'

// T1650: Capture console.error/warn before anything else runs
installClientLogger();
setupActionTracking();
// T7515 tier 4: accumulate per-screen dwell + trail, flushed on session exit.
installSessionBreadcrumbs();

console.info(`[Build] ${__COMMIT_HASH__} (#${__APP_BUILD__})`);
installResponsivenessMonitor();

// T6630 round 4: the PWA update-gate machinery is PROD-ONLY. A dev server
// must never register a service worker -- and must actively evict any SW
// left controlling this origin from a past `vite build && vite preview`
// session, which otherwise intercepts every fetch (including cross-origin R2
// URLs) and can serve a stale cached bundle ("I don't see any of your
// changes"). See evictStaleDevServiceWorker's docstring for the full
// mechanism. import.meta.env.DEV is Vite's build-time flag (mirrors the
// /debug/rich-text gate below) -- always false in a deployed build.
if (import.meta.env.DEV) {
  evictStaleDevServiceWorker();
} else {
  setupPwaUpdatePrompt();
}

// T5674: The floating global report trigger sits at the same safe bottom-right
// corner (bottom-20 clears the player control bar) on every screen. On the editor
// screens (annotate/framing/overlay) a video player fills the lower area, so it
// collapses to a small icon square instead of the 134px "Report a problem" pill —
// a tiny corner footprint that no longer reads as colliding with the player
// controls. On Home (no video) it stays the full text pill. Desktop-only
// (hidden lg:block hide-on-touch), matching the prior mount.
//
// The editor-vs-home decision must track the RESOLVED screen, not the raw
// editorMode: FRAMING/OVERLAY with no selected project routes to Home
// (resolveEditorScreen), so those only count as an editor screen when a project
// is selected. ANNOTATE always renders the editor. (We inline the rule instead of
// calling resolveEditorScreen, which console.warns on the no-project case.)
function GlobalReportButton() {
  const editorMode = useEditorStore((s) => s.editorMode);
  // Mirror App's Home/editor decision (resolveEditorScreen uses the selectedProject
  // OBJECT, not the id — the id can linger set while the object is cleared, which
  // would wrongly compact the pill on Home).
  const hasSelectedProject = useProjectsStore((s) => !!s.selectedProject);
  const onEditorScreen =
    editorMode === EDITOR_MODES.ANNOTATE ||
    ((editorMode === EDITOR_MODES.FRAMING || editorMode === EDITOR_MODES.OVERLAY) &&
      hasSelectedProject);
  const base =
    'hidden lg:block hide-on-touch fixed bottom-20 right-4 z-[9999] bg-gray-800/90 border border-gray-600 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 shadow-lg transition-colors';
  return (
    <ReportProblemButton
      compact={onEditorScreen}
      className={`${base} ${onEditorScreen ? 'p-2.5' : 'px-3 py-2 text-sm font-medium'}`}
    />
  );
}


// T5180: dev/test-only debug mount for the rich-text parity Playwright spec
// (T5180-text-parity.spec.js). This app has NO react-router (a custom
// screen-switching SPA driven by editorStore's EDITOR_MODES/APP_SCREENS
// state machine — see App.jsx), so rather than add a routing dependency,
// this checks the raw pathname BEFORE mounting <App/> and renders a bare
// <RichText/> with no chrome/providers instead. Mirrors the backend seam's
// prod-gating spirit (test_seams.py's _require_seams_enabled(), gated on
// dev/development/local/test): import.meta.env.DEV is Vite's build-time
// flag, true only for `npm run dev` / the local Playwright dev server,
// always false in a deployed CF Pages production build — so this route
// 404s/blank-renders (falls through to the normal <App/> mount, which does
// not recognise the path) on any deployed target.
function renderDebugRichTextRouteIfRequested() {
  if (!import.meta.env.DEV) return false;
  if (window.location.pathname !== '/debug/rich-text') return false;

  const params = new URLSearchParams(window.location.search);
  const spec = JSON.parse(decodeURIComponent(params.get('spec') || 'null'));
  const boxWidth = Number(params.get('boxWidth'));
  const boxHeight = Number(params.get('boxHeight'));

  ReactDOM.createRoot(document.getElementById('root')).render(
    <RichText spec={spec} boxWidth={boxWidth} boxHeight={boxHeight} />
  );
  return true;
}

// T6640 round 3: dev/test-only debug mount for the extended T5180 parity spec's
// card-collision case. Unlike /debug/rich-text (a single element, hand-built
// spec), this mounts the REAL <IntroCardPreview> — so the layout mirror's
// element specs AND their <RichText> renders happen in the SAME component
// tree, going through the SAME `useCardPreviewElements` settle loop the actual
// editor uses. A single-element /debug/rich-text mount cannot reproduce that:
// it never registers the card's @font-face (nothing on that bare page ever
// mounts a sibling RichText for the same font), so its canvas metrics measure
// against the browser's fallback font forever — a false mismatch unrelated to
// the double-wrap bug this route exists to catch. Same DEV-only gating as
// /debug/rich-text above.
function renderDebugIntroCardRouteIfRequested() {
  if (!import.meta.env.DEV) return false;
  if (window.location.pathname !== '/debug/intro-card') return false;

  const params = new URLSearchParams(window.location.search);
  const card = JSON.parse(decodeURIComponent(params.get('card') || 'null'));
  const profile = JSON.parse(decodeURIComponent(params.get('profile') || 'null'));
  const aspect = params.get('aspect');
  const boxWidth = Number(params.get('boxWidth'));
  const boxHeight = Number(params.get('boxHeight'));

  ReactDOM.createRoot(document.getElementById('root')).render(
    <IntroCardPreview card={card} profile={profile} aspect={aspect} boxWidth={boxWidth} boxHeight={boxHeight} />
  );
  return true;
}

if (!renderDebugRichTextRouteIfRequested() && !renderDebugIntroCardRouteIfRequested()) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
      <AuthGateModal />
      {/* T8460: no longer a blocking gate -- a passive corner card that never
          overlaps AuthGateModal or anything else (no backdrop, no fixed
          inset-0). Mount order no longer matters for z-stacking. */}
      <UpdateGateModal />
      <AuthErrorBanner />
      {/* Single global mount — renders toasts on every screen, incl. sign-in and shared views */}
      <ToastContainer />
      {/* T1650/T5674: Global report trigger — visible on every screen. Hidden on
          mobile (shown on Home screen instead). Text pill on Home, compact icon on
          the editor screens (see GlobalReportButton). */}
      <GlobalReportButton />
    </React.StrictMode>,
  )
}
