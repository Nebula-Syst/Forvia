import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, MotionConfig, useSpring, useMotionValueEvent } from 'motion/react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { adsStatus, redeemCoins } from '../../lib/api.js'
import { watchRewardedAd, MOBILE } from '../../lib/mobile.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row, Button, Switch } from '../../components/ui.jsx'

// Every optional placement this app currently has — Settings.jsx's AdPlacements section below
// renders one Switch per entry here, so adding a 6th/7th spot later is just one more line, not a
// new component. Social → Discover isn't in this list on purpose: a banner every 5 posts there
// is unconditional (Social.jsx), not a choice, by explicit request.
export const AD_PLACEMENTS = [
  { key: 'rest', title: 'During rest between sets', subtitle: 'Shown below the rest timer' },
  { key: 'workoutSummary', title: 'Workout summary', subtitle: 'Shown once, after you finish' },
  { key: 'history', title: 'Workout history', subtitle: 'Every few entries, scrolling past workouts' },
  { key: 'library', title: 'Exercise library', subtitle: 'Every few entries, browsing exercises' },
  { key: 'nutrition', title: 'Food diary', subtitle: 'Every few entries, browsing logged meals' },
]

// What a watched rewarded ad is redeemable for — a watch never grants XP (removed outright, see
// api/server.js's xpFor), only Forvia Coin, spent here. Costs mirror api/server.js's own
// COIN_COST_* constants — duplicated on purpose rather than fetched, same small/rarely-retuned
// tradeoff PR_XP/GOAL_XP already live with across the stack; the server is still the one that
// actually enforces them (POST /api/ads/redeem), this is just what the row shows.
const REDEEM_ITEMS = [
  { item: 'pro', title: 'Pro, for 24h', subtitle: 'Unlocks every Pro perk for a day', cost: 50 },
  { item: 'streak-save', title: "Save today's streak", subtitle: 'Counts as trained today, even if you skip', cost: 30 },
  { item: 'minigame-time', title: 'Extra mini-game time', subtitle: 'Lifts the rest-timer cap for your next game', cost: 10 },
]

// The balance reads as a running ledger total, not a decorative counter: it springs toward
// whatever the real value is rather than snapping, so a credit or debit visibly arrives —
// the same "motion that acknowledges, mostly" rule index.css already holds the rest of the
// app to. useSpring doesn't track a changing plain-number prop on its own (it only animates
// in response to .set()), hence the effect below.
function LedgerBalance({ value }) {
  const spring = useSpring(value, { stiffness: 260, damping: 26 })
  const [display, setDisplay] = useState(Math.round(value))
  useEffect(() => { spring.set(value) }, [value, spring])
  useMotionValueEvent(spring, 'change', v => setDisplay(Math.round(v)))
  return <span>{display}</span>
}

