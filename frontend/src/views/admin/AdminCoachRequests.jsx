import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { adminCoachRequests, adminCoachApprove, adminCoachDismiss, coachRequestDocumentUrl } from '../../lib/api.js'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.
//
// Applications to become a coach (POST /api/coach/apply, requires a session — unlike alpha
// waitlist requests these are tied to an existing account). Approving sets user.coach = true
// server-side; the applicant's next /api/me refresh (useStore refreshUser) picks it up with
// no re-login needed.
export default function AdminCoachRequests() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const load = () => adminCoachRequests().then(setRows).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const approve = r => adminCoachApprove(r.id).then(() => { toast(t('{0} is now a coach', r.name || r.userId)); load() }).catch(e => toast(e.message))
  const dismiss = r => adminCoachDismiss(r.id).then(() => { toast(t('Dismissed')); load() }).catch(e => toast(e.message))

  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => !ql || (r.name || '').toLowerCase().includes(ql) || (r.email || '').toLowerCase().includes(ql))
  const pendingCount = (rows || []).filter(r => r.status === 'pending').length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Coach requests')}</h1>
        <div className="sub">{rows ? t('{0} pending · {1} total', pendingCount, rows.length) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search name or email…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Experience')}</th><th>{t('Certifications')}</th><th>{t('Document')}</th><th>{t('Requested')}</th><th>{t('Status')}</th><th></th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id}>
            <td>{r.name || '—'}</td>
            <td className="dim-cell">{r.email || '—'}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 220 }}>{r.experience || '—'}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 180 }}>{r.certifications || '—'}</td>
            <td className="dim-cell">
              {r.documentFile
                ? <a href={coachRequestDocumentUrl(r.id)} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 5, color: 'var(--acc)' }}><Icon name="clipboard" style={{ fontSize: 15 }} />{t('View')}</a>
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
      {rows && !shown.length && <div className="dtable-empty">{q ? t('No requests match “{0}”.', q) : t('No coach requests yet.')}</div>}
    </div>
  </div>
}
