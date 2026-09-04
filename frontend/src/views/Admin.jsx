import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

// Admin-only landing page — a map of sections, same idiom as Settings.jsx's tile grid.
function Tile({ icon, tint, title, subtitle, full, onClick }) {
  return (
    <button className="settings-tile" style={{ '--tint': tint, ...(full ? { gridColumn: '1 / -1' } : {}) }} onClick={onClick}>
      <span className="ico"><Icon name={icon} /></span>
      <div><div className="t">{title}</div><div className="s">{subtitle}</div></div>
    </button>
  )
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  if (!user?.admin) return null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin panel')}</h1></div>
    </div>

    <div className="settings-grid">
      <Tile icon="personCircle" tint="var(--blue)" title={t('Users')} subtitle={t('Accounts, roles, invites')}
        onClick={() => nav('/admin/users')} />
      <Tile icon="checkCircle" tint="var(--green)" title={t('Daily tasks')} subtitle={t('XP criteria')}
        onClick={() => nav('/admin/tasks')} />
      <Tile icon="dumbbell" tint="var(--acc)" title={t('Exercises')} subtitle={t('Rename catalogue entries')}
        onClick={() => nav('/admin/exercises')} />
      <Tile icon="target" tint="var(--blue)" title={t('Muscle groups')} subtitle={t('Custom groupings of exercises')}
        onClick={() => nav('/admin/muscle-groups')} />
      <Tile icon="flame" tint="var(--orange)" title={t('Streak tiers')} subtitle={t('Badge day thresholds')}
        onClick={() => nav('/admin/streaks')} />
      <Tile icon="sparkles" tint="var(--acc)" title={t('Alpha requests')} subtitle={t('Access requests from the landing page')} full
        onClick={() => nav('/admin/alpha')} />
      <Tile icon="flag" tint="var(--red)" title={t('Bug reports')} subtitle={t('What users flagged from Settings')} full
        onClick={() => nav('/admin/bugs')} />
      <Tile icon="warnTriangle" tint="var(--orange)" title={t('Fair play')} subtitle={t('Anti-cheat penalties and appeals')} full
        onClick={() => nav('/admin/anticheat')} />
      <Tile icon="clipboard" tint="var(--grey)" title={t('Activity log')} subtitle={t('Sign-ins, admin actions')} full
        onClick={() => nav('/admin/log')} />
    </div>
  </div>
}
