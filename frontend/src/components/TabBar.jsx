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
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'plan' && k === 'home') || (cur === 'library' && k === 'home')

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return <>
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>

    {/* Desktop replacement for #tabbar (CSS swaps them at the ≥1000px breakpoint) —
        same routes and the same startWorkout(), laid out as a fixed left rail. */}
    <nav id="sidenav">
      <div className="brand" onClick={() => nav('/home')}>
        <span className="mark"><Icon name="dumbbell" /></span>
        <span>Forvia</span>
      </div>
      <button className={'sidestart' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <Icon name={S.active ? 'play' : 'dumbbell'} />
        <span>{S.active ? t('Resume workout') : t('Start workout')}</span>
      </button>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>
  </>
}
