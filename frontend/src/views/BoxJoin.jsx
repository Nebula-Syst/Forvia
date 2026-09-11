import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { boxJoin } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

// Landing spot for a shared box-invite link (coach's copy-link button in CoachBox.jsx).
// Redeems the code immediately, then drops the athlete into their box list.
export default function BoxJoin() {
  const { code } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [state, setState] = useState('joining')
  const [boxName, setBoxName] = useState('')

  useEffect(() => {
    boxJoin(code).then(box => { setBoxName(box.name); setState('joined') }).catch(e => { toast(e.message); setState('error') })
  }, [code])

  return <div className="narrow" style={{ textAlign: 'center', paddingTop: 60 }}>
    <Icon name="shield" style={{ width: 48, height: 48, opacity: .6, marginBottom: 12 }} />
    {state === 'joining' && <p>{t('Joining…')}</p>}
    {state === 'joined' && <>
      <h2>{t('Welcome to {0}!', boxName)}</h2>
      <button className="btn primary" style={{ marginTop: 16 }} onClick={() => nav('/settings/boxes')}>{t('Go to my boxes')}</button>
    </>}
    {state === 'error' && <>
      <p className="muted">{t('That invite link is invalid or has been revoked.')}</p>
      <button className="btn" style={{ marginTop: 16 }} onClick={() => nav('/home')}>{t('Go home')}</button>
    </>}
  </div>
}
