import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api, adminAnticheat, adminAnticheatReview } from '../../lib/api.js'
import { fmtDate, fmtDur, fmtVol } from '../../lib/format.js'
import { setsDone, workoutVolume } from '../../lib/history.js'
import { exOr } from '../../lib/exercises.js'
import { t, nameFor } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.
//
// Every algorithmic penalty (api/server.js CHEAT_RULES), whether the account holder ever
// appealed it or not — reviewing only the appealed ones would leave the ones nobody noticed
// yet permanently unreviewable from here. Each finding already carries the exact ratio that
// tripped it (e.g. "weight 1.2x the allowed max"), sent as plain English straight from the
// server's own rule table — not re-translated — so a reviewer reads the same wording the
// detection code itself uses. The flagged workout itself — sets, weights, reps — comes straight
// off the penalty row (`p.workout`): scanForCheating pulls a flagged workout out of the account's
// normal history the instant it's flagged, and that row is its ONLY surviving copy until this
// page rules on it, so there's nothing else here to fetch or cross-reference.
const STATUS_LABEL = () => ({ active: t('Flagged'), appealed: t('Appealed'), upheld: t('Upheld'), overturned: t('Overturned') })
const STATUS_COLOR = { active: 'var(--red)', appealed: 'var(--orange)', upheld: 'var(--red)', overturned: 'var(--acc)' }
const STATUS_RANK = { appealed: 0, active: 1, upheld: 2, overturned: 3 }

