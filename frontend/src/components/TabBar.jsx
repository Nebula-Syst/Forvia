import { useEffect, useState } from 'react'
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
  // Collapsed by default: one round button. Tapping it while idle opens a small speed-dial
  // — the button itself becomes a cancel/close circle, and two option pills (workout,
  // food) fan out above it. Tapping cancel/the scrim closes it with the normal grow/shrink
  // animation; a route change (tapping one of the two pills, or any other nav) closes it
  // instantly instead — the page underneath has already swapped by the time a `--fast`
  // transition would finish, so animating it only leaves the pill visibly floating over
  // content on the new screen for a beat (issue: an option pill briefly overlapping a
  // button on /workout after tapping it). `instant` disables the transition for exactly
  // one frame so the close still happens, just without the travel.
  const [expanded, setExpanded] = useState(false)
  const [instant, setInstant] = useState(false)
  useEffect(() => {
    setInstant(true)
    setExpanded(false)
    const id = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(id)
  }, [loc.pathname])
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'plan' && k === 'home') || (cur === 'library' && k === 'home')
  const paused = !!S.active?.paused

  const startWorkout = () => {
    const r = effectiveRoutine(S, todayISO())
    if (r && r.ex.length) { onStart(r.id); return }
    nav('/workout')
  }
  // Once a session is running the button skips the speed-dial entirely and goes straight
  // back to being the session's transport control (tap to pause, tap again to resume) —
  // but only while already on the workout screen. From anywhere else the first tap just
  // gets you there, so it can't be paused by accident from e.g. Home. No food option
  // mid-workout either way — sidenavTap below mirrors this for the desktop rail, which
  // has no speed-dial (its two actions are separate, always-visible buttons instead).
  const centerTap = () => {
    if (S.active) {
      if (cur !== 'workout') { nav('/workout'); return }
      update(s => { s.active.paused = !s.active.paused }); return
    }
    setExpanded(e => !e)
  }
  const sidenavTap = () => {
    if (S.active) {
      if (cur !== 'workout') { nav('/workout'); return }
      update(s => { s.active.paused = !s.active.paused }); return
    }
    startWorkout()
  }
  // The fab's "Workout" pill always opens the routine picker (/workout, with its own
  // routine list and the two start buttons there) rather than auto-starting today's
  // routine like the desktop rail's direct button (startWorkout/sidenavTap) does — from
  // a menu the user just chose to open, jumping straight into a session without a chance
  // to pick would be surprising.
  const goWorkout = () => { setExpanded(false); nav('/workout') }
  const logFood = () => { setExpanded(false); nav('/nutrition') }
  const centerCls = (S.active ? (paused ? ' paused' : ' rec') : (expanded ? ' expanded' : '')) + (instant ? ' instant' : '')
  // Idle + collapsed shows a neutral "+" rather than the dumbbell — the dumbbell now
  // belongs to just one of the two things this opens (see `.opt.workout` below), so the
  // resting icon can't point at either specifically.
  const centerIcon = S.active ? (paused ? 'play' : 'pause') : (expanded ? 'xmark' : 'plus')
  const centerLabel = S.active ? (paused ? t('Resume workout') : t('Pause workout')) : (expanded ? t('Close') : t('Workout options'))
  const sidenavIcon = S.active ? (paused ? 'play' : 'pause') : 'dumbbell'
  const sidenavLabel = S.active ? (paused ? t('Resume workout') : t('Pause workout')) : t('Start workout')
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return <>
    {expanded && !S.active && <div className="fab-scrim" onClick={() => setExpanded(false)} />}
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <div className={'startfab' + centerCls}>
        <div className="optrow">
          <button className="opt workout" onClick={goWorkout} aria-label={t('Start workout')} tabIndex={expanded ? 0 : -1}><span>{t('Workout')}</span></button>
          <button className="opt food" onClick={logFood} aria-label={t('Log food')} tabIndex={expanded ? 0 : -1}><span>{t('Nutrition')}</span></button>
        </div>
        <button className="main" onClick={centerTap} aria-label={centerLabel}><Icon name={centerIcon} /></button>
      </div>
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>

    {/* Desktop replacement for #tabbar (CSS swaps them at the ≥1000px breakpoint) —
        same routes, laid out as a fixed left rail. Two separate always-visible buttons
        (sidenavTap direct, no speed-dial) rather than the mobile fab's expand step —
        there's no cramped-width problem to solve here. */}
    <nav id="sidenav">
      <div className="brand" onClick={() => nav('/home')}>
        <span className="mark"><img src="/icon-512.png" alt="" /></span>
        <span>Forvia</span>
      </div>
      <button className={'sidestart' + centerCls} onClick={sidenavTap}>
        <Icon name={sidenavIcon} />
        <span>{sidenavLabel}</span>
      </button>
      <button className="sidestart food" onClick={() => nav('/nutrition')}>
        <Icon name="plate" />
        <span>{t('Log food')}</span>
      </button>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="social" icon="heart" to="/social" label={t('Social')} />
      <Tab k="stats" icon="chart" to="/stats" label={t('Progress')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>
  </>
}
