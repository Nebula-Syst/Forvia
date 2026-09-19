import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { boxClasses, classBook, classCancel } from '../lib/api.js'
import { wsOn } from '../lib/ws.js'
import { todayISO, isoOf, addMinToTime } from '../lib/format.js'
import { useBoxAccent } from '../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../lib/boxCache.js'
import { t, dateLocale } from '../lib/i18n.js'
import { typeIcon, typeColor } from '../lib/classDisciplines.js'
import { wodIsEmpty } from '../lib/wod.js'
import Icon from '../components/Icon.jsx'
import SeatGrid from '../components/SeatGrid.jsx'
import WodView from '../components/WodView.jsx'
import { Button, PillPicker } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { LIVE_CLASSES_ENABLED } from '../lib/featureFlags.js'

const HOUR_MS = 60 * 60 * 1000
const msToStart = c => new Date(c.date + 'T' + c.startTime + ':00') - Date.now()

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const mondayOf = iso => { const off = (new Date(iso + 'T00:00:00').getDay() + 6) % 7; return addDays(iso, -off) }
const dowShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'narrow' })
const dayTitle = iso => new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

// A box can run several rooms at the same hour (CrossFit + open gym side by side) — group by
// startTime so those render together under one time header instead of a flat sequential list.
const isPastClass = c => new Date(c.date + 'T' + c.startTime + ':00') <= new Date()
const isEndedClass = c => new Date(c.date + 'T' + addMinToTime(c.startTime, c.durationMin) + ':00') <= new Date()

const groupSlots = classes => {
  const slots = []
  let slot = null
  for (const c of classes) {
    if (!slot || slot.startTime !== c.startTime) { slot = { startTime: c.startTime, items: [] }; slots.push(slot) }
    slot.items.push(c)
  }
  return slots
}

