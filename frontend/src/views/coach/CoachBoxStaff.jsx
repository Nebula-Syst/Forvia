import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { coachBox, coachBoxStaff, coachAddStaff, coachRemoveStaff } from '../../lib/api.js'
import { activeBoxColor } from '../../lib/format.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import UserSearch from '../../components/UserSearch.jsx'

// Coaches/helpers only — inviting athletes is a separate job and lives on the Athletes screen
// instead (CoachBoxAthletes.jsx). Two separate cards, not one with an internal divider — "add
// someone" and "who's already here" are different jobs, and a thin line inside one box still
// reads as a single crowded block; a real gap between two cards reads as two things at a glance.
export default function CoachBoxStaff() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [box, setBox] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [staff, setStaff] = useState(null)

  const load = () => {
    coachBox(boxId).then(r => { setBox(r.box); setIsOwner(!!r.isOwner); setCachedBoxColors(boxId, r.box.colors, r.box.colorsEnabled) }).catch(e => toast(e.message))
    coachBoxStaff(boxId).then(setStaff).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])

  const addStaff = u => coachAddStaff(boxId, u.id).then(() => { toast(t('{0} added as staff', u.name)); load() }).catch(e => toast(e.message))
  const removeStaff = u => coachRemoveStaff(boxId, u.id).then(() => { toast(t('Removed from staff')); load() }).catch(e => toast(e.message))

  useBoxAccent(box ? activeBoxColor(box, myTheme) : cachedBoxColor(boxId, myTheme))

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('Staff')}</h1>
    </div>

    {!box ? <div className="muted small" style={{ margin: '0 2px' }}>{t('Loading…')}</div> : isOwner && <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-eyebrow">
          <span className="flat-badge" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name="person" /></span>
          <span className="t">{t('Add a coach or helper')}</span>
        </div>
        <UserSearch placeholder={t('username')} exclude={(staff || []).map(s => s.id).concat(box.coachId)} onPick={addStaff} />
        <p className="muted small" style={{ margin: '10px 2px 0' }}>{t('Staff can manage the roster and routines, but can’t remove members or manage invites.')}</p>
      </div>

      <div className="card">
        {!staff?.length ? (
          <div className="empty" style={{ padding: '10px 0' }}>
            <div className="ico"><Icon name="person" /></div>
            {t('No staff yet — search a username above to add one.')}
          </div>
        ) : (
          <div className="staff-list">
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
      </div>
    </>}
  </div>
}
