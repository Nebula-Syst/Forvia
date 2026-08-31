import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'

// Admin-only landing page — a map of sections, same idiom as Settings.jsx's tile grid.
// Deliberately English-only — it isn't part of the translated end-user surface.
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
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Admin panel</h1></div>
    </div>

    <div className="settings-grid">
      <Tile icon="personCircle" tint="var(--blue)" title="Users" subtitle="Accounts, roles, invites"
        onClick={() => nav('/admin/users')} />
      <Tile icon="checkCircle" tint="var(--green)" title="Daily tasks" subtitle="XP criteria"
        onClick={() => nav('/admin/tasks')} />
      <Tile icon="clipboard" tint="var(--grey)" title="Activity log" subtitle="Sign-ins, admin actions" full
        onClick={() => nav('/admin/log')} />
    </div>
  </div>
}
