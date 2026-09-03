import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { api, anticheatStatus, anticheatAppeal, anticheatAck } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { tierFor } from '../lib/rank.js'
import { FINDING_LABEL } from '../lib/anticheat.js'
import { setCheatRevealChecker } from '../lib/anticheatWatch.js'
import { wsOn } from '../lib/ws.js'
import RankIcon from './RankIcon.jsx'
import { Button, TextArea } from './ui.jsx'

// The reveal's ring: the exact same circular-progress setup Rank's own hero ring uses (same
// -90deg rotation, same clockwise fill direction) — no mirroring, so the fill boundary sits
// exactly where it would on the real ring, and only the pct itself changes over time to show
// the drain. The tier badge sits centered inside it just like the hero ring does, so this
// reads as "your rank ring, right now" rather than an unrelated loading spinner.
const SPIN_R = 74, SPIN_C = 2 * Math.PI * SPIN_R
function CheatCaughtRing({ pct, color, animate, tierName }) {
  return (
    <div style={{ position: 'relative', width: 176, height: 176 }}>
      <svg width={176} height={176} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={88} cy={88} r={SPIN_R} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="10" />
        <circle cx={88} cy={88} r={SPIN_R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={SPIN_C} strokeDashoffset={SPIN_C * (1 - pct / 100)}
          className="cheat-ring-fg" style={{ transition: animate ? undefined : 'none', filter: `drop-shadow(0 0 10px ${color})` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 16, display: 'flex' }}><RankIcon tier={tierName} size="100%" /></div>
    </div>
  )
}
// One penalty's "we caught you" reveal — plays exactly once (see the `seen` flag/ack call in
// CheatRevealTrigger below), locked so it can't be swiped away mid-count. The ring counts
// down for real: one full drain per level lost, starting from the level the account had
// *before* this penalty and landing exactly on its real, already-docked position — so the
// number under it (not just the ring) visibly ticks the account down, lap by lap, before the
// verdict text explains why. Appeal is right here, not a screen away, since the moment
// someone reads the verdict is exactly when they'd want to say "no, that's wrong."
function CheatCaughtDialog({ penalty, rank, tierColor, tierName, onDone }) {
  const laps = Math.max(1, Math.min(penalty.levels, 5))
  // Older penalties (created before this field existed) fall back to the old guess — a full
  // ring at rank.level + levels — rather than crash; every new one carries its own real snapshot.
  const beforeLevel = Math.max(1, penalty.beforeLevel ?? (rank.level + penalty.levels))
  const beforePct = penalty.beforeXpForLevel
    ? Math.min(100, Math.round((penalty.beforeXpInLevel / penalty.beforeXpForLevel) * 100)) : 100
  const finalPct = rank.xpForLevel ? Math.min(100, Math.round((rank.xpInLevel / rank.xpForLevel) * 100)) : 100

  const [level, setLevel] = useState(beforeLevel)
  const [pct, setPct] = useState(beforePct)
  const [animate, setAnimate] = useState(false)
  const [color, setColor] = useState('var(--red)')
  const [appealing, setAppealing] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    const wait = ms => new Promise(r => setTimeout(r, ms))
    // one JS-committed paint of the reset before re-enabling the transition, so the snap
    // to full never gets swept up into the drain that follows it as one smooth motion
    const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    async function run() {
      await wait(800)
      for (let i = 0; i < laps && !cancelled; i++) {
        setAnimate(true)
        setPct(0)                          // one full lap: drain from wherever it started to empty…
        await wait(1100)
        if (cancelled) return
        setAnimate(false)
        setLevel(Math.max(1, beforeLevel - i - 1))   // never ticks below the real floor
        setPct(100)                        // …snap straight back to full, no transition…
        await paint()
        if (cancelled) return
        await wait(400)                    // …hold full for a beat so the reset actually reads
        if (cancelled) return
      }
      setAnimate(true)
      setColor(tierColor)
      setPct(finalPct)                     // final lap settles into the real, docked position
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async () => {
    const msg = message.trim()
    if (!msg) return
    setSending(true)
    try { await anticheatAppeal(penalty.id, msg); setSent(true) }
    finally { setSending(false) }
  }

  return <div className="wide-reveal" style={{ textAlign: 'center', padding: '4px 0' }}>
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 10px' }}>
      <CheatCaughtRing pct={pct} color={color} animate={animate} tierName={tierName} />
    </div>
    <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', color, transition: 'color .4s ease', marginBottom: 8 }}>
      {t('Level {0}', level)}
    </div>
    <h3 style={{ margin: '2px 0 4px', color: 'var(--red)' }}>{t('Caught cheating')}</h3>
    <div className="ss" style={{ margin: '0 0 4px', color: 'var(--label-2)' }}>
      {t(penalty.levels === 1 ? "We've decided to rescind {0} level from your account." : "We've decided to rescind {0} levels from your account.", penalty.levels)}
    </div>
    {penalty.findings?.[0] && (
      <div className="small" style={{ margin: '0 0 20px', color: 'var(--label-3)' }}>
        {(FINDING_LABEL[penalty.findings[0].id] || (() => penalty.findings[0].id))()}
      </div>
    )}

    {sent ? (
      <>
        <div className="small" style={{ color: 'var(--acc)', marginBottom: 14 }}>{t('Sent — you’ll find it under review in your penalties.')}</div>
        <Button variant="primary" onClick={onDone}>{t('Got it')}</Button>
      </>
    ) : appealing ? (
      <>
        <div style={{ textAlign: 'left', marginBottom: 14 }}>
          <TextArea rows={3} placeholder={t('Explain why this should be reviewed…')} value={message} onChange={e => setMessage(e.target.value)} />
        </div>
        <Button variant="primary" disabled={!message.trim() || sending} onClick={send}>{t('Send for review')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="tinted" onClick={() => setAppealing(false)}>{t('Cancel')}</Button>
      </>
    ) : (
      <>
        <Button variant="primary" onClick={onDone}>{t('Got it')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="tinted" onClick={() => setAppealing(true)}>{t('Appeal')}</Button>
      </>
    )}
  </div>
}

// The verdict on an appeal (or on a penalty nobody appealed but an admin ruled on anyway) —
// same modal-reveal idiom as CheatCaughtDialog above, not a passing toast, since a ruling with a
// written reason attached deserves to actually be read, not glanced at and gone. Overturned gets
// the ring: same geometry as the "caught" reveal, but rising instead of draining and paced
// noticeably slower per lap (2.2s vs. the catch's 1.1s) — being cleared should feel like relief
// settling in, not another verdict landing. Upheld gets no ring at all; nothing on the account
// changed, so there's nothing to animate.
function VerdictDialog({ msg, rank, tierColor, tierName, close }) {
  const accepted = msg.status === 'overturned'
  const laps = accepted ? Math.max(1, Math.min(msg.levels || 1, 5)) : 0
  const toLevel = rank?.level ?? 1
  const startLevel = Math.max(1, toLevel - laps)
  const finalPct = rank?.xpForLevel ? Math.min(100, Math.round((rank.xpInLevel / rank.xpForLevel) * 100)) : 100

  const [level, setLevel] = useState(accepted ? startLevel : toLevel)
  const [pct, setPct] = useState(accepted ? 0 : finalPct)
  const [animate, setAnimate] = useState(false)
  const [color, setColor] = useState(accepted ? 'var(--acc)' : tierColor)

  useEffect(() => {
    if (!accepted) return
    let cancelled = false
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    async function run() {
      await wait(800)
      for (let i = 0; i < laps && !cancelled; i++) {
        setAnimate(true)
        setPct(100)                          // one full lap: rise from wherever it started to full…
        await wait(2200)
        if (cancelled) return
        setAnimate(false)
        setLevel(Math.min(toLevel, startLevel + i + 1))
        setPct(0)                            // …snap straight back to empty, no transition…
        await paint()
        if (cancelled) return
        await wait(500)                      // …hold empty for a beat so the reset actually reads
        if (cancelled) return
      }
      setAnimate(true)
      setColor(tierColor)
      setPct(finalPct)                       // final lap settles into the real, restored position
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wide-reveal" style={{ textAlign: 'center', padding: '4px 0' }}>
    {accepted && <>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 10px' }}>
        <CheatCaughtRing pct={pct} color={color} animate={animate} tierName={tierName} />
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', color, transition: 'color .4s ease', marginBottom: 8 }}>
        {t('Level {0}', level)}
      </div>
    </>}
    <h3 style={{ margin: '2px 0 4px', color: accepted ? 'var(--acc)' : 'var(--red)' }}>
      {accepted ? t('Appeal accepted') : t('Appeal reviewed')}
    </h3>
    <div className="ss" style={{ margin: '0 0 20px', color: 'var(--label-2)', lineHeight: 1.5 }}>
      {accepted
        ? t('We’ve decided to accept your appeal: “{0}”', msg.reviewNote || '')
        : t('We’ve reviewed your appeal — the penalty stands: “{0}”', msg.reviewNote || '')}
    </div>
    <Button variant="primary" onClick={close}>{t('Got it')}</Button>
  </div>
}

// Mounted once at the app shell level (not on any one page) so the reveal can interrupt
// wherever the account actually is when it fires, not just a visit to Rank — queued one at a
// time if more than one penalty is waiting.
//
// The WebSocket (lib/ws.js) is what makes this actually real-time: api/server.js's scanForCheating
// and anticheat/review both call wsSend the instant something happens, so 'anticheat:flagged' /
// 'anticheat:reviewed' land here with no delay at all, open app or not backgrounded. Everything
// else here — on mount, on demand right after a workout save (setCheatRevealChecker /
// lib/anticheatWatch.js), on the tab regaining focus, and a long-interval poll — is a fallback
// for the gap between a dropped connection and ws.js reconnecting, not the primary path. A push
// notification (same two server-side moments) covers the app fully closed, where none of this
// runs at all.
const POLL_MS = 60000
export default function CheatRevealTrigger() {
  const user = useStore(s => s.user)
  useEffect(() => {
    if (!user) { setCheatRevealChecker(() => {}); return }
    let cancelled = false
    let busy = false

    const check = async () => {
      if (busy || cancelled) return
      busy = true
      try {
        const [items, me] = await Promise.all([anticheatStatus(), api('/api/me')])
        if (cancelled) return
        const unseen = items.filter(p => !p.seen)
        if (!unseen.length) return
        const rank = me.user.rank
        const tier = tierFor(rank.level)
        const playNext = async queue => {
          if (cancelled || !queue.length) return
          const [next, ...rest] = queue
          await new Promise(resolve => {
            const { close } = useUI.getState().openSheet(() => (
              <CheatCaughtDialog penalty={next} rank={rank} tierColor={tier.color} tierName={tier.name} onDone={async () => {
                try { await anticheatAck(next.id) } finally { close(); resolve() }
              }} />
            ), { kind: 'center', locked: true })
          })
          if (!cancelled) await playNext(rest)
        }
        await playNext(unseen)
      } catch { /* offline or logged out mid-check — next trigger tries again */ }
      finally { busy = false }
    }

    setCheatRevealChecker(check)
    check()
    const id = setInterval(check, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const offFlagged = wsOn('anticheat:flagged', check)
    // The verdict gets the same modal-reveal treatment as being caught in the first place
    // (VerdictDialog above) — the account holder isn't necessarily even looking at Penalties
    // when it lands, and a ruling with a written reason attached deserves to be read, not just
    // glanced off a toast. Overturned needs the fresh rank to animate the ring up to; upheld
    // doesn't change anything about the account, so there's nothing to fetch first.
    const offReviewed = wsOn('anticheat:reviewed', async msg => {
      if (cancelled) return
      if (msg.status === 'overturned') {
        const me = await api('/api/me').catch(() => null)
        if (cancelled) return
        const rank = me?.user?.rank
        const tier = tierFor(rank?.level ?? 1)
        useUI.getState().openSheet(close => <VerdictDialog msg={msg} rank={rank} tierColor={tier.color} tierName={tier.name} close={close} />, { kind: 'center' })
      } else {
        useUI.getState().openSheet(close => <VerdictDialog msg={msg} close={close} />, { kind: 'center' })
      }
      check()
    })
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      offFlagged(); offReviewed()
      setCheatRevealChecker(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
  return null
}
