import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { GAMES } from '../lib/games.js'
import { t, getLang } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// The actual play surface for a vendored mini-game (frontend/public/games/, see NOTICE.md).
// Same fullscreen-takeover chrome as BarcodeScanSheet (sheets.jsx) — reuses its .scan-close/
// .scan-title classes verbatim, there's nothing game-specific about "a black full-bleed view
// with a close button top-left". The game itself is a same-origin static site in an iframe:
// fully isolated from this React tree (no DOM/event clashes with a vanilla-JS canvas game),
// and same-origin means its own localStorage (best scores, sound/difficulty prefs) just works.
//
// Elapsed play time is logged exactly once, on unmount, regardless of how the sheet closes
// (our own close button, or Android back/Escape via the sheet's existing history wiring) — a
// cleanup function fires for all of those alike, so there's no need to wire each one separately.
// Each vendored batch exposes sound through a different API (see NOTICE.md for each one's
// origin) — OpenGames self-persists its own on/off flag, crisp-game-lib only ever exposes a
// continuous volume setter with no persistence, and 2048 has no audio at all. This one key is
// Forvia's own, read on every game's load so the choice carries across games that otherwise
// have no memory of it (crisp-game-lib) and so OpenGames' own toggle starts in sync with it.
const SOUND_KEY = 'forvia:gameSound'
function applySound(win, game, muted) {
  if (!win) return
  if (game?.path?.startsWith('crisp/')) {
    win.sss?.setVolume?.(muted ? 0 : 0.1)
  } else if (win.OGAudio) {
    if (!!win.OGAudio.enabled === muted) win.OGAudio.toggle()
  }
}

export default function GamePlayer({ slug, close }) {
  const startRef = useRef(Date.now())
  const iframeRef = useRef(null)
  const [muted, setMuted] = useState(() => localStorage.getItem(SOUND_KEY) === 'off')
  // "El tiempo máximo de juego sea el de descanso" — if a rest was already counting down when
  // this game opened, the game is capped to it: the moment that rest ends (naturally hitting 0,
  // Skip, or dropping below 0 via −15), this view closes itself. +15/extending rest naturally
  // extends the cap too, since this just watches the live timer rather than a fixed deadline
  // snapshotted at open time. A game opened with no rest running (catalog, or the in-workout
  // button between sets) is never capped — hadRestRef is only ever true if one was already live.
  const rest = useUI(s => s.timer)
  const hadRestRef = useRef(!!rest)

  useEffect(() => {
    if (hadRestRef.current && !rest) close()
  }, [rest, close])

  useEffect(() => {
    return () => {
      const ms = Date.now() - startRef.current
      if (ms > 500) useStore.getState().logGameTime(slug, ms)
    }
  }, [slug])

  const game = GAMES.find(g => g.slug === slug)
  const hasSound = slug !== '2048'

  // No title here (unlike BarcodeScanSheet) — the game's own header already names itself inside
  // the iframe, right where this view's top strip is; a second title on top of it just doubled up.
  return (
    <div className="fs-view">
      <button className="iconbtn scan-close" aria-label={t('Close')} onPointerDown={e => { e.preventDefault(); close() }}><Icon name="xmark" /></button>
      {hasSound && (
        <button
          className={'iconbtn scan-torch' + (muted ? ' on' : '')}
          aria-label={t(muted ? 'Unmute' : 'Mute')}
          onPointerDown={e => {
            e.preventDefault()
            const next = !muted
            setMuted(next)
            localStorage.setItem(SOUND_KEY, next ? 'off' : 'on')
            applySound(iframeRef.current?.contentWindow, game, next)
          }}
        ><Icon name={muted ? 'volumeOff' : 'volume'} /></button>
      )}
      <iframe
        ref={iframeRef}
        onLoad={() => { if (hasSound) applySound(iframeRef.current?.contentWindow, game, muted) }}
        src={'/games/' + (game?.path || slug) + '/index.html?lang=' + getLang()}
        title={game ? t(game.label) : 'Mini-game'}
        allow="fullscreen"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  )
}
