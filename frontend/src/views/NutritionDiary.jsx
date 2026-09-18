import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS } from '../lib/nutrition.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { mealFilterSheet, editFoodSheet } from '../sheets.jsx'

// The full "everything logged today" list behind Nutrition.jsx's "See all" — a flat, ordered
// view of every item for the day (or one meal of it), instead of the day view's per-meal
// summary cards. `d`/`m` live in the URL rather than component state so the back button and
// a reload both land on the same day/filter, not always today/all.
const KCAL_PER_G = { carbsG: 4, fatG: 9, proteinG: 4 }

// Three colored arcs (carbs/fat/protein, sized by their share of logged calories) around the
// day's total — the single-arc Ring.jsx can't do multiple colors, so this is its own small
// SVG rather than stretching that component to a case it wasn't built for.
function MacroRing({ size, stroke, kcal, carbs, fat, protein }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2, cy = size / 2
  const kc = carbs * KCAL_PER_G.carbsG, kf = fat * KCAL_PER_G.fatG, kp = protein * KCAL_PER_G.proteinG
  const total = kc + kf + kp
  const segs = total > 0 ? [
    { frac: kc / total, color: 'var(--orange)' },
    { frac: kf / total, color: 'var(--indigo)' },
    { frac: kp / total, color: 'var(--blue)' },
  ] : []
  let acc = 0
  return <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      {segs.map((s, i) => {
        const len = s.frac * c
        const offset = -acc
        acc += len
        return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
          strokeDasharray={`${len} ${c - len}`} strokeDashoffset={offset} transform={`rotate(-90 ${cx} ${cy})`} />
      })}
    </svg>
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{kcal}</div>
      <div className="dim small">kcal</div>
    </div>
  </div>
}

export default function NutritionDiary() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const S = useStore(s => s.S)
  const dateIso = params.get('d') || todayISO()
  const filter = params.get('m') || 'all'
  const setFilter = key => setParams({ d: dateIso, m: key }, { replace: true })

  const all = S.foodDiary[dateIso] || []
  const shown = filter === 'all' ? all : all.filter(it => it.meal === filter)
  const sum = key => shown.reduce((n, it) => n + (it[key] || 0), 0)
  const kcal = sum('kcal'), carbs = sum('carbsG'), fat = sum('fatG'), protein = sum('proteinG')
  const macroKcal = carbs * KCAL_PER_G.carbsG + fat * KCAL_PER_G.fatG + protein * KCAL_PER_G.proteinG
  const pctOf = k => macroKcal > 0 ? Math.round(k / macroKcal * 100) : 0

  const filterMeal = MEALS.find(m => m.key === filter)
  const filterLabel = filterMeal ? filterMeal.name() : t('All meals')
  const groups = filter === 'all'
    ? MEALS.map(m => ({ meal: m, items: all.filter(it => it.meal === m.key) })).filter(g => g.items.length)
    : [{ meal: filterMeal, items: shown }]

  return <div className="narrow">
    {/* A plain .hdr h1 (40px, built for a short word like "Hoy") wrapped "Todos los
        alimentos" onto two lines. This is a sub-page selector, not a page title, so it's
        sized and centered like one — a spacer div balances the back button's width so the
        label actually centers in the row instead of just the space right of the button. */}
    <div className="hdr" style={{ alignItems: 'center', margin: '8px 0 16px' }}>
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <button className="row" style={{ flex: 1, justifyContent: 'center', gap: 4, background: 'none', border: 'none', padding: 0, minWidth: 0 }} onClick={() => mealFilterSheet(filter, setFilter)}>
        <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filterLabel}</span>
        <Icon name="chevronDown" style={{ fontSize: 16, color: 'var(--label-2)', flex: 'none' }} />
      </button>
      <div style={{ width: 36, flex: 'none' }} />
    </div>

    <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 20 }}>
      <MacroRing size={104} stroke={12} kcal={kcal} carbs={carbs} fat={fat} protein={protein} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { l: t('Carbs'), v: carbs, k: carbs * KCAL_PER_G.carbsG, c: 'var(--orange)' },
          { l: t('Fat'), v: fat, k: fat * KCAL_PER_G.fatG, c: 'var(--indigo)' },
          { l: t('Protein'), v: protein, k: protein * KCAL_PER_G.proteinG, c: 'var(--blue)' },
        ].map(m => (
          <div key={m.l} className="row" style={{ gap: 10 }}>
            <span style={{ color: m.c, fontWeight: 800, fontSize: 13, width: 30, flex: 'none' }}>{pctOf(m.k)}%</span>
            <span style={{ fontWeight: 700, fontSize: 14, width: 44, flex: 'none' }}>{m.v}g</span>
            <span className="dim small">{m.l}</span>
          </div>
        ))}
      </div>
    </div>

    {groups.length === 0
      ? <div className="dim small" style={{ textAlign: 'center', margin: '30px 0' }}>{t('No items logged yet')}</div>
      : groups.map(({ meal, items }) => (
        <div key={meal.key} style={{ marginBottom: 18 }}>
          {filter === 'all' && <div className="row" style={{ gap: 8, margin: '0 2px 8px' }}>
            <span className="lrow-i" style={{ width: 24, height: 24, borderRadius: 7, fontSize: 12, background: `color-mix(in srgb, ${meal.color} 20%, transparent)`, color: meal.color }}>
              <Icon name={meal.icon} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{meal.name()}</span>
          </div>}
          <div className="list">
            {items.map(it => (
              <div key={it.id} className="item" onClick={() => editFoodSheet(dateIso, it)}>
                <div className="grow">
                  <div className="tt">{it.name}</div>
                  {it.grams != null && <div className="ss">{it.grams + ' g'}</div>}
                  {it.units != null && <div className="ss">{t('{0} units', it.units)}</div>}
                </div>
                <span style={{ fontWeight: 700, marginRight: 6 }}>{it.kcal}</span>
                <Icon name="chevronRight" className="chev" />
              </div>
            ))}
          </div>
        </div>
      ))}

    <Button variant="primary" onClick={() => nav('/nutrition/log?d=' + dateIso + '&m=' + (filter === 'all' ? 'breakfast' : filter))}>{t('Log more')}</Button>
    <div style={{ height: 20 }} />
  </div>
}
