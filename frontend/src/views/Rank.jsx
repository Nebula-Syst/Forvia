import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import RankIcon, { PrestigeIcon } from '../components/RankIcon.jsx'
import TasksCard from '../components/TasksCard.jsx'
import { Segmented } from '../components/ui.jsx'
import { TIERS, tierFor } from '../lib/rank.js'

const PRESTIGE_LEVELS = Array.from({ length: 10 }, (_, i) => i + 1)
const RING_R = 84, RING_C = 2 * Math.PI * RING_R

// Perk text per rank tier / prestige level — mirrors perksFor() in api/server.js. Each
// entry is a *list* (usually one line; Prestige 5/10 stack two) so a tier/level that
// unlocks more than one thing reads as a checklist, not one run-on sentence. Purely
// descriptive here — the gate check lives server-side on each actual route.
const RANK_PERKS = [
  { tier: 'Iron', perks: () => [t('The start of your climb.')] },
  { tier: 'Bronze', perks: () => [t('Pin your favorite PR to your profile.')] },
  { tier: 'Silver', perks: () => [t('Add a short bio to your profile.')] },
  { tier: 'Gold', perks: () => [t('Coming soon.')] },
  { tier: 'Platinum', perks: () => [t('Your rank badge gets a subtle animated glow in the feed.')] },
  { tier: 'Diamond', perks: () => [t('Upload up to 6 photos per workout.')] },
  { tier: 'Master', perks: () => [t('Pin a featured post to your profile.')] },
  { tier: 'Champion', perks: () => [t('An animated glow around your profile card.')] },
  { tier: 'Elite', perks: () => [t('Pin a second featured post to your profile.')] },
  { tier: 'Legend', perks: () => [t('A golden badge frame and a highlighted name in comments and the leaderboard.')] },
]
const PRESTIGE_PERKS = {
  1: () => [t('Coming soon.')],
  2: () => [t('A small crown next to your name in the feed and leaderboard.')],
  3: () => [t('Pin 2 featured posts instead of 1.')],
  4: () => [t('Your comments get a highlighted background.')],
  5: () => [t('A special avatar frame.'), t('25% off the subscription, once it exists.')],
  6: () => [t('Upload up to 8 photos per workout.')],
  7: () => [t('Your name gets an animated color gradient in the feed.')],
  8: () => [t('An exclusive app-wide color theme.')],
  9: () => [t('A "veteran" badge on your profile and the leaderboard.')],
  10: () => [t('The most exclusive, animated badge frame.'), t('50% off the subscription, once it exists.')],
}

// A perk row's description — one line for a single perk, a small checklist when a
// tier/level stacks more than one (Prestige 5 and 10 today).
function PerkText({ items }) {
  if (items.length <= 1) return <div className="ss">{items[0]}</div>
  return <ul className="ss perk-ul">{items.map((p, i) => <li key={i}>{p}</li>)}</ul>
}

// Reached from the badge on Home and on Progress — the full picture the small pill
// can't show. Fetched fresh, same reasoning as RankRow: XP moves on things that never
// re-run login/me, so a cached copy goes stale within the session.
export default function Rank() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('tiers')

  useEffect(() => { api('/api/me').then(r => setMe(r.user)).catch(() => setMe(false)) }, [])

  if (me === null) return null
  if (!me) { nav('/home'); return null }

  const rank = me.rank
  const tier = tierFor(rank.level)
  const tierIdx = TIERS.findIndex(x => x.name === tier.name)
  const nextTier = TIERS[tierIdx + 1]
  const pct = rank.xpForLevel ? Math.min(100, Math.round((rank.xpInLevel / rank.xpForLevel) * 100)) : 100
  const left = Math.max(0, rank.xpForLevel - rank.xpInLevel)
  const ringOffset = RING_C * (1 - pct / 100)
  const nextPrestige = Math.min(10, rank.prestige + 1)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Level')}</h1></div>
    </div>

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
      {rank.prestige > 0 && (
        <div className="rank-prestige-pill" style={{ background: `color-mix(in srgb, ${tier.color} 16%, transparent)`, borderColor: `color-mix(in srgb, ${tier.color} 40%, transparent)` }}>
          <PrestigeIcon level={rank.prestige} size={24} />
          <span style={{ color: tier.color }}>{t('Prestige {0}', rank.prestige)}</span>
        </div>
      )}
      <div className="rank-xp-row">
        <span className="muted">{t('{0} / {1} XP', fmtNum(rank.xpInLevel), fmtNum(rank.xpForLevel))}</span>
        <span style={{ fontWeight: 700, color: tier.color }}>{t('{0} XP to next level', fmtNum(left))}</span>
      </div>
      <div className="rank-xp-bar"><i style={{ width: pct + '%', background: `linear-gradient(90deg, color-mix(in srgb, ${tier.color} 70%, white 10%), ${tier.color})` }} /></div>
    </div>

    <TasksCard />

    <Segmented className="seg-range" value={tab} onChange={setTab}
      options={[{ value: 'tiers', label: t('Tiers') }, { value: 'prestige', label: t('Prestige') }]} />

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
          return <div key={lvl} className="item" style={current ? {
            background: `linear-gradient(120deg, color-mix(in srgb, ${tier.color} 16%, transparent), transparent)`,
            borderColor: `color-mix(in srgb, ${tier.color} 55%, var(--glass-border))`,
          } : undefined}>
            <span className="lrow-i" style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', fontSize: 34, filter: locked ? 'grayscale(1) brightness(.55)' : undefined }}><PrestigeIcon level={lvl} /></span>
            <div className="grow">
              <div className="tt" style={{ fontWeight: current ? 700 : 500 }}>{t('Prestige {0}', lvl)}</div>
              <PerkText items={PRESTIGE_PERKS[lvl]()} />
            </div>
            {done && <Icon name="check" className="accent" />}
            {locked && <Icon name="lock" className="dim" />}
          </div>
        })}
      </div>
    </div>}
  </div>
}
