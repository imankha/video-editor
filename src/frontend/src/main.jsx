import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOneTap } from './components/GoogleOneTap.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import { AuthErrorBanner } from './components/AuthErrorBanner.jsx'
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
  </React.StrictMode>,
)
