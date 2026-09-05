import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { lastEntryFor, buildSets, freestyleConfig, defaultConfig, setsDoneActive, workoutVolume, supersetUnits, unitOf, setLabel, modeOf, isBw, repStep, EFFORT, effortOf, capEffort, cascadeWeight, removeRowAt, pairAdjacent, unpairSuperset, cleanupSg, setLooksOff, bestWeightFor, fmtSec } from '../lib/history.js'
import { fmtVol, fmtNum, exCount, uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, nameFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { setProgressHighWater, supersetFlowStep } from '../lib/supersetFlow.js'
import { Thumb } from '../components/Media.jsx'
import { startFlow, exercisePicker, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, deleteRoutine } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, Segmented, Stepper } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { loadOfActive } from '../lib/muscles.js'
import BodyMap from '../components/BodyMap.jsx'

/* ---------- start chooser (no active workout) ---------- */
// No more "today's plan" to feature above the rest — every routine is picked freely each
// session (see the FREESTYLE fab/rail buttons for training without one at all), so this is
// just a flat list rather than a highlighted card plus "other routines" underneath it.
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Workout')}</h1><div className="sub">{t('Pick a routine to start')}</div></div>
      {/* Home's header icon now opens the calendar instead of /routines (see sheets.jsx
          calendarSheet) — this is the surviving way in to create/rename/delete routines. */}
      <button className="iconbtn" onClick={() => nav('/routines')} aria-label={t('Manage routines')}><Icon name="clipboard" /></button>
    </div>
    {S.routines.length > 0 ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <button className="iconbtn" aria-label={t('Edit routine')} onClick={e => { e.stopPropagation(); nav('/routines/r/' + r.id) }}><Icon name="pencil" /></button>
        <button className="iconbtn" aria-label={t('Delete routine')} onClick={e => { e.stopPropagation(); deleteRoutine(r) }}><Icon name="trash" /></button>
        <span className="tag acc">{t('Start')}</span></div>)}</div>
      : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No routines yet — create one below, or just train freestyle.')}</div>}
  </div>
}

// Rendered from App.jsx as a Shell-level sibling (next to RestTimer), NOT from inside
// StartChooser: #app plays a page-transition animation on every route change
// (viewfade, key={pathname}) that animates `transform`, and an element mid-transform
// animation becomes a containing block for its position:fixed descendants — so a fixed
// bar nested in #app would render pinned to #app's own box for that ~200ms, not the
// viewport, and visibly jump into place once the animation finished. Living outside
// #app sidesteps the quirk entirely, the same way RestTimer already does.
export function WorkoutStartActions() {
  const loc = useLocation()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  // Sits outside the authed/Login split in App.jsx (see comment above), so it needs its
  // own guard against a stale #/workout hash while logged out.
  if ((!user && !isGuest) || loc.pathname !== '/workout' || S.active) return null

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/routines/r/' + r.id)
  }

  return (
    <div className="sticky-actions">
      <Button variant="tinted" icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout')}</Button>
      <Button variant="primary" icon="plus" onClick={addRoutine}>{t('Create routine')}</Button>
    </div>
  )
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
// Global rest duration (S.restSec) picked from right inside the card that needs it,
// instead of a trip to Settings — same six options as SettingsWorkout's own Rest timer row.
const REST_OPTIONS = [0, 60, 90, 120, 150, 180]
function restPickerSheet(S, update) {
  useUI.getState().openSheet(close => (
    <>
      <h3>{t('Rest timer')}</h3>
      <div className="list">
        {REST_OPTIONS.map(v => (
          <div key={v} className="item" onClick={() => { update(s => { s.restSec = v }); close() }}>
            <div className="grow"><div className="tt">{v === 0 ? t('Off') : v + 's'}</div></div>
            {S.restSec === v && <Icon name="check" className="accent" />}
          </div>
        ))}
      </div>
    </>
  ))
}

