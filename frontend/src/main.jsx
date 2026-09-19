import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

function mount() {
  const root = createRoot(document.getElementById('root'))
  root.render(<StrictMode><App /></StrictMode>)
}

function registerServiceWorker() {
  // Skipped in the mobile build: the native shell already serves everything from disk,
  // so there's nothing for a service worker to cache or intercept there.
  const eligible = !MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:'
  if (eligible) navigator.serviceWorker.register('sw.js').catch(() => {})
}

mount()
registerServiceWorker()
