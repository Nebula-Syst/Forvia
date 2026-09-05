import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { streakDays, lastBW } from '../lib/history.js'
import { loadOfWorkouts } from '../lib/muscles.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, dayDetailSheet, bwDeltaColor } from '../sheets.jsx'
import { streakTiers as fetchStreakTiers } from '../lib/api.js'
import { tierForDays } from '../lib/streak.js'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import Icon from '../components/Icon.jsx'
import RankRow from '../components/RankRow.jsx'
import TasksCard from '../components/TasksCard.jsx'
import Ring from '../components/Ring.jsx'
import { Button } from '../components/ui.jsx'

// Macro ring for the Home nutrition card — not the shared Ring component: that one leaves an
// unfilled ring a flat neutral grey, which is correct for a generic progress ring but reads as
// three dead, colorless circles here at 0g logged (the common state — most visits to Home are
// before any food's been logged yet). Tinting the *track* itself in the macro's own color
// keeps each ring visually alive and distinct from the very first render, progress or not.
function MacroRing({ label, value, goal, color }) {
  const pct = goal ? Math.min(1, value / goal) : 0
  const size = 76, stroke = 7, r = (size - stroke) / 2, c = 2 * Math.PI * r
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>{value}<span style={{ fontSize: 11, fontWeight: 600, opacity: .55 }}>g</span></span>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span className="row" style={{ gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flex: 'none' }} />
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--label-3)' }}>{t('of {0}g', goal)}</span>
    </div>
  </div>
}

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [tiers, setTiers] = useState(null)
  useEffect(() => { fetchStreakTiers().then(setTiers).catch(() => setTiers([])) }, [])

  const today = new Date()
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  // Attendance strip: the ring's two halves are independent signals, not a generic
  // "either" fill — left = a workout logged that day, right = a food entry — so at a
  // glance which half is missing tells you which one you skipped. Full ring + checkmark
  // only when both sides are lit. Fixed to the current week only — browsing other weeks
  // now happens through the month calendar sheet instead, so there's no weekOffset here.
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const isToday = iso === todayISO()
    const trained = doneDays.has(iso)
    const ate = (S.foodDiary[iso] || []).length > 0
    const fillCls = (trained ? ' l-on' : '') + (ate ? ' r-on' : '')
    // Date number in the label instead of a weekday letter — a day is identified by
    // its number, the ring below still carries the logged state.
    strip.push(<button key={i} type="button" className={'wday' + (isToday ? ' today' : '')} onClick={() => dayDetailSheet(iso)}>
      <div className="wday-tick">{isToday && <span className="wday-tick-dot" />}</div>
      <div className="lbl">{d.getDate()}</div>
      <div className={'day-ring' + fillCls}>{trained && ate && <Icon name="check" />}</div>
    </button>)
  }

  const weekWorkouts = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO()))
  const wThisWeek = weekWorkouts.length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const setsThisWeek = weekWorkouts.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.sets.filter(s => s.done).length, 0), 0)
  const minsThisWeek = weekWorkouts.reduce((n, w) => n + Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000)), 0)
  const weekLoad = loadOfWorkouts(weekWorkouts, null)
  const hasHistory = S.workouts.length > 0
  const streak = Math.max(0, streakDays(S) + (user?.streakBonus || 0))
  const streakTier = tiers ? tierForDays(streak, tiers) : null

  return <div>
    <div className="hdr">
      <div>
        {/* Given name only — Apellidos are for Account/Perfil, a greeting reads better
            short, and a compound-surname full name here wrapped onto its own line. */}
        <h1>{user ? t('Hi {0}', user.firstName || user.name) : 'Forvia'}</h1>
        <div className="sub">
          {today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          {' · '}<span style={{ textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, color: 'var(--acc)' }}>{t('Early access')}</span>
        </div>
        {user && <div style={{ marginTop: 8 }}><RankRow streak={hasHistory ? streak : 0} streakTier={streakTier?.artIdx || 1} /></div>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={() => calendarSheet()} aria-label={t('Calendar')}><Icon name="calendar" /></button>
      </div>
    </div>

    {/* No card here on purpose — this is a glance strip, not a content block, and the
        glass background/border/padding of `.card` was the biggest chunk of the height
        this has already been trimmed twice trying to shrink. */}
    <div className="week">{strip}</div>

    {user && <TasksCard />}

    {user && (() => {
      const goals = S.nutritionGoals
      const todayFood = S.foodDiary[todayISO()] || []
      const kcal = todayFood.reduce((n, it) => n + (it.kcal || 0), 0)
      const carbs = todayFood.reduce((n, it) => n + (it.carbsG || 0), 0)
      const fat = todayFood.reduce((n, it) => n + (it.fatG || 0), 0)
      const protein = todayFood.reduce((n, it) => n + (it.proteinG || 0), 0)
      return <>
        <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/nutrition')}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{t('Calories')}</h2>
            <div className="row" style={{ gap: 6 }}>
              <span className="dim small">{t('{0} / {1} kcal', kcal, goals.calories)}</span>
              <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
            </div>
          </div>
          <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: Math.min(100, goals.calories ? (kcal / goals.calories) * 100 : 0) + '%', height: '100%', background: 'var(--acc)' }} />
          </div>
        </div>

        <div className="card tappable" style={{ cursor: 'pointer', padding: '18px 16px 22px' }} onClick={() => nav('/nutrition')}>
          <div className="row between" style={{ marginBottom: 22 }}>
            <h2 style={{ margin: 0 }}>{t('Macros')}</h2>
            <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 26 }}>
            {[
              { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
              { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
              { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' }
            ].map(m => <MacroRing key={m.l} label={m.l} value={m.v} goal={m.g} color={m.c} />)}
          </div>
        </div>
      </>
    })()}

    <div className="tiles">
      <div className="tile k-green">
        <div className="ringwrap"><Ring size={34} stroke={4} pct={1} color="var(--green)"><Icon name="dumbbell" style={{ fontSize: 14 }} /></Ring></div>
        <div className="v">{wThisWeek}</div><div className="l">{t('This week')}</div>
      </div>
      <div className="tile k-violet">
        <div className="ringwrap"><Ring size={34} stroke={4} pct={1} color="var(--purple)"><Icon name="clipboard" style={{ fontSize: 14 }} /></Ring></div>
        <div className="v">{setsThisWeek}</div><div className="l">{t('Sets')}</div>
      </div>
      <div className="tile k-blue">
        <div className="ringwrap"><Ring size={34} stroke={4} pct={1} color="var(--blue)"><Icon name="clock" style={{ fontSize: 14 }} /></Ring></div>
        <div className="v">{minsThisWeek}</div><div className="l">{t('Minutes')}</div>
      </div>
    </div>

    {(() => {
      const weightCard = <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
          </div>
        </div>
        {bw ? <>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
            {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
            {!!delta && (
              <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
                <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
                {fmtNum(Math.abs(delta))}
              </span>
            )}
            <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
          </div>
          {S.targetW && (
            <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
              <Icon name="target" style={{ fontSize: 13 }} />
              <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
            </div>
          )}
          <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
      </div>

      return <div className="cols">
        {weightCard}
        <div className="col">
          <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/stats')}>
            <div className="row between" style={{ marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>{t('This week’s balance')}</h2>
              <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
            </div>
            <BodyMap load={weekLoad} body={S.body} />
            <BodyMapLegend />
          </div>
          <div className="card">
            <h2>{t('Activity')}</h2>
            <Heatmap S={S} onDay={iso => calendarSheet(iso)} />
          </div>
        </div>
      </div>
    })()}
  </div>
}
