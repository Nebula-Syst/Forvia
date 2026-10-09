import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { GAMES } from '../lib/games.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// The actual play surface for a vendored mini-game (frontend/public/games/, see NOTICE.md).
// Same fullscreen-takeover chrome as BarcodeScanSheet (sheets.jsx) — reuses its .scan-close/
// .scan-title classes verbatim, there's nothing game-specific about "a black full-bleed view
// with a close button top-left". The game itself is a same-origin static site in an iframe:
// fully isolated from this React tree (no DOM/event clashes with a vanilla-JS canvas game),
// and same-origin means its own localStorage (best scores, sound/difficulty prefs) just works.
//
// Elapsed play time is logged exactly once, on unmount, regardless of how the sheet closes
// (our own close button, the vendored game's "back to all games" link via games/close.html's
// postMessage, or Android back/Escape via the sheet's existing history wiring) — a cleanup
// function fires for all of those alike, so there's no need to wire each one separately.
export default function GamePlayer({ slug, close }) {
  const startRef = useRef(Date.now())

  useEffect(() => {
    const onMessage = e => {
      if (e.origin === location.origin && e.data?.type === 'og:close') close()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      const ms = Date.now() - startRef.current
      if (ms > 500) useStore.getState().logGameTime(slug, ms)
    }
  }, [slug])

  const game = GAMES.find(g => g.slug === slug)

  // No title here (unlike BarcodeScanSheet) — the game's own header already names itself inside
  // the iframe, right where this view's top strip is; a second title on top of it just doubled up.
  return (
    <div className="fs-view">
      <button className="iconbtn scan-close" aria-label={t('Close')} onPointerDown={e => { e.preventDefault(); close() }}><Icon name="xmark" /></button>
      <iframe
        src={'/games/' + slug + '/index.html'}
        title={game ? t(game.label) : 'Mini-game'}
        allow="fullscreen"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  )
}
