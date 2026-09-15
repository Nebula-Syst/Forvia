import { useEffect, useState } from 'react'

// Pure time-math shared by the host controls (CoachClasses.jsx) and the athlete's live view
// (LiveClass.jsx) — every device derives the same round/phase/remaining from one anchor
// timestamp (api/server.js's matching liveElapsedMs), so a pause/resume/reset only ever needs
// one broadcast, never a push per tick.
const elapsedSecOf = live => {
  const ms = live.status === 'running' ? live.pausedElapsedMs + (Date.now() - Date.parse(live.phaseStartedAt)) : live.pausedElapsedMs
  return Math.max(0, ms / 1000)
}

export const clockStr = sec => {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0')
}

// { seconds: the big number to show, phase: 'work'|'rest'|null, round, totalRounds, done }
export function liveState(live) {
  const elapsed = elapsedSecOf(live)
  const p = live.params
  if (live.timerType === 'amrap') {
    const remaining = p.durationSec - elapsed
    return { seconds: Math.max(0, remaining), phase: null, round: null, totalRounds: null, done: remaining <= 0 }
  }
  if (live.timerType === 'emom') {
    const round = Math.floor(elapsed / p.roundSec) + 1
    const remaining = p.roundSec - (elapsed % p.roundSec)
    const done = !!p.rounds && round > p.rounds
    return { seconds: remaining, phase: null, round: p.rounds ? Math.min(round, p.rounds) : round, totalRounds: p.rounds || null, done }
  }
  if (live.timerType === 'tabata') {
    const cycleLen = p.workSec + p.restSec
    const round = Math.floor(elapsed / cycleLen) + 1
    const pos = elapsed % cycleLen
    const isWork = pos < p.workSec
    const remaining = isWork ? p.workSec - pos : cycleLen - pos
    return { seconds: remaining, phase: isWork ? 'work' : 'rest', round: Math.min(round, p.rounds), totalRounds: p.rounds, done: round > p.rounds }
  }
  // 'fortime' — counts up, no built-in end; the host taps End when the last athlete finishes.
  return { seconds: elapsed, phase: null, round: null, totalRounds: null, done: false }
}

// Re-renders on a light interval while the clock is actually running, settles once paused —
// avoids a tick (and a re-render) for every viewer once nothing is changing.
export function useLiveTick(live) {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!live || live.status !== 'running') return
    const id = setInterval(() => bump(n => n + 1), 250)
    return () => clearInterval(id)
  }, [live?.status, live?.phaseStartedAt, live?.pausedElapsedMs, live?.timerType])
  return live ? liveState(live) : null
}
