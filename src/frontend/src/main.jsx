import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOneTap } from './components/GoogleOneTap.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import './index.css'
import { installResponsivenessMonitor } from './utils/responsiveness.js'

console.info(`[Build] ${__COMMIT_HASH__}`);
installResponsivenessMonitor();

// T1535: initialize perf timing when ?debug is in URL
if (new URLSearchParams(window.location.search).has('debug')) {
  window.__videoPerfTimings = [];
  localStorage.setItem('debugPerf', '1');
} else if (localStorage.getItem('debugPerf') === '1') {
  window.__videoPerfTimings = [];
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <GoogleOneTap />
    <AuthGateModal />
  </React.StrictMode>,
)
