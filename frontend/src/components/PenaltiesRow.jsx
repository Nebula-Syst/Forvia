import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { anticheatStatus } from '../lib/api.js'
import Icon from './Icon.jsx'

// A single compact, navigable summary — silent (renders nothing) for a clean account, same
// "never announce what it's watching for" principle the detection itself follows.
//
// `onlyPending` is what keeps this from becoming permanent clutter: Rank (right where a level
// hit lands) and Settings → Account (a stable findable spot) pass it, so once every penalty on
// the account has an actual verdict — upheld or overturned, nothing left to appeal or act on —
// the row disappears from both of those front-and-center spots on its own. It doesn't vanish
// outright, though: Settings → How it works renders this same row unconditionally, right next
// to the explanation of how the whole system works, which is where a resolved one still belongs
// (findable on purpose, not thrust in front of you forever for something already settled). The
// actual list — collapsed, expand-to-appeal — lives at /penalties either way.
export default function PenaltiesRow({ onlyPending = false }) {
  const nav = useNavigate()
  const [items, setItems] = useState(null)
  useEffect(() => { anticheatStatus().then(setItems).catch(() => setItems([])) }, [])
  if (!items || !items.length) return null
  if (onlyPending && !items.some(p => p.status === 'active' || p.status === 'appealed')) return null
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
