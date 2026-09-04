import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api, adminUserCreate, adminSetEmployeeTypes, adminUserLevel, adminUserPrestige } from '../../lib/api.js'
import { fmtDate, fmtVol, fmtDur } from '../../lib/format.js'
import { workoutVolume, setsDone } from '../../lib/history.js'
import { confirmSheet } from '../../sheets.jsx'
import { tierFor } from '../../lib/rank.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import RankIcon, { PrestigeIcon } from '../../components/RankIcon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only.

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

const EMPLOYEE_TYPES = ['founder', 'admin']

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const toggleEmployeeType = type => {
    const cur = u.employeeTypes || []
    const next = cur.includes(type) ? cur.filter(x => x !== type) : [...cur, type]
    adminSetEmployeeTypes(u.id, next).then(() => { toast(t('Updated')); load(); onChanged() }).catch(e => toast(e.message))
  }
  const nudgeLevel = delta => {
    setBusy(true)
    adminUserLevel(u.id, delta).then(() => { load(); onChanged() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  // Same bypass relationship to POST /api/prestige that the level nudge above has to earning
  // XP normally — the real "Upgrade mastery" button only ever fires at level 100, so this is
  // the direct way to move the count for testing or a correction, same as level already is.
  const nudgePrestige = delta => {
    setBusy(true)
    adminUserPrestige(u.id, delta).then(() => { load(); onChanged() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  const rank = u.rank || {}
  const tier = tierFor(rank.level || 1)
  return <>
    <div className="row" style={{ gap: 12, marginBottom: 4 }}>
      <Avatar name={u.name} avatarUrl={u.avatarUrl} size={52} fontSize={19} />
      <div className="grow">
        <h3 className="capitalize" style={{ margin: 0 }}>{u.name}</h3>
        <div className="small muted">{u.email || '—'}</div>
      </div>
    </div>
    {u.bio && <div className="small" style={{ margin: '8px 0', fontStyle: 'italic', color: 'var(--label-2)' }}>“{u.bio}”</div>}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {(u.employeeTypes || []).map(x => <span key={x} className="tag acc">{x}</span>)}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      <span className="tag">{u.public ? t('public profile') : t('private profile')}</span>
      {u.phone && <span className="tag">{u.phone}</span>}
      {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>

    <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Rank')}</div>
    <div className="row between" style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <RankIcon tier={tier.name} size={30} />
        {rank.prestige > 0 && <PrestigeIcon level={rank.prestige} size={22} />}
        <div>
          <div className="small" style={{ fontWeight: 600 }}>{t('Level {0}', rank.level)} · {tier.name}{rank.prestige > 0 ? ` · ${t('Prestige {0}', rank.prestige)}` : ''}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{t('{0}/{1} XP this level · {2} total', rank.xpInLevel, rank.xpForLevel, rank.totalXp)}{u.adminXpAdjust ? ` (${u.adminXpAdjust > 0 ? '+' : ''}${u.adminXpAdjust} ${t('admin adjust')})` : ''}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7 }} disabled={busy || rank.level <= 1} onClick={() => nudgeLevel(-1)} aria-label={t('level down')}><Icon name="minus" /></button>
        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7 }} disabled={busy || rank.level >= 100} onClick={() => nudgeLevel(1)} aria-label={t('level up')}><Icon name="plus" /></button>
      </div>
    </div>
    <div className="row between" style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 12 }}>
      <div className="small" style={{ fontWeight: 600 }}>{t('Prestige {0}', rank.prestige || 0)}</div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7 }} disabled={busy || (rank.prestige || 0) <= 0} onClick={() => nudgePrestige(-1)} aria-label={t('prestige down')}><Icon name="minus" /></button>
        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7 }} disabled={busy} onClick={() => nudgePrestige(1)} aria-label={t('prestige up')}><Icon name="plus" /></button>
      </div>
    </div>

    <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Employee types')}</div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {EMPLOYEE_TYPES.map(x => <button key={x} className={'chip' + ((u.employeeTypes || []).includes(x) ? ' on' : '')} onClick={() => toggleEmployeeType(x)}>{x}</button>)}
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

