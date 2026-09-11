import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { athleteBoxes, boxJoin } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField, Section } from '../components/ui.jsx'

// Athlete-side hub: boxes I've joined (each a doorway into that box's WOD + leaderboard),
// a manual "enter invite code" field (the same redemption a shared /box/join/:code link uses),
// and coach-assigned routines waiting to be copied into my own S.routines.
export default function MyBoxes() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const pending = useStore(s => s.pendingAssignments)
  const applyAssignment = useStore(s => s.applyRoutineAssignment)
  const refreshPending = useStore(s => s.refreshPendingAssignments)
  const [boxes, setBoxes] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => athleteBoxes().then(setBoxes).catch(e => toast(e.message))
  useEffect(() => { load(); refreshPending() }, [])

  const join = () => {
    const v = code.trim()
    if (!v) return
    setBusy(true)
    boxJoin(v).then(() => { setCode(''); toast(t('Joined!')); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  const apply = a => applyAssignment(a).then(() => toast(t('Added to your routines'))).catch(e => toast(e.message))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('My boxes')}</h1></div>
    </div>

    {!!pending?.length && (
      <Section title={t('From your coach')}>
        <div className="lrow-list">
          {pending.map(a => (
            <div key={a.id} className="lrow">
              <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="dumbbell" /></span>
              <span className="lrow-m">
                <span className="lrow-t">{a.routine.name}</span>
                <span className="lrow-s">{t('From {0} · {1}', a.coachName || '?', a.boxName || '')}</span>
              </span>
              <Button size="sm" variant="primary" onClick={() => apply(a)}>{t('Add')}</Button>
            </div>
          ))}
        </div>
      </Section>
    )}

    <Section title={t('Join a box')}>
      <div className="row" style={{ gap: 8 }}>
        <TextField placeholder={t('Invite code')} value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ flex: 1 }} />
        <Button variant="primary" style={{ width: 'auto' }} onClick={join} disabled={busy || !code.trim()}>{t('Join')}</Button>
      </div>
    </Section>

    <Section title={t('Your boxes')}>
      {!boxes ? <div className="muted small">{t('Loading…')}</div> : !boxes.length ? (
        <div className="muted small">{t('Not in a box yet — enter an invite code above.')}</div>
      ) : (
        <div className="lrow-list">
          {boxes.map(b => (
            <button key={b.id} className="lrow tap" onClick={() => nav('/box/' + b.id + '/wod')}>
              <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="shield" /></span>
              <span className="lrow-m">
                <span className="lrow-t">{b.name}</span>
                <span className="lrow-s">{t('Coach: {0}', b.coachName || '?')}</span>
              </span>
              <Icon name="chevronRight" className="lrow-c" />
            </button>
          ))}
        </div>
      )}
    </Section>
  </div>
}
