import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { adminBoxRequests, adminBoxRequestApprove, adminBoxRequestDismiss, boxRequestImageUrl } from '../../lib/api.js'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.
//
// A coach no longer creates a box directly (POST /api/coach/box-request instead) — approving
// here is what actually creates the db.boxes row (api/server.js POST /api/admin/box-requests/approve).
export default function AdminBoxRequests() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const load = () => adminBoxRequests().then(setRows).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const approve = r => adminBoxRequestApprove(r.id).then(() => { toast(t('Box created')); load() }).catch(e => toast(e.message))
  const dismiss = r => adminBoxRequestDismiss(r.id).then(() => { toast(t('Dismissed')); load() }).catch(e => toast(e.message))

  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => !ql || r.title.toLowerCase().includes(ql) || (r.coachName || '').toLowerCase().includes(ql))
  const pendingCount = (rows || []).filter(r => r.status === 'pending').length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Box requests')}</h1>
        <div className="sub">{rows ? t('{0} pending · {1} total', pendingCount, rows.length) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search title or coach…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>{t('Title')}</th><th>{t('Coach')}</th><th>{t('Location')}</th><th>{t('Description')}</th><th>{t('Image')}</th><th>{t('Requested')}</th><th>{t('Status')}</th><th></th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id}>
            <td>{r.title}</td>
            <td className="dim-cell">{r.coachName || '—'}</td>
            <td className="dim-cell">{r.location?.label || '—'}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 220 }}>{r.description || '—'}</td>
            <td className="dim-cell">
              {r.imageFile
                ? <a href={boxRequestImageUrl(r.id)} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 5, color: 'var(--acc)' }}><Icon name="clipboard" style={{ fontSize: 15 }} />{t('View')}</a>
                : '—'}
            </td>
            <td className="dim-cell">{fmtDate(r.created.slice(0, 10))}</td>
            <td>
              {r.status === 'pending' && <span className="tag">{t('pending')}</span>}
              {r.status === 'approved' && <span className="tag acc">{t('approved')}</span>}
              {r.status === 'dismissed' && <span className="tag" style={{ color: 'var(--red)' }}>{t('dismissed')}</span>}
            </td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {r.status === 'pending' && <>
                <Button size="sm" variant="primary" onClick={() => approve(r)}>{t('Approve')}</Button>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13, color: 'var(--red)', marginLeft: 4 }} onClick={() => dismiss(r)} aria-label={t('dismiss')}><Icon name="xmark" /></button>
              </>}
            </td>
          </tr>)}
        </tbody>
      </table>
      {rows && !shown.length && <div className="dtable-empty">{q ? t('No requests match “{0}”.', q) : t('No box requests yet.')}</div>}
    </div>
  </div>
}