// A short, explicit dialog (not a toast) for a one-line explanation someone tapped "i" to
// read — a toast times out before a full sentence is read; this waits for a tap to close.
function infoDialog(title, message) {
  useUI.getState().openSheet(close => (
    <div style={{ textAlign: 'center', padding: '4px 0' }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
      <Button variant="primary" onClick={close}>{t('Got it')}</Button>
    </div>
  ), { kind: 'center' })
}

// The corner flag on a weight/reps box that looks fat-fingered rather than real — same dialog
// shell as infoDialog, just built from the specific number and (for weight) the lifter's own
// best, so the explanation says exactly why THIS value tripped it.
function unusualDialog(cls, s, bestW, unit) {
  if (cls === 'r') {
    infoDialog(t('Unusual value'), t('{0} reps in one set is a lot — check you didn’t mistype it.', fmtNum(s.r)))
  } else {
    const msg = bestW > 0
      ? t('{0} is a lot more than your best logged for this exercise ({1}) — check you didn’t mistype it.', fmtVol(s.w, unit), fmtVol(bestW, unit))
      : t('{0} is unusually heavy — check you didn’t mistype it.', fmtVol(s.w, unit))
    infoDialog(t('Unusual value'), msg)
  }
}

// The mini map in the stats row is too small to tell muscles apart at a glance —
// tapping it opens the same full-size map the end-of-workout summary uses.
function bodyMapSheet(load, body) {
  useUI.getState().openSheet(() => (
    <>
      <h3>{t('Muscles worked')}</h3>
      <BodyMap load={load} body={body} />
    </>
  ))
}

// Tapping the set-number badge opens this — what kind of set it was, not just whether it's
// done. `type` is undefined/'normal' for a plain working set; only approach/failure/drop are
// stored, so old data and a never-touched set both read as normal with nothing to migrate.
const SET_TYPES = [
  { id: 'warmup', label: 'Warm-up set', icon: 'stretch', info: 'A lighter set before your working sets, to prepare — not counted as work.' },
  { id: 'approach', label: 'Approach set', icon: 'plate', info: 'A ramp-up set between warm-up and the top set, at a weight closer to it than a warm-up.' },
  { id: 'normal', label: 'Normal set', icon: 'barbell', info: 'A regular working set — nothing special logged about it.' },
  { id: 'failure', label: 'Failure set', icon: 'flame', info: 'Taken to the point where another rep with good form isn’t possible.' },
  { id: 'drop', label: 'Drop set', icon: 'arrowDown', info: 'Straight into a lighter weight the moment this one ends, no rest in between.' },
]
const SET_TYPE_ICON = Object.fromEntries(SET_TYPES.map(st => [st.id, st.icon]))
function setTypeSheet(set, onPick, onRemove) {
  const current = isWarmupRow(set) ? 'warmup' : (set.type || 'normal')
  useUI.getState().openSheet(close => (
    <>
      <h3>{t('Set type')}</h3>
      <div className="list">
        {SET_TYPES.map(st => {
          const on = current === st.id
          return (
            <div key={st.id} className={'item' + (on ? ' on' : '')} onClick={() => { close(); onPick(st.id) }}>
              <span className="lrow-i"><Icon name={st.icon} /></span>
              <div className="grow"><div className="tt">{t(st.label)}</div></div>
              <button className="iconbtn" aria-label={t('Info')} onClick={ev => { ev.stopPropagation(); infoDialog(t(st.label), t(st.info)) }}><Icon name="info" /></button>
            </div>
          )
        })}
        <div className="item" onClick={() => { close(); onRemove() }}>
          <span className="lrow-i"><Icon name="trash" /></span>
          <div className="grow"><div className="tt" style={{ color: 'var(--red)' }}>{t('Remove set')}</div></div>
          <button className="iconbtn" aria-label={t('Info')} onClick={ev => { ev.stopPropagation(); infoDialog(t('Remove set'), t('Removes this set from the exercise.')) }}><Icon name="info" /></button>
        </div>
      </div>
    </>
  ))
}

// A real component (not a closure snapshot) so it re-renders live as entries move — the
// sheets elsewhere in this file that only need a fixed list at open time get away with a
// plain closure, but this one has to reflect its own edits while it's still open.
function ReorderSheet() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const entries = S.active?.entries || []
  const move = (idx, dir) => update(s => {
    const arr = s.active.entries
    const j = idx + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    cleanupSg(arr)
  })
  return <>
    <h3>{t('Reorder exercises')}</h3>
    <div className="list">
      {entries.map((e, i) => (
        <div key={i} className="item">
          <div className="grow"><div className="tt capitalize">{nameFor(exOr(e.id))}</div></div>
          <button className="iconbtn" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><Icon name="arrowUp" /></button>
          <button className="iconbtn" disabled={i === entries.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><Icon name="arrowDown" /></button>
        </div>
      ))}
    </div>
  </>
}
const openReorderSheet = () => useUI.getState().openSheet(() => <ReorderSheet />)

// A general-purpose clock, separate from the per-set rest timer (that one starts itself after
// a checked set and always counts down toward the next set; this one is manual — timing
// anything else mid-session, a stretch, a walk between machines) and from the timed-hold work
// countdown (that one logs its elapsed time onto a specific set when it ends; this one doesn't
// touch the workout at all). Two independent clocks in one sheet since a phone's Clock app is
// the obvious model for "a timer and a stopwatch" — switching modes doesn't reset either one.
const TIMER_PRESETS = [30, 60, 90, 120, 180, 300, 600]
function ClockSheet() {
  const S = useStore(s => s.S)
  const [mode, setMode] = useState('timer')

  const [dur, setDur] = useState(60)
  const [timerLeft, setTimerLeft] = useState(null)   // null = not started this round
  const [timerRunning, setTimerRunning] = useState(false)
  const timerEndsAt = useRef(0)

  const [swElapsed, setSwElapsed] = useState(0)
  const [swRunning, setSwRunning] = useState(false)
  const swStartedAt = useRef(0)

  useEffect(() => {
    if (!timerRunning) return
    const tick = () => {
      const left = Math.max(0, Math.round((timerEndsAt.current - Date.now()) / 1000))
      setTimerLeft(left)
      if (left <= 0) {
        setTimerRunning(false)
        beep(S.sound, 880, 0.15); beep(S.sound, 880, 0.15, 0.25); beep(S.sound, 1320, 0.4, 0.5)
        if (S.vibration !== false) vibrate([200, 100, 200])
      }
    }
    const iv = setInterval(tick, 250)
    return () => clearInterval(iv)
  }, [timerRunning])

  useEffect(() => {
    if (!swRunning) return
    const iv = setInterval(() => setSwElapsed(Math.round((Date.now() - swStartedAt.current) / 1000)), 250)
    return () => clearInterval(iv)
  }, [swRunning])

  const startTimer = () => { timerEndsAt.current = Date.now() + dur * 1000; setTimerLeft(dur); setTimerRunning(true) }
  const resumeTimer = () => { timerEndsAt.current = Date.now() + timerLeft * 1000; setTimerRunning(true) }
  const pauseTimer = () => setTimerRunning(false)
  const resetTimer = () => { setTimerRunning(false); setTimerLeft(null) }

  const startSw = () => { swStartedAt.current = Date.now() - swElapsed * 1000; setSwRunning(true) }
  const pauseSw = () => setSwRunning(false)
  const resetSw = () => { setSwRunning(false); setSwElapsed(0) }

  return <>
    <h3>{t('Clock')}</h3>
    <Segmented className="cw-seg" value={mode} onChange={setMode} options={[
      { value: 'timer', label: t('Timer'), icon: 'timer' },
      { value: 'stopwatch', label: t('Stopwatch'), icon: 'history' },
    ]} />
    {mode === 'timer' ? <>
      <div className="cw-display">{fmtSec(timerLeft ?? dur)}</div>
      {timerLeft == null && <>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '14px 0' }}>
          {TIMER_PRESETS.map(v => (
            <button key={v} className={'tag' + (dur === v ? ' acc' : '')} onClick={() => setDur(v)}>{fmtSec(v)}</button>
          ))}
        </div>
        <Stepper label={t('Custom (seconds)')} value={dur} step={5} decimal={false} onChange={v => setDur(Math.max(5, v))} />
      </>}
      <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 18 }}>
        {timerLeft == null
          ? <Button variant="primary" icon="play" onClick={startTimer}>{t('Start')}</Button>
          : timerRunning
            ? <Button variant="tinted" icon="pause" onClick={pauseTimer}>{t('Pause')}</Button>
            : <Button variant="primary" icon="play" onClick={resumeTimer}>{t('Resume')}</Button>}
        {timerLeft != null && <Button variant="ghost" icon="reset" onClick={resetTimer}>{t('Reset')}</Button>}
      </div>
    </> : <>
      <div className="cw-display">{fmtSec(swElapsed)}</div>
      <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 18 }}>
        {!swRunning
          ? <Button variant="primary" icon="play" onClick={startSw}>{t(swElapsed > 0 ? 'Resume' : 'Start')}</Button>
          : <Button variant="tinted" icon="pause" onClick={pauseSw}>{t('Pause')}</Button>}
        {swElapsed > 0 && <Button variant="ghost" icon="reset" onClick={resetSw}>{t('Reset')}</Button>}
      </div>
    </>}
  </>
}
const openClockSheet = () => useUI.getState().openSheet(() => <ClockSheet />)

