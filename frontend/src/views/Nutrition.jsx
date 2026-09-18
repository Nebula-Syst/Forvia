import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, isoOf, uid, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS } from '../lib/nutrition.js'
import { waterGoalForDate } from '../lib/nutrition-goals.js'
import Icon from '../components/Icon.jsx'
import { StackedBar } from '../components/MacroBars.jsx'
import FastingCard from '../components/FastingCard.jsx'
import { calendarSheet, waterLogSheet, saveMealSheet } from '../sheets.jsx'

// One day before the given ISO date — used both for "yesterday" (the repeat-meal shortcut)
// and to keep it relative to whatever day is currently open, not literally today, once the
// calendar lets you browse other days.
const dayBefore = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return isoOf(d) }

// Real food logging now (search via Open Food Facts, custom entries, barcode where the
// browser supports one — see sheets.jsx's "nutrition: food logging" section) and a full
// diary list (NutritionDiary.jsx) behind "See all".

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const goals = S.nutritionGoals
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const isToday = selectedDate === todayISO()
  const today = S.foodDiary[selectedDate] || []
  const yesterday = S.foodDiary[dayBefore(selectedDate)] || []

  const sum = key => today.reduce((n, it) => n + (it[key] || 0), 0)
  const kcal = sum('kcal'), carbs = sum('carbsG'), fat = sum('fatG'), protein = sum('proteinG')
  const remaining = Math.max(0, goals.calories - kcal)
  const allLogged = MEALS.every(meal => today.some(it => it.meal === meal.key))
  const openCalendar = () => calendarSheet(new Date(selectedDate + 'T12:00:00'), setSelectedDate)
  const water = S.waterLog[selectedDate] || 0
  // nutritionGoals is stored/merged as one object (see useStore.js), so an account whose
  // goals were last saved before waterMl existed has the rest of the object but not this key
  // — falls back the same way S.bmrFormula and friends do for a field added after the fact.
  // waterGoalForDate applies the optional "peak week" taper (Settings → Nutrition → Water)
  // on top of that baseline for whichever day is open — a no-op unless it's actually enabled.
  const waterGoal = waterGoalForDate(goals.waterMl || 2000, S.waterProtocol, selectedDate)
  // Copies yesterday's items for one meal into the open day under fresh ids — the one real
  // action in an otherwise manual-entry-only diary, since re-logging an identical meal is
  // common enough to be worth wiring up on its own. "Yesterday" here means the day before
  // whichever day is open, not literally today, now that the calendar lets you browse others.
  const repeatYesterday = items => {
    update(s => {
      const list = s.foodDiary[selectedDate] || (s.foodDiary[selectedDate] = [])
      items.forEach(it => list.push({ ...it, id: uid() }))
    })
    toast(t('Meal logged'))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="row" style={{ gap: 4, background: 'none', border: 'none', padding: 0 }} onClick={openCalendar}>
        <h1 style={{ margin: 0 }}>{isToday ? t('Today') : fmtDate(selectedDate, true)}</h1>
        <Icon name="chevronDown" style={{ fontSize: 18, color: 'var(--label-2)' }} />
      </button>
      <div className="row" style={{ gap: 14 }}>
        <span className="row" style={{ gap: 5, fontSize: 20, fontWeight: 800 }}>
          {remaining}<Icon name="bolt" style={{ fontSize: 17, color: 'var(--acc)' }} />
        </span>
        <button className="iconbtn" onClick={() => nav('/settings/nutrition')} aria-label={t('Nutrition goals')}><Icon name="target" /></button>
      </div>
    </div>

    {/* Compact, unlabeled version of the same three macro fractions the Macros card
        below spells out in full — a glanceable strip right under the header, same
        idiom as the reference screenshot's three bare progress pills. */}
    <div className="row" style={{ gap: 10, marginBottom: 16 }}>
      {[
        { v: carbs, g: goals.carbsG, c: 'var(--orange)' },
        { v: fat, g: goals.fatG, c: 'var(--indigo)' },
        { v: protein, g: goals.proteinG, c: 'var(--blue)' }
      ].map((m, i) => (
        <div key={i} style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: Math.min(100, m.g ? (m.v / m.g) * 100 : 0) + '%', height: '100%', borderRadius: 99, background: m.c }} />
        </div>
      ))}
    </div>

    {/* Same two-card language as Home's calories/macros pair — 1-line calorie bar, then a
        ring per macro with the current/goal grams inside it — kept consistent rather than
        inventing a third layout just because this page has more room to work with. */}
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Calories')}</h2>
        <span className="dim small">{t('{0} / {1} kcal', kcal, goals.calories)}</span>
      </div>
      <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: Math.min(100, goals.calories ? (kcal / goals.calories) * 100 : 0) + '%', height: '100%', background: 'var(--acc)' }} />
      </div>
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ margin: '0 0 16px' }}>{t('Macros')}</h2>
      {[
        { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
        { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
        { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' }
      ].map((m, i) => {
        const pct = Math.min(100, m.g ? (m.v / m.g) * 100 : 0)
        return <div key={m.l} style={i > 0 ? { marginTop: 18 } : null}>
          <div className="row between" style={{ marginBottom: 8, alignItems: 'baseline' }}>
            <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: m.c, flex: 'none' }} />
              {m.l}
            </span>
            <span className="small" style={{ color: 'var(--label-2)' }}>
              <b style={{ color: 'var(--label)', fontWeight: 700 }}>{m.v}</b> / {m.g}g · {Math.round(pct)}%
            </span>
          </div>
          <div style={{ height: 11, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ width: pct + '%', height: '100%', borderRadius: 99, background: m.c, position: 'relative' }}>
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 14, borderRadius: 99, background: 'color-mix(in srgb, #fff 35%, transparent)', filter: 'blur(2px)' }} />
            </div>
          </div>
        </div>
      })}
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 className="row" style={{ margin: 0, gap: 6 }}><Icon name="drop" style={{ fontSize: 16, color: 'var(--blue)' }} />{t('Water')}</h2>
        <span className="dim small">{t('{0} / {1} ml', water, waterGoal)}</span>
      </div>
      <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: Math.min(100, waterGoal ? (water / waterGoal) * 100 : 0) + '%', height: '100%', background: 'var(--blue)' }} />
      </div>
      <button className="btn tinted" style={{ width: '100%' }} onClick={() => waterLogSheet(selectedDate)}>{t('Log water')}</button>
    </div>

    <FastingCard />

    <div className="row between" style={{ margin: '4px 0 10px' }}>
      <div style={{ fontSize: 19, fontWeight: 700 }}>{t('Diary')}</div>
      <button className="small" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--label-2)', fontWeight: 600 }} onClick={() => nav('/nutrition/diary?d=' + selectedDate)}>{t('See all')}</button>
    </div>

    <div className="list" style={{ marginBottom: 14 }}>
      {(() => {
        // Every meal's own totals, computed once up front — each meal's bars below need not
        // just its own numbers but every *earlier* meal's too (see priorKeys on MEALS).
        const totals = {}
        MEALS.forEach(m => {
          const items = today.filter(it => it.meal === m.key)
          totals[m.key] = {
            items,
            kcal: items.reduce((n, it) => n + (it.kcal || 0), 0),
            carbs: items.reduce((n, it) => n + (it.carbsG || 0), 0),
            fat: items.reduce((n, it) => n + (it.fatG || 0), 0),
            protein: items.reduce((n, it) => n + (it.proteinG || 0), 0),
          }
        })
        return MEALS.map(meal => {
          const { items, kcal: mealKcal, carbs: mealCarbs, fat: mealFat, protein: mealProtein } = totals[meal.key]
          const prior = meal.priorKeys.reduce((acc, k) => {
            acc.kcal += totals[k].kcal; acc.carbs += totals[k].carbs; acc.fat += totals[k].fat; acc.protein += totals[k].protein
            return acc
          }, { kcal: 0, carbs: 0, fat: 0, protein: 0 })
          const summary = items.length ? (items.length === 1 ? items[0].name : t('{0} and {1} more', items[0].name, items.length - 1)) : null
          const yItems = yesterday.filter(it => it.meal === meal.key)
          const ySummary = yItems.length === 1 ? yItems[0].name : t('{0} and {1} more', yItems[0]?.name, yItems.length - 1)
          return <div key={meal.key} className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/nutrition/diary?d=' + selectedDate + '&m=' + meal.key)}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="lrow-i" style={{ width: 32, height: 32, borderRadius: 9, fontSize: 15, background: `color-mix(in srgb, ${meal.color} 20%, transparent)`, color: meal.color }}>
                  <Icon name={meal.icon} />
                </span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: 'none', letterSpacing: 0, color: 'var(--label)' }}>{meal.name()}</h2>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {items.length > 0 && (
                  <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label={t('Save as meal')}
                    onClick={e => { e.stopPropagation(); saveMealSheet(items) }}>
                    <Icon name="clipboard" style={{ fontSize: 13 }} />
                  </button>
                )}
                <button className="btn xs tinted" onClick={e => { e.stopPropagation(); nav('/nutrition/log?d=' + selectedDate + '&m=' + meal.key) }}>{t('Log it')}</button>
              </div>
            </div>
            {/* Always separated from the header, not just when there's a repeat-yesterday row
                to divide — the empty "No items logged yet" state used to sit right under the
                header with no breathing room at all. */}
            <div className="divider" style={{ margin: '0 0 10px' }} />
            <div style={{ marginBottom: 10 }}>
              {items.length > 0
                ? <div className="small" style={{ color: 'var(--label-2)' }}>{summary}</div>
                : yItems.length > 0
                  ? <button className="row between" style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left' }} onClick={e => { e.stopPropagation(); repeatYesterday(yItems) }}>
                    <div>
                      <div className="small" style={{ fontWeight: 700 }}>{t('Repeat yesterday’s meal')}</div>
                      <div className="dim small">{ySummary}</div>
                    </div>
                    <Icon name="plus" style={{ color: 'var(--label-3)' }} />
                  </button>
                  : <div className="dim small">{t('No items logged yet')}</div>}
            </div>
            {/* A second divider — between what was eaten and how it counts toward the day —
                rather than reusing the one above, which separates the header from everything
                else regardless of state. */}
            <div className="divider" style={{ margin: '0 0 10px' }} />
            {/* Same two-tier bar language as the page header above (one full calorie line,
                then a row of three macro lines), always shown — even with nothing logged
                for *this* meal yet, earlier meals may already have used up real budget, and
                that grey segment is worth seeing before you decide what to add here. */}
            <div className="row between" style={{ marginBottom: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>{t('Calories')}</span>
              <span className="small" style={{ color: 'var(--label-2)' }}>{t('{0} kcal', mealKcal)}</span>
            </div>
            <div style={{ marginBottom: 10 }}><StackedBar prior={prior.kcal} own={mealKcal} goal={goals.calories} color="var(--acc)" /></div>
            <div className="row" style={{ gap: 10 }}>
              {[
                { l: t('Carbs'), v: mealCarbs, p: prior.carbs, g: goals.carbsG, c: 'var(--orange)' },
                { l: t('Fat'), v: mealFat, p: prior.fat, g: goals.fatG, c: 'var(--indigo)' },
                { l: t('Protein'), v: mealProtein, p: prior.protein, g: goals.proteinG, c: 'var(--blue)' }
              ].map((m, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.l}</span>
                    <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.v}g</span>
                  </div>
                  <StackedBar prior={m.p} own={m.v} goal={m.g} color={m.c} />
                </div>
              ))}
            </div>
          </div>
        })
      })()}
    </div>

    {allLogged && <div className="row" style={{ justifyContent: 'center', gap: 8, margin: '4px 0 20px', color: 'var(--label-2)', fontWeight: 700 }}>
      <Icon name="check" style={{ color: 'var(--acc)' }} />{t('Diary complete')}
    </div>}
  </div>
}
