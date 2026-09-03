// Real-time push while the app is open — one WebSocket, connected whenever a session exists,
// carrying server-side events the instant they happen (api/server.js's wsSend). Push
// notifications (lib/api.js's subscribe flow) cover the same events for a closed app; this is
// the open-app path — no polling delay, reconnects on its own if the connection drops.
let socket = null
let reconnectTm = null
let reconnectDelay = 1000
const MAX_DELAY = 30000
const listeners = new Map() // type -> Set<fn>

const urlFor = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

function dispatch(type, msg) {
  const set = listeners.get(type)
  if (!set) return
  // One bad listener (a bug in whatever's subscribed) must not stop the rest from hearing it.
  for (const fn of set) { try { fn(msg) } catch (e) { console.error('ws listener failed', type, e) } }
}

export function wsConnect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  clearTimeout(reconnectTm)
  let ws
  try { ws = new WebSocket(urlFor()) } catch { return }
  socket = ws
  ws.onopen = () => { reconnectDelay = 1000 }
  ws.onmessage = e => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    if (msg?.type) dispatch(msg.type, msg)
  }
  ws.onclose = () => {
    if (socket !== ws) return   // a newer connect (or an explicit disconnect) already replaced this one
    socket = null
    reconnectTm = setTimeout(wsConnect, reconnectDelay)
    reconnectDelay = Math.min(MAX_DELAY, reconnectDelay * 2)
  }
  ws.onerror = () => ws.close()
}

export function wsDisconnect() {
  clearTimeout(reconnectTm)
  reconnectDelay = 1000
  if (socket) { const s = socket; socket = null; s.close() }
}

// A backgrounded tab's WebSocket is one of the first things mobile OSes and browsers suspend —
// coming back to a stale/closed socket and just waiting out the backoff would sit there doing
// nothing for however long the delay had grown to. Reconnecting immediately on refocus, if it
// isn't already open, is what actually keeps "real-time" true across app switches.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!socket || socket.readyState === WebSocket.CLOSED)) wsConnect()
  })
}

// Returns an unsubscribe function, same shape as every other event-listener helper in this app.
export function wsOn(type, fn) {
  let set = listeners.get(type)
  if (!set) { set = new Set(); listeners.set(type, set) }
  set.add(fn)
  return () => set.delete(fn)
}
