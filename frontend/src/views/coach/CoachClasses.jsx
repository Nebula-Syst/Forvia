import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import {
  coachClassTypes, coachCreateClassType, coachUpdateClassType, coachDeleteClassType,
  coachCreateClass, coachRemoveClass, coachSetClassExercises,
  coachDayTemplates, coachCreateDayTemplate, coachApplyDayTemplate, coachDeleteDayTemplate,
  coachWeekTemplates, coachCreateWeekTemplate, coachApplyWeekTemplate, coachDeleteWeekTemplate,
  coachWodTemplates, coachCreateWodTemplate, coachApplyWodTemplate, coachDeleteWodTemplate,
  coachClassRoster, coachClassAttendance, boxClasses,
  coachStartLiveClass, coachControlLiveClass, boxLiveClass,
} from '../../lib/api.js'
import { todayISO, isoOf, addMinToTime } from '../../lib/format.js'
import { t, dateLocale, nameFor } from '../../lib/i18n.js'
import { CLASS_ICONS, CLASS_COLORS, typeIcon, typeColor } from '../../lib/classDisciplines.js'
import { clockStr, useLiveTick } from '../../lib/liveClass.js'
import { LIVE_CLASSES_ENABLED } from '../../lib/featureFlags.js'
import { EXIDX } from '../../lib/exercises.js'
import { wsOn } from '../../lib/ws.js'
import { exercisePicker } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import Media from '../../components/Media.jsx'
import { Button, TextField, NumberField } from '../../components/ui.jsx'

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const mondayOf = iso => { const off = (new Date(iso + 'T00:00:00').getDay() + 6) % 7; return addDays(iso, -off) }
const dowShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'narrow' })
// "Hoy, domingo 13/09" for today, "lunes 14/09" otherwise.
const fmtDayLabel = iso => {
  const d = new Date(iso + 'T00:00:00')
  const wd = d.toLocaleDateString(dateLocale(), { weekday: 'long' })
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return (iso === todayISO() ? t('Today') + ', ' : '') + wd + ' ' + dd + '/' + mm
}
const fmtShortDate = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7)
const weekdayOnly = iso => new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })
// A day's sessions grouped by startTime, so classes happening at once (different rooms) show
// side by side under one shared time label instead of reading as sequential.
const groupByTime = sessions => {
  const slots = []
  let slot = null
  for (const s of sessions) {
    if (!slot || slot.startTime !== s.startTime) { slot = { startTime: s.startTime, items: [] }; slots.push(slot) }
    slot.items.push(s)
  }
  return slots
}
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return isoOf(d) }
const monthLabel = iso => {
  const name = new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
  return name.charAt(0).toUpperCase() + name.slice(1)
}
// 42 ISO dates (6 Monday-first weeks) covering the month `iso` falls in, for a real month grid.
const monthGrid = iso => {
  const d = new Date(iso + 'T00:00:00')
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const start = new Date(first); start.setDate(first.getDate() - (first.getDay() + 6) % 7)
  return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return isoOf(x) })
}

