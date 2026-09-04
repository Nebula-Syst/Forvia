import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { adminAlpha, adminAlphaInvite, adminAlphaDismiss } from '../../lib/api.js'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.
//
// "Request access" submissions from the landing page (POST /api/alpha/apply, no session —
// see api/server.js) land here. Inviting someone mints a real single-use invite code (same
// table Users → Invite codes uses) and hands back a mailto: link with it already in the body
// — there's no automatic email, the admin sends it themselves, same as every other invite.
const joinUrl = code => `${location.origin}${location.pathname}#/join/${code}`

export default function AdminAlpha() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const load = () => adminAlpha().then(setRows).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const invite = r => adminAlphaInvite(r.id).then(({ invite }) => {
    const url = joinUrl(invite.code)
    navigator.clipboard?.writeText(url).catch(() => {})
    toast(t('Invite link copied — opening your mail client'))
    load()
    const subject = encodeURIComponent('Your Forvia alpha access')
    const body = encodeURIComponent(`Hi ${r.name},\n\nYou're in — here's your invite link to create your Forvia account:\n\n${url}\n\nSee you in there!`)
    window.open(`mailto:${r.email}?subject=${subject}&body=${body}`, '_blank')
  }).catch(e => toast(e.message))

  const dismiss = r => adminAlphaDismiss(r.id).then(() => { toast(t('Dismissed')); load() }).catch(e => toast(e.message))

  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => !ql || r.name.toLowerCase().includes(ql) || r.email.toLowerCase().includes(ql))
  const pendingCount = (rows || []).filter(r => r.status === 'pending').length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Alpha requests')}</h1>
        <div className="sub">{rows ? t('{0} pending · {1} total', pendingCount, rows.length) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search name or email…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Message')}</th><th>{t('Requested')}</th><th>{t('Status')}</th><th></th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id}>
            <td>{r.name}</td>
            <td className="dim-cell">{r.email}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 240 }}>{r.message || '—'}</td>
            <td className="dim-cell">{fmtDate(r.created.slice(0, 10))}</td>
            <td>
              {r.status === 'pending' && <span className="tag">{t('pending')}</span>}
              {r.status === 'invited' && <span className="tag acc">{t('invited')}</span>}
              {r.status === 'dismissed' && <span className="tag" style={{ color: 'var(--red)' }}>{t('dismissed')}</span>}
            </td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {r.status === 'pending' && <>
                <Button size="sm" variant="primary" onClick={() => invite(r)}>{t('Invite')}</Button>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13, color: 'var(--red)', marginLeft: 4 }} onClick={() => dismiss(r)} aria-label={t('dismiss')}><Icon name="xmark" /></button>
              </>}
              {r.status === 'invited' && <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13 }}
                onClick={() => { navigator.clipboard?.writeText(joinUrl(r.inviteCode)).catch(() => {}); toast(t('Link copied')) }} aria-label={t('copy link')}><Icon name="link" /></button>}
            </td>
          </tr>)}
        </tbody>
      </table>
      {rows && !shown.length && <div className="dtable-empty">{q ? t('No requests match “{0}”.', q) : t('No alpha requests yet.')}</div>}
    </div>
  </div>
}
