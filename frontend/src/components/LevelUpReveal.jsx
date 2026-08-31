import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { tierFor } from '../lib/rank.js'
import { checkLevelUp, setLevelUpChecker } from '../lib/levelWatch.js'
import { t } from '../lib/i18n.js'
import RankIcon from './RankIcon.jsx'
import { Button } from './ui.jsx'

// The exact mirror of the anti-cheat reveal's ring (components/CheatCaughtReveal.jsx) — same
// geometry, same clockwise fill direction — but filling up instead of draining down, and no
// mirroring: gaining a level should read as the same motion the real rank ring already uses,
// not a reversed one. No text anywhere, by design — this is a quick, wordless "yes, that
// happened" rather than something that needs reading or acknowledging.
const SPIN_R = 74, SPIN_C = 2 * Math.PI * SPIN_R
function LevelUpRing({ pct, color, animate, tierName, iconPhase, level }) {
  return (
    <div style={{ position: 'relative', width: 176, height: 176 }}>
      {/* overflow:visible — SVG clips filter effects (the glow below) to its own box by
          default in some browsers, which was cutting the drop-shadow off in a hard rectangular
          edge instead of letting it bloom evenly all the way around the ring. */}
      <svg width={176} height={176} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <circle cx={88} cy={88} r={SPIN_R} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="10" />
        <circle cx={88} cy={88} r={SPIN_R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={SPIN_C} strokeDashoffset={SPIN_C * (1 - pct / 100)}
          className="cheat-ring-fg" style={{ transition: animate ? undefined : 'none', filter: `drop-shadow(0 0 10px ${color})` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 16, display: 'flex' }}>
        {iconPhase === 'in' && <div className="prestige-burst2" />}
        {/* Not rendered at all during 'gap' — a lingering element with no animation class would
            just snap back to fully visible the instant .out's fill-mode class is removed. */}
        {iconPhase !== 'gap' && (
          <div className={'prestige-reveal-icon' + (iconPhase === 'out' ? ' out' : iconPhase === 'in' ? ' in' : '')}>
            <RankIcon tier={tierName} size="100%" />
          </div>
        )}
      </div>
      {/* The level number sits ON TOP of the icon, not beside it — a strong shadow keeps it
          legible over whatever tier art happens to be underneath, light or dark. key={level}
          remounts the span on every change, so the flash keyframe (index.css) replays fresh
          each tick with no JS timer of its own to manage. Hidden during a tier crossing
          (iconPhase set) so the icon transition itself stays the whole show — it flashes back
          in (same remount trick) once the new icon has actually arrived. */}
      {!iconPhase && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span key={level} className="level-num-flash" style={{
            fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff',
            textShadow: '0 2px 6px rgba(0,0,0,.9), 0 0 16px rgba(0,0,0,.7), 0 0 3px rgba(0,0,0,.9)',
          }}>
            {level}
          </span>
        </div>
      )}
    </div>
  )
}

