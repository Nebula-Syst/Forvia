import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { t, nameFor } from '../lib/i18n.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'

function Elapsed({ start }) {
  const [label, setLabel] = useState('0:00')
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - start) / 1000))
      setLabel(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [start])
  return <span>{label}</span>
}

// What to show as "the exercise" — the last one with a logged set (what the person was just
// doing), falling back to the first entry before anything's checked off. There's no separate
// "current exercise" tracked in state (the workout screen is just a scrollable list, not a
// wizard with a step pointer), so this is the closest real signal to "where you left off".
function currentEntry(A) {
  const entries = A?.entries || []
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].sets.some(s => s.done)) return entries[i]
  }
  return entries[0] || null
}

// The tab bar's own button went back to always opening its normal speed-dial (Workout/
// Nutrition), active session or not — this pill is the one way back into a running session
// from anywhere else in the app, Instagram/Spotify-mini-player style. Hidden on the workout
// screen itself, where the session already fills the page.
export default function ActiveWorkoutPill() {
  const nav = useNavigate()
  const loc = useLocation()
  const A = useStore(s => s.S.active)
  if (!A || loc.pathname === '/workout') return null

  const entry = currentEntry(A)
  const ex = entry && EXIDX[entry.id]

  return (
    <button className="active-pill tap" onClick={() => nav('/workout')}>
      {ex ? <Thumb ex={ex} /> : <span className="active-pill-ico"><Icon name="dumbbell" /></span>}
      <span className="active-pill-m">
        <span className="active-pill-t capitalize">{ex ? nameFor(ex) : t('Workout')}</span>
        <span className="active-pill-s"><Elapsed start={A.start} /></span>
      </span>
      <span className="active-pill-play"><Icon name="play" /></span>
    </button>
  )
}
