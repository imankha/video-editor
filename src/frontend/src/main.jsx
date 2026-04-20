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
    <ReportProblemButton className="fixed bottom-3 right-3 z-30 text-xs text-gray-500 hover:text-gray-300" />
  </React.StrictMode>,
)