// Ads plan — two independent things on one page, both under Settings → Ads: earning and
// spending Forvia Coin (AdMob, native app only, phase 1), and choosing where passive AdSense
// banners are allowed to show (web/PWA only — see lib/ads.js's own comment on why never inside
// the installed app). Neither does anything on an instance that hasn't configured the
// corresponding Google account; both sections hide themselves rather than show a dead control.
//
// The coin half reads as a bank statement on purpose (a small balance up top, every row a
// signed amount) rather than a shop of cards — "earned" and "spent" are the same ledger, not
// two different UI metaphors, and a statement is the honest way to show that a watch's payout
// isn't known until it lands (so that row carries no number at all, just a credit mark) while
// a redemption's cost is known up front (so those rows carry the exact debit).
export default function SettingsAds() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const { update } = useStore()
  const S = useStore(s => s.S)
  const admobUnitId = useStore(s => s.config?.admob_rewarded_unit_id)
  const adsenseClientId = useStore(s => s.config?.adsense_client_id)
  const [status, setStatus] = useState(null)
  const [watching, setWatching] = useState(false)
  const [redeeming, setRedeeming] = useState(null)
  const [shake, setShake] = useState(null)        // item key mid-shake, insufficient-balance tap
  const [flash, setFlash] = useState(null)        // item key that just redeemed, brief row tint
  const [chip, setChip] = useState(null)          // { id, text } — transient +N/−N ledger stamp
  const chipSeq = useRef(0)
  const prevCoins = useRef(user?.coins || 0)

  const showRewards = MOBILE && !!admobUnitId
  const showPlacements = !!adsenseClientId
  const coins = user?.coins || 0

  // Stamps a +N/−N chip next to the balance whenever it actually moves, no matter why — a
  // redemption changes it synchronously, but a watch's credit lands later via AdMob's SSV
  // callback, so this watches the rendered balance itself rather than snapshotting it around
  // one specific action.
  useEffect(() => {
    const prev = prevCoins.current
    if (coins !== prev) {
      const id = ++chipSeq.current
      setChip({ id, text: (coins > prev ? '+' : '') + (coins - prev) })
      prevCoins.current = coins
      const tm = setTimeout(() => setChip(c => (c?.id === id ? null : c)), 1400)
      return () => clearTimeout(tm)
    }
  }, [coins])

  const refreshStatus = () => adsStatus().then(setStatus).catch(() => setStatus(null))
  useEffect(() => { if (showRewards) refreshStatus() }, [showRewards])

  const watch = async () => {
    setWatching(true)
    const result = await watchRewardedAd(admobUnitId, user.id)
    setWatching(false)
    if (result.ok) {
      toast(t('Thanks for watching — your Forvia Coin is on its way'))
      setTimeout(refreshStatus, 1500)   // gives the SSV callback a moment to land before re-reading
    } else {
      toast(t('Could not play the ad — try again in a moment'))
    }
  }
  const eligible = status?.eligible && !watching
  const togglePlacement = (key, v) => update(s => { s.adPlacements = { ...(s.adPlacements || {}), [key]: v } })

  // Merges the redeem response (Nebula's own half only, same shape every other nebulaMe()-
  // returning route hands back — see lib/api.js's fetchMe) onto whatever core fields the store's
  // user already has, exactly like fetchMe itself combines the two halves on login/boot.
  const redeem = async (item, cost) => {
    if (redeeming) return
    if (coins < cost) {
      setShake(item)
      setTimeout(() => setShake(s => (s === item ? null : s)), 420)
      toast(t('Not enough Forvia Coin'))
      return
    }
    setRedeeming(item)
    try {
      const updated = await redeemCoins(item)
      useStore.getState().setUser({ ...useStore.getState().user, ...updated })
      setFlash(item)
      setTimeout(() => setFlash(f => (f === item ? null : f)), 650)
    } catch (e) {
      toast(e.message === 'not enough Forvia Coin' ? t('Not enough Forvia Coin') : t('Could not redeem — try again'))
    }
    setRedeeming(null)
  }

  return <MotionConfig reducedMotion="user">
  <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Ads')}</h1></div>
      {showRewards && (
        <div className="coin-balance">
          <Icon name="coin" />
          <LedgerBalance value={coins} />
          <AnimatePresence>
            {chip && (
              <motion.span key={chip.id} className={'coin-chip' + (chip.text.startsWith('+') ? ' up' : ' down')}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}>
                {chip.text}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
    <p className="settings-subtitle">{t('Everything here is optional — Forvia works exactly the same with all of it off.')}</p>

    {showRewards && (
      <Section title={t('Forvia Coin')}
        footer={status ? t('{0} of {1} watched today — resets at midnight.', status.watchedToday, status.dailyCap) : null}>
        <Row icon="coin" iconTint="var(--acc)" title={t('Watch an ad')}
          subtitle={t('Never XP — every video adds Forvia Coin to your balance')}>
          <div className="ledger-credit">
            <span className="ledger-mark">+</span>
            <Button variant="primary" size="sm" disabled={!eligible} onClick={watch}>
              {watching ? t('Loading…') : t('Watch')}
            </Button>
          </div>
        </Row>
        {REDEEM_ITEMS.map(r => (
          <Row key={r.item} icon="coin" iconTint="var(--acc)" title={t(r.title)} subtitle={t(r.subtitle)}
            className={flash === r.item ? 'row-flash' : ''}>
            <motion.button type="button" className={'ledger-amt' + (coins >= r.cost ? ' afford' : '')}
              disabled={!!redeeming} onClick={() => redeem(r.item, r.cost)}
              whileTap={{ scale: 0.9 }}
              animate={shake === r.item ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
              transition={{ duration: 0.4 }}>
              {redeeming === r.item ? '…' : '−' + r.cost}
            </motion.button>
          </Row>
        ))}
      </Section>
    )}

    {showPlacements && (
      <Section title={t('Where you see ads')}
        footer={t('These only ever show up when you use Forvia from a browser — never in the installed app.')}>
        {AD_PLACEMENTS.map(p => (
          <Row key={p.key} icon="sparkles" iconTint="var(--acc)" title={t(p.title)} subtitle={t(p.subtitle)}>
            <Switch checked={!!S.adPlacements?.[p.key]} onChange={v => togglePlacement(p.key, v)} />
          </Row>
        ))}
      </Section>
    )}

    {!showRewards && !showPlacements && (
      <div className="empty"><div className="ico"><Icon name="sparkles" /></div>{t('Nothing to configure yet on this instance.')}</div>
    )}
  </div>
  </MotionConfig>
}
