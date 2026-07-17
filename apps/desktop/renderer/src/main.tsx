import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles/tailwind.css'
import './styles/index.scss'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