function PenaltyDetail({ p, onChanged, close }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const w = p.workout || null
  const reviewed = p.status === 'upheld' || p.status === 'overturned'
  const statusLabel = STATUS_LABEL()

  // Overturning already does the real work server-side (api/server.js's review route puts the
  // workout back in state.workouts, counted in xpFor() again on the very next read) — the fetch
  // here is only so the admin sees that restoration actually landed, in the toast itself, rather
  // than taking it on faith. reviewNote is required server-side too (400 without one) — a ruling
  // with no reason attached is just a status flip, and the account holder is the one left
  // wondering why either way.
  const review = decision => {
    const reviewNote = note.trim()
    if (!reviewNote) return
    setBusy(true)
    adminAnticheatReview(p.id, decision, reviewNote)
      .then(async () => {
        if (decision === 'overturn') {
          const fresh = await api('/api/admin/user?id=' + encodeURIComponent(p.userId)).catch(() => null)
          const r = fresh?.user?.rank
          toast(r ? t('Penalty overturned — {0} is back to Level {1} ({2} total XP)', p.userName || t('user'), r.level, r.totalXp) : t('Penalty overturned'))
        } else {
          toast(t('Penalty upheld'))
        }
        onChanged(); close()
      })
      .catch(e => toast(e.message))
      .finally(() => setBusy(false))
  }

  return <>
    <h3 className="capitalize">{p.userName || t('Unknown user')}</h3>
    <div className="small muted" style={{ marginBottom: 14 }}>
      {fmtDate(p.date)} · −{p.levels} {p.levels === 1 ? t('level') : t('levels')} · <span style={{ color: STATUS_COLOR[p.status] }}>{statusLabel[p.status]}</span>
    </div>

    <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Why it was flagged')}</div>
    <div className="list" style={{ marginBottom: 14 }}>
      {p.findings.map(f => <div key={f.id} className="row between" style={{ padding: '6px 2px', borderBottom: '1px solid var(--sep)' }}>
        <span className="small">{f.label}</span>
        <span className="tag" style={{ flexShrink: 0, marginLeft: 8 }}>{f.ratio.toFixed(1)}x · lvl {f.levels}</span>
      </div>)}
    </div>

    {p.appeal && <>
      <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Their appeal')}</div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="small" style={{ lineHeight: 1.5 }}>“{p.appeal.message}”</div>
        {p.appeal.created && <div className="dim" style={{ fontSize: '.72rem', marginTop: 6 }}>{fmtDate(p.appeal.created.slice(0, 10))}</div>}
      </div>
    </>}

    <div className="small muted" style={{ margin: '0 0 6px' }}>{t('The flagged workout')}</div>
    {!w ? <div className="empty small" style={{ marginBottom: 14 }}>{t('No workout snapshot on this row (a penalty from before this existed).')}</div>
      : <div className="card" style={{ marginBottom: 14 }}>
        <div className="small" style={{ fontWeight: 600 }}>{w.name || t('Freestyle')}</div>
        <div className="dim" style={{ fontSize: '.72rem', marginBottom: 8 }}>
          {fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} {t('sets')} · {fmtVol(w.vol ?? workoutVolume(w), p.unit || 'kg')}
        </div>
        {(w.entries || []).map((e, i) => <div key={i} style={{ marginBottom: 6 }}>
          <div className="small capitalize" style={{ fontWeight: 500 }}>{nameFor(exOr(e.id)) || e.id}</div>
          <div className="dim" style={{ fontSize: '.74rem' }}>
            {(e.sets || []).filter(s => s.done).map(s => `${s.w ?? 0}×${s.r ?? 0}`).join(' · ') || '—'}
          </div>
        </div>)}
      </div>}

    {reviewed && p.reviewNote && <>
      <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Review note')}</div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="small" style={{ lineHeight: 1.5 }}>“{p.reviewNote}”</div>
        {p.reviewedAt && <div className="dim" style={{ fontSize: '.72rem', marginTop: 6 }}>{fmtDate(p.reviewedAt.slice(0, 10))}</div>}
      </div>
    </>}

    <div className="small muted" style={{ margin: '0 0 6px' }}>{reviewed ? t('Reason for changing this ruling') : t('Reason for this ruling')}</div>
    <textarea className="input" rows={3} placeholder={t('Explain the decision — the account holder sees this too…')}
      value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 12, width: '100%' }} />

    {!reviewed ? <>
      <Button variant="primary" disabled={busy || !note.trim()} onClick={() => review('overturn')}>{t('Overturn — remove penalty')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="danger" disabled={busy || !note.trim()} onClick={() => review('uphold')}>{t('Uphold — keep penalty')}</Button>
    </> : (
      <Button variant="ghost" size="sm" disabled={busy || !note.trim()} onClick={() => review(p.status === 'upheld' ? 'overturn' : 'uphold')}>
        {p.status === 'upheld' ? t('Change to overturned') : t('Change to upheld')}
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
  const statusLabel = STATUS_LABEL()

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
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Fair play')}</h1>
        <div className="sub">{rows ? t('{0} need review · {1} appealed · {2} total', needsReview, appealedCount, rows.length) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search name or finding…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>{t('User')}</th><th>{t('Findings')}</th><th>{t('Levels')}</th><th>{t('Flagged')}</th><th>{t('Status')}</th></tr></thead>
        <tbody>
          {shown.map(r => <tr key={r.id} className="tap" onClick={() => openDetail(r)}>
            <td className="capitalize">{r.userName || t('Unknown')}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal', maxWidth: 280 }}>{r.findings.map(f => f.label).join(' · ')}</td>
            <td>−{r.levels}</td>
            <td className="dim-cell">{fmtDate(r.date)}</td>
            <td>
              <span className="row" style={{ display: 'inline-flex', gap: 5 }}>
                <span className="tag" style={{ color: STATUS_COLOR[r.status] }}>{statusLabel[r.status]}</span>
                {r.status === 'appealed' && <Icon name="flag" style={{ fontSize: 12, color: 'var(--orange)' }} title={t('has an appeal message')} />}
              </span>
            </td>
          </tr>)}
        </tbody>
      </table>
      {rows && !shown.length && <div className="dtable-empty">{q ? t('No penalties match “{0}”.', q) : t('No penalties recorded.')}</div>}
    </div>
  </div>
}
