import { t } from '../lib/i18n.js'

// One bar, two segments: grey for whatever "already used" of a goal (Nutrition.jsx's
// meal cards pass in earlier meals' totals), then the caller's own share in its real
// color — clipped to the track's rounded ends by the parent's overflow:hidden, so
// neither segment needs its own border-radius. `prior={0}` (LogQuantitySheet's preview
// of a single not-yet-logged item) just renders the plain single-fill bar.
export function StackedBar({ prior, own, goal, color }) {
  const priorPct = goal ? Math.min(100, (prior / goal) * 100) : 0
  const ownPct = goal ? Math.min(100 - priorPct, (own / goal) * 100) : 0
  return <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', display: 'flex' }}>
    {priorPct > 0 && <div style={{ width: priorPct + '%', height: '100%', background: 'var(--grey)', flex: 'none' }} />}
    {ownPct > 0 && <div style={{ width: ownPct + '%', height: '100%', background: color, flex: 'none' }} />}
  </div>
}

// Shared by NutritionFoodDetail.jsx (log/edit a food) and NutritionFoodCreate.jsx (define one
// manually) — splits by each macro's actual calorie share (carbs/protein 4 kcal/g, fat 9)
// rather than by gram weight, the same arithmetic the kcal figure itself comes from. Sized and
// classed for those two screens' own hero treatment (.food-detail-ring/-label, index.css) —
// NutritionDiary.jsx's day-total ring is a smaller, denser summary card by design and keeps
// its own separate implementation rather than forcing one shared component into both roles.
export function MacroRing({ kcal, carbs, fat, protein }) {
  const carbsKcal = carbs * 4, fatKcal = fat * 9, proteinKcal = protein * 4
  const macroTotal = carbsKcal + fatKcal + proteinKcal
  return (
    <div className="food-detail-ring">
      <svg width="148" height="148" viewBox="0 0 148 148">
        <circle cx="74" cy="74" r="60" fill="none" stroke="var(--glass-border)" strokeWidth="14" />
        {macroTotal > 0 && [
          { v: carbsKcal, color: 'var(--orange)' },
          { v: fatKcal, color: 'var(--indigo)' },
          { v: proteinKcal, color: 'var(--blue)' },
        ].reduce((acc, seg) => {
          const frac = seg.v / macroTotal
          const C = 2 * Math.PI * 60
          if (seg.v > 0) acc.arcs.push(
            <circle key={seg.color} cx="74" cy="74" r="60" fill="none" stroke={seg.color} strokeWidth="14"
              strokeDasharray={`${frac * C} ${C - frac * C}`} strokeDashoffset={-acc.cum * C}
              transform="rotate(-90 74 74)" />
          )
          acc.cum += frac
          return acc
        }, { arcs: [], cum: 0 }).arcs}
      </svg>
      <div className="food-detail-ring-label">
        <span className="n">{kcal}</span>
        <span className="u">{t('kcal')}</span>
      </div>
    </div>
  )
}