// Reached only from the main "Box" menu → pick a box → this screen — the one place classes
// get booked, for a member, staff or the owner alike. Nothing else lives here: box
// *administration* (title, invite, staff, the weekly schedule itself) stays entirely on the
// Settings → coach dashboard side, never mixed in on this side of the app.
export default function BoxClasses() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const title = location.state?.title || ''
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [classes, setClasses] = useState(null)
  const [myPlan, setMyPlan] = useState(null)
  const [boxColors, setBoxColors] = useState(null)
  const [selectedDay, setSelectedDay] = useState(todayISO())
  const [filterTime, setFilterTime] = useState('')
  const [filterType, setFilterType] = useState('')
  const dayOptions = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(todayISO()), i))

  const load = () => {
    const from = mondayOf(todayISO()), to = addDays(from, 13)
    boxClasses(boxId, from, to).then(r => { setClasses(r.sessions); setMyPlan(r.myPlan); setBoxColors(r.boxColors); setCachedBoxColors(boxId, r.boxColors, true) }).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])
  // A host starting/ending a class should flip the "Live" badge instantly for anyone with this
  // screen open, not just whoever reopens it later — same wsSend path as the waitlist nudge.
  useEffect(() => wsOn('live:update', load), [boxId])

  const enterLive = c => nav('/box/' + boxId + '/classes/' + c.id + '/live', { state: { session: c, boxTitle: title } })

  const doBook = c => classBook(c.id).then(load).catch(e => toast(e.message))
  const doCancel = c => classCancel(c.id).then(load).catch(e => toast(e.message))

  // Booking is instant normally, but under an hour out a tap that turns out to be a "can I
  // actually make it?" maybe shouldn't silently take a spot someone else could use — one
  // confirm step, not a hard block like the already-started case. ('offered'/'waitlist' rows
  // have their own dedicated Reserve/Cancel buttons below, so this only ever sees 'booked' or
  // nothing yet.)
  const toggleClass = c => {
    if (c.myStatus === 'booked') { doCancel(c); return }
    if (msToStart(c) < HOUR_MS) {
      confirmSheet({
        title: t('Starting soon'),
        message: t('This class starts in less than an hour — only book if you’re sure you can make it.'),
        confirmText: t('Book anyway'),
        onConfirm: () => doBook(c),
      })
      return
    }
    doBook(c)
  }

  const showExercises = c => openSheet(() => <>
    <h3>{c.name}</h3>
    <WodView wod={c.wod} />
  </>)

  useBoxAccent(boxColors ? (boxColors[myTheme] || null) : cachedBoxColor(boxId, myTheme))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/boxes')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{title || t('Classes')}</h1></div>
    </div>

    <div className="day-strip">
      {dayOptions.map(d => (
        <button key={d} className={'day-pill' + (d === selectedDay ? ' on' : '')} onClick={() => setSelectedDay(d)}>
          <span className="dow">{dowShort(d)}</span>
          <span className="dom">{Number(d.slice(8, 10))}</span>
        </button>
      ))}
    </div>
    <div className="day-title">{dayTitle(selectedDay)}</div>
    {myPlan && (
      <div className="muted small" style={{ marginTop: -10, marginBottom: 14, color: myPlan.expired ? 'var(--red)' : myPlan.inGrace ? 'var(--orange)' : undefined }}>
        {myPlan.name}
        {myPlan.expired ? <> · {t('Expired — ask your coach to renew it')}</> : myPlan.inGrace ? <> · {t('Renew in {0} days or lose access', myPlan.graceDaysLeft)}</> : <>
          {myPlan.monthlyLimit != null && <> · {myPlan.remaining > 0 ? t('{0} left this month', myPlan.remaining) : t('Monthly limit reached')}</>}
          {myPlan.classTypes && <> · {t('Only: {0}', myPlan.classTypes.join(', '))}</>}
        </>}
      </div>
    )}

    {!!classes?.length && (() => {
      const timeOptions = [{ value: '', label: t('All times') }, ...[...new Set(classes.map(c => c.startTime))].sort().map(tm => ({ value: tm, label: tm }))]
      const typeOptions = [{ value: '', label: t('All types') }, ...[...new Set(classes.map(c => c.name))].sort().map(n => ({ value: n, label: n }))]
      return (
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <PillPicker value={filterTime} options={timeOptions} onChange={setFilterTime} sheetTitle={t('Filter by time')} />
          <PillPicker value={filterType} options={typeOptions} onChange={setFilterType} sheetTitle={t('Filter by class type')} />
        </div>
      )
    })()}

    {!classes ? <div className="muted small">{t('Loading…')}</div> : (() => {
      const shown = classes.filter(c => c.date === selectedDay && (!filterTime || c.startTime === filterTime) && (!filterType || c.name === filterType))
      return !shown.length ? (
        <div className="muted small">{t('No classes this day.')}</div>
      ) : groupSlots(shown).map(slot => (
        <div key={slot.startTime} className="sched-slot">
          {slot.items.length > 1 && <div className="sched-time">{slot.startTime}<span className="sched-count">{t('{0} at once', slot.items.length)}</span></div>}
          <div className="sched-row">
            {slot.items.map(c => (
              <div key={c.id} className={'class-card booking' + (slot.items.length > 1 ? ' in-row' : '')} style={{ '--tint': typeColor(c) }}>
                <div className="class-card-top">
                  <div>
                    <div className="name">{c.name}
                      {c.myStatus === 'offered' && <span className="role-tag" style={{ marginLeft: 8, background: 'var(--acc-soft)', color: 'var(--acc)' }}>{t('Spot available!')}</span>}
                      {LIVE_CLASSES_ENABLED && c.myStatus !== 'offered' && !!c.live && <span className="role-tag" style={{ marginLeft: 8, background: 'color-mix(in srgb, var(--red) 18%, transparent)', color: 'var(--red)' }}>{t('Live')}</span>}
                      {c.myStatus !== 'offered' && !(LIVE_CLASSES_ENABLED && c.live) && isPastClass(c) && !isEndedClass(c) && <span className="role-tag" style={{ marginLeft: 8, background: 'var(--acc-soft)', color: 'var(--acc)' }}>{t('In progress')}</span>}
                      {c.myStatus !== 'offered' && !(LIVE_CLASSES_ENABLED && c.live) && isEndedClass(c) && <span className="role-tag" style={{ marginLeft: 8, background: 'var(--glass-bg-2)', color: 'var(--label-3)' }}>{t('Finished')}</span>}
                    </div>
                    {!!c.room && <div className="disc"><Icon name={typeIcon(c)} className="icn" />{c.room}</div>}
                    {!wodIsEmpty(c.wod) && (
                      <button className="chip-pill" style={{ border: 'none', cursor: 'pointer' }} onClick={() => showExercises(c)}>
                        <Icon name="clipboard" className="icn" />{t('View exercises')}
                      </button>
                    )}
                  </div>
                  <div className="meta">{c.startTime}–{addMinToTime(c.startTime, c.durationMin)}</div>
                </div>
                <div className="fill-note">{t('{0}/{1} spots', c.booked, c.capacity)}</div>
                <SeatGrid capacity={c.capacity} attendees={c.attendees} tint={typeColor(c)} />
                {(() => {
                  const canJoinLive = LIVE_CLASSES_ENABLED && (!!c.live || (c.myStatus === 'booked' && isPastClass(c) && !isEndedClass(c)))
                  if (c.myStatus === 'offered' || c.myStatus === 'waitlist') return <>
                    <Button variant="primary" style={{ marginTop: 14 }} onClick={() => doBook(c)}>{t('Reserve now')}</Button>
                    <Button variant="ghost" size="sm" style={{ marginTop: 4 }} onClick={() => doCancel(c)}>{c.myStatus === 'offered' ? t('I can’t make it') : t('Leave waitlist')}</Button>
                  </>
                  if (canJoinLive) return (
                    // Once you're in, leaving happens from inside the live view (its own "Leave
                    // class" button) — a second full-width Cancel here read as two competing
                    // "get out" buttons stacked on top of each other.
                    <Button variant="live" style={{ marginTop: 14 }} onClick={() => enterLive(c)}>
                      <span className="dot" />{t('Join live class')}
                    </Button>
                  )
                  if (!c.myStatus && isPastClass(c)) return (
                    <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>{t('This class has already started.')}</div>
                  )
                  // An expired plan blocks everything, checked before the type/limit checks below
                  // since it overrides both — same order as the server-side check.
                  if (!c.myStatus && myPlan?.expired) return (
                    <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>{t('Your plan has expired — ask your coach to renew it.')}</div>
                  )
                  // A type mismatch blocks even the waitlist — there's no scenario where waiting
                  // helps, this class is simply never covered by the plan.
                  if (!c.myStatus && myPlan?.classTypes && !myPlan.classTypes.includes(c.name)) return (
                    <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>{t('Your plan doesn’t include this class type.')}</div>
                  )
                  // A full class still offers the waitlist regardless of the limit (waitlisting
                  // hasn't claimed a seat yet) — this only blocks an attempt that would actually
                  // book one. remaining is null for an unlimited plan — checked explicitly rather
                  // than `<= 0`, since `null <= 0` is true in JS and would wrongly block it.
                  if (!c.myStatus && c.booked < c.capacity && myPlan && myPlan.remaining != null && myPlan.remaining <= 0) return (
                    <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>{t('You’ve reached your plan’s monthly class limit.')}</div>
                  )
                  return (
                    <Button variant={c.myStatus ? 'danger' : 'primary'} style={{ marginTop: 10 }} onClick={() => toggleClass(c)}>
                      {c.myStatus === 'booked' ? t('Cancel') : c.booked >= c.capacity ? t('Join waitlist') : t('Book')}
                    </Button>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      ))
    })()}
  </div>
}
