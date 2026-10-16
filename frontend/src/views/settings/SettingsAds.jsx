import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { adsStatus } from '../../lib/api.js'
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

// Ads plan — two independent things on one page, both under Settings → Ads: earning a reward by
// choosing to watch a video ad (AdMob, native app only, phase 1), and choosing where passive
// AdSense banners are allowed to show (web/PWA only — see lib/ads.js's own comment on why never
// inside the installed app). Neither does anything on an instance that hasn't configured the
// corresponding Google account; both sections hide themselves rather than show a dead control.
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

  const showRewards = MOBILE && !!admobUnitId
  const showPlacements = !!adsenseClientId

  const refreshStatus = () => adsStatus().then(setStatus).catch(() => setStatus(null))
  useEffect(() => { if (showRewards) refreshStatus() }, [showRewards])

  const watch = async () => {
    setWatching(true)
    const result = await watchRewardedAd(admobUnitId, user.id)
    setWatching(false)
    if (result.ok) {
      toast(t('Thanks for watching — your reward is on its way'))
      setTimeout(refreshStatus, 1500)   // gives the SSV callback a moment to land before re-reading
    } else {
      toast(t('Could not play the ad — try again in a moment'))
    }
  }
  const eligible = status?.eligible && !watching
  const togglePlacement = (key, v) => update(s => { s.adPlacements = { ...(s.adPlacements || {}), [key]: v } })

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Ads')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Everything here is optional — Forvia works exactly the same with all of it off.')}</p>

    {showRewards && (
      <Section title={t('Earn rewards')} footer={status ? t('{0} of {1} watched today — resets at midnight.', status.watchedToday, status.dailyCap) : null}>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Watch an ad')}
          subtitle={status ? t('+{0} XP', status.rewardXp) : null}>
          <Button variant="primary" size="sm" disabled={!eligible} onClick={watch}>
            {watching ? t('Loading…') : t('Watch')}
          </Button>
        </Row>
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
}