// Shared as a link, not a bare code — the invited person opens it and lands straight in the
// register form with the code already filled in (Login.jsx's /join/:code handling).
const joinUrl = code => `${location.origin}${location.pathname}#/join/${code}`

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(joinUrl(invite.code)).catch(() => {}); toast(t('Link for {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('{0} unused · {1} redeemed — click a link to copy it', open.length, used.length)}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)', gap: 10 }}>
      <span className="grow" style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '.78rem', wordBreak: 'break-all', cursor: 'pointer' }}
        onClick={() => { navigator.clipboard?.writeText(joinUrl(i.code)).catch(() => {}); toast(t('Link copied')) }}>{joinUrl(i.code)}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)', flex: 'none' }} onClick={() => revoke(i.code)} aria-label={t('revoke')}><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

// Registration is closed on this instance (ALLOW_REGISTER=0) — this is the only door left,
// same validation as the public form, just admin-gated instead of open/invite-gated.
function CreateUserCard({ reload }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const create = () => {
    if (!name.trim()) return toast(t('Name is required'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return toast(t('Enter a valid email address'))
    if (password.length < 8) return toast(t('Password must be at least 8 characters'))
    adminUserCreate(name.trim(), email.trim(), password)
      .then(u => { setName(''); setEmail(''); setPassword(''); toast(t('{0} created', u.name)); reload() })
      .catch(e => toast(e.message))
  }
  return <div className="card">
    <h2 style={{ margin: '0 0 8px' }}>{t('Create user')}</h2>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Registration is closed on this instance — this is the only way to add an account.')}</div>
    <div style={{ display: 'grid', gap: 6 }}>
      <input className="input" placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} />
      <input className="input" type="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)} />
      <input className="input" type="password" placeholder={t('Password')} value={password} onChange={e => setPassword(e.target.value)} />
      <Button variant="primary" size="sm" icon="plus" onClick={create}>{t('Create user')}</Button>
    </div>
  </div>
}

export default function AdminUsers() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [q, setQ] = useState('')

  const loadUsers = () => api('/api/admin/users').then(d => setUsers(d.users)).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length
  const ql = q.trim().toLowerCase()
  const shownUsers = (users || []).filter(u => !ql || u.name.toLowerCase().includes(ql) || (u.email || '').toLowerCase().includes(ql) || (u.employeeTypes || []).some(x => x.includes(ql)))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Users')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · {t('ex {0}/{1}', u.live.exIdx, u.live.exTotal)} · {t('{0}/{1} sets', u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <CreateUserCard reload={loadUsers} />
    <div style={{ marginTop: 14 }}><InvitesCard invites={invites} reload={loadInvites} /></div>

    <h4 className="sec">{t('Users')}</h4>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search name, email or role…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr>
          <th>{t('Name')}</th><th>{t('Email')}</th><th>{t('Roles')}</th><th>{t('Workouts')}</th><th>{t('Last workout')}</th><th>{t('Synced')}</th><th></th>
        </tr></thead>
        <tbody>
          {shownUsers.map(u => (
            <tr key={u.id} className="tap" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .5 } : null}>
              <td>{u.live && <Icon name="dot" style={{ fontSize: 8, color: 'var(--green)', marginRight: 5 }} />}{u.name}</td>
              <td className="dim-cell">{u.email || '—'}</td>
              <td>
                {(u.employeeTypes || []).map(x => <span key={x} className="tag acc" style={{ marginRight: 4 }}>{x}</span>)}
                {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('off')}</span>}
                {!(u.employeeTypes || []).length && !u.disabled && <span className="dim-cell">—</span>}
              </td>
              <td className="dim-cell">{u.live ? t('training now') : u.workouts}</td>
              <td className="dim-cell">{u.lastWorkout ? fmtDate(u.lastWorkout) : '—'}</td>
              <td className="dim-cell">{rel(u.lastSync)}</td>
              <td>{u.hasPush && <Icon name="bell" title={t('push enabled')} style={{ fontSize: 14, color: 'var(--label-3)' }} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {users && !shownUsers.length && <div className="dtable-empty">{q ? t('No users match “{0}”.', q) : t('No users yet.')}</div>}
    </div>
  </div>
}
