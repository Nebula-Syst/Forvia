import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { adminBugs, adminBugResolve, adminBugDelete } from '../../lib/api.js'
import { fmtDate } from '../../lib/format.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only. Deliberately English-only — it isn't part of the translated end-user surface.
//
// One free-text field, no severity/category picker (see reportBugSheet in sheets.jsx) — this
// is alpha, the point is a report you can read at a glance, not a real issue tracker. `page`
// is whatever route the reporter was on when they hit Send, useful context without asking them
// to type it themselves.
export default function AdminBugs() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const load = () => adminBugs().then(setRows).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const toggleResolve = r => adminBugResolve(r.id).then(load).catch(e => toast(e.message))
  const remove = r => {
    if (!confirm('Delete this report?')) return
    adminBugDelete(r.id).then(() => { toast('Deleted'); load() }).catch(e => toast(e.message))
  }

  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => !ql || r.message.toLowerCase().includes(ql) || (r.name || '').toLowerCase().includes(ql))
  const openCount = (rows || []).filter(r => r.status !== 'resolved').length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Bug reports</h1>
        <div className="sub">{rows ? openCount + ' open · ' + rows.length + ' total' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="refresh">↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder="Search message or name…" value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>User</th><th>Message</th><th>Page</th><th>Reported</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id}>
            <td>{r.name || 'Anonymous'}{r.email ? <div className="dim-cell" style={{ fontSize: 12 }}>{r.email}</div> : null}</td>
            <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{r.message}</td>
            <td className="dim-cell">{r.page || '—'}</td>
            <td className="dim-cell">{fmtDate(r.created.slice(0, 10))}</td>
            <td>{r.status === 'resolved' ? <span className="tag acc">resolved</span> : <span className="tag">open</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <Button size="sm" variant={r.status === 'resolved' ? 'ghost' : 'primary'} onClick={() => toggleResolve(r)}>
                {r.status === 'resolved' ? 'Reopen' : 'Resolve'}
              </Button>
              <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13, color: 'var(--red)', marginLeft: 4 }} onClick={() => remove(r)} aria-label="delete"><Icon name="trash" /></button>
            </td>
          </tr>)}
        </tbody>
      </table>
      {rows && !shown.length && <div className="dtable-empty">{q ? 'No reports match “' + q + '”.' : 'No bug reports yet.'}</div>}
    </div>
  </div>
}
