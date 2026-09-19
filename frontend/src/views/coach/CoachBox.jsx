import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { coachBox } from '../../lib/api.js'
import { activeBoxColor } from '../../lib/format.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'

// Pure directory: header + a grid of cards — each opens its own screen (About/Classes/Plan/
// Staff/Athletes), same as tapping any other nav row in the app. No inline content, no accordion
// state; that all lives on the sub-screens now (CoachBoxAbout/CoachBoxPlans/CoachBoxStaff/
// CoachBoxAthletes/CoachClasses). The cover image used to live here too, but editing it from a
// tap on the image wasn't discoverable/working well — dropped in favor of this 5th card instead;
// the image itself is still editable from inside "About this box" (CoachBoxAbout.jsx, inline).
export default function CoachBox() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [box, setBox] = useState(null)
  const [isOwner, setIsOwner] = useState(false)

  const load = () => coachBox(boxId).then(r => { setBox(r.box); setIsOwner(!!r.isOwner); setCachedBoxColors(boxId, r.box.colors, r.box.colorsEnabled) }).catch(e => toast(e.message))
  useEffect(() => { load() }, [boxId])
  useBoxAccent(box ? activeBoxColor(box, myTheme) : cachedBoxColor(boxId, myTheme))

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="row" style={{ justifyContent: 'center', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <h1 className="hdr-sub" style={{ margin: 0 }}>{box?.title || ''}</h1>
        {box && !isOwner && <span className="role-tag" style={{ flexShrink: 0 }}>{t('Staff')}</span>}
      </div>
    </div>

    {!box ? <div className="muted small" style={{ margin: '0 2px' }}>{t('Loading…')}</div> : (
    <div className="box-menu-grid">
      <button className="box-menu-card" onClick={() => nav('/coach/box/' + boxId + '/about')}>
        <span className="flat-badge"><Icon name="shield" /></span>
        <span className="tt">{t('About this box')}</span>
        <span className="ss">{t('Location and description')}</span>
      </button>

      <button className="box-menu-card" onClick={() => nav('/coach/box/' + boxId + '/classes')}>
        <span className="flat-badge"><Icon name="calendar" /></span>
        <span className="tt">{t('Classes')}</span>
        <span className="ss">{t('Schedule and bookings')}</span>
      </button>

      <button className="box-menu-card" onClick={() => nav('/coach/box/' + boxId + '/plans')}>
        <span className="flat-badge"><Icon name="list" /></span>
        <span className="tt">{t('Membership plans')}</span>
        <span className="ss">{t('Pricing and limits')}</span>
      </button>

      <button className="box-menu-card" onClick={() => nav('/coach/box/' + boxId + '/athletes')}>
        <span className="flat-badge"><Icon name="figureRun" /></span>
        <span className="tt">{t('Athletes')}</span>
        <span className="ss">{t('Roster and progress')}</span>
      </button>

      {isOwner && (
        <button className="box-menu-card" onClick={() => nav('/coach/box/' + boxId + '/staff')}>
          <span className="flat-badge"><Icon name="person" /></span>
          <span className="tt">{t('Staff')}</span>
          <span className="ss">{t('Invite and manage')}</span>
        </button>
      )}
    </div>
    )}
  </div>
}
