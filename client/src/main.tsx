// ============================================================
// PAYROLL GANG SUITE — Entry Point React
// ============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AmbienteBanner } from './components/AmbienteBanner'
import { ambienteDaHost, applicaAmbiente } from './utils/ambiente'
import './index.css'

// Ambiente dall'host della pagina, prima del primo render (niente salti di layout)
const host     = window.location.hostname
const ambiente = ambienteDaHost(host)
applicaAmbiente(ambiente)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AmbienteBanner ambiente={ambiente} host={host} />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
