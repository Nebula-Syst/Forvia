import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api, adminAnticheat, adminAnticheatReview } from '../../lib/api.js'
import { fmtDate, fmtDur, fmtVol } from '../../lib/format.js'
import { setsDone, workoutVolume } from '../../lib/history.js'
import { exOr } from '../../lib/exercises.js'
import { nameFor } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only. Deliberately English-only — it isn't part of the translated end-user surface.
//
// Every algorithmic penalty (api/server.js CHEAT_RULES), whether the account holder ever
// appealed it or not — reviewing only the appealed ones would leave the ones nobody noticed
// yet permanently unreviewable from here. Each finding already carries the exact ratio that
// tripped it (e.g. "weight 1.2x the allowed max"), sent as plain English straight from the
// server's own rule table — not re-translated — so a reviewer reads the same wording the
// detection code itself uses. The flagged workout's own sets are fetched and shown underneath
// for the same reason: "far beyond any recorded human lift" only means something once you can
// see the actual number that was logged, which is the whole point of this page existing.

const STATUS_LABEL = { active: 'Flagged', appealed: 'Appealed', upheld: 'Upheld', overturned: 'Overturned' }
const STATUS_COLOR = { active: 'var(--red)', appealed: 'var(--orange)', upheld: 'var(--red)', overturned: 'var(--acc)' }
const STATUS_RANK = { appealed: 0, active: 1, upheld: 2, overturned: 3 }

function PenaltyDetail({ p, onChanged, close }) {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('/api/admin/user?id=' + encodeURIComponent(p.userId)).then(setD).catch(() => setD(false))
  }, [p.id])
  const w = d && d.workouts ? d.workouts.find(x => x.id === p.workoutId) : null

  // Nothing here actually needs to "give back" levels or XP as a separate step — xpFor() never
  // excluded a flagged workout's own XP from the total to begin with (see api/server.js), and
  // rankFor()'s levelsDocked sum already skips any penalty whose status is 'overturned'. So the
  // instant the status flips, the account's real level/XP is exactly what it would've been had
  // the workout never been flagged. The only reason to re-fetch here is to show the admin that
  // restoration actually landed, in the same toast, rather than asking them to take it on faith.
  const review = decision => {
    setBusy(true)
    adminAnticheatReview(p.id, decision)
      .then(async () => {
        if (decision === 'overturn') {
          const fresh = await api('/api/admin/user?id=' + encodeURIComponent(p.userId)).catch(() => null)
          const r = fresh?.user?.rank
          toast(r ? `Penalty overturned — ${p.userName || 'user'} is back to Level ${r.level} (${r.totalXp} total XP)` : 'Penalty overturned')
        } else {
          toast('Penalty upheld')
        }
        onChanged(); close()
      })
      .catch(e => toast(e.message))
      .finally(() => setBusy(false))
  }

  return <>
    <h3 className="capitalize">{p.userName || 'Unknown user'}</h3>
    <div className="small muted" style={{ marginBottom: 14 }}>
      {fmtDate(p.date)} · −{p.levels} level{p.levels === 1 ? '' : 's'} · <span style={{ color: STATUS_COLOR[p.status] }}>{STATUS_LABEL[p.status]}</span>
    </div>

    <div className="small muted" style={{ margin: '0 0 6px' }}>Why it was flagged</div>
    <div className="list" style={{ marginBottom: 14 }}>
      {p.findings.map(f => <div key={f.id} className="row between" style={{ padding: '6px 2px', borderBottom: '1px solid var(--sep)' }}>
        <span className="small">{f.label}</span>
        <span className="tag" style={{ flexShrink: 0, marginLeft: 8 }}>{f.ratio.toFixed(1)}x · lvl {f.levels}</span>
      </div>)}
    </div>

    {p.appeal && <>
      <div className="small muted" style={{ margin: '0 0 6px' }}>Their appeal</div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="small" style={{ lineHeight: 1.5 }}>“{p.appeal.message}”</div>
        {p.appeal.created && <div className="dim" style={{ fontSize: '.72rem', marginTop: 6 }}>{fmtDate(p.appeal.created.slice(0, 10))}</div>}
      </div>
    </>}

    <div className="small muted" style={{ margin: '0 0 6px' }}>The flagged workout</div>
    {d === null ? <div className="muted small" style={{ marginBottom: 14 }}>Loading…</div>
      : !w ? <div className="empty small" style={{ marginBottom: 14 }}>Workout not found — it may have been deleted since.</div>
        : <div className="card" style={{ marginBottom: 14 }}>
          <div className="small" style={{ fontWeight: 600 }}>{w.name || 'Freestyle'}</div>
          <div className="dim" style={{ fontSize: '.72rem', marginBottom: 8 }}>
            {fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets · {fmtVol(w.vol ?? workoutVolume(w), d.unit)}
          </div>
          {(w.entries || []).map((e, i) => <div key={i} style={{ marginBottom: 6 }}>
            <div className="small capitalize" style={{ fontWeight: 500 }}>{nameFor(exOr(e.id)) || e.id}</div>
            <div className="dim" style={{ fontSize: '.74rem' }}>
              {(e.sets || []).filter(s => s.done).map(s => `${s.w ?? 0}×${s.r ?? 0}`).join(' · ') || '—'}
            </div>
          </div>)}
        </div>}

    {(p.status === 'active' || p.status === 'appealed') ? <>
      <Button variant="primary" disabled={busy} onClick={() => review('overturn')}>Overturn — remove penalty</Button>
      <div style={{ height: 8 }} />
      <Button variant="danger" disabled={busy} onClick={() => review('uphold')}>Uphold — keep penalty</Button>
    </> : (
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => review(p.status === 'upheld' ? 'overturn' : 'uphold')}>
        {p.status === 'upheld' ? 'Change to overturned' : 'Change to upheld'}
      </Button>
    )}
  </>
}

export default function AdminAnticheat() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const load = () => adminAnticheat().then(setRows).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const openDetail = p => openSheet(close => <PenaltyDetail p={p} onChanged={load} close={close} />)

  const ql = q.trim().toLowerCase()
  const shown = (rows || [])
    .filter(r => !ql || (r.userName || '').toLowerCase().includes(ql) || r.findings.some(f => f.label.toLowerCase().includes(ql)))
    .slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
  const needsReview = (rows || []).filter(r => r.status === 'active' || r.status === 'appealed').length
  const appealedCount = (rows || []).filter(r => r.status === 'appealed').length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Fair play</h1>
        <div className="sub">{rows ? needsReview + ' need review · ' + appealedCount + ' appealed · ' + rows.length + ' total' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="refresh">↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder="Search name or finding…" value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>User</th><th>Findings</th><th>Levels</th><th>Flagged</th><th>Status</th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id} className="tap" onClick={() => openDetail(r)}>
            <td className="capitalize">{r.userName || 'Unknown'}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 280 }}>{r.findings.map(f => f.label).join(' · ')}</td>
            <td>−{r.levels}</td>
            <td className="dim-cell">{fmtDate(r.date)}</td>
            <td>
              <span className="row" style={{ display: 'inline-flex', gap: 5 }}>
                <span className="tag" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                {r.status === 'appealed' && <Icon name="flag" style={{ fontSize: 12, color: 'var(--orange)' }} title="has an appeal message" />}
              </span>
            </td>
          </tr>)}
        </tbody>
      </table>
      {rows && !shown.length && <div className="dtable-empty">{q ? 'No penalties match “' + q + '”.' : 'No penalties recorded.'}</div>}
    </div>
  </div>
}
