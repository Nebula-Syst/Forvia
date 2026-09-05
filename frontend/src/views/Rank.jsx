import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, confirmPrestige, streakTiers as fetchStreakTiers } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtNum } from '../lib/format.js'
import { streakDays } from '../lib/history.js'
import { tierForDays, STREAK_TIER_COLORS } from '../lib/streak.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import RankIcon, { PrestigeIcon } from '../components/RankIcon.jsx'
import StreakIcon from '../components/StreakIcon.jsx'
import TasksCard from '../components/TasksCard.jsx'
import PenaltiesRow from '../components/PenaltiesRow.jsx'
import { Segmented, Button } from '../components/ui.jsx'
import { TIERS, tierFor } from '../lib/rank.js'
import { markRankSeen } from '../lib/levelWatch.js'

const PRESTIGE_LEVELS = Array.from({ length: 10 }, (_, i) => i + 1)
const RING_R = 84, RING_C = 2 * Math.PI * RING_R

// Perk text per rank tier / prestige level — mirrors perksFor() in api/server.js. Each
// entry is a *list* (one line today, but PerkText already renders a checklist if a
// tier/level ever stacks more than one again) so this stays a one-line change per
// perk to re-add. Purely descriptive here — the gate check lives server-side on each
// actual route. Most decorative-flair perks (animated badge, border-beam, crown,
// avatar/legend frame, animated name, veteran badge, comment highlight) were pulled
// for the alpha — see 'Coming soon.' below. Prestige 8's exclusive theme stayed real.
const RANK_PERKS = [
  { tier: 'Iron', perks: () => [t('The start of your climb.')] },
  { tier: 'Bronze', perks: () => [t('Pin your favorite PR to your profile.')] },
  { tier: 'Silver', perks: () => [t('Coming soon.')] },
  { tier: 'Gold', perks: () => [t('Coming soon.')] },
  { tier: 'Platinum', perks: () => [t('Coming soon.')] },
  { tier: 'Diamond', perks: () => [t('Upload up to 6 photos per workout.')] },
  { tier: 'Master', perks: () => [t('Pin a featured post to your profile.')] },
  { tier: 'Champion', perks: () => [t('Coming soon.')] },
  { tier: 'Elite', perks: () => [t('Pin a second featured post to your profile.')] },
  { tier: 'Legend', perks: () => [t('Coming soon.')] },
]
const PRESTIGE_PERKS = {
  1: () => [t('Coming soon.')],
  2: () => [t('Coming soon.')],
  3: () => [t('Pin 2 featured posts instead of 1.')],
  4: () => [t('Coming soon.')],
  5: () => [t('25% off the subscription, once it exists.')],
  6: () => [t('Upload up to 8 photos per workout.')],
  7: () => [t('Coming soon.')],
  8: () => [t('An exclusive app-wide color theme.')],
  9: () => [t('Coming soon.')],
  10: () => [t('50% off the subscription, once it exists.')],
}
// The two prestige levels with a real money payoff — seeing the exact reward ahead of earning
// it is exactly what would tempt someone to fabricate workouts for it, so the text itself stays
// hidden (a plain "???", not even a hint at the percentage) until the account has actually
// reached that level. Admins/staff always see the real text, same as anyone who's unlocked it —
// nothing to hide from someone who can't cheat their way to it anyway.
const MONEY_PRESTIGE_LEVELS = new Set([5, 10])

// A perk row's description — one line for a single perk, a small checklist when a
// tier/level stacks more than one (Prestige 5 and 10 today).
function PerkText({ items }) {
  if (items.length <= 1) return <div className="ss">{items[0]}</div>
  return <ul className="ss perk-ul">{items.map((p, i) => <li key={i}>{p}</li>)}</ul>
}

