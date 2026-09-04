import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, FREESTYLE_DAY, streakDays, lastBW } from '../lib/history.js'
import { loadOfWorkouts } from '../lib/muscles.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, bwDeltaColor } from '../sheets.jsx'
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
import { glyphOf } from '../lib/glyphs.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)
  const [tiers, setTiers] = useState(null)
  useEffect(() => { fetchStreakTiers().then(setTiers).catch(() => setTiers([])) }, [])

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const isFreestyleToday = effectiveRoutineId(S, todayISO()) === FREESTYLE_DAY
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const weekWorkouts = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO()))
  const wThisWeek = weekWorkouts.length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const setsThisWeek = weekWorkouts.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.sets.filter(s => s.done).length, 0), 0)
  const minsThisWeek = weekWorkouts.reduce((n, w) => n + Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000)), 0)
  const weekLoad = loadOfWorkouts(weekWorkouts, null)
  const hasHistory = S.workouts.length > 0
  const streak = Math.max(0, streakDays(S) + (user?.streakBonus || 0))
  const streakTier = tiers ? tierForDays(streak, tiers) : null

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else if (isFreestyleToday) startFlow(null); else dayOverrideSheet(todayISO()) }

  return <div>
    <div className="hdr">
      <div>
        <h1>{user ? t('Hi {0}', user.name) : 'Forvia'}</h1>
        <div className="sub">
          {today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          {' · '}<span style={{ textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, color: 'var(--acc)' }}>{t('Early access')}</span>
        </div>
        {user && <div style={{ marginTop: 8 }}><RankRow streak={hasHistory ? streak : 0} streakTier={streakTier?.artIdx || 1} /></div>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="calendar" /></button>
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          {plannedPerWeek > 0
            ? <Ring size={56} stroke={6} pct={wThisWeek / plannedPerWeek} color={S.active ? 'var(--orange)' : 'var(--acc)'}>
                <span className="ring-badge" style={{ width: 40, height: 40, fontSize: 18, '--tint': S.active ? 'var(--orange)' : (routine || isFreestyleToday) ? 'var(--acc)' : 'var(--surface-3)' }}>
                  <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : isFreestyleToday ? 'shuffle' : 'moon'} />
                </span>
              </Ring>
            : <span className="lrow-i" style={{ width: 40, height: 40, borderRadius: '50%', fontSize: 18, background: S.active ? 'var(--orange)' : (routine || isFreestyleToday) ? 'var(--acc)' : 'var(--surface-3)' }}>
                <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : isFreestyleToday ? 'shuffle' : 'moon'} />
              </span>}
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : isFreestyleToday ? t('Freestyle') : t('Rest day')}{todayOvr && (routine || isFreestyleToday) ? ' · ' + t('rescheduled') : ''}</div>
            {plannedPerWeek > 0 && <div className="sub">{t('{0}/{1} this week', wThisWeek, plannedPerWeek)}</div>}
          </div>
        </div>
        {S.active ? <span className="btn primary sm" style={{ backgroundColor: 'var(--orange)' }}>{t('Resume')}</span>
          : (routine || isFreestyleToday) ? <span className="btn primary sm">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

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

        <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/nutrition')}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>{t('Macros')}</h2>
            <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            {[
              { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
              { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
              { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' }
            ].map(m => <div key={m.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Ring size={92} stroke={8} pct={m.g ? m.v / m.g : 0} color={m.c}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{m.v}/{m.g}<span style={{ fontSize: 10, fontWeight: 500, opacity: .7 }}>g</span></span>
              </Ring>
              <span className="small" style={{ fontWeight: 600 }}>{m.l}</span>
            </div>)}
          </div>
        </div>
      </>
    })()}

    <div className="tiles">
      <div className="tile k-green">
        <div className="ringwrap"><Ring size={34} stroke={4} pct={plannedPerWeek ? wThisWeek / plannedPerWeek : 1} color="var(--green)"><Icon name="dumbbell" style={{ fontSize: 14 }} /></Ring></div>
        <div className="v">{wThisWeek}{plannedPerWeek ? '/' + plannedPerWeek : ''}</div><div className="l">{t('This week')}</div>
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
