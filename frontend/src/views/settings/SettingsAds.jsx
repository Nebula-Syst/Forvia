import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { adsStatus } from '../../lib/api.js'
import { watchRewardedAd } from '../../lib/mobile.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row, Button } from '../../components/ui.jsx'

// Ads plan, phase 1 — native-only (App.jsx routes here only when MOBILE and an ad unit is
// configured, see Settings.jsx's own tile). The reward is never granted from anything that
// happens in this component: watchRewardedAd() (lib/mobile.js) just drives the native ad UI and
// reports whether the video played; the actual XP lands moments later via Google's own
// server-side SSV callback (api/server.js's POST /internal/ad-grant), which is what's really
// deciding whether this was a genuine watch, not this screen. refreshStatus() after a watch is
// just re-reading GET /api/ads/status to update the "2/3 today" count — if the SSV callback
// hasn't landed yet, that read is a beat stale, same as any other "the real change arrives over
// the wire a moment after the client-side action" case elsewhere in this app.
export default function SettingsAds() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const adUnitId = useStore(s => s.config?.admob_rewarded_unit_id)
  const [status, setStatus] = useState(null)
  const [watching, setWatching] = useState(false)

  const refreshStatus = () => adsStatus().then(setStatus).catch(() => setStatus(null))
  useEffect(() => { refreshStatus() }, [])

  const watch = async () => {
    setWatching(true)
    const result = await watchRewardedAd(adUnitId, user.id)
    setWatching(false)
    if (result.ok) {
      toast(t('Thanks for watching — your reward is on its way'))
      setTimeout(refreshStatus, 1500)   // gives the SSV callback a moment to land before re-reading
    } else {
      toast(t('Could not play the ad — try again in a moment'))
    }
  }

  const eligible = status?.eligible && !watching

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Earn rewards')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Completely optional — watch a short ad, get a small XP bonus. Never required to use Forvia.')}</p>

    <Section footer={status ? t('{0} of {1} watched today — resets at midnight.', status.watchedToday, status.dailyCap) : null}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Watch an ad')}
        subtitle={status ? t('+{0} XP', status.rewardXp) : null}>
        <Button variant="primary" size="sm" disabled={!eligible} onClick={watch}>
          {watching ? t('Loading…') : t('Watch')}
        </Button>
      </Row>
    </Section>
  </div>
}
