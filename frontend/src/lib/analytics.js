// Google Analytics (GA4) — loaded only once someone actually has an account and is signed in,
// never on the signed-out login screen. Accepting the Terms/Privacy/Cookies pages at account
// creation (see sheets.jsx's PasswordRegisterForm) is what this project treats as consent for
// it, so the script has no business running before that consent exists — and guest mode (when
// an instance leaves it on; this one turns it off, see .env) never touches a server at all, so
// it never loads there either.
//
// Self-hosters who leave GOOGLE_ANALYTICS_ID unset in forvia-core's own .env get none of this:
// GET /api/config reports google_analytics_id as null, and initAnalytics below is simply never
// called with a real id — the gtag.js script itself is never even requested, not just told to
// send nothing.
let loadedId = null

export function initAnalytics(measurementId) {
  if (!measurementId || loadedId === measurementId) return
  loadedId = measurementId
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
  document.head.appendChild(script)
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  // send_page_view: false — this is a single-page app that navigates by changing the URL hash,
  // which GA's own automatic pageview detection never sees. trackPageView below fires those
  // instead, once per real in-app navigation (see App.jsx's own effect on route change).
  window.gtag('config', measurementId, { send_page_view: false })
}

export function trackPageView(path) {
  if (!loadedId || typeof window.gtag !== 'function') return
  window.gtag('event', 'page_view', { page_path: path })
}
