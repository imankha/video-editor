import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
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
import { setupActionTracking } from './utils/analytics.js'
import { setupPwaUpdatePrompt } from './utils/pwaUpdate.js'

// T1650: Capture console.error/warn before anything else runs
installClientLogger();
setupActionTracking();

console.info(`[Build] ${__COMMIT_HASH__}`);
installResponsivenessMonitor();
setupPwaUpdatePrompt();

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


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <AuthGateModal />
    {/* T5070: mounted AFTER AuthGateModal so its z-[60] paints above the
        auth/login surface -- an un-updated client can't log in either. */}
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
