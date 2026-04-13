import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOneTap } from './components/GoogleOneTap.jsx'
import { AuthGateModal } from './components/AuthGateModal.jsx'
import { AppAuthGate } from './components/AppAuthGate.jsx'
import './index.css'

console.info(`[Build] ${__COMMIT_HASH__}`);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppAuthGate>
      <App />
    </AppAuthGate>
    <GoogleOneTap />
    <AuthGateModal />
  </React.StrictMode>,
)
