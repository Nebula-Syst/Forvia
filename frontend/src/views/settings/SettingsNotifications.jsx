import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { MOBILE, syncReminder } from '../../lib/mobile.js'
import { localTZ } from '../../lib/format.js'
import { pushSupported, pushPermission, enablePush, disablePush, sendTestPush } from '../../lib/push.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row, Switch, SelectRow } from '../../components/ui.jsx'

const TIMES = Array.from({ length: 34 }, (_, i) => {
  const m = i * 30 + 5 * 60
  const hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
})

// Native app: the reminder is scheduled on-device (Capacitor local notifications) — no
// server, no push subscription, works offline.
function NativeReminderSection() {
  const S = useStore(s => s.S)
  const { update } = useStore()
  const toast = useUI(s => s.toast)
  const on = !!S.reminder?.on

  const setOn = async v => {
    if (v) {
      const ok = await syncReminder({ ...S, reminder: { ...S.reminder, on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    update(s => { s.reminder = { ...(s.reminder || {}), on: v, tz: localTZ() } })
    toast(v ? t('Notifications on') : t('Notifications off'))
  }

  return <Section footer={on ? t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder?.tz || localTZ()) : null}>
    <Row icon="calendar" iconTint="var(--indigo)" title={t('Workout day reminder')}
      subtitle={t("Only sent on days you have a routine planned and haven't logged a workout yet.")}>
      <Switch checked={on} onChange={setOn} />
    </Row>
    {on && <SelectRow icon="clock" iconTint="var(--orange)" title={t('Reminder time')}
      value={S.reminder?.time || '08:00'}
      onChange={v => update(s => { s.reminder = { ...(s.reminder || {}), time: v } })}
      options={TIMES.map(v => ({ value: v, label: v }))} />}
  </Section>
}

// Web: the exact same `S.reminder` shape, but delivered server-side over Web Push — the
// backend's day-reminder loop (api/server.js) only fires for a user with a live push
// subscription, so the toggle stays locked until Push notifications is on.
function WebReminderSection({ pushOn }) {
  const S = useStore(s => s.S)
  const { update } = useStore()
  const toast = useUI(s => s.toast)
  const on = !!S.reminder?.on

  const setOn = v => {
    update(s => { s.reminder = { ...(s.reminder || {}), on: v, tz: localTZ() } })
    toast(v ? t('Notifications on') : t('Notifications off'))
  }

  return <Section footer={on && pushOn ? t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder?.tz || localTZ()) : null}>
    <Row icon="calendar" iconTint="var(--indigo)" title={t('Workout day reminder')}
      subtitle={pushOn ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") : t('Turn on push notifications first.')}>
      <Switch checked={on} disabled={!pushOn} onChange={setOn} />
    </Row>
    {on && pushOn && <SelectRow icon="clock" iconTint="var(--orange)" title={t('Reminder time')}
      value={S.reminder?.time || '08:00'}
      onChange={v => update(s => { s.reminder = { ...(s.reminder || {}), time: v } })}
      options={TIMES.map(v => ({ value: v, label: v }))} />}
  </Section>
}

function PushSection({ on, setOn, busy }) {
  const toast = useUI(s => s.toast)
  const supported = pushSupported()

  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(t('Test failed')) }
  }

  return <Section>
    <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')}
      subtitle={supported ? t('Rest-timer alerts, even if Forvia is closed.') : t('Not supported in this browser.')}>
      <Switch checked={on} disabled={!supported || busy} onChange={setOn} />
    </Row>
    {on && <Row icon="sparkles" iconTint="var(--acc)" title={t('Send test notification')} accessory="chevron" onClick={test} />}
  </Section>
}

function WebNotifications() {
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const [perm, setPerm] = useState(pushPermission())
  const pushOn = perm === 'granted'

  const setPushOn = async v => {
    setBusy(true)
    try {
      if (v) await enablePush(); else await disablePush()
      setPerm(pushPermission())
      toast(v ? t('Notifications on') : t('Notifications off'))
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    finally { setBusy(false) }
  }

  return <>
    <PushSection on={pushOn} setOn={setPushOn} busy={busy} />
    <WebReminderSection pushOn={pushOn} />
  </>
}

export default function SettingsNotifications() {
  const nav = useNavigate()

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Notifications')}</h1></div>
    </div>

    {MOBILE ? <NativeReminderSection /> : <WebNotifications />}
  </div>
}