function ExerciseBlock({ entryIdx, onToggle, onField, onAddSet, onRemoveSetAt, onStartTimed, onNotes, onSetType, onMenu }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // Same "carry the last row forward" fallback buildSets() uses, so the Previous column
  // always has something to say once a set count grows past what was logged last time.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // A bodyweight set has no weight to type — but the column still holds its usual slot
  // (issue #48: dropping it entirely shifted Reps into the Weight column's spot, so a
  // bodyweight exercise and a loaded one right next to it in the same session no longer lined
  // up). `ghost` keeps the slot and hides only its content; the label empties out with it, so
  // there's no column head describing values that aren't there. Adding a belt weight in the
  // config brings it back live, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit), ghost: bw && !added }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? loadCol
      : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // Best-ever weight for this exact exercise, computed once per card rather than per set/per
  // row — setLooksOff() below judges "unusual" against it, not a fixed number, so a strong
  // lifter's real numbers on a big compound never get flagged.
  const bestW = mode === 'reps' ? bestWeightFor(S, entry.id) : 0
  // Just a narrow typed value — no +/- either side of it. A set is a couple of digits,
  // tapped and typed directly; six characters covers a decimal weight like "137.5" with
  // room to spare (three used to be the cap, which silently blocked any decimal at all).
  const cell = (s, i, col, cls, off) => (
    <div className={'setcell ' + cls + (col.ghost ? ' wghost' : '')}>
      {!col.ghost && <NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)}
        className="setval" maxLength={6} />}
      {off && <button className="cellwarn" aria-label={t('Unusual value')}
        onClick={ev => { ev.stopPropagation(); unusualDialog(cls, s, bestW, S.unit) }}>
        <Icon name="warnTriangle" />
      </button>}
    </div>
  )
  return <>
    <div className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <button className="thumbbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex, { hideAddToPlan: true })}><Thumb ex={ex} /></button>
      <div className="grow" style={{ minWidth: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{nameFor(ex)}</div>
      <button className="iconbtn" style={{ flexShrink: 0 }} aria-label={t('More')} onClick={onMenu}><Icon name="dots" /></button>
    </div>
    <input className="input" style={{ marginBottom: 8 }} placeholder={t('Add a note…')}
      value={entry.notes || ''} onChange={e => onNotes(e.target.value)} />
    <button className="row" style={{ gap: 6, marginBottom: 8, color: 'var(--label-2)', background: 'none' }}
      onClick={() => restPickerSheet(S, update)}>
      <Icon name="clock" /><span className="small">{t('Rest')}: {S.restSec ? S.restSec + 's' : t('Off')}</span>
    </button>
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp">{t('Sets')}</span><span className="p-sp">{t('Previous')}</span><span className={'w-sp' + (col1.ghost ? ' wghost' : '')}>{col1.hd}</span>{col2 && <span className={'r-sp' + (col2.ghost ? ' wghost' : '')}>{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp"><Icon name="check" /></span></div>
      {entry.sets.map((s, i) => {
        const warm = isWarmupRow(s)
        const warmBefore = i > 0 && isWarmupRow(entry.sets[i - 1])
        const isFirstWarmup = warm && !warmBefore
        // Numbering restarts per phase: with two warm-ups the first work set reads 1, not 3.
        const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
        const prev = prevAt(i)
        const off = mode === 'reps' ? setLooksOff(S.unit, s, cfg, bestW) : null
        return <div key={i}>
          {isFirstWarmup && <div className="setph">{t('Warm-up')}</div>}
          {!warm && warmBefore && <div className="setsep" />}
          <div className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
            <div className="n-wrap">
              {/* A tinted number reads fine as "just another working set", but doesn't say what's
                  different about the ones that aren't — so every non-normal set trades its number
                  for the same icon it shows in the picker, and only a plain working set keeps
                  counting. Drop sets keep both: they're usually a short run (drop 1, drop 2…),
                  so which one this is still matters — a small corner badge adds it back. */}
              <button className={'n' + (warm ? ' warmup' : s.type ? ' ' + s.type : '')} aria-label={t('Set type')}
                onClick={() => setTypeSheet(s, type => onSetType(i, type), () => onRemoveSetAt(i))}>
                {warm ? <Icon name={SET_TYPE_ICON.warmup} />
                  : s.type === 'drop' ? <><Icon name={SET_TYPE_ICON.drop} /><span className="n-sub">{phaseNum}</span></>
                  : s.type ? <Icon name={SET_TYPE_ICON[s.type]} />
                  : phaseNum}
              </button>
            </div>
            <div className="prev">{prev ? setLabel(entry.id, prev, last.target, { effort: false }) : '—'}</div>
            {cell(s, i, col1, 'w', off?.weightOff)}
            {col2 && cell(s, i, col2, 'r', off?.repsOff)}
            {col3 && cell(s, i, col3, 'eff')}
            {/* A timed set is started, not typed: the timer counts the hold down and checks the
                set off itself. The checkbox stays for anyone who timed it on their own watch. */}
            {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
              onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
            <Check checked={s.done} onChange={() => onToggle(i)} />
          </div>
        </div>
      })}
      <div style={{ height: 8 }} />
    </div>
    {/* Pulled out of the card itself — its own row underneath, not sharing space with
        remove/warm-up (gone, per the reference this now follows). */}
    <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
      <Button size="sm" variant="tinted" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
    </div>
  </>
}

/* ---------- active workout ---------- */
export function removeActiveExercise(idx) {
  // Clear the work callback before indexes can shift. This also protects a confirmation sheet
  // that was opened first and confirmed after a timed hold started.
  useUI.getState().stopWork()
  useStore.getState().update(s => {
    if (!s.active || !Array.isArray(s.active.entries)) return
    if (idx < 0 || idx >= s.active.entries.length) return
    s.active.entries.splice(idx, 1)
    cleanupSg(s.active.entries)
    if (idx < s.active.cur) s.active.cur--
    if (s.active.cur >= s.active.entries.length) s.active.cur = Math.max(0, s.active.entries.length - 1)
  }, true)
}

function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const paused = !!A.paused
  const togglePause = () => update(s => { s.active.paused = !s.active.paused })
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  // Superset flow: keep the active exercise in view - completing a set scrolls to the
  // next exercise in the group, then back up to the first exercise of the next round.
  const exRefs = useRef({})
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
  // The marks are index-keyed, and removing an exercise shifts every index above it down
  // (removeActiveExercise splices). Re-baseline whenever the list length changes, otherwise a
  // shifted exercise inherits its predecessor's mark and its real progress reads as a re-check.
  useEffect(() => {
    progressHighWater.current = A.entries.map(e => e.sets.filter(s => s.done).length)
  }, [A.entries.length])
  useEffect(() => {
    if (!isSuperset) return
    const el = exRefs.current[cur]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [cur, isSuperset, A.entries.length])

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)
  const vol = workoutVolume(A)
  // Only the sets actually ticked so far — grows live as the session progresses, same
  // source (loadOfActive) the routine editor's "What this session hits" preview uses.
  const muscleLoad = loadOfActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  const setNotes = (idx, v) => mutEntry(idx, e => { e.notes = v })
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Changing a weight cascades to the following sets of the same phase, so a
    // heavier bar carries through the set instead of retyping every row.
    if (field === 'w') {
      e.sets = cascadeWeight(e.sets, i, v)
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSetAt = (idx, i) => mutEntry(idx, e => { e.sets = removeRowAt(e.sets, i) })
  const setType = (idx, i, type) => mutEntry(idx, e => {
    const s = e.sets[i]
    if (type === 'warmup') { s.phase = 'warmup'; s.warmup = true; delete s.type; return }
    if (isWarmupRow(s)) { delete s.phase; delete s.warmup }
    if (type === 'normal') delete s.type; else s.type = type
  })
  const unpairAt = idx => update(s => {
    s.active.entries = unpairSuperset(s.active.entries, idx)
  })
  const pairAt = (first, second) => update(s => {
    s.active.entries = pairAdjacent(s.active.entries, first, second)
  })
  // Swap a whole exercise for a different one mid-session: same slot, same set count where
  // it can be, seeded exactly like a freshly-added exercise would be (last time's numbers,
  // or empty if this is the first time doing it).
  const replaceExercise = (idx, newEx) => update(s => {
    const e = s.active.entries[idx]
    const last = lastEntryFor(s, newEx.id)
    e.id = newEx.id
    delete e.plan
    if (last) {
      const cfg = freestyleConfig(s, { id: newEx.id, ...defaultConfig(newEx.id) })
      e.sets = buildSets(s, cfg, { preferLast: true })
      e.target = last.target || {}
    } else {
      e.sets = []
      e.target = {}
    }
  })

  // Remove a whole exercise from the session. The confirmation always asks first; in a
  // superset it asks WHICH exercise of the group to remove.
  const removeExercise = removeActiveExercise
  const confirmRemoveExercise = idx => {
    const e = A.entries[idx]
    if (!e) return
    const hasDone = (e.sets || []).some(s => s.done)
    confirmSheet({
      title: t('Remove {0}?', nameFor(exOr(e.id))),
      message: hasDone
        ? t('The sets you logged for this exercise in this session will be lost.')
        : t('This removes the exercise from your current session.'),
      confirmText: t('Remove'), danger: true, onConfirm: () => removeExercise(idx)
    })
  }
  // The ⋮ menu on one exercise's own card — reorder/replace/pair/remove, all scoped to
  // that exact exercise, no more guessing which one a page-level button meant.
  const openExerciseMenu = idx => {
    const e = A.entries[idx]
    if (!e) return
    const myUnit = units.find(u => u.includes(idx)) || [idx]
    const uIdx = units.indexOf(myUnit)
    const inSuperset = myUnit.length > 1
    const prevUnit = units[uIdx - 1], nextUnit = units[uIdx + 1]
    // A superset isn't capped at two — it's whatever's contiguous and shares the same sg
    // (pairAdjacent already merges groups of any size on either side). So this stays available
    // even mid-superset, gated on the group's own edges rather than on being unpaired.
    const prevEdge = myUnit[0], nextEdge = myUnit[myUnit.length - 1]
    const canPairPrev = prevUnit && prevUnit.length === 1
    const canPairNext = nextUnit && nextUnit.length === 1
    const addToSuperset = () => {
      if (canPairPrev && canPairNext) {
        useUI.getState().openSheet(close2 => (
          <>
            <h3>{t('Add to superset')}</h3>
            <div className="list">
              <div className="item" onClick={() => { close2(); pairAt(prevUnit[0], prevEdge) }}>
                <div className="grow"><div className="tt capitalize">{nameFor(exOr(A.entries[prevUnit[0]].id))}</div></div>
              </div>
              <div className="item" onClick={() => { close2(); pairAt(nextEdge, nextUnit[0]) }}>
                <div className="grow"><div className="tt capitalize">{nameFor(exOr(A.entries[nextUnit[0]].id))}</div></div>
              </div>
            </div>
          </>
        ))
      } else if (canPairPrev) pairAt(prevUnit[0], prevEdge)
      else pairAt(nextEdge, nextUnit[0])
    }
    useUI.getState().openSheet(close => (
      <>
        <h3 className="capitalize">{nameFor(exOr(e.id))}</h3>
        <div className="list">
          {A.entries.length > 1 && <div className="item" onClick={() => { close(); openReorderSheet() }}>
            <span className="lrow-i"><Icon name="list" /></span>
            <div className="grow"><div className="tt">{t('Reorder exercises')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>}
          <div className="item" onClick={() => { close(); exercisePicker(newEx => { replaceExercise(idx, newEx) }) }}>
            <span className="lrow-i"><Icon name="shuffle" /></span>
            <div className="grow"><div className="tt">{t('Replace exercise')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
          {(canPairPrev || canPairNext) && <div className="item" onClick={() => { close(); addToSuperset() }}>
            <span className="lrow-i"><Icon name="link" /></span>
            <div className="grow"><div className="tt">{t('Add to superset')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>}
          {inSuperset && <div className="item" onClick={() => { close(); unpairAt(idx) }}>
            <span className="lrow-i"><Icon name="link" /></span>
            <div className="grow"><div className="tt">{t('Unpair')}</div></div>
          </div>}
          <div className="item" onClick={() => { close(); confirmRemoveExercise(idx) }}>
            <span className="lrow-i"><Icon name="trash" /></span>
            <div className="grow"><div className="tt" style={{ color: 'var(--red)' }}>{t('Remove exercise')}</div></div>
          </div>
        </div>
      </>
    ))
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, nameFor(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false, checked = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      checked = e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); if (S.vibration !== false) vibrate(30)
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        // Only loaded reps training has a "working weight" worth confirming — a bodyweight
        // plank has nothing to put in that slider, and neither does a set of push-ups
        // (issue #32: the fewest taps that still record what happened).
        const loaded = m === 'reps' && !(isBw({ ...(e.target || {}), id: e.id }) && !e.sets.some(x => x.w > 0))
        if (e.sets.every(x => x.done)) { exJustDone = true; if (loaded && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    // reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio/timed or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))

    // Only progress beyond this exercise's high-water mark may navigate or change rest. This
    // prevents an uncheck/re-check of finished work from replaying the flow side effects.
    const fresh = useStore.getState().S.active
    if (fresh && checked && fresh.entries[idx]) {
      const progress = setProgressHighWater(fresh.entries[idx], progressHighWater.current[idx] || 0)
      progressHighWater.current[idx] = progress.highWater
      if (!progress.isNew) return

      const freshUnits = supersetUnits(fresh.entries)
      const freshUnit = freshUnits.find(u => u.includes(idx))
      const freshUnitIdx = freshUnits.indexOf(freshUnit)
      const freshLastUnit = freshUnitIdx >= freshUnits.length - 1
      const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))

      // Singleton units are ordinary exercises: preserve their historical between-set rest,
      // while final sets finish quietly and never enter superset navigation.
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (!freshUnitDone) startRest(S.restSec)
        return
      }

      const step = supersetFlowStep(fresh.entries, freshUnit, idx)
      if (!step) return
      if (step.unitDone) {
        if (!freshLastUnit) {
          const nextUnit = freshUnits[freshUnitIdx + 1]
          // The top-weight sheet's explicit "Just close" path owns the choice not to advance.
          if (!askTop && nextUnit?.length) update(s => { if (s.active) s.active.cur = nextUnit[0] })
          startRest(S.restSec)
        }
      } else {
        if (step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
        if (step.roundDone) startRest(S.restSec)
      }
    }
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    {/* Sticky (issue #67): name/discard/finish, progress and the stat row stay on screen while
        the exercise list scrolls underneath — the ✕/✓ and "how am I doing" glance shouldn't
        need a trip back to the top of a long session to reach. */}
    <div className="wsticky">
      <div className="hdr" style={{ alignItems: 'center', margin: '0 0 12px' }}>
        <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
        {/* Elapsed time + set count used to live here too — pulled out, going elsewhere
            per the next step; done/total and <Elapsed> stay defined for that. .hdr's default
            align-items:flex-end is for the usual title+subtitle pair — a single line needs
            center instead to actually land level with the round buttons either side. */}
        <div style={{ flex: 1, marginLeft: 10, fontWeight: 600 }}>{A.name}</div>
        <button className="iconbtn" aria-label={t('Clock')} onClick={openClockSheet}><Icon name="clock" /></button>
        <button className="iconbtn" aria-label={paused ? t('Resume workout') : t('Pause workout')} onClick={togglePause}><Icon name={paused ? 'play' : 'pause'} /></button>
        <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
      </div>
      <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

      <div className="wstats">
        <div className="wstat"><div className="v"><Elapsed start={A.start} /></div><div className="l">{t('Time')}</div></div>
        <div className="wstat"><div className="v">{fmtVol(vol, S.unit)}</div><div className="l">{t('Volume')}</div></div>
        <div className="wstat"><div className="v">{done}/{total}</div><div className="l">{t('Sets')}</div></div>
        <button className="wstat wstat-map" aria-label={t('Muscles worked')} onClick={() => bodyMapSheet(muscleLoad, S.body)}>
          <BodyMap className="compact mini" load={muscleLoad} body={S.body} />
        </button>
      </div>
    </div>

    {paused ? (
      <div className="card pausedcard">
        <span className="pausedcard-ico"><Icon name="pause" /></span>
        <h3>{t('Workout paused')}</h3>
        <div className="muted small" style={{ marginBottom: 16 }}>{t('Resume to keep logging sets.')}</div>
        <Button variant="primary" icon="play" onClick={togglePause}>{t('Resume')}</Button>
      </div>
    ) : <>
    {/* Every exercise stacked in order — one below another — instead of a single-exercise
        view with hidden navigation. A superset's members still group inside their own
        .ss-card, same as before; pairing one on the fly now lives in that exercise's own
        ⋮ menu instead of a standalone button on the card. */}
    {A.entries.length ? units.map((u, ui) => {
      const ss = u.length > 1
      return <div key={u[0]} style={{ marginBottom: 18 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>{ss ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</div>
        {ss ? (
          <div className="ss-card">
            <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset · do these back-to-back, rest when done')}</span>
              <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(u[0])}>{t('Unpair')}</Button>
            </div>
            {u.map((idx, k) => <div key={idx} ref={el => { exRefs.current[idx] = el }} className="ss-ex" data-exidx={idx}>
              {k > 0 && <div className="ss-amp">+</div>}
              <ExerciseBlock entryIdx={idx}
                onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onRemoveSetAt={i => removeSetAt(idx, i)} onStartTimed={i => startTimed(idx, i)} onNotes={v => setNotes(idx, v)} onSetType={(i, ty) => setType(idx, i, ty)} onMenu={() => openExerciseMenu(idx)} />
            </div>)}
          </div>
        ) : (
          <div ref={el => { exRefs.current[u[0]] = el }}>
            <ExerciseBlock entryIdx={u[0]} onToggle={i => toggle(u[0], i)} onField={(i, f, v) => setField(u[0], i, f, v)} onAddSet={() => addSet(u[0])} onRemoveSetAt={i => removeSetAt(u[0], i)} onStartTimed={i => startTimed(u[0], i)} onNotes={v => setNotes(u[0], v)} onSetType={(i, ty) => setType(u[0], i, ty)} onMenu={() => openExerciseMenu(u[0])} />
          </div>
        )}
      </div>
    }) : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    {/* Multi-pick, no per-exercise config sheet: each one lands with last time's sets
        already filled in (or empty, first time — added one at a time from there), same
        as the routine's own "no prescription" freestyle path. */}
    <Button onClick={() => exercisePicker(list => {
      if (!list.length) return
      update(s => {
        const startIdx = s.active.entries.length
        list.forEach(ex => {
          const last = lastEntryFor(s, ex.id)
          let sets = [], target = {}
          if (last) {
            const cfg = freestyleConfig(s, { id: ex.id, ...defaultConfig(ex.id) })
            sets = buildSets(s, cfg, { preferLast: true })
            target = last.target || {}
          }
          s.active.entries.push({ id: ex.id, target, sets })
        })
        s.active.cur = startIdx
      })
    }, { multi: true })} variant="tinted" icon="plus">{t('Add exercise')}</Button>
    {/* Finish (✓) and discard (✕) already live in the header up top; remove now lives in
        each exercise's own ⋮ menu, unambiguous about which one — no page-level button for
        either any more. */}
    </>}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
