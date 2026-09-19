import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { coachBox, coachBoxRoster, coachBoxPlans, coachCreateInvite, coachRevokeInvite, coachAddMember } from '../../lib/api.js'
import { activeBoxColor } from '../../lib/format.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { useRevealPaging } from '../../lib/useRevealPaging.js'
import { assignPlanSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import UserSearch from '../../components/UserSearch.jsx'
import { Button, SearchField } from '../../components/ui.jsx'

const joinUrl = code => `${location.origin}${location.pathname}#/box/join/${code}`

// Bringing athletes in (the invite link) and the roster of who's already in are the same
// audience/job, so they live together here — separate from Staff, which is coaches/helpers only.
export default function CoachBoxAthletes() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [isOwner, setIsOwner] = useState(false)
  const [box, setBox] = useState(null)
  const [roster, setRoster] = useState(null)
  const [plans, setPlans] = useState(null)
  const [invite, setInvite] = useState(null)
  const [search, setSearch] = useState('')

  const load = () => {
    coachBox(boxId).then(r => { setIsOwner(!!r.isOwner); setBox(r.box); setCachedBoxColors(boxId, r.box.colors, r.box.colorsEnabled) }).catch(e => toast(e.message))
    coachBoxRoster(boxId).then(setRoster).catch(e => toast(e.message))
    coachBoxPlans(boxId).then(setPlans).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])
  const planNameFor = id => plans?.find(p => p.id === id)?.name || t('No plan')

  const q = search.trim().toLowerCase()
  const filtered = !roster ? null : !q ? roster : roster.filter(m =>
    m.name.toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q))
  const active7d = roster?.filter(m => m.thisWeek > 0).length ?? 0
  const withPlan = roster?.filter(m => m.planId).length ?? 0
  // A box can have hundreds of members — mounting every row (and every avatar image) at once is
  // what actually made a big roster slow, not the single fetch itself. 30 at a time, more
  // revealed as the sentinel scrolls into view, same mechanism as the social feed.
  const { shown, loadingMore, hasMore, sentinelElRef } = useRevealPaging(filtered, boxId + ':' + q, 30)

  const mintInvite = () => coachCreateInvite(boxId).then(inv => {
    setInvite(inv)
    navigator.clipboard?.writeText(joinUrl(inv.code)).catch(() => {})
    toast(t('Invite link copied'))
  }).catch(e => toast(e.message))
  const copyInvite = () => { navigator.clipboard?.writeText(joinUrl(invite.code)).catch(() => {}); toast(t('Link copied')) }
  const revokeInvite = () => coachRevokeInvite(boxId, invite.code).then(() => { setInvite(null); toast(t('Revoked')) }).catch(e => toast(e.message))
  const addMember = u => coachAddMember(boxId, u.id).then(() => { toast(t('{0} added', u.name)); load() }).catch(e => toast(e.message))

  useBoxAccent(box ? activeBoxColor(box, myTheme) : cachedBoxColor(boxId, myTheme))

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('Athletes')}</h1>
    </div>

    {isOwner && (
      <div className="card" style={{ marginBottom: 16 }}>
        {invite ? (
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <span className="flat-badge" style={{ '--tint': 'var(--acc)', width: 34, height: 34, borderRadius: 10 }}><Icon name="link" /></span>
            <button className="lrow-m invite-copy" onClick={copyInvite}>
              <span className="lrow-t" style={{ fontWeight: 700 }}>{t('Invite link active')}</span>
              <span className="lrow-s">{t('Tap to copy')}</span>
            </button>
            <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={revokeInvite} aria-label={t('Revoke')}><Icon name="xmark" /></button>
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.012em' }}>{t('Invite athletes')}</div>
              <div className="muted small" style={{ marginTop: 2 }}>{t('Not single-use — share this link with your whole box.')}</div>
            </div>
            <Button size="sm" variant="primary" onClick={mintInvite}>{t('Create link')}</Button>
          </div>
        )}
        <div className="muted small" style={{ textAlign: 'center', margin: '14px 0 10px' }}>{t('or add by username')}</div>
        <UserSearch placeholder={t('username')} exclude={(roster || []).map(m => m.id)} onPick={addMember} />
      </div>
    )}

    {!roster ? <div className="muted small">{t('Loading…')}</div> : !roster.length ? (
      <div className="empty"><div className="ico"><Icon name="person" /></div>{t('No members yet.')}</div>
    ) : <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="coach-stats">
          <div className="coach-stat"><div className="n">{roster.length}</div><div className="l">{t('Athletes')}</div></div>
          <div className="coach-vsep" />
          <div className="coach-stat"><div className="n">{active7d}</div><div className="l">{t('Active 7d')}</div></div>
          <div className="coach-vsep" />
          <div className="coach-stat"><div className="n">{withPlan}</div><div className="l">{t('On a plan')}</div></div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <SearchField value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder={t('Search athlete…')} />
      </div>

      {!filtered.length ? (
        <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No matches.')}</div>
      ) : (
        <div className="staff-list">
          {filtered.slice(0, shown).map(m => (
            <div key={m.id} className="lrow">
              <button style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => nav('/coach/box/' + boxId + '/athlete/' + m.id)}>
                <Avatar name={m.name} avatarUrl={m.avatarUrl} size={34} />
                <span className="lrow-m">
                  <span className="lrow-t"><span className={'roster-dot' + (m.thisWeek > 0 ? ' on' : '')} />{m.name}</span>
                  <span className="lrow-s">@{m.username}{m.streakDays > 0 ? ` · ${t('{0} day streak', m.streakDays)}` : ''}</span>
                </span>
              </button>
              <button className={'tag' + (m.planId && !m.planExpired && !m.planInGrace ? ' acc' : '')}
                style={m.planExpired ? { background: 'color-mix(in srgb, var(--red) 18%, transparent)', color: 'var(--red)' }
                  : m.planInGrace ? { background: 'color-mix(in srgb, var(--orange) 18%, transparent)', color: 'var(--orange)' } : undefined}
                onClick={() => assignPlanSheet(box, m, plans || [], m.planId, load)}>
                {m.planExpired ? t('Expired') : m.planInGrace ? t('Renew soon') : planNameFor(m.planId)}
              </button>
            </div>
          ))}
          {loadingMore && <div className="muted small" style={{ textAlign: 'center', padding: '10px 0' }}>{t('Loading…')}</div>}
          {hasMore && <div ref={sentinelElRef} style={{ height: 1 }} />}
        </div>
      )}
    </>}
  </div>
}
