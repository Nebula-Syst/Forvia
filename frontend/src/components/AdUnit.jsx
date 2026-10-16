import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { adsReady } from '../lib/ads.js'
import { MOBILE } from '../lib/mobile.js'

// One placement = one <ins class="adsbygoogle">, pushed to Google's queue exactly once per
// mount (a second push on the same node is what AdSense's own docs warn throws "already have
// ads in them" — the ref guards against that happening from a re-render, not just StrictMode's
// double-invoke). Renders nothing at all — not even an empty wrapper — until there's a real
// slot id AND the base script has actually loaded (App.jsx's initAds effect; `adsReady()` is
// what tells this component that already happened rather than racing it). Off-platform ads are
// already handled one layer up (lib/ads.js never loads the script inside MOBILE at all), but
// this double-checks before ever rendering the actual `<ins>` tag too.
export default function AdUnit({ slot }) {
  const clientId = useStore(s => s.config?.adsense_client_id)
  const pushed = useRef(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!slot || !clientId || MOBILE || pushed.current || !window.adsbygoogle) return
    pushed.current = true
    try { window.adsbygoogle.push({}) } catch { /* same "ads blocked/not ready yet" tolerance every embed needs */ }
  })

  if (!slot || !clientId || MOBILE || !adsReady()) return null
  return (
    <ins ref={ref} className="adsbygoogle" style={{ display: 'block' }}
      data-ad-client={clientId} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
  )
}
