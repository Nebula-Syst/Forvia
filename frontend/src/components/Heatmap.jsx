import { useEffect, useRef } from 'react'
import { fmtVol, isoOf, todayISO, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const WEEKS_SHOWN = 53
const DAYS_PER_WEEK = 7

function mondayOnOrBefore(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// Per-day totals, keyed by ISO date — a Map rather than a plain object since the keys
// are already unique date strings and this is only ever iterated, never spread.
function aggregateByDay(workouts) {
  const byDay = new Map()
  for (const w of workouts) {
    const durationMin = Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
    const entry = byDay.get(w.d) || { sessions: 0, volume: 0, minutes: 0 }
    entry.sessions += 1
    entry.volume += w.vol || 0
    entry.minutes += durationMin
    byDay.set(w.d, entry)
  }
  return byDay
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length))
  return sortedValues[idx]
}

// Four shading tiers on top of "nothing logged" — tier cutoffs are this account's own
// quartiles, not fixed minute counts, so someone who trains for 20 minutes and someone
// who trains for 90 both see their own busiest days as the darkest square.
function buildShadeLevel(byDay) {
  const minutes = [...byDay.values()].map(e => e.minutes).filter(m => m > 0).sort((a, b) => a - b)
  const q1 = percentile(minutes, 0.25)
  const q2 = percentile(minutes, 0.5)
  const q3 = percentile(minutes, 0.75)
  return entry => {
    if (!entry) return 0
    if (!entry.minutes) return 1
    if (entry.minutes >= q3) return 4
    if (entry.minutes >= q2) return 3
    if (entry.minutes >= q1) return 2
    return 1
  }
}

function DayCell({ iso, entry, level, isToday, isFuture, unit, onClick }) {
  const tooltip = entry
    ? `${iso} · ${t(entry.sessions === 1 ? '{0} workout' : '{0} workouts', entry.sessions)} · ${entry.minutes} min · ${fmtVol(entry.volume, unit)}`
    : ''
  const cls = ['hm-c', 'l' + level, isToday && 'today', isFuture && 'future'].filter(Boolean).join(' ')
  return <div className={cls} title={tooltip} onClick={entry ? () => onClick(iso) : undefined} />
}

// GitHub-style activity heatmap, shaded by time trained per day.
export default function Heatmap({ S, onDay }) {
  const scrollRef = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const byDay = aggregateByDay(S.workouts)
  const shadeLevel = buildShadeLevel(byDay)

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const gridEnd = mondayOnOrBefore(today)
  const gridStart = addDays(gridEnd, -WEEKS_SHOWN * DAYS_PER_WEEK)
  const isoToday = todayISO()

  const monthLabels = []
  const weekColumns = []
  let lastLabeledMonth = -1
  for (let week = 0; week <= WEEKS_SHOWN; week++) {
    const weekStart = addDays(gridStart, week * DAYS_PER_WEEK)
    const month = weekStart.getMonth()
    const showLabel = month !== lastLabeledMonth && weekStart.getDate() <= 7 && week < WEEKS_SHOWN - 1
    monthLabels.push(<span key={week}>{showLabel ? t(MONTHS[month]) : ''}</span>)
    if (weekStart.getDate() <= 7) lastLabeledMonth = month

    const days = Array.from({ length: DAYS_PER_WEEK }, (_, offset) => {
      const day = addDays(weekStart, offset)
      const iso = isoOf(day)
      return (
        <DayCell
          key={offset}
          iso={iso}
          entry={byDay.get(iso)}
          level={shadeLevel(byDay.get(iso))}
          isToday={iso === isoToday}
          isFuture={day > today}
          unit={S.unit}
          onClick={onDay}
        />
      )
    })
    weekColumns.push(<div key={week} className="hm-col">{days}</div>)
  }

  return <>
    <div className="hm-wrap" ref={scrollRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{monthLabels}</div>
      <div className="hm-body">
        <div className="hm-days">
          <span>{t('Mon')}</span><span /><span>{t('Wed')}</span><span /><span>{t('Fri')}</span><span /><span />
        </div>
        <div className="hm-grid">{weekColumns}</div>
      </div>
    </div>
    <div className="hm-legend">
      {t('Less time')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More time')}
    </div>
  </>
}
