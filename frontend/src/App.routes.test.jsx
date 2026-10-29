// @vitest-environment happy-dom
// Renders the whole app on every route it declares and fails if any view throws while rendering.
//
// This is the net for dependency updates: the lib/ tests cover logic, but a React, React Router,
// Zustand or Lexical bump breaks *rendering* — and every view sits behind an ErrorBoundary, so in
// the real app such a break is a blank card, not a crash anyone notices in CI. The route list is
// read from App.jsx itself, so a newly added route is covered without touching this file.
//
// The network is cut, not faked: fetch never settles, so each view renders its initial (loading)
// state through the real lib/api.js and stores instead of against made-up response shapes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import appSource from './App.jsx?raw'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class SilentWebSocket {
  constructor() { this.readyState = 0 }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const clone = value => JSON.parse(JSON.stringify(value))
// Every gate in App.jsx opens for this account (user?.admin, user.coach, signed in).
const USER = { id: 'smoke-user', name: 'Smoke Test', email: 'smoke@example.com', admin: true, coach: true }
const PARAMS = { date: '2026-01-05', meal: 'breakfast', code: 'ABC123' }

const routePaths = [...new Set([...appSource.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]))]
  .filter(path => path !== '*')
const toUrl = path => path.replace(/:(\w+)/g, (_, name) => PARAMS[name] || 'smoke-' + name)
// Rendered outside <Routes>, straight off the pathname (see Shell in App.jsx).
const shellPaths = ['/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/licenses']
const signedOutPaths = ['/login', '/login/signin', '/login/register', '/login/forgot-password', '/login/reset-password']

let container, root, renderErrors

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.stubGlobal('WebSocket', SilentWebSocket)
})
afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  root = container = null
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function renderAt(url, { signedIn }) {
  vi.useFakeTimers()
  localStorage.clear()
  renderErrors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).includes('Forvia render error')) renderErrors.push(args[1])
  })
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  // boot() would hit the (cut) network and decide the session itself; the session is set here.
  useStore.setState({ S: clone(DEF), user: signedIn ? USER : null, ready: true, boot: () => {} })
  window.location.hash = '#' + url
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<App />))
  act(() => vi.advanceTimersByTime(2000))
}

function expectRendered(url) {
  expect(renderErrors, `${url} threw while rendering: ${renderErrors.map(e => e?.stack || e).join('\n')}`).toEqual([])
  expect(container.querySelector('#app'), `${url} rendered no app shell`).toBeTruthy()
  expect(container.textContent.trim().length, `${url} rendered an empty page`).toBeGreaterThan(0)
}

describe('every route renders', () => {
  it('found the routes in App.jsx', () => {
    // Guards the regex above: if App.jsx changes how it declares routes, fail loudly rather than
    // silently testing nothing.
    expect(routePaths.length).toBeGreaterThan(50)
  })

  it.each(routePaths.map(toUrl))('signed in: %s', url => {
    renderAt(url, { signedIn: true })
    expectRendered(url)
  })

  it.each(shellPaths)('legal page: %s', url => {
    renderAt(url, { signedIn: false })
    expectRendered(url)
  })

  it.each(signedOutPaths)('signed out: %s', url => {
    renderAt(url, { signedIn: false })
    expectRendered(url)
  })
})