// Owner/staff side of Phase 1 ("classes & schedule"). Classes live on real calendar dates —
// nothing repeats on its own. A class TYPE (name/icon/color/room/duration/capacity, no
// schedule) is just a preset picked when adding a class straight to a date. If a day or a
// week's shape genuinely repeats, the coach saves it as a template and applies it to another
// date/week on purpose (below) — that's the only way anything is copied forward. Exercises
// ("today's WOD") live on the specific occurrence, never on a type or a day/week template,
// since the schedule slot can recur while the workout content never does; a WOD template is
// the equivalent opt-in repeat tool for exercise lists specifically. Distinct from the box's
// own config (title, invite, staff), which stays on CoachBox.jsx.
export default function CoachClasses() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)

  const [types, setTypes] = useState(null)
  const [editingTypeId, setEditingTypeId] = useState(null)
  const [tyName, setTyName] = useState('')
  const [tyRoom, setTyRoom] = useState('')
  const [tyIcon, setTyIcon] = useState(CLASS_ICONS[0])
  const [tyColor, setTyColor] = useState(CLASS_COLORS[0])
  const [tyDuration, setTyDuration] = useState(60)
  const [tyCapacity, setTyCapacity] = useState(12)
  const [tyBusy, setTyBusy] = useState(false)

  const [sessions, setSessions] = useState(null)
  const [selectedDay, setSelectedDay] = useState(todayISO())
  const [weekAnchor, setWeekAnchor] = useState(mondayOf(todayISO()))
  const [showMonth, setShowMonth] = useState(false)
  const [monthCursor, setMonthCursor] = useState(todayISO())
  const dayOptions = Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i))

  const [addingSlot, setAddingSlot] = useState(false)
  const [pickedTypeId, setPickedTypeId] = useState(null)
  const [slotTime, setSlotTime] = useState('18:00')

  const [dayTemplates, setDayTemplates] = useState(null)
  const [dayTplName, setDayTplName] = useState('')
  const [weekTemplates, setWeekTemplates] = useState(null)
  const [weekTplName, setWeekTplName] = useState('')
  const [wodTemplates, setWodTemplates] = useState(null)
  const [wodTplName, setWodTplName] = useState('')

  const [openSession, setOpenSession] = useState(null)
  const [roster, setRoster] = useState(null)
  const [exDraft, setExDraft] = useState([])
  const [tab, setTab] = useState('horario')

  const [live, setLive] = useState(null)
  const [timerType, setTimerType] = useState('fortime')
  const [amrapMin, setAmrapMin] = useState(10)
  const [emomRoundSec, setEmomRoundSec] = useState(60)
  const [emomRounds, setEmomRounds] = useState(10)
  const [tabataWork, setTabataWork] = useState(20)
  const [tabataRest, setTabataRest] = useState(10)
  const [tabataRounds, setTabataRounds] = useState(8)
  const liveTick = useLiveTick(live)

  const load = () => {
    coachClassTypes(boxId).then(setTypes).catch(e => toast(e.message))
    coachDayTemplates(boxId).then(setDayTemplates).catch(e => toast(e.message))
    coachWeekTemplates(boxId).then(setWeekTemplates).catch(e => toast(e.message))
    coachWodTemplates(boxId).then(setWodTemplates).catch(e => toast(e.message))
    const from = addDays(mondayOf(todayISO()), -7)
    boxClasses(boxId, from, addDays(from, 180)).then(setSessions).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])

  const resetTypeForm = () => {
    setEditingTypeId(null); setTyName(''); setTyRoom('')
    setTyIcon(CLASS_ICONS[0]); setTyColor(CLASS_COLORS[0]); setTyDuration(60); setTyCapacity(12)
  }
  const startEditType = ty => {
    setEditingTypeId(ty.id); setTyName(ty.name); setTyRoom(ty.room || '')
    setTyIcon(typeIcon(ty)); setTyColor(typeColor(ty)); setTyDuration(ty.durationMin); setTyCapacity(ty.capacity)
  }
  const saveType = () => {
    const n = tyName.trim()
    if (!n) return toast(t('Name required'))
    const fields = { name: n, room: tyRoom.trim(), icon: tyIcon, color: tyColor, durationMin: tyDuration, capacity: tyCapacity }
    setTyBusy(true)
    const req = editingTypeId ? coachUpdateClassType(boxId, editingTypeId, fields) : coachCreateClassType(boxId, fields)
    req.then(() => { resetTypeForm(); toast(editingTypeId ? t('Class type updated') : t('Class type created')); load() })
      .catch(e => toast(e.message)).finally(() => setTyBusy(false))
  }
  const removeType = ty => coachDeleteClassType(boxId, ty.id)
    .then(() => { if (editingTypeId === ty.id) resetTypeForm(); toast(t('Removed')); load() }).catch(e => toast(e.message))

  const openAdd = () => { setAddingSlot(true); setSlotTime('18:00'); setPickedTypeId(types?.[0]?.id || null) }
  const closeAdd = () => setAddingSlot(false)
  const confirmAdd = () => {
    const ty = (types || []).find(x => x.id === pickedTypeId)
    if (!ty) return toast(t('Pick a class type'))
    coachCreateClass(boxId, { date: selectedDay, startTime: slotTime, name: ty.name, room: ty.room, icon: ty.icon, color: ty.color, durationMin: ty.durationMin, capacity: ty.capacity })
      .then(() => { toast(t('Class added')); closeAdd(); load() })
      .catch(e => toast(e.message))
  }
  const removeClass = s => coachRemoveClass(boxId, s.id).then(() => { toast(t('Removed')); load() }).catch(e => toast(e.message))

  const saveDayTemplate = () => {
    const n = dayTplName.trim()
    if (!n) return toast(t('Name required'))
    coachCreateDayTemplate(boxId, n, selectedDay)
      .then(() => { setDayTplName(''); toast(t('Day template saved')); load() })
      .catch(e => toast(e.message))
  }
  const applyDayTemplate = dt => coachApplyDayTemplate(boxId, dt.id, selectedDay)
    .then(n => { toast(t('{0} classes placed', n)); load() }).catch(e => toast(e.message))
  const removeDayTemplate = dt => coachDeleteDayTemplate(boxId, dt.id).then(() => { toast(t('Removed')); load() }).catch(e => toast(e.message))

  const saveWeekTemplate = () => {
    const n = weekTplName.trim()
    if (!n) return toast(t('Name required'))
    coachCreateWeekTemplate(boxId, n, weekAnchor)
      .then(() => { setWeekTplName(''); toast(t('Week template saved')); load() })
      .catch(e => toast(e.message))
  }
  const applyWeekTemplate = wt => coachApplyWeekTemplate(boxId, wt.id, weekAnchor)
    .then(n => { toast(t('{0} classes placed', n)); load() }).catch(e => toast(e.message))
  const removeWeekTemplate = wt => coachDeleteWeekTemplate(boxId, wt.id).then(() => { toast(t('Removed')); load() }).catch(e => toast(e.message))

  const openRoster = s => {
    setOpenSession(s); setExDraft(s.exercises || []); setLive(null)
    coachClassRoster(s.id).then(r => setRoster(r.roster)).catch(e => toast(e.message))
    boxLiveClass(s.id).then(setLive).catch(e => toast(e.message))
  }
  const closeRoster = () => { setOpenSession(null); setRoster(null); setExDraft([]); setLive(null) }
  const markAttendance = (row, status) => coachClassAttendance(row.bookingId, status)
    .then(() => { toast(t('Saved')); openRoster(openSession); load() }).catch(e => toast(e.message))

  // The host's own device hears this exactly the same way a viewer's does (App.jsx-style
  // wsOn), which is what lets a second staff member's phone take over the controls mid-class.
  useEffect(() => {
    if (!openSession) return
    return wsOn('live:update', msg => { if (msg.sessionId === openSession.id) setLive(msg.live) })
  }, [openSession?.id])

  const startLive = () => {
    const params =
      timerType === 'amrap' ? { durationSec: amrapMin * 60 } :
      timerType === 'emom' ? { roundSec: emomRoundSec, rounds: emomRounds || null } :
      timerType === 'tabata' ? { workSec: tabataWork, restSec: tabataRest, rounds: tabataRounds } : {}
    coachStartLiveClass(boxId, openSession.id, timerType, params).then(setLive).catch(e => toast(e.message))
  }
  const controlLive = action => coachControlLiveClass(boxId, openSession.id, action).then(setLive).catch(e => toast(e.message))

  const addExercises = () => {
    exercisePicker(list => {
      setExDraft(prev => [...prev, ...list.map(e => ({ exerciseId: e.id, name: nameFor(e), scheme: '' }))])
    }, { multi: true })
  }
  const updateExScheme = (i, scheme) => setExDraft(prev => prev.map((e, idx) => idx === i ? { ...e, scheme } : e))
  const removeExDraft = i => setExDraft(prev => prev.filter((_, idx) => idx !== i))
  const saveExercises = () => coachSetClassExercises(boxId, openSession.id, exDraft)
    .then(() => { toast(t('Saved')); load() }).catch(e => toast(e.message))

  const saveWodTemplate = () => {
    const n = wodTplName.trim()
    if (!n) return toast(t('Name required'))
    if (!exDraft.length) return toast(t('Add exercises first'))
    coachCreateWodTemplate(boxId, n, exDraft)
      .then(() => { setWodTplName(''); toast(t('WOD template saved')); load() })
      .catch(e => toast(e.message))
  }
  const applyWodTemplate = wt => coachApplyWodTemplate(boxId, wt.id, openSession.id)
    .then(ex => { setExDraft(ex); toast(t('Loaded')) }).catch(e => toast(e.message))
  const removeWodTemplate = wt => coachDeleteWodTemplate(boxId, wt.id).then(() => { toast(t('Removed')); load() }).catch(e => toast(e.message))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Classes')}</h1></div>
    </div>

    {openSession ? (
      <div className="class-card booking" style={{ '--tint': typeColor(openSession) }}>
        <div className="class-card-top">
          <div>
            <div className="name">{openSession.name}</div>
            <div className="disc"><Icon name={typeIcon(openSession)} className="icn" />{[openSession.room, openSession.date].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="meta">{openSession.startTime}–{addMinToTime(openSession.startTime, openSession.durationMin)}</div>
        </div>
        <div className="divider" style={{ margin: '14px 0' }} />
        {!roster ? <div className="muted small">{t('Loading…')}</div> : !roster.length ? (
          <div className="muted small">{t('No bookings yet.')}</div>
        ) : (
          <div className="lrow-list">
            {roster.map(r => (
              <div key={r.bookingId} className="lrow">
                <Avatar name={r.name} avatarUrl={r.avatarUrl} size={36} />
                <span className="lrow-m">
                  <span className="lrow-t">{r.name}</span>
                  <span>
                    <span className={'status-pill ' + r.status}>
                      {r.status === 'waitlist' ? t('Waitlist') : r.status === 'offered' ? t('Spot offered') : r.status === 'attended' ? t('Attended') : r.status === 'no-show' ? t('No-show') : t('Booked')}
                    </span>
                  </span>
                </span>
                {(r.status === 'booked') && <>
                  <button className="att-btn yes" onClick={() => markAttendance(r, 'attended')}><Icon name="check" className="icn" />{t('Attended')}</button>
                  <button className="att-btn no" onClick={() => markAttendance(r, 'no-show')}><Icon name="xmark" className="icn" /></button>
                </>}
              </div>
            ))}
          </div>
        )}

        <div className="divider" style={{ margin: '14px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="sect-t" style={{ padding: 0 }}>{t('Exercises')}</span>
          <button className="iconbtn" style={{ width: 30, height: 30 }} onClick={addExercises} aria-label={t('Add exercise')}><Icon name="plus" /></button>
        </div>
        {!exDraft.length ? <div className="muted small" style={{ marginBottom: 10 }}>{t('No exercises added yet.')}</div> : (
          <div className="lrow-list" style={{ marginBottom: 10 }}>
            {exDraft.map((e, i) => (
              <div key={i} className="lrow">
                <span className="lrow-m"><span className="lrow-t" style={{ textTransform: 'capitalize' }}>{e.name}</span></span>
                <input className="field" placeholder={t('e.g. 21-15-9, 5x5 @ 60kg')} value={e.scheme} onChange={ev => updateExScheme(i, ev.target.value)} style={{ flex: 1, maxWidth: 150, padding: '7px 10px', fontSize: 13 }} />
                <button className="iconbtn" style={{ width: 26, height: 26, borderRadius: 7, color: 'var(--red)', marginLeft: 6 }} onClick={() => removeExDraft(i)} aria-label={t('remove')}><Icon name="xmark" /></button>
              </div>
            ))}
          </div>
        )}
        {!!exDraft.length && <Button variant="primary" size="sm" onClick={saveExercises} style={{ marginBottom: 16 }}>{t('Save exercises')}</Button>}

        <div className="row" style={{ gap: 8, marginBottom: wodTemplates?.length ? 12 : 0 }}>
          <TextField placeholder={t('Name this WOD — e.g. Fran')} value={wodTplName} onChange={e => setWodTplName(e.target.value)} style={{ flex: 1 }} />
          <Button variant="tinted" style={{ width: 'auto' }} onClick={saveWodTemplate} disabled={!exDraft.length}>{t('Save')}</Button>
        </div>
        {!!wodTemplates?.length && (
          <div className="lrow-list">
            {wodTemplates.map(wt => (
              <div key={wt.id} className="lrow">
                <span className="lrow-m"><span className="lrow-t">{wt.name}</span><span className="lrow-s">{t('{0} exercises', wt.exercises.length)}</span></span>
                <Button size="sm" onClick={() => applyWodTemplate(wt)}>{t('Load')}</Button>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)', marginLeft: 6 }} onClick={() => removeWodTemplate(wt)} aria-label={t('remove')}><Icon name="xmark" /></button>
              </div>
            ))}
          </div>
        )}

        {LIVE_CLASSES_ENABLED && <>
        <div className="divider" style={{ margin: '14px 0' }} />
        <span className="sect-t" style={{ padding: 0, display: 'block', marginBottom: 10 }}>{t('Live class')}</span>

        {!live ? (
          <div className="card">
            <div className="seg" style={{ marginBottom: 12 }}>
              <button type="button" className={'seg-tab' + (timerType === 'fortime' ? ' on' : '')} onClick={() => setTimerType('fortime')}>{t('For Time')}</button>
              <button type="button" className={'seg-tab' + (timerType === 'amrap' ? ' on' : '')} onClick={() => setTimerType('amrap')}>AMRAP</button>
              <button type="button" className={'seg-tab' + (timerType === 'emom' ? ' on' : '')} onClick={() => setTimerType('emom')}>EMOM</button>
              <button type="button" className={'seg-tab' + (timerType === 'tabata' ? ' on' : '')} onClick={() => setTimerType('tabata')}>Tabata</button>
            </div>
            {timerType === 'amrap' && (
              <div style={{ marginBottom: 12 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>{t('Duration (min)')}</div>
                <div className="stat-box"><NumberField value={amrapMin} onChange={setAmrapMin} decimal={false} className="num-plain" /><span className="stat-unit">{t('min')}</span></div>
              </div>
            )}
            {timerType === 'emom' && (
              <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{t('Seconds per round')}</div>
                  <div className="stat-box"><NumberField value={emomRoundSec} onChange={setEmomRoundSec} decimal={false} className="num-plain" /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{t('Rounds')}</div>
                  <div className="stat-box"><NumberField value={emomRounds} onChange={setEmomRounds} decimal={false} className="num-plain" /></div>
                </div>
              </div>
            )}
            {timerType === 'tabata' && (
              <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{t('Work (s)')}</div>
                  <div className="stat-box"><NumberField value={tabataWork} onChange={setTabataWork} decimal={false} className="num-plain" /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{t('Rest (s)')}</div>
                  <div className="stat-box"><NumberField value={tabataRest} onChange={setTabataRest} decimal={false} className="num-plain" /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{t('Rounds')}</div>
                  <div className="stat-box"><NumberField value={tabataRounds} onChange={setTabataRounds} decimal={false} className="num-plain" /></div>
                </div>
              </div>
            )}
            <Button variant="primary" onClick={startLive}><Icon name="play" className="icn" />{t('Start live class')}</Button>
          </div>
        ) : (
          <div className="card live-card">
            <div className="live-clock">{clockStr(liveTick.seconds)}</div>
            {(liveTick.phase || liveTick.round) && (
              <div className="live-phase">
                {liveTick.phase === 'work' ? t('Work') : liveTick.phase === 'rest' ? t('Rest') : null}
                {!!liveTick.round && (liveTick.phase ? ' · ' : '') + t('Round {0}', liveTick.round) + (liveTick.totalRounds ? ' / ' + liveTick.totalRounds : '')}
              </div>
            )}
            {liveTick.done && <div className="muted small" style={{ marginTop: 4 }}>{t('Time!')}</div>}

            {!!(openSession.exercises || []).length && (() => {
              const current = openSession.exercises[live.currentExerciseIndex]
              const catalogEx = current && EXIDX[current.exerciseId]
              return <>
                {catalogEx && <div style={{ marginTop: 16, textAlign: 'left' }}><Media ex={catalogEx} compact /></div>}
                <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: catalogEx ? 8 : 16 }}>
                  <button className="iconbtn" onClick={() => controlLive('prev-exercise')} disabled={live.currentExerciseIndex === 0} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
                  <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{current?.name}</div>
                    {!!current?.scheme && <div className="muted small">{current.scheme}</div>}
                  </div>
                  <button className="iconbtn" onClick={() => controlLive('next-exercise')} disabled={live.currentExerciseIndex >= openSession.exercises.length - 1} aria-label={t('Next')}><Icon name="chevronRight" /></button>
                </div>
              </>
            })()}

            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Button variant="tinted" style={{ flex: 1 }} onClick={() => controlLive(live.status === 'running' ? 'pause' : 'resume')}>
                <Icon name={live.status === 'running' ? 'pause' : 'play'} className="icn" />{live.status === 'running' ? t('Pause') : t('Resume')}
              </Button>
              <Button variant="tinted" style={{ flex: 1 }} onClick={() => controlLive('reset')}><Icon name="reset" className="icn" />{t('Reset')}</Button>
            </div>
            <Button variant="danger" style={{ marginTop: 10 }} onClick={() => controlLive('end')}>{t('End live class')}</Button>
          </div>
        )}
        </>}

        <Button variant="tinted" size="sm" style={{ marginTop: 16 }} onClick={closeRoster}>{t('Close')}</Button>
      </div>
    ) : <>
      <div className="seg">
        <button type="button" className={'seg-tab' + (tab === 'horario' ? ' on' : '')} onClick={() => setTab('horario')}>{t('Schedule')}</button>
        <button type="button" className={'seg-tab' + (tab === 'types' ? ' on' : '')} onClick={() => setTab('types')}>{t('Class types')}</button>
      </div>

      {tab === 'horario' && (() => {
        const daySessions = (sessions || []).filter(s => s.date === selectedDay).sort((a, b) => a.startTime.localeCompare(b.startTime))
        return <div className="sect">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <button className="iconbtn" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
            <button className="period-link" style={{ width: 'auto' }} onClick={() => { setMonthCursor(selectedDay); setShowMonth(v => !v) }}>
              <Icon name="calendar" className="icn" />{fmtShortDate(dayOptions[0])} – {fmtShortDate(dayOptions[6])}
            </button>
            <button className="iconbtn" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
          </div>

          {showMonth && (
            <div className="period-panel">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <button className="iconbtn" onClick={() => setMonthCursor(addMonths(monthCursor, -1))} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
                <span style={{ fontWeight: 700 }}>{monthLabel(monthCursor)}</span>
                <button className="iconbtn" onClick={() => setMonthCursor(addMonths(monthCursor, 1))} aria-label={t('Next')}><Icon name="chevronRight" /></button>
              </div>
              <div className="month-grid">
                {monthGrid(monthCursor).map(d => {
                  const inMonth = d.slice(0, 7) === monthCursor.slice(0, 7)
                  const hasClasses = (sessions || []).some(s => s.date === d)
                  return (
                    <button key={d} className={'month-cell' + (d === selectedDay ? ' on' : '') + (inMonth ? '' : ' out')}
                      onClick={() => { setSelectedDay(d); setWeekAnchor(mondayOf(d)); setShowMonth(false) }}>
                      {Number(d.slice(8, 10))}
                      {hasClasses && <span className="month-dot" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="day-strip" style={{ marginBottom: 16 }}>
            {dayOptions.map(d => (
              <button key={d} className={'day-pill' + (d === selectedDay ? ' on' : '')} onClick={() => setSelectedDay(d)}>
                <span className="dow">{dowShort(d)}</span>
                <span className="dom">{Number(d.slice(8, 10))}</span>
                {(sessions || []).some(s => s.date === d) && <span className="day-dot" />}
              </button>
            ))}
          </div>

          <div className="day-title">{fmtDayLabel(selectedDay)}</div>

          {!daySessions.length ? <div className="muted small" style={{ marginBottom: 12 }}>{t('No classes this day yet.')}</div> : (
            <div style={{ marginBottom: 14 }}>
              {groupByTime(daySessions).map(slot => (
                <div key={slot.startTime} style={{ marginBottom: 8 }}>
                  <div className="sched-time">
                    {slot.startTime}
                    {slot.items.length > 1 && <span className="sched-count">{t('{0} at once', slot.items.length)}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {slot.items.map(s => (
                      <div key={s.id} className="lrow" style={{ background: 'var(--glass-bg-2)', border: '1px solid var(--glass-border)', borderRadius: 14 }}>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => openRoster(s)}>
                          <span className="lrow-i" style={{ '--tint': typeColor(s) }}><Icon name={typeIcon(s)} /></span>
                          <span className="lrow-m">
                            <span className="lrow-t">{s.name}</span>
                            <span className="lrow-s">{s.startTime}–{addMinToTime(s.startTime, s.durationMin)}{s.room ? ' · ' + s.room : ''} · {s.booked}/{s.capacity}</span>
                          </span>
                        </button>
                        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)' }} onClick={() => removeClass(s)} aria-label={t('remove')}><Icon name="xmark" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!addingSlot ? (
            <button className="add-dashed" style={{ marginBottom: 28 }} onClick={openAdd}>
              <Icon name="plus" className="icn" />{t('Add a class on {0}', weekdayOnly(selectedDay))}
            </button>
          ) : (
            <div className="cal-add-panel" style={{ marginTop: 12, marginBottom: 28 }}>
              {!types?.length ? (
                <div className="muted small">{t('Create a class type first, in the "Class types" tab.')}</div>
              ) : <>
                <div className="cal-type-picker" style={{ marginBottom: 12 }}>
                  {types.map(ty => (
                    <button key={ty.id} type="button" className={'type-chip' + (pickedTypeId === ty.id ? ' on' : '')} style={{ '--tint': typeColor(ty) }} onClick={() => setPickedTypeId(ty.id)}>
                      <Icon name={typeIcon(ty)} className="icn" />{ty.name}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <input type="time" className="field" value={slotTime} onChange={e => setSlotTime(e.target.value)} style={{ flex: 1 }} />
                  <Button variant="primary" style={{ width: 'auto' }} onClick={confirmAdd}>{t('Add')}</Button>
                  <Button variant="tinted" style={{ width: 'auto' }} onClick={closeAdd}>{t('Cancel')}</Button>
                </div>
              </>}
            </div>
          )}

          <div className="sect">
            <h2 className="sect-t">{t('Day templates')}</h2>
            <div className="card">
              <TextField placeholder={t('Name this day — e.g. Leg day')} value={dayTplName} onChange={e => setDayTplName(e.target.value)} style={{ marginBottom: 10 }} />
              <Button variant="primary" onClick={saveDayTemplate} disabled={!daySessions.length}>{t('Save')}</Button>
              {!!dayTemplates?.length && (
                <div className="lrow-list" style={{ marginTop: 16 }}>
                  {dayTemplates.map(dt => (
                    <div key={dt.id} className="lrow">
                      <span className="lrow-m"><span className="lrow-t">{dt.name}</span><span className="lrow-s">{t('{0} classes', dt.slots.length)}</span></span>
                      <Button size="sm" variant="tinted" onClick={() => applyDayTemplate(dt)}>{t('Apply')}</Button>
                      <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)', marginLeft: 6 }} onClick={() => removeDayTemplate(dt)} aria-label={t('remove')}><Icon name="xmark" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="sect-f">{t('Save this day, or apply a saved one — replaces whatever this day already has.')}</p>
          </div>

          <div className="sect">
            <h2 className="sect-t">{t('Week templates')}</h2>
            <div className="card">
              <TextField placeholder={t('Name this week — e.g. Summer schedule')} value={weekTplName} onChange={e => setWeekTplName(e.target.value)} style={{ marginBottom: 10 }} />
              <Button variant="primary" onClick={saveWeekTemplate} disabled={!dayOptions.some(d => (sessions || []).some(s => s.date === d))}>{t('Save')}</Button>
              {!!weekTemplates?.length && (
                <div className="lrow-list" style={{ marginTop: 16 }}>
                  {weekTemplates.map(wt => (
                    <div key={wt.id} className="lrow">
                      <span className="lrow-m"><span className="lrow-t">{wt.name}</span></span>
                      <Button size="sm" variant="tinted" onClick={() => applyWeekTemplate(wt)}>{t('Apply')}</Button>
                      <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)', marginLeft: 6 }} onClick={() => removeWeekTemplate(wt)} aria-label={t('remove')}><Icon name="xmark" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="sect-f">{t('Save the whole week, or apply a saved one — replaces that week entirely.')}</p>
          </div>
        </div>
      })()}

      {tab === 'types' && <>
        <h2 className="sect-t">{editingTypeId ? t('Edit class type') : t('New class type')}</h2>

        <div className="icon-picker">
          {CLASS_ICONS.map(ic => (
            <button key={ic} type="button" className={'icon-opt' + (tyIcon === ic ? ' on' : '')} style={{ '--tint': tyColor }} onClick={() => setTyIcon(ic)}>
              <Icon name={ic} className="icn" />
            </button>
          ))}
        </div>
        <div className="color-picker">
          {CLASS_COLORS.map(c => (
            <button key={c} type="button" className={'color-opt' + (tyColor === c ? ' on' : '')} style={{ background: c }} onClick={() => setTyColor(c)} aria-label={c} />
          ))}
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <TextField placeholder={t('e.g. CrossFit')} value={tyName} onChange={e => setTyName(e.target.value)} style={{ marginBottom: 10 }} />
          <TextField placeholder={t('Room (optional) — e.g. Room 1')} value={tyRoom} onChange={e => setTyRoom(e.target.value)} style={{ marginBottom: 10 }} />
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>{t('Duration (min)')}</div>
              <div className="stat-box">
                <NumberField value={tyDuration} onChange={setTyDuration} decimal={false} className="num-plain" />
                <span className="stat-unit">{t('min')}</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>{t('Capacity')}</div>
              <div className="stat-box">
                <NumberField value={tyCapacity} onChange={setTyCapacity} decimal={false} className="num-plain" />
                <span className="stat-unit">{t('spots')}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginBottom: 30 }}>
          <Button variant="primary" onClick={saveType} disabled={tyBusy}>{editingTypeId ? t('Save changes') : t('Add class type')}</Button>
          {!!editingTypeId && <Button variant="tinted" style={{ width: 'auto' }} onClick={resetTypeForm}>{t('Cancel')}</Button>}
        </div>

        <div className="sect">
          <h2 className="sect-t">{t('Your class types')}</h2>
          {!types?.length ? <div className="muted small">{t('No class types yet.')}</div> : (
            <div className="type-cards">
              {types.map(ty => (
                <div key={ty.id} className="type-card" style={{ '--tint': typeColor(ty) }}>
                  <button className="type-card-edit" onClick={() => startEditType(ty)} aria-label={t('Edit')}><Icon name="pencil" /></button>
                  <button className="type-card-del" onClick={() => removeType(ty)} aria-label={t('remove')}><Icon name="xmark" /></button>
                  <span className="ic"><Icon name={typeIcon(ty)} /></span>
                  <div className="nm">{ty.name}</div>
                  <div className="sub">{ty.room ? ty.room + ' · ' : ''}{t('{0} min', ty.durationMin)}</div>
                  <div className="sub">{t('cap. {0}', ty.capacity)}</div>
                </div>
              ))}
            </div>
          )}
          <p className="sect-f">{t('No schedule yet — add a class straight to a date in the Schedule tab.')}</p>
        </div>
      </>}
    </>}
  </div>
}
