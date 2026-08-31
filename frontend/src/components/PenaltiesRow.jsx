import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { anticheatStatus } from '../lib/api.js'
import Icon from './Icon.jsx'

// A single compact, navigable summary — silent (renders nothing) for a clean account, same
// "never announce what it's watching for" principle the detection itself follows. Both doors
// in (Rank, right where a level hit lands, and Settings → Account, a stable findable spot)
// show this exact row; the actual list — collapsed, expand-to-appeal — lives at /penalties.
export default function PenaltiesRow() {
  const nav = useNavigate()
  const [items, setItems] = useState(null)
  useEffect(() => { anticheatStatus().then(setItems).catch(() => setItems([])) }, [])
  if (!items || !items.length) return null
  return (
    <div className="item" style={{ borderColor: 'var(--red)', marginBottom: 12 }} onClick={() => nav('/penalties')}>
      <span className="lrow-i" style={{ background: 'color-mix(in srgb, var(--red) 22%, var(--surface-2))', color: 'var(--red)' }}><Icon name="warnTriangle" /></span>
      <div className="grow">
        <div className="tt" style={{ color: 'var(--red)' }}>{t('Penalties')}</div>
        <div className="ss">{t('Something was flagged on your account')}</div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  )
}
