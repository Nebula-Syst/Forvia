import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Ring from '../components/Ring.jsx'
import Icon from '../components/Icon.jsx'

// Phase 1 shell (see the nutrition plan) — the diary itself is real (reads/writes
// S.foodDiary/S.nutritionGoals, syncs like everything else in S), but there's no food
// search/barcode backend yet, so "+" just says so for now instead of opening a dead sheet.
const MEALS = [
  { key: 'breakfast', name: () => t('Breakfast'), color: 'var(--orange)' },
  { key: 'lunch', name: () => t('Lunch'), color: 'var(--blue)' },
  { key: 'dinner', name: () => t('Dinner'), color: 'var(--indigo)' },
  { key: 'snack', name: () => t('Snack'), color: 'var(--acc)' }
]

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const goals = S.nutritionGoals
  const today = S.foodDiary[todayISO()] || []

  const sum = key => today.reduce((n, it) => n + (it[key] || 0), 0)
  const kcal = sum('kcal'), carbs = sum('carbsG'), fat = sum('fatG'), protein = sum('proteinG')
  const notReady = () => toast(t('Food search isn’t connected yet — coming soon.'))

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Nutrition')}</h1><div className="sub">{t('Today')}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings/nutrition')} aria-label={t('Nutrition goals')}><Icon name="target" /></button>
    </div>

    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 12 }}>
      <Ring size={92} stroke={9} pct={goals.calories ? kcal / goals.calories : 0} color="var(--acc)">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{kcal}</div>
          <div className="dim" style={{ fontSize: 11 }}>{t('of {0} kcal', goals.calories)}</div>
        </div>
      </Ring>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
          { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
          { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' }
        ].map(m => <div key={m.l}>
          <div className="row between small" style={{ marginBottom: 3 }}>
            <span className="muted">{m.l}</span><span className="dim">{m.v} / {m.g}g</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: Math.min(100, m.g ? (m.v / m.g) * 100 : 0) + '%', height: '100%', background: m.c }} />
          </div>
        </div>)}
      </div>
    </div>

    <div className="list" style={{ marginBottom: 14 }}>
      {MEALS.map(meal => {
        const items = today.filter(it => it.meal === meal.key)
        const mealKcal = items.reduce((n, it) => n + (it.kcal || 0), 0)
        return <div key={meal.key} className="card">
          <div className="row between" style={{ marginBottom: items.length ? 8 : 0 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="lrow-i" style={{ width: 32, height: 32, borderRadius: 9, fontSize: 15, background: `color-mix(in srgb, ${meal.color} 20%, transparent)`, color: meal.color }}>
                <Icon name="plate" />
              </span>
              <h2 style={{ margin: 0, fontSize: 16 }}>{meal.name()}</h2>
            </div>
            <div className="row" style={{ gap: 10 }}>
              {!!mealKcal && <span className="dim small">{mealKcal} kcal</span>}
              <button className="iconbtn" style={{ width: 28, height: 28, fontSize: 13 }} onClick={notReady} aria-label={t('Add food')}><Icon name="plus" /></button>
            </div>
          </div>
          {items.length === 0
            ? <div className="dim small">{t('No items logged yet')}</div>
            : items.map(it => <div key={it.id} className="row between small" style={{ padding: '4px 0' }}>
                <span>{it.name}</span><span className="dim">{it.kcal} kcal</span>
              </div>)}
        </div>
      })}
    </div>
  </div>
}