// "Upgrade mastery" reveal: a locked center dialog (same shape as the anti-cheat reveal, but
// for a gain the account holder just chose). No flip — this is a big enough moment to earn a
// real buildup: the old icon sits, then dissolves away; a beat of nothing; then a burst of
// light and the new icon grows in with a bit of overshoot, landing right as the text reveals.
// The API call happens here, on mount, not before the dialog opens — so the reveal always has
// something real to land on and never has to guess the outcome ahead of the request finishing.
function PrestigeUpgradeDialog({ oldPrestige, onDone, close }) {
  const [newUser, setNewUser] = useState(null)
  const [phase, setPhase] = useState('idle') // 'idle' -> 'out' -> 'gap' -> 'in' -> 'done'
  const [failed, setFailed] = useState(false)
  const newLevel = Math.max(1, oldPrestige + 1)

  useEffect(() => {
    let cancelled = false
    const wait = ms => new Promise(r => setTimeout(r, ms))
    async function run() {
      let u
      try { u = await confirmPrestige() }
      catch { if (!cancelled) setFailed(true); return }
      if (cancelled) return
      await wait(800)                // the old icon sits for a proper beat first
      setPhase('out')
      await wait(750)
      if (cancelled) return
      setPhase('gap')                 // a breath of nothing — the anticipation
      await wait(450)
      if (cancelled) return
      setPhase('in')                  // the burst + the new icon growing in
      await wait(1100)
      if (cancelled) return
      setPhase('done')
      setNewUser(u)
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wide-reveal" style={{ textAlign: 'center', padding: '4px 0' }}>
    <div className="prestige-stage">
      {phase === 'in' && <div className="prestige-burst2" />}
      {(phase === 'idle' || phase === 'out') && (
        <div className={'prestige-reveal-icon' + (phase === 'idle' ? ' idle' : ' out')}>
          <PrestigeIcon level={Math.max(1, oldPrestige)} locked={oldPrestige === 0} size="100%" />
        </div>
      )}
      {(phase === 'in' || phase === 'done') && (
        <div className={'prestige-reveal-icon' + (phase === 'in' ? ' in' : '')}>
          <PrestigeIcon level={newLevel} size="100%" />
        </div>
      )}
    </div>
    {failed ? (
      <>
        <div className="ss" style={{ color: 'var(--red)', marginBottom: 14 }}>{t('Could not save')}</div>
        <Button variant="primary" onClick={close}>{t('Got it')}</Button>
      </>
    ) : phase === 'done' && newUser ? (
      <>
        <h3 style={{ marginBottom: 4 }}>{t('Prestige {0} unlocked', newUser.rank.prestige)}</h3>
        <div className="ss" style={{ color: 'var(--label-2)', marginBottom: 18 }}>{t('Level {0}', newUser.rank.level)}</div>
        <Button variant="primary" onClick={() => { onDone(newUser); close() }}>{t('Got it')}</Button>
      </>
    ) : <div className="muted">{t('Updating…')}</div>}
  </div>
}

// Reached from the badge on Home and on Progress — the full picture the small pill
// can't show. Fetched fresh, same reasoning as RankRow: XP moves on things that never
// re-run login/me, so a cached copy goes stale within the session.
export default function Rank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('tiers')
  const [streakTierList, setStreakTierList] = useState(null)

  useEffect(() => { api('/api/me').then(r => setMe(r.user)).catch(() => setMe(false)) }, [])
  useEffect(() => { fetchStreakTiers().then(setStreakTierList).catch(() => setStreakTierList([])) }, [])

  if (me === null) return null
  if (!me) { nav('/home'); return null }

  const streak = Math.max(0, streakDays(S) + (me.streakBonus || 0))
  const curStreakTier = streakTierList ? tierForDays(streak, streakTierList) : null
  const streakTierIdx = streakTierList ? streakTierList.findIndex(x => curStreakTier && x.id === curStreakTier.id) : -1
  const nextStreakTier = streakTierList ? streakTierList[streakTierIdx + 1] : null
  const streakArtIdx = streakTierIdx >= 0 ? streakTierIdx + 1 : 1
  const streakColor = STREAK_TIER_COLORS[streakArtIdx - 1]
  const streakPct = !curStreakTier ? 0
    : !nextStreakTier ? 1
    : Math.max(0, Math.min(1, (streak - curStreakTier.days) / (nextStreakTier.days - curStreakTier.days)))
  const streakRingOffset = RING_C * (1 - streakPct)

  const rank = me.rank
  const tier = tierFor(rank.level)
  const tierIdx = TIERS.findIndex(x => x.name === tier.name)
  const nextTier = TIERS[tierIdx + 1]
  const pct = rank.xpForLevel ? Math.min(100, Math.round((rank.xpInLevel / rank.xpForLevel) * 100)) : 100
  const left = Math.max(0, rank.xpForLevel - rank.xpInLevel)
  const nextPrestige = Math.min(10, rank.prestige + 1)
  const ringOffset = RING_C * (1 - pct / 100)

  const doPrestige = () => {
    useUI.getState().openSheet(close => (
      <PrestigeUpgradeDialog oldPrestige={rank.prestige} onDone={u => { markRankSeen(u.id, u.rank); setMe(u) }} close={close} />
    ), { kind: 'center', locked: true })
  }

  return <div className="narrow">
    <div className="hdr">
      {/* Back to wherever this was opened from (Home, Stats, Settings, the profile page's
          RankRow all lead here) rather than always landing on Home — same idiom as
          Penalties.jsx/legal pages. */}
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Level')}</h1></div>
    </div>

    {tab === 'prestige' ? (
      <div className="rank-hero" style={{ '--tier': tier.color }}>
        <div className="rank-ring-wrap">
          <div className="rank-ring-badge">
            <PrestigeIcon level={Math.max(1, rank.prestige)} locked={rank.prestige === 0} size="100%" />
          </div>
        </div>
        {rank.prestige > 0 ? (
          <div className="rank-tier-name" style={{ backgroundImage: `linear-gradient(120deg, #fff, color-mix(in srgb, #fff 30%, ${tier.color}))` }}>{t('Prestige {0}', rank.prestige)}</div>
        ) : (
          <div className="rank-tier-name" style={{ color: 'var(--label-3)', backgroundImage: 'none', WebkitTextFillColor: 'unset' }}>{t('No prestige yet')}</div>
        )}
      </div>
    ) : tab === 'streak' ? (
      <div className="rank-hero" style={{ '--tier': streakColor }}>
        <div className="rank-ring-wrap">
          <svg width="208" height="208" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="104" cy="104" r={RING_R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
            <circle cx="104" cy="104" r={RING_R} fill="none" stroke={streakColor} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={RING_C} strokeDashoffset={streakRingOffset}
              style={{ filter: `drop-shadow(0 0 10px ${streakColor})` }} />
          </svg>
          <div className="rank-ring-badge" style={{ filter: curStreakTier ? undefined : 'grayscale(1) brightness(.55)' }}>
            <StreakIcon tier={streakArtIdx} size="100%" />
          </div>
        </div>
        <div className="rank-tier-name" style={{ backgroundImage: `linear-gradient(120deg, #fff, color-mix(in srgb, #fff 30%, ${streakColor}))` }}>
          {curStreakTier ? curStreakTier.name : t('No streak yet')}
        </div>
        <div className="rank-level-line">{t('{0} day streak', streak)}</div>
        {nextStreakTier ? (
          <>
            <div className="rank-xp-row">
              <span className="muted">{t('{0} / {1} days', streak, nextStreakTier.days)}</span>
              <span style={{ fontWeight: 700, color: streakColor }}>{t('{0} days to next badge', Math.max(0, nextStreakTier.days - streak))}</span>
            </div>
            <div className="rank-xp-bar"><i style={{ width: (streakPct * 100) + '%', background: `linear-gradient(90deg, color-mix(in srgb, ${streakColor} 70%, white 10%), ${streakColor})` }} /></div>
          </>
        ) : curStreakTier && (
          <div className="rank-xp-row" style={{ justifyContent: 'center' }}>
            <span style={{ fontWeight: 700, color: streakColor }}>{t('Top streak badge reached')}</span>
          </div>
        )}
      </div>
    ) : (
      <div className="rank-hero" style={{ '--tier': tier.color }}>
        <div className="rank-ring-wrap">
          <svg width="208" height="208" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="104" cy="104" r={RING_R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
            <circle cx="104" cy="104" r={RING_R} fill="none" stroke={tier.color} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={RING_C} strokeDashoffset={ringOffset}
              style={{ filter: `drop-shadow(0 0 10px ${tier.color})` }} />
          </svg>
          <div className="rank-ring-badge"><RankIcon tier={tier.name} size="100%" /></div>
        </div>
        <div className="rank-tier-name" style={{ backgroundImage: `linear-gradient(120deg, #fff, color-mix(in srgb, #fff 30%, ${tier.color}))` }}>{tier.name}</div>
        <div className="rank-level-line">{t('Level {0}', rank.level)}</div>
        {rank.readyToPrestige ? (
          <>
            <div className="rank-xp-row" style={{ justifyContent: 'center' }}>
              <span style={{ fontWeight: 700, color: tier.color }}>{t('Level cap reached — ready to prestige')}</span>
            </div>
            <Button variant="primary" style={{ marginTop: 10 }} onClick={doPrestige}>{t('Upgrade mastery')}</Button>
          </>
        ) : <>
          <div className="rank-xp-row">
            <span className="muted">{t('{0} / {1} XP', fmtNum(rank.xpInLevel), fmtNum(rank.xpForLevel))}</span>
            <span style={{ fontWeight: 700, color: tier.color }}>{t('{0} XP to next level', fmtNum(left))}</span>
          </div>
          <div className="rank-xp-bar"><i style={{ width: pct + '%', background: `linear-gradient(90deg, color-mix(in srgb, ${tier.color} 70%, white 10%), ${tier.color})` }} /></div>
        </>}
      </div>
    )}

    <Segmented className="seg-range" value={tab} onChange={setTab}
      options={[{ value: 'streak', label: t('Streak') }, { value: 'tiers', label: t('Tiers') }, { value: 'prestige', label: t('Prestige') }]} />

    {tab === 'tiers' && <div>
      <h4 className="sec">{t('Tier path')}</h4>
      <div className="rank-ladder">
        {TIERS.map((tr, i) => {
          const cls = 'rank-node' + (i === tierIdx ? ' current' : i < tierIdx ? ' done' : ' locked')
          return <div key={tr.name} className={cls} style={{ '--ntier': tr.color }}>
            <div className="rank-node-circ"><RankIcon tier={tr.name} size="100%" /></div>
          </div>
        })}
      </div>

      {nextTier && <div className="rank-next-card">
        <span className="ico"><RankIcon tier={nextTier.name} size="100%" /></span>
        <div><div className="t">{t('Next tier')}</div><div className="n">{nextTier.name} · {t('reach Level {0}', nextTier.min)}</div></div>
      </div>}

      <h4 className="sec">{t('All tiers')}</h4>
      <div className="list">
        {TIERS.map((tr, i) => {
          const current = i === tierIdx, done = i < tierIdx, locked = i > tierIdx
          return <div key={tr.name} className="item" style={current ? {
            background: `linear-gradient(120deg, color-mix(in srgb, ${tr.color} 16%, transparent), transparent)`,
            borderColor: `color-mix(in srgb, ${tr.color} 55%, var(--glass-border))`,
          } : undefined}>
            <span className="lrow-i" style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', fontSize: 34, filter: locked ? 'grayscale(1) brightness(.55)' : undefined }}><RankIcon tier={tr.name} /></span>
            <div className="grow">
              <div className="row" style={{ gap: 7, alignItems: 'baseline' }}>
                <span className="tt" style={{ fontWeight: current ? 700 : 500 }}>{tr.name}</span>
                <span className="rank-lvl-pill" style={{ color: locked ? undefined : tr.color, background: locked ? 'var(--surface-2)' : `color-mix(in srgb, ${tr.color} 16%, transparent)` }}>{tr.min}–{tr.max}</span>
              </div>
              <PerkText items={RANK_PERKS.find(x => x.tier === tr.name).perks()} />
            </div>
            {done && <Icon name="check" className="accent" />}
            {locked && <Icon name="lock" className="dim" />}
          </div>
        })}
      </div>
    </div>}

    {tab === 'prestige' && <div>
      <h4 className="sec">{t('Prestige path')}</h4>
      <div className="rank-ladder">
        {PRESTIGE_LEVELS.map(lvl => {
          const current = lvl === rank.prestige && rank.prestige > 0, done = lvl < rank.prestige
          const cls = 'rank-node' + (current ? ' current' : done ? ' done' : ' locked')
          return <div key={lvl} className={cls} style={{ '--ntier': tier.color }}>
            <div className="rank-node-circ"><PrestigeIcon level={lvl} size="100%" /></div>
          </div>
        })}
      </div>

      {rank.prestige < 10 && <div className="rank-next-card">
        <span className="ico"><PrestigeIcon level={nextPrestige} size="100%" /></span>
        <div><div className="t">{t('Next prestige')}</div><div className="n">{t('Prestige {0}', nextPrestige)}</div></div>
      </div>}

      <h4 className="sec">{t('All prestige levels')}</h4>
      <div className="list">
        {PRESTIGE_LEVELS.map(lvl => {
          const current = lvl === rank.prestige && rank.prestige > 0, done = lvl < rank.prestige, locked = lvl > rank.prestige
          const hideMoneyPerk = locked && MONEY_PRESTIGE_LEVELS.has(lvl) && !me.admin
          return <div key={lvl} className="item" style={current ? {
            background: `linear-gradient(120deg, color-mix(in srgb, ${tier.color} 16%, transparent), transparent)`,
            borderColor: `color-mix(in srgb, ${tier.color} 55%, var(--glass-border))`,
          } : undefined}>
            <span className="lrow-i" style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', fontSize: 34, filter: locked ? 'grayscale(1) brightness(.55)' : undefined }}><PrestigeIcon level={lvl} /></span>
            <div className="grow">
              <div className="tt" style={{ fontWeight: current ? 700 : 500 }}>{t('Prestige {0}', lvl)}</div>
              <PerkText items={hideMoneyPerk ? [t('???')] : PRESTIGE_PERKS[lvl]()} />
            </div>
            {done && <Icon name="check" className="accent" />}
            {locked && <Icon name="lock" className="dim" />}
          </div>
        })}
      </div>
    </div>}

    {tab === 'streak' && <div>
      <h4 className="sec">{t('Streak path')}</h4>
      <div className="rank-ladder">
        {(streakTierList || []).map((st, i) => {
          const cls = 'rank-node' + (i === streakTierIdx ? ' current' : i < streakTierIdx ? ' done' : ' locked')
          return <div key={st.id} className={cls} style={{ '--ntier': tier.color }}>
            <div className="rank-node-circ"><StreakIcon tier={i + 1} size="100%" /></div>
          </div>
        })}
      </div>

      {nextStreakTier && <div className="rank-next-card">
        <span className="ico"><StreakIcon tier={streakTierIdx + 2} size="100%" /></span>
        <div><div className="t">{t('Next streak badge')}</div><div className="n">{nextStreakTier.name} · {t('reach {0} days', nextStreakTier.days)}</div></div>
      </div>}

      <h4 className="sec">{t('All streak badges')}</h4>
      <div className="list">
        {(streakTierList || []).map((st, i) => {
          const current = i === streakTierIdx, done = i < streakTierIdx, locked = i > streakTierIdx
          return <div key={st.id} className="item" style={current ? {
            background: `linear-gradient(120deg, color-mix(in srgb, ${tier.color} 16%, transparent), transparent)`,
            borderColor: `color-mix(in srgb, ${tier.color} 55%, var(--glass-border))`,
          } : undefined}>
            <span className="lrow-i" style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', fontSize: 34, filter: locked ? 'grayscale(1) brightness(.55)' : undefined }}><StreakIcon tier={i + 1} /></span>
            <div className="grow">
              <div className="row" style={{ gap: 7, alignItems: 'baseline' }}>
                <span className="tt" style={{ fontWeight: current ? 700 : 500 }}>{st.name}</span>
                <span className="rank-lvl-pill" style={{ color: locked ? undefined : tier.color, background: locked ? 'var(--surface-2)' : `color-mix(in srgb, ${tier.color} 16%, transparent)` }}>{t('{0}d', st.days)}</span>
              </div>
              <PerkText items={[t('Coming soon.')]} />
            </div>
            {done && <Icon name="check" className="accent" />}
            {locked && <Icon name="lock" className="dim" />}
          </div>
        })}
        {streakTierList && streakTierList.length === 0 && <div className="empty">{t('No streak badges configured yet.')}</div>}
      </div>
    </div>}

    <TasksCard />
    <PenaltiesRow onlyPending />
  </div>
}
