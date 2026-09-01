import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'

// A map of categories, not a single long scroll — each tile opens its own focused
// sub-page under views/settings/. Direction the user picked after 3 sketched options;
// solves "I don't know where to grab hold of it" by giving every setting a named,
// visible home instead of one undifferentiated list.
function Tile({ icon, tint, title, subtitle, badge, onClick }) {
  return (
    <button className="settings-tile" style={{ '--tint': tint }} onClick={onClick}>
      {badge && <span className="badge">{badge}</span>}
      <span className="ico"><Icon name={icon} /></span>
      <div><div className="t">{title}</div><div className="s">{subtitle}</div></div>
    </button>
  )
}

export default function Settings() {
  const nav = useNavigate()
  const user = useStore(s => s.user)

  const showProfile = user && !DEMO && !MOBILE
  const showNotifications = user || MOBILE

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Settings')}</h1></div>
    </div>

    <div className="settings-grid">
      <Tile icon="personCircle" tint="var(--blue)" title={t('Account')}
        subtitle={MOBILE ? t('About this app') : DEMO ? t('Demo') : t('Sign-in, username, sessions')}
        onClick={() => nav('/settings/account')} />
      {showProfile && (
        <Tile icon="sparkles" tint="var(--purple)" title={t('Profile')} subtitle={t('Bio, badges')}
          onClick={() => nav('/settings/profile')} />
      )}
      {user && (
        <Tile icon="medal" tint="var(--yellow)" title={t('Level & Prestige')} subtitle={t('Tier progress, perks')}
          onClick={() => nav('/rank')} />
      )}
      <Tile icon="dumbbell" tint="var(--orange)" title={t('Workout')} subtitle={t('Rest timer, sounds, units')}
        onClick={() => nav('/settings/workout')} />
      <Tile icon="moon" tint="var(--indigo)" title={t('Appearance')} subtitle={t('Theme, accent color')}
        onClick={() => nav('/settings/appearance')} />
      {showNotifications && (
        <Tile icon="bell" tint="var(--red)" title={t('Notifications')} subtitle={t('Push alerts, reminders')}
          onClick={() => nav('/settings/notifications')} />
      )}
      <Tile icon="folder" tint="var(--teal)" title={t('Data')} subtitle={t('Backup, import, reset')}
        onClick={() => nav('/settings/data')} />
      {!MOBILE && (
        <Tile icon="download" tint="var(--green)" title={t('Mobile app')} subtitle={t('Get it for Android')}
          onClick={() => nav('/settings/mobile-app')} />
      )}
      {user && (
        <Tile icon="info" tint="var(--grey)" title={t('How it works')} subtitle={t('Rank, prestige, penalties')}
          onClick={() => nav('/settings/fair-play')} />
      )}
    </div>

    {user?.admin && (
      <div className="item" onClick={() => nav('/admin')}>
        <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="wrench" /></span>
        <div className="grow"><div className="tt">{t('Admin dashboard')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    )}
  </div>
}
