import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { athleteBoxes, boxJoin } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField, Section } from '../components/ui.jsx'

// The "Join a box" sheet is its own small component (not inline JSX referencing the parent's
// state) so typing in the code field re-renders just this sheet — a render function captured
// once by openSheet() only ever sees the parent state as it was at that instant, so any
// interactive state inside a sheet has to live in a real component of its own.
function JoinBoxSheet({ close, onJoined }) {
  const toast = useUI(s => s.toast)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const join = () => {
    const v = code.trim()
    if (!v) return
    setBusy(true)
    boxJoin(v).then(() => { close(); toast(t('Joined!')); onJoined() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  return <>
    <h3>{t('Join a box')}</h3>
    <div className="row" style={{ gap: 8 }}>
      <TextField placeholder={t('Invite code')} value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ flex: 1 }} autoFocus />
      <Button variant="primary" style={{ width: 'auto' }} onClick={join} disabled={busy || !code.trim()}>{t('Join')}</Button>
    </div>
    <div style={{ height: 8 }} />
  </>
}

// Athlete-side hub, reached from the main "Box" quick action. Picking a box here is the only
// step — it goes straight to that one box's classes to book (BoxClasses.jsx), for a member,
// staff or the owner alike. Box *configuration* (title, invite, staff, the weekly schedule
// itself) deliberately lives elsewhere (Settings → coach dashboard), never here.
export default function MyBoxes() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const pending = useStore(s => s.pendingAssignments)
  const applyAssignment = useStore(s => s.applyRoutineAssignment)
  const refreshPending = useStore(s => s.refreshPendingAssignments)
  const [boxes, setBoxes] = useState(null)

  const load = () => athleteBoxes().then(setBoxes).catch(e => toast(e.message))
  useEffect(() => { load(); refreshPending() }, [])

  const apply = a => applyAssignment(a).then(() => toast(t('Added to your routines'))).catch(e => toast(e.message))

  const openBox = b => nav('/box/' + b.id + '/classes', { state: { title: b.title } })
  const openJoin = () => openSheet(close => <JoinBoxSheet close={close} onJoined={load} />)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Box')}</h1></div>
      <button className="iconbtn" onClick={openJoin} aria-label={t('Join a box')}><Icon name="plus" /></button>
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

    <Section title={t('Your boxes')}>
      {!boxes ? <div className="muted small">{t('Loading…')}</div> : !boxes.length ? (
        <div className="muted small">{t('Not in a box yet — tap + above to enter an invite code.')}</div>
      ) : (
        <div className="lrow-list">
          {boxes.map(b => (
            <button key={b.id} className="lrow tap" onClick={() => openBox(b)}>
              <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="shield" /></span>
              <span className="lrow-m">
                <span className="lrow-t">{b.title}
                  {b.role === 'staff' && <span className="role-tag" style={{ marginLeft: 8 }}>{t('Staff')}</span>}
                  {b.role === 'owner' && <span className="role-tag" style={{ marginLeft: 8 }}>{t('Owner')}</span>}
                </span>
                <span className="lrow-s">{b.role === 'owner' ? t('Your box') : t('Coach: {0}', b.coachName || '?')}</span>
              </span>
              <Icon name="chevronRight" className="lrow-c" />
            </button>
          ))}
        </div>
      )}
    </Section>
  </div>
}
