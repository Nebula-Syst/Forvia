import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import {
  coachBox, coachCreateInvite, coachRevokeInvite,
  boxImageUrl, coachBoxStaff, coachAddStaff, coachRemoveStaff,
} from '../../lib/api.js'
import { editBoxSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import UserSearch from '../../components/UserSearch.jsx'
import { Button } from '../../components/ui.jsx'

const joinUrl = code => `${location.origin}${location.pathname}#/box/join/${code}`

// "Tarjeta única" direction picked from 2 sketched on the design canvas: location, description
// and invite live in one hero card, staff in a second card below. Roster/athletes and
// WOD-of-the-day + leaderboard are deliberately not on this screen — pulled out for a rework,
// not deleted (api/server.js's data and endpoints for all of it are untouched).
export default function CoachBox() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [box, setBox] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [invite, setInvite] = useState(null)
  const [staff, setStaff] = useState(null)

  const load = () => {
    coachBox(boxId).then(r => { setBox(r.box); setIsOwner(!!r.isOwner) }).catch(e => toast(e.message))
    coachBoxStaff(boxId).then(setStaff).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])

  // Mint-and-copy in one tap, same idiom as every other invite link in the app (Admin's alpha/
  // user invites) — nobody actually wants to see the raw URL, they want it on their clipboard.
  const mintInvite = () => coachCreateInvite(boxId).then(inv => {
    setInvite(inv)
    navigator.clipboard?.writeText(joinUrl(inv.code)).catch(() => {})
    toast(t('Invite link copied'))
  }).catch(e => toast(e.message))
  const copyInvite = () => { navigator.clipboard?.writeText(joinUrl(invite.code)).catch(() => {}); toast(t('Link copied')) }
  const revokeInvite = () => coachRevokeInvite(boxId, invite.code).then(() => { setInvite(null); toast(t('Revoked')) }).catch(e => toast(e.message))
  const addStaff = u => coachAddStaff(boxId, u.id).then(() => { toast(t('{0} added as staff', u.name)); load() }).catch(e => toast(e.message))
  const removeStaff = u => coachRemoveStaff(boxId, u.id).then(() => { toast(t('Removed from staff')); load() }).catch(e => toast(e.message))

  if (!box) return <div className="narrow"><div className="muted">{t('Loading…')}</div></div>

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1 style={{ margin: 0 }}>{box.title}</h1>
        {!isOwner && <span className="role-tag" style={{ marginTop: 4 }}>{t('Staff')}</span>}
      </div>
      {isOwner && <button className="iconbtn" onClick={() => editBoxSheet(box, load)} aria-label={t('Edit box')}><Icon name="pencil" /></button>}
    </div>

    {box.imageFile && <img src={boxImageUrl(box.id)} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 'var(--r-card)', marginBottom: 16 }} />}

    <div className="card">
      <div className="card-eyebrow">
        <span className="flat-badge" style={{ '--tint': 'var(--indigo)', width: 34, height: 34, borderRadius: 10 }}><Icon name="shield" /></span>
        <span className="t">{t('About this box')}</span>
      </div>
      {box.location?.label && <div className="box-loc" style={{ marginBottom: 6 }}><Icon name="pin" className="icn" />{box.location.label}</div>}
      {box.description && <p className="sub" style={{ margin: 0 }}>{box.description}</p>}

      <div className="divider" />

      {isOwner ? (
        invite ? (
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
        )
      ) : (
        <div className="muted small">{t('Ask the box owner for an invite link.')}</div>
      )}

      <div className="divider" />

      <button className="row invite-copy" style={{ alignItems: 'center', gap: 12, width: '100%' }} onClick={() => nav('/coach/box/' + boxId + '/classes')}>
        <span className="flat-badge" style={{ '--tint': 'var(--teal)', width: 34, height: 34, borderRadius: 10 }}><Icon name="calendar" /></span>
        <span className="lrow-m" style={{ flex: 1 }}>
          <span className="lrow-t" style={{ fontWeight: 700 }}>{t('Classes')}</span>
          <span className="lrow-s">{t('Weekly schedule, bookings, attendance')}</span>
        </span>
        <Icon name="chevronRight" className="lrow-c" />
      </button>
    </div>

    {isOwner && (
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-eyebrow">
          <span className="flat-badge" style={{ '--tint': 'var(--purple)', width: 34, height: 34, borderRadius: 10 }}><Icon name="person" /></span>
          <span className="t">{t('Staff')}</span>
        </div>
        <UserSearch placeholder={t('username')} exclude={(staff || []).map(s => s.id).concat(box.coachId)} onPick={addStaff} />
        {!!staff?.length && (
          <div className="staff-list" style={{ marginTop: 12 }}>
            {staff.map(s => (
              <div key={s.id} className="lrow">
                <Avatar name={s.name} avatarUrl={s.avatarUrl} size={34} />
                <span className="lrow-m">
                  <span className="lrow-t">{s.name}</span>
                  <span className="lrow-s">@{s.username}</span>
                </span>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)' }} onClick={() => removeStaff(s)} aria-label={t('remove')}><Icon name="xmark" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>{t('Staff can manage the roster and routines, but can’t remove members or manage invites.')}</p>
      </div>
    )}
  </div>
}
