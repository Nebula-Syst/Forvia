// AdSense — web/PWA only, same "only once signed in" consent gate as lib/analytics.js, plus one
// more: never inside the installed native app. Google's own AdSense policy bans showing AdSense
// ads inside a wrapped WebView (this app's installed shell is exactly that — see forvia-mobile's
// README), so the caller (App.jsx) is expected to also check !MOBILE before ever calling this —
// enforced here too, belt-and-suspenders, since getting this wrong risks the whole AdSense
// account being suspended, not just a missing ad on one screen.
//
// Self-hosters who leave ADSENSE_CLIENT_ID unset in forvia-core's own .env get none of this:
// GET /api/config reports adsense_client_id as null, and initAds below is simply never called
// with a real id — adsbygoogle.js is never even requested.
import { MOBILE } from './mobile.js'

let loadedId = null

export function initAdSense(clientId) {
  if (!clientId || MOBILE || loadedId === clientId) return
  loadedId = clientId
  const script = document.createElement('script')
  script.async = true
  script.crossOrigin = 'anonymous'
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`
  document.head.appendChild(script)
}

export const adsReady = () => !!loadedId
