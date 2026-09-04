import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtNum } from '../../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../../lib/audit.js'
import { confirmSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.
//
// Who signed in, who tried and failed, what an admin changed. Paging follows Library.jsx's
// house style — "Show more", not page numbers.
export default function AdminLog() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [meta, setMeta] = useState(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')

  const load = (c, before) => api('/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then(r => { setMeta(r); setRows(x => (before ? x.concat(r.events) : r.events)) })
    .catch(e => toast(e.message))
  const pick = c => { setCat(c); setRows([]); setMeta(null); load(c) }
  useEffect(() => { load(cat) }, [])

  const ql = q.trim().toLowerCase()
  const shownRows = !ql ? rows : rows.filter(e => {
    const line = auditLine(e)
    return line.title.toLowerCase().includes(ql) || (line.sub || '').toLowerCase().includes(ql)
  })

  const clear = () => confirmSheet({
    title: t('Clear the activity log?'),
    message: t('Every recorded event is deleted. The clear itself is logged, so the gap stays visible.'),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast(t('Activity log cleared')); pick(cat) }).catch(e => toast(e.message))
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Activity log')}</h1>
        <div className="sub">
          {meta ? t('{0} events', fmtNum(meta.total))
            + (meta.retention.days ? ' · ' + t('last {0} days', meta.retention.days) : '')
            + (meta.ip_mode === 'off' ? ' · ' + t('no IP addresses') : '') : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => pick(cat)} aria-label={t('refresh')}>↻</button>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={clear} aria-label={t('clear log')}><Icon name="trash" /></button>
    </div>

    {meta && !meta.enabled ? <div className="empty">{t('Activity logging is off on this instance (AUDIT_LOG=0).')}</div> : <>
      <div className="chips" style={{ marginBottom: 10 }}>
        {[['', t('All')], ['auth', t('Sign-ins')], ['admin', t('Admin')], ['fail', t('Failed')]].map(([v, l]) =>
          <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{l}</button>)}
      </div>
      <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" placeholder={t('Search loaded events…')} value={q} onChange={e => setQ(e.target.value)} /></div>

      <div className="dtable-wrap">
        <table className="dtable">
          <thead><tr><th>{t('Event')}</th><th>{t('Detail')}</th><th>{t('When')}</th></tr></thead>
          <tbody>
            {shownRows.map(e => {
              const line = auditLine(e)
              return <tr key={e.id}>
                <td>{line.title}
                  {/* a red pill, not a red row: twenty fumbled sign-ins in a row shouldn't read as an incident */}
                  {!e.ok && <span className="tag" style={{ marginLeft: 6, color: 'var(--red)' }}>{t('failed')}</span>}
                  {auditCat(e.ev) === 'admin' && <span className="tag acc" style={{ marginLeft: 6 }}>{t('admin')}</span>}</td>
                <td className="dim-cell" style={{ whiteSpace: 'normal' }}>{line.sub || '—'}</td>
                <td className="dim-cell">{fmtWhen(e.ts, meta?.now)}</td>
              </tr>
            })}
          </tbody>
        </table>
        {meta && !shownRows.length && <div className="dtable-empty">{q ? t('No loaded events match “{0}”.', q) : t('Nothing logged yet.')}</div>}
      </div>
      {meta?.nextBefore && <div style={{ marginTop: 10 }}>
        <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{t('Show more')}</Button></div>}
    </>}
  </div>
}
