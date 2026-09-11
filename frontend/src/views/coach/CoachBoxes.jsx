import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { coachBoxes, coachCreateBox } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField } from '../../components/ui.jsx'

// Coach-only landing page — a coach's own boxes (db.boxes where coachId === me), each just a
// roster + WOD + leaderboard away. One coach per box in v1, no multi-coach boxes.
export default function CoachBoxes() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [boxes, setBoxes] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => coachBoxes().then(setBoxes).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const create = () => {
    const v = name.trim()
    if (!v) return
    setBusy(true)
    coachCreateBox(v).then(() => { setName(''); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Your boxes')}</h1></div>
    </div>

    <div className="row" style={{ gap: 8, marginBottom: 16 }}>
      <TextField placeholder={t('New box name')} value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
      <Button variant="primary" style={{ width: 'auto' }} onClick={create} disabled={busy || !name.trim()}>{t('Create')}</Button>
    </div>

    {!boxes ? <div className="muted">{t('Loading…')}</div> : !boxes.length ? (
      <div className="muted">{t('No boxes yet — create one above.')}</div>
    ) : (
      <div className="lrow-list">
        {boxes.map(b => (
          <button key={b.id} className="lrow tap" onClick={() => nav('/coach/box/' + b.id)}>
            <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="shield" /></span>
            <span className="lrow-m">
              <span className="lrow-t">{b.name}</span>
              <span className="lrow-s">{t('{0} athletes', b.members)}</span>
            </span>
            <Icon name="chevronRight" className="lrow-c" />
          </button>
        ))}
      </div>
    )}
  </div>
}
