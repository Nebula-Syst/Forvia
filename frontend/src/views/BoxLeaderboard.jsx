import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { boxLeaderboard } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

// WODbuster-style: visible to the coach AND any current box member, not coach-only.
export default function BoxLeaderboard() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const me = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [wod, setWod] = useState(null)

  useEffect(() => {
    boxLeaderboard(boxId).then(r => { setRows(r.leaderboard); setWod(r.wod) }).catch(e => toast(e.message))
  }, [boxId])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Leaderboard')}</h1>
        {wod && <div className="sub">{wod.name}</div>}</div>
    </div>

    {!rows ? <div className="muted">{t('Loading…')}</div> : !rows.length ? (
      <div className="muted">{t('No athletes yet.')}</div>
    ) : (
      <div className="lrow-list">
        {rows.map((a, i) => (
          <div key={a.id} className="lrow" style={a.id === me?.id ? { background: 'var(--fill-2)' } : null}>
            <span className="lrow-i" style={{ '--tint': i === 0 ? 'var(--yellow)' : 'var(--grey)' }}>{i + 1}</span>
            <span className="lrow-m"><span className="lrow-t">{a.name}{a.coach ? ' · ' + t('Coach') : ''}</span></span>
            <span className="lrow-v">{a.value == null ? t('no result') : a.value}</span>
          </div>
        ))}
      </div>
    )}
  </div>
}
