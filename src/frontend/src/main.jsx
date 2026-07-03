import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import { AuthErrorBanner } from './components/AuthErrorBanner.jsx'
import { ReportProblemButton } from './components/ReportProblemButton.jsx'
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


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <AuthGateModal />
    <AuthErrorBanner />
    {/* Single global mount — renders toasts on every screen, incl. sign-in and shared views */}
    <ToastContainer />
    {/* T1650: Global report button — visible on every screen. Hidden on mobile (shown on Home screen instead). */}
    <ReportProblemButton className="hidden lg:block hide-on-touch fixed bottom-20 right-4 z-[9999] bg-gray-800/90 border border-gray-600 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 shadow-lg transition-colors" />
  </React.StrictMode>,
)
