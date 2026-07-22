import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { subscribeToDesktopDiagnostics } from './services/desktopDiagnostics.js'
import './styles/tailwind.css'
import './styles/index.scss'

subscribeToDesktopDiagnostics(window.codePilotXDesktop)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
