import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { boxLiveClass, classCancel } from '../lib/api.js'
import { wsOn } from '../lib/ws.js'
import { useWakeLock } from '../lib/wakelock.js'
import { clockStr, useLiveTick } from '../lib/liveClass.js'
import { LIVE_CLASSES_ENABLED } from '../lib/featureFlags.js'
import { EXIDX } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { typeColor } from '../lib/classDisciplines.js'
import Icon from '../components/Icon.jsx'
import Media from '../components/Media.jsx'
import { Button } from '../components/ui.jsx'

// t() reads the active language live, so this stays a function (not a module-level object) —
// a plain object built at import time would freeze "For Time" in whatever language loaded first.
const timerTypeLabel = type => type === 'amrap' ? 'AMRAP' : type === 'emom' ? 'EMOM' : type === 'tabata' ? 'Tabata' : t('For Time')

// The athlete's side of the host-driven live class (CoachClasses.jsx runs the controls) —
// read-only, follows whatever the host does. Reached only from a "live" class card on
// BoxClasses.jsx, which hands the session over via location.state so this never has to
// re-fetch the whole schedule just to know the class's name/room/exercises.
export default function LiveClass() {
  const { boxId, sessionId } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const toast = useUI(s => s.toast)
  const session = location.state?.session || null
  const boxTitle = location.state?.boxTitle || ''
  const [live, setLive] = useState(undefined) // undefined = loading, null = not live

  useEffect(() => {
    if (!LIVE_CLASSES_ENABLED) { nav('/box/' + boxId + '/classes', { state: { title: boxTitle }, replace: true }); return }
    boxLiveClass(sessionId).then(setLive).catch(e => { toast(e.message); setLive(null) })
  }, [sessionId])

  useEffect(() => wsOn('live:update', msg => { if (msg.sessionId === sessionId) setLive(msg.live) }), [sessionId])

  const liveTick = useLiveTick(live)
  useWakeLock(!!live)

  const back = () => nav('/box/' + boxId + '/classes', { state: { title: boxTitle } })
  const leave = () => classCancel(sessionId).then(back).catch(e => toast(e.message))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{session?.name || t('Live class')}</h1></div>
    </div>

    {live === undefined ? (
      <div className="muted small">{t('Loading…')}</div>
    ) : !live ? (
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="muted small" style={{ marginBottom: 14 }}>{t('Waiting for the coach to start the live class…')}</div>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <Button variant="tinted" style={{ width: 'auto' }} onClick={back}>{t('Back')}</Button>
          {!!session?.myStatus && <Button variant="danger" style={{ width: 'auto' }} onClick={leave}>{t('Leave class')}</Button>}
        </div>
      </div>
    ) : (
      <div className="card live-card" style={{ '--tint': session ? typeColor(session) : undefined }}>
        <div className="muted small" style={{ marginBottom: 6, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>{timerTypeLabel(live.timerType)}</div>
        <div className="live-clock">{clockStr(liveTick.seconds)}</div>
        {(liveTick.phase || liveTick.round) && (
          <div className="live-phase">
            {liveTick.phase === 'work' ? t('Work') : liveTick.phase === 'rest' ? t('Rest') : null}
            {!!liveTick.round && (liveTick.phase ? ' · ' : '') + t('Round {0}', liveTick.round) + (liveTick.totalRounds ? ' / ' + liveTick.totalRounds : '')}
          </div>
        )}
        {liveTick.done && <div className="muted small" style={{ marginTop: 4 }}>{t('Time!')}</div>}

        {!!session?.exercises?.length && (() => {
          const current = session.exercises[live.currentExerciseIndex]
          const catalogEx = current && EXIDX[current.exerciseId]
          return (
            <div style={{ marginTop: 20, textAlign: 'left' }}>
              {catalogEx && <Media ex={catalogEx} compact />}
              <div style={{ fontWeight: 800, fontSize: 17, textTransform: 'capitalize' }}>{current?.name}</div>
              {!!current?.scheme && <div className="muted small" style={{ marginTop: 2 }}>{current.scheme}</div>}
              {session.exercises.length > 1 && (
                <div className="muted small" style={{ marginTop: 10 }}>{t('{0} of {1}', live.currentExerciseIndex + 1, session.exercises.length)}</div>
              )}
            </div>
          )
        })()}

        {!!session?.myStatus && <Button variant="danger" style={{ marginTop: 20 }} onClick={leave}>{t('Leave class')}</Button>}
      </div>
    )}
  </div>
}