// One lap per level gained (capped at 5 — a long absence or a big import can jump many levels
// at once, and nobody needs to sit through a dozen laps to see it). Same fill/hold/reset beats
// as the anti-cheat countdown, just upward: fill to full, hold, snap back to empty, repeat.
// Crossing into a new tier along the way borrows the exact dissolve → gap → burst-grow icon
// transition the prestige-upgrade reveal uses, so a tier change always reads the same way
// wherever it happens. Not locked (backdrop/Escape still dismiss it), and a "Got it" button is
// there from the very first frame — it never times itself out on its own.
function LevelUpDialog({ fromLevel, toRank, close, onUnmount }) {
  const laps = Math.min(5, toRank.level - fromLevel)
  const startLevel = toRank.level - laps
  const startTier = tierFor(startLevel)

  const [level, setLevel] = useState(startLevel)
  const [pct, setPct] = useState(0)
  const [animate, setAnimate] = useState(false)
  const [tierName, setTierName] = useState(startTier.name)
  const [color, setColor] = useState(startTier.color)
  const [iconPhase, setIconPhase] = useState(null) // null | 'out' | 'gap' | 'in'

  useEffect(() => {
    let cancelled = false
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    async function run() {
      let curLevel = startLevel
      let curTierName = startTier.name   // tracked locally — state wouldn't be current mid-loop
      await wait(350)
      for (let i = 0; i < laps && !cancelled; i++) {
        const isLast = i === laps - 1
        setAnimate(true)
        setPct(100)                          // one lap: fill from empty to full…
        await wait(600)
        if (cancelled) return
        curLevel += 1
        setLevel(curLevel)
        const nextTier = tierFor(curLevel)
        const crossedTier = nextTier.name !== curTierName

        if (crossedTier) {
          curTierName = nextTier.name
          setIconPhase('out')
          await wait(750)
          if (cancelled) return
          setAnimate(false)
          setPct(0)
          setIconPhase('gap')
          await wait(450)
          if (cancelled) return
          setTierName(nextTier.name)
          setColor(nextTier.color)
          setIconPhase('in')
          await wait(1100)
          if (cancelled) return
          setIconPhase(null)
        } else {
          setAnimate(false)
          setPct(0)                          // …snap straight back to empty, no transition…
          await paint()
          if (cancelled) return
          await wait(350)                    // …hold empty for a beat so the reset actually reads
          if (cancelled) return
        }

        if (isLast) {
          const finalPct = toRank.xpForLevel ? Math.min(100, Math.round((toRank.xpInLevel / toRank.xpForLevel) * 100)) : 100
          setAnimate(true)
          setPct(finalPct)                   // final lap settles into the real, current position
          await wait(600)
        }
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Separate from the animation effect on purpose: this cleanup is the ONE thing guaranteed to
  // run exactly once no matter how the dialog goes away — the animation finishing and calling
  // close() itself, or the backdrop/Escape dismissing it early (not locked, unlike the anti-cheat
  // reveal) — so it's what the trigger's queue actually waits on, not a call from inside run().
  // Without this, an early dismiss would leave that queue's promise unresolved forever.
  useEffect(() => () => onUnmount(), [])

  return <div style={{ textAlign: 'center', padding: '10px 4px 4px' }}>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
      <LevelUpRing pct={pct} color={color} animate={animate} tierName={tierName} iconPhase={iconPhase} level={level} />
    </div>
    <Button variant="primary" onClick={close}>{t('Got it')}</Button>
  </div>
}

// Mounted once at the app shell level, like the anti-cheat trigger — but level-ups aren't a
// discrete server record to poll a "seen" flag on, they're just wherever xpFor() currently
// lands, so this polls /api/me instead: on mount, on an interval, on the tab regaining focus,
// and on demand right after a workout save (see setLevelUpChecker / lib/levelWatch.js) since
// that's the single most common moment XP actually moves. checkLevelUp (localStorage-backed)
// is what actually decides whether any of those checks found real forward progress to show.
const POLL_MS = 20000
export default function LevelUpRevealTrigger() {
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)

  useEffect(() => {
    if (!user) { setLevelUpChecker(() => {}); return }
    let cancelled = false
    let busy = false

    const check = async (preFetchedUser) => {
      if (busy || cancelled) return
      busy = true
      try {
        const u = preFetchedUser || (await api('/api/me')).user
        if (cancelled) return
        const rank = u.rank
        const up = checkLevelUp(user.id, rank)
        if (!preFetchedUser) setUser(u)   // refreshUser (the pre-fetched path) already did this
        if (up) {
          await new Promise(resolve => {
            const { close } = useUI.getState().openSheet(() => (
              <LevelUpDialog fromLevel={up.prevLevel} toRank={rank} close={close} onUnmount={resolve} />
            ), { kind: 'center' })
          })
        }
      } catch { /* offline or logged out mid-check — next trigger tries again */ }
      finally { busy = false }
    }

    setLevelUpChecker(check)
    check()
    const id = setInterval(check, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      setLevelUpChecker(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return null
}
