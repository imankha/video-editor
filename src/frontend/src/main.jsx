import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOneTap } from './components/GoogleOneTap.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import { AuthErrorBanner } from './components/AuthErrorBanner.jsx'
import { ReportProblemButton } from './components/ReportProblemButton.jsx'
import './index.css'
import { installResponsivenessMonitor } from './utils/responsiveness.js'
import { installClientLogger } from './utils/clientLogger.js'

// T1650: Capture console.error/warn before anything else runs
installClientLogger();

console.info(`[Build] ${__COMMIT_HASH__}`);
installResponsivenessMonitor();


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <GoogleOneTap />
    <AuthGateModal />
    <AuthErrorBanner />
    {/* T1650: Global report button — visible on every screen */}
    <ReportProblemButton className="fixed bottom-4 right-4 z-[9999] bg-gray-800/90 border border-gray-600 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 shadow-lg transition-colors" />
  </React.StrictMode>,
)
