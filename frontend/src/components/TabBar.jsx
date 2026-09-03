import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'plan' && k === 'home') || (cur === 'library' && k === 'home')
  const paused = !!S.active?.paused

  // With no session this starts one (or jumps to /workout to choose). Once a session
  // is running the button becomes the session's transport control (tap to pause, tap
  // again to resume) — but only while already on the workout screen. From anywhere
  // else the first tap just gets you there, so it can't be paused by accident from
  // e.g. Home.
  const centerTap = () => {
    if (S.active) {
      if (cur !== 'workout') { nav('/workout'); return }
      update(s => { s.active.paused = !s.active.paused }); return
    }
    const r = effectiveRoutine(S, todayISO())
    if (r && r.ex.length) { onStart(r.id); return }
    nav('/workout')
  }
  const centerCls = S.active ? (paused ? ' paused' : ' rec') : ''
  const centerIcon = S.active ? (paused ? 'play' : 'pause') : 'dumbbell'
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return <>
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <button className={'start' + centerCls} onClick={centerTap}>
        <span className="cir"><Icon name={centerIcon} /></span>
        <span>{S.active ? (paused ? t('Resume') : t('Pause')) : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>

    {/* Desktop replacement for #tabbar (CSS swaps them at the ≥1000px breakpoint) —
        same routes and the same centerTap(), laid out as a fixed left rail. */}
    <nav id="sidenav">
      <div className="brand" onClick={() => nav('/home')}>
        <span className="mark"><img src="/icon-512.png" alt="" /></span>
        <span>Forvia</span>
      </div>
      <button className={'sidestart' + centerCls} onClick={centerTap}>
        <Icon name={centerIcon} />
        <span>{S.active ? (paused ? t('Resume workout') : t('Pause workout')) : t('Start workout')}</span>
      </button>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>
  </>
}
