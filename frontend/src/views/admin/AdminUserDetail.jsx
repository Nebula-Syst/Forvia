import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api, adminSetEmployeeTypes, adminUserLevel, adminUserPrestige, adminUserStreak, adminUserPro, adminUserEdit, adminUserProfile, adminUserDelete, adminUserRestore, adminUserResetPassword } from '../../lib/api.js'
import { fmtDate, fmtVol, fmtDur } from '../../lib/format.js'
import { workoutVolume, setsDone, streakDays } from '../../lib/history.js'
import { confirmSheet } from '../../sheets.jsx'
import { tierFor } from '../../lib/rank.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import RankIcon from '../../components/RankIcon.jsx'
import { Switch } from '../../components/ui.jsx'

// Admin-only. The full-page replacement for the old UserDetail sheet (AdminUsers.jsx) — same
// data, same actions, plus direct editing of the profile fields and the two account-state
// actions (suspend, soft-delete) that sheet never had room for. Direction "A" from the approved
// mockup: one wide column, hero card first, danger zone last.

const EMPLOYEE_TYPES = ['founder', 'admin']

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}

// Same self-save-on-blur shape as SettingsAccount.jsx's own Field — this is the admin-editing
// equivalent, just posting to adminUserEdit/adminUserProfile for a target id instead of the
// self-service account routes.
function EditField({ label, value, onSave, placeholder, type = 'text', hint }) {
  const [v, setV] = useState(value || '')
  const [err, setErr] = useState('')
  useEffect(() => { setV(value || '') }, [value])
  const commit = async () => {
    if (v === (value || '')) return
    try { await onSave(v.trim()); setErr('') }
    catch (e) { setErr(e.message || t('Could not save')); setV(value || '') }
  }
  return (
    <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
      <span className="lrow-t">{label}</span>
      <input className="input" type={type} value={v} placeholder={placeholder}
        onChange={e => { setV(e.target.value); setErr('') }} onBlur={commit} />
      {err ? <span className="small" style={{ color: 'var(--red)' }}>{err}</span>
        : hint ? <span className="small dim">{hint}</span> : null}
    </div>
  )
}

