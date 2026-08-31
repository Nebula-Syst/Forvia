import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { anticheatStatus, anticheatAppeal } from '../lib/api.js'
import { FINDING_LABEL, STATUS_LABEL, STATUS_COLOR } from '../lib/anticheat.js'
import Icon from '../components/Icon.jsx'
import { Button, TextArea } from '../components/ui.jsx'

// Every algorithmic penalty on this account, collapsed by default — tap one to expand it and,
// if it's still open (never appealed, never ruled on), send a review request right there.
// Reached from PenaltiesRow on both Rank and Settings → Account, so back goes to whichever of
// those actually got here, not a fixed page.
export default function Penalties() {
  const nav = useNavigate()
  const [items, setItems] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState(null)
  useEffect(() => { anticheatStatus().then(setItems).catch(() => setItems([])) }, [])

  const send = async id => {
    const message = (drafts[id] || '').trim()
    if (!message) return
    setSending(id)
    try { await anticheatAppeal(id, message); setItems(await anticheatStatus()) }
    finally { setSending(null) }
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Flagged activity')}</h1></div>
    </div>
    <div className="small dim" style={{ margin: '-6px 2px 16px' }}>
      {t('An automatic check found something unusual on these workouts and docked levels for it. If it got one wrong, explain why and it’ll be looked at by hand.')}
    </div>

    {items === null ? null : !items.length ? (
      <div className="empty"><div className="ico"><Icon name="checkCircle" /></div>{t('Nothing flagged on this account.')}</div>
    ) : (
      <div className="list">
        {items.map(p => {
          const open = expanded === p.id
          return <div key={p.id}>
            <div className="item" onClick={() => setExpanded(open ? null : p.id)}>
              <span className="lrow-i" style={{ background: 'color-mix(in srgb, var(--red) 22%, var(--surface-2))', color: 'var(--red)' }}><Icon name="warnTriangle" /></span>
              <div className="grow">
                <div className="tt">{t('−{0} levels', p.levels)}</div>
                <div className="ss">{p.date}</div>
              </div>
              <span className="tag" style={{ color: STATUS_COLOR[p.status], flexShrink: 0 }}>{STATUS_LABEL[p.status]?.() || p.status}</span>
              <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />
            </div>
            {open && <div className="card" style={{ marginTop: -6, marginBottom: 10 }}>
              <div className="ss" style={{ marginBottom: p.status === 'active' ? 12 : 0 }}>
                {p.findings.map(f => FINDING_LABEL[f.id]?.() || f.id).join(' · ')}
              </div>
              {p.status === 'active' && <>
                <TextArea rows={3} placeholder={t('Explain why this should be reviewed…')}
                  value={drafts[p.id] || ''} onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))} />
                <div style={{ height: 8 }} />
                <Button size="sm" variant="tinted" disabled={!(drafts[p.id] || '').trim() || sending === p.id} onClick={() => send(p.id)}>{t('Send for review')}</Button>
              </>}
              {p.status === 'appealed' && <div className="small dim" style={{ marginTop: 8 }}>{t('Your note: “{0}”', p.appeal?.message || '')}</div>}
            </div>}
          </div>
        })}
      </div>
    )}
  </div>
}
