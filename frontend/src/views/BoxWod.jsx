import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { boxWod, boxWodResult } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'

export default function BoxWod() {
  const UNIT_FOR = { time: t('seconds'), reps: t('reps'), weight: t('kg'), rounds: t('rounds') }
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [wod, setWod] = useState(undefined)
  const [myResult, setMyResult] = useState(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => boxWod(boxId).then(r => { setWod(r.wod); setMyResult(r.myResult); if (r.myResult) setValue(String(r.myResult.value)) }).catch(e => toast(e.message))
  useEffect(() => { load() }, [boxId])

  const send = () => {
    const v = Number(value)
    if (!isFinite(v) || v < 0) return toast(t('Enter a valid result'))
    setBusy(true)
    boxWodResult(boxId, wod.id, v).then(() => { toast(t('Result logged')); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/boxes')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('WOD of the day')}</h1></div>
      <button className="iconbtn" onClick={() => nav('/box/' + boxId + '/leaderboard')} aria-label={t('Leaderboard')}><Icon name="trophy" /></button>
    </div>

    {wod === undefined ? <div className="muted">{t('Loading…')}</div> : !wod ? (
      <div className="muted">{t('No WOD posted for today yet.')}</div>
    ) : <>
      <h2 style={{ marginBottom: 4 }}>{wod.name}</h2>
      {wod.description && <p className="muted" style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{wod.description}</p>}
      <div className="row" style={{ gap: 8 }}>
        <TextField type="number" placeholder={t('Your result') + ' (' + UNIT_FOR[wod.scoringType] + ')'} value={value} onChange={e => setValue(e.target.value)} style={{ flex: 1 }} />
        <Button variant="primary" style={{ width: 'auto' }} onClick={send} disabled={busy || !value}>{myResult ? t('Update') : t('Log result')}</Button>
      </div>
    </>}
  </div>
}
