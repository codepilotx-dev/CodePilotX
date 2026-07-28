import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { initializeRendererDataEpoch } from './services/desktop-client/data-epoch.js'
import './styles/tailwind.css'
import './styles/index.scss'

initializeRendererDataEpoch()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