export default function AdminUserDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  // Two backend services answer this drill-down — forvia-core owns identity/training data
  // (GET /api/admin/user), Nebula's own half (rank/perks/badges/pro/streakBonus/bio/public)
  // lives at a second path (GET /api/admin/user/nebula). Merged here, same as lib/api.js's
  // fetchMe() already merges GET /api/me for the signed-in user's own profile.
  const load = () => Promise.all([
    api('/api/admin/user?id=' + encodeURIComponent(id)),
    api('/api/admin/user/nebula?id=' + encodeURIComponent(id)).catch(() => ({ user: {} })),
  ]).then(([core, nebula]) => setD({ ...core, user: { ...core.user, ...nebula.user } }))
    .catch(e => { toast(e.message); nav('/admin/users') })
  useEffect(() => { load() }, [id])

  if (!d) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/admin/users')} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div>
    <div className="muted small" style={{ padding: '0 16px' }}>{t('Loading…')}</div>
  </div>

  const u = d.user
  const realStreak = streakDays({ workouts: d.workouts || [] })
  const rank = u.rank || {}
  const tier = tierFor(rank.level || 1)
  const pct = rank.xpForLevel ? Math.max(2, Math.min(100, Math.round((rank.xpInLevel / rank.xpForLevel) * 100))) : 0

  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); load() })
      .catch(e => toast(e.message))
  }
  const toggleEmployeeType = type => {
    const cur = u.employeeTypes || []
    const next = cur.includes(type) ? cur.filter(x => x !== type) : [...cur, type]
    adminSetEmployeeTypes(u.id, next).then(() => { toast(t('Updated')); load() }).catch(e => toast(e.message))
  }
  const nudgeLevel = delta => { setBusy(true); adminUserLevel(u.id, delta).then(load).catch(e => toast(e.message)).finally(() => setBusy(false)) }
  // Same bypass relationship to POST /api/prestige that nudging level above has to earning XP
  // normally — the real "Upgrade mastery" button only ever fires at level 100.
  const nudgePrestige = delta => { setBusy(true); adminUserPrestige(u.id, delta).then(load).catch(e => toast(e.message)).finally(() => setBusy(false)) }
  // Unlike level/prestige there's no real "streak" stored anywhere to nudge — it's always
  // recomputed client-side from workout history. This adjusts streakBonus on top of that.
  const nudgeStreak = delta => { setBusy(true); adminUserStreak(u.id, delta).then(load).catch(e => toast(e.message)).finally(() => setBusy(false)) }
  // No billing yet — this is the only way an account becomes Pro for now.
  const togglePro = () => { setBusy(true); adminUserPro(u.id).then(load).catch(e => toast(e.message)).finally(() => setBusy(false)) }
  const editField = patch => adminUserEdit(u.id, patch).then(load)
  const editProfile = patch => adminUserProfile(u.id, patch).then(load).catch(e => toast(e.message))

  const doSuspend = () => confirmSheet({
    title: t('Disable {0}?', u.name),
    message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'),
    confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true),
  })
  const doDelete = () => confirmSheet({
    title: t('Delete {0}?', u.name),
    message: t("Locks them out immediately, same as disabling. Their data isn't touched — this can be undone from here for as long as nobody removes it by hand."),
    confirmText: t('Delete account'), danger: true,
    onConfirm: () => adminUserDelete(u.id).then(() => { toast(t('Account deleted')); load() }).catch(e => toast(e.message)),
  })
  const doRestore = () => adminUserRestore(u.id).then(() => { toast(t('Account restored')); load() }).catch(e => toast(e.message))
  // The only account-recovery path on an instance with no SMTP configured (forgot-password
  // can't email a link there) — reported missing alongside the self-service flow. The new
  // password is shown exactly once, copied to the clipboard for relaying to the account
  // holder out of band, and never stored or displayed again after this.
  const doResetPassword = () => confirmSheet({
    title: t('Reset {0}’s password?', u.name),
    message: t('Generates a new password and signs them out everywhere. You’ll see it once here to pass on to them.'),
    confirmText: t('Reset password'), danger: true,
    onConfirm: () => adminUserResetPassword(u.id).then(pw => {
      navigator.clipboard?.writeText(pw).catch(() => {})
      toast(t('New password (copied): {0}', pw))
    }).catch(e => toast(e.message)),
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin/users')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <div className="small muted">{t('Users')}</div>
        <h1 style={{ margin: 0, fontSize: '1.1rem' }}>{t('User profile')}</h1>
      </div>
    </div>

    {/* hero */}
    <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
      <Avatar name={u.name} avatarUrl={u.avatarUrl} size={72} fontSize={25} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <h2 className="capitalize" style={{ margin: '0 0 2px', fontSize: '1.25rem' }}>{u.name}</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>{u.email || '—'}</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(u.employeeTypes || []).map(x => <span key={x} className="tag acc">{x}</span>)}
          {u.pro && <span className="tag acc">{t('Pro')}</span>}
          <span className="tag">{u.public ? t('public profile') : t('private profile')}</span>
          {u.disabled && !u.deleted && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
          {u.deleted && <span className="tag" style={{ color: 'var(--red)' }}>{t('deleted')}</span>}
          {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
          <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
        </div>
      </div>
      {!u.admin && !u.deleted && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <Switch checked={!u.disabled} onChange={active => active ? setDisabled(false) : doSuspend()} />
          <div className="small dim">{u.disabled ? t('Suspended') : t('Active')}</div>
        </div>
      )}
    </div>

    {/* rank */}
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 12 }}>
          <RankIcon tier={tier.name} size={40} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>{t('Level {0}', rank.level)} · {tier.name}{rank.prestige > 0 ? ` · ${t('Prestige {0}', rank.prestige)}` : ''}</div>
            <div className="dim small">{t('{0}/{1} XP this level · {2} total', rank.xpInLevel, rank.xpForLevel, rank.totalXp)}{u.adminXpAdjust ? ` (${u.adminXpAdjust > 0 ? '+' : ''}${u.adminXpAdjust} ${t('admin adjust')})` : ''}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" disabled={busy || rank.level <= 1} onClick={() => nudgeLevel(-1)} aria-label={t('level down')}><Icon name="minus" /></button>
          <button className="iconbtn" disabled={busy || rank.level >= 100} onClick={() => nudgeLevel(1)} aria-label={t('level up')}><Icon name="plus" /></button>
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: '100%', width: pct + '%', borderRadius: 999, background: 'var(--acc)' }} />
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row between" style={{ flex: 1, minWidth: 200, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 12 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t('Prestige {0}', rank.prestige || 0)}</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" style={{ width: 26, height: 26 }} disabled={busy || (rank.prestige || 0) <= 0} onClick={() => nudgePrestige(-1)} aria-label={t('prestige down')}><Icon name="minus" /></button>
            <button className="iconbtn" style={{ width: 26, height: 26 }} disabled={busy} onClick={() => nudgePrestige(1)} aria-label={t('prestige up')}><Icon name="plus" /></button>
          </div>
        </div>
        <div className="row between" style={{ flex: 1, minWidth: 200, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 12 }}>
          <div>
            <div className="small" style={{ fontWeight: 600 }}>{t('Streak days: {0}', realStreak + (u.streakBonus || 0))}</div>
            {!!u.streakBonus && <div className="dim" style={{ fontSize: '.72rem' }}>{t('{0} from workouts, {1} admin-added', realStreak, u.streakBonus)}</div>}
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" style={{ width: 26, height: 26 }} disabled={busy} onClick={() => nudgeStreak(-1)} aria-label={t('streak down')}><Icon name="minus" /></button>
            <button className="iconbtn" style={{ width: 26, height: 26 }} disabled={busy} onClick={() => nudgeStreak(1)} aria-label={t('streak up')}><Icon name="plus" /></button>
          </div>
        </div>
      </div>
    </div>

    {/* editable profile data */}
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>{t('Profile data')}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '0 16px' }}>
        <EditField label={t('First name')} value={u.firstName} onSave={v => editField({ firstName: v, lastName: u.lastName || '' })} />
        <EditField label={t('Last name')} value={u.lastName} onSave={v => editField({ firstName: u.firstName || '', lastName: v })} />
        <EditField label={t('Username')} value={u.username} placeholder={t('your_handle')} onSave={v => editField({ username: v })}
          hint={t('Letters, numbers, underscore, 3–20 characters — or leave blank to clear it.')} />
        <EditField label={t('Phone')} value={u.phone} placeholder={t('Not set')} onSave={v => editField({ phone: v })} />
        <div style={{ gridColumn: '1 / -1' }}>
          <EditField label={t('Email')} value={u.email} type="email" onSave={v => editField({ email: v })}
            hint={u.emailVerified ? t('Verified') : t('Not verified')} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <EditField label={t('Bio')} value={u.bio} placeholder={t('No bio')} onSave={v => editProfile({ bio: v })} />
        </div>
      </div>
      <div className="row between" style={{ padding: '4px 2px' }}>
        <span className="small" style={{ fontWeight: 600 }}>{t('Public profile')}</span>
        <Switch checked={!!u.public} onChange={v => editProfile({ public: v })} />
      </div>
    </div>

    {/* admin & access */}
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '.95rem' }}>{t('Admin & access')}</h3>
      <div className="row between" style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 12 }}>
        <span className="small" style={{ fontWeight: 600 }}>{t('Pro subscription')}</span>
        <button className={'chip' + (u.pro ? ' on' : '')} disabled={busy} onClick={togglePro}>{u.pro ? t('Pro') : t('Free')}</button>
      </div>
      <div className="tiles" style={{ textAlign: 'left', marginBottom: 12 }}>
        <div className="tile"><div className="l">{t('Custom foods')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.customFoodsCount}{!u.pro ? '/5' : ''}</div></div>
        <div className="tile"><div className="l">{t('Saved meals')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.savedMealsCount}{!u.pro ? '/5' : ''}</div></div>
        <div className="tile"><div className="l">{t('Custom exercises')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.customExCount}{!u.pro ? '/5' : ''}</div></div>
      </div>
      <div className="small muted" style={{ margin: '0 0 6px' }}>{t('Employee types')}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {EMPLOYEE_TYPES.map(x => <button key={x} className={'chip' + ((u.employeeTypes || []).includes(x) ? ' on' : '')} onClick={() => toggleEmployeeType(x)}>{x}</button>)}
      </div>
    </div>

    {/* stats */}
    <div className="tiles" style={{ textAlign: 'left', marginTop: 14 }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>

    {/* danger zone */}
    {!u.admin && (
      <div className="card" style={{ marginTop: 14, background: 'color-mix(in srgb,var(--red) 10%,var(--surface))', border: '1px solid color-mix(in srgb,var(--red) 32%,transparent)' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '.95rem', color: 'var(--red)' }}>{t('Danger zone')}</h3>
        <div className="row between" style={{ gap: 14, flexWrap: 'wrap', paddingBottom: 14, borderBottom: '1px solid color-mix(in srgb,var(--red) 22%,transparent)', marginBottom: 14 }}>
          <div style={{ maxWidth: 440 }}>
            <div className="small" style={{ fontWeight: 600 }}>{u.disabled ? t('Re-enable account') : t('Suspend account')}</div>
            <div className="dim small">{u.disabled ? t('Lets them sign in and sync again.') : t('They are signed out everywhere and can no longer sync or log in until re-enabled.')}</div>
          </div>
          <button className="btn danger sm" onClick={() => u.disabled ? setDisabled(false) : doSuspend()}>{u.disabled ? t('Re-enable') : t('Suspend')}</button>
        </div>
        {!u.deleted && <div className="row between" style={{ gap: 14, flexWrap: 'wrap', paddingBottom: 14, borderBottom: '1px solid color-mix(in srgb,var(--red) 22%,transparent)', marginBottom: 14 }}>
          <div style={{ maxWidth: 440 }}>
            <div className="small" style={{ fontWeight: 600 }}>{t('Reset password')}</div>
            <div className="dim small">{t("For when they can't get back in on their own — generates a new password and signs them out everywhere.")}</div>
          </div>
          <button className="btn danger sm" onClick={doResetPassword}>{t('Reset password')}</button>
        </div>}
        <div className="row between" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 440 }}>
            <div className="small" style={{ fontWeight: 600 }}>{u.deleted ? t('Restore account') : t('Delete account')}</div>
            <div className="dim small">{u.deleted ? t('Undoes the delete — signs them back in normally.') : t('Locks them out immediately. Recoverable from here for now, but treat it as permanent.')}</div>
          </div>
          <button className="btn danger sm" onClick={() => u.deleted ? doRestore() : doDelete()}>{u.deleted ? t('Restore') : t('Delete account…')}</button>
        </div>
      </div>
    )}

    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </div>
}
