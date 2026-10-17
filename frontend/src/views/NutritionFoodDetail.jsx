import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { StackedBar } from '../components/MacroBars.jsx'
import { Segmented, Stepper, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { lockedIds, logFoodItem, mealOptions, FOOD_QTY_MODES } from '../sheets.jsx'

// Was two different bottom sheets (LogQuantitySheet for an Open Food Facts/barcode result,
// LogCustomFoodSheet for one of "Mis alimentos"/the community database) stacked over a third
// (FoodSearchSheet) — now one full screen, reached from NutritionFoodSearch.jsx's list via
// real navigation (the food + which of the two shapes it is ride in location.state, since a
// search result isn't a stable id this screen could refetch by). Serving size first, like
// MyFitnessPal's own food screen, because that's the one choice this whole screen exists for;
// everything else (meal, macros, extra nutrients) is read-only context around it.
export default function NutritionFoodDetail() {
  const nav = useNavigate()
  const { date: dateIso, meal: mealParam } = useParams()
  const location = useLocation()
  const toast = useUI(s => s.toast)
  const food = location.state?.food || null
  const kind = location.state?.kind || null   // 'off' (per-100g) | 'custom' (per-rate, mine/community)

  const customFoods = useStore(s => s.S.customFoods)
  const pro = useStore(s => s.user?.pro)
  const goals = useStore(s => s.S.nutritionGoals)

  const [qtyMode, setQtyMode] = useState('weight')   // 'off' only
  const [grams, setGrams] = useState(100)
  const [units, setUnits] = useState(1)
  const [unitGrams, setUnitGrams] = useState(100)
  const [customQty, setCustomQty] = useState(food?.mode === 'weight' ? 100 : 1)
  const [meal, setMeal] = useState(mealParam)
  const [detail, setDetail] = useState(false)

  // Landed here directly (a refresh, a bookmarked link) with nothing handed over — there's
  // nothing to show, so back to search rather than rendering a broken screen.
  useEffect(() => { if (!food || !kind) nav('/nutrition/log?d=' + dateIso + '&m=' + mealParam, { replace: true }) }, [])
  if (!food || !kind) return null

  const isOff = kind === 'off'
  const effectiveGrams = qtyMode === 'weight' ? (grams || 0) : (units || 0) * (unitGrams || 0)
  const factor = isOff ? effectiveGrams / 100 : (food.mode === 'weight' ? (customQty || 0) / 100 : (customQty || 0))
  const kcal = Math.round((isOff ? food.kcal100 : food.kcal) * factor)
  const carbs = Math.round((isOff ? food.carbs100 : food.carbs) * factor)
  const fat = Math.round((isOff ? food.fat100 : food.fat) * factor)
  const protein = Math.round((isOff ? food.protein100 : food.protein) * factor)

  const save = () => {
    if (isOff) {
      if (qtyMode === 'weight') {
        if (!grams || grams <= 0) { toast(t('Enter a valid amount')); return }
        logFoodItem(dateIso, meal, { name: food.name, grams, kcal, carbsG: carbs, fatG: fat, proteinG: protein })
      } else {
        if (!units || units <= 0 || !unitGrams || unitGrams <= 0) { toast(t('Enter a valid amount')); return }
        logFoodItem(dateIso, meal, { name: food.name, units, kcal, carbsG: carbs, fatG: fat, proteinG: protein })
      }
    } else {
      // Mirrors logCustomFoodSheet's own re-check — a lock can lapse between opening the
      // search list and tapping Save (e.g. a Pro trial ending mid-session).
      if (customFoods.some(f => f.id === food.id) && lockedIds(customFoods, pro).has(food.id)) {
        toast(t('This food is locked — go Pro to use it again.')); return
      }
      if (!customQty || customQty <= 0) { toast(t('Enter a valid amount')); return }
      const item = { name: food.name, kcal, carbsG: carbs, fatG: fat, proteinG: protein }
      if (food.mode === 'weight') item.grams = customQty; else item.units = customQty
      logFoodItem(dateIso, meal, item)
    }
    nav('/nutrition/diary?d=' + dateIso, { replace: true })
  }

  // Calorie contribution per macro (carbs/protein 4 kcal/g, fat 9) rather than splitting the
  // ring by gram weight — a gram of fat isn't worth the same ring real estate as a gram of
  // carbs, and this is the same arithmetic `kcal` itself already comes from.
  const carbsKcal = carbs * 4, fatKcal = fat * 9, proteinKcal = protein * 4
  const macroTotal = carbsKcal + fatKcal + proteinKcal

  return <div className="narrow food-detail-view">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1 className="hdr-sub">{food.name}</h1></div>
    </div>

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

    <div className="food-detail-qty">
      {isOff && <Segmented options={FOOD_QTY_MODES()} value={qtyMode} onChange={setQtyMode} />}
      {isOff && <div style={{ height: 12 }} />}
      {isOff
        ? (qtyMode === 'weight'
          ? <Stepper value={grams} step={10} decimal={false} onChange={setGrams} unit={t('g')} label={t('Amount')} />
          : <div className="row" style={{ gap: 10 }}>
            <Stepper value={units} step={1} decimal={false} onChange={setUnits} unit={t('units')} label={t('Quantity')} />
            <Stepper value={unitGrams} step={5} decimal={false} onChange={setUnitGrams} unit={t('g')} label={t('Weight per unit')} />
          </div>)
        : <Stepper value={customQty} step={food.mode === 'weight' ? 10 : 1} decimal={false} onChange={setCustomQty}
          unit={food.mode === 'weight' ? t('g') : t('units')} label={t('Amount')} />}
    </div>

    <div style={{ height: 18 }} />
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 18 }} />

    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="small" style={{ fontWeight: 600 }}>{t('Calories')}</span>
      <span className="small" style={{ color: 'var(--label-2)' }}>{t('{0} of {1} kcal', kcal, goals.calories)}</span>
    </div>
    <div style={{ marginBottom: 14 }}><StackedBar prior={0} own={kcal} goal={goals.calories} color="var(--acc)" /></div>
    <div className="row" style={{ gap: 10 }}>
      {[
        { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
        { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
        { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' },
      ].map((m, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.l}</span>
            {detail && <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.v}g</span>}
          </div>
          <StackedBar prior={0} own={m.v} goal={m.g} color={m.c} />
          {detail && <div className="dim small" style={{ marginTop: 4, textAlign: 'center' }}>{Math.round(m.g ? m.v / m.g * 100 : 0)}%</div>}
        </div>
      ))}
    </div>

    {isOff && detail && <>
      <div className="divider" style={{ margin: '14px 0 10px' }} />
      {['satFat100', 'sugars100', 'fiber100', 'salt100'].some(k => food[k] != null)
        ? <div className="list">
          {food.satFat100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Saturated fat')}</span><span className="small">{Math.round(food.satFat100 * factor * 10) / 10}g</span></div>}
          {food.sugars100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Sugars')}</span><span className="small">{Math.round(food.sugars100 * factor * 10) / 10}g</span></div>}
          {food.fiber100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Fiber')}</span><span className="small">{Math.round(food.fiber100 * factor * 10) / 10}g</span></div>}
          {food.salt100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Salt')}</span><span className="small">{Math.round(food.salt100 * factor * 10) / 10}g</span></div>}
        </div>
        : <div className="dim small">{t('No further nutrition data for this item.')}</div>}
    </>}
    {isOff && <>
      <div style={{ height: 8 }} />
      <button className="small" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--label-2)', fontWeight: 600 }} onClick={() => setDetail(v => !v)}>
        {detail ? t('Show less') : t('See all nutrients')}
      </button>
    </>}

    <div className="food-detail-actions">
      <Button variant="primary" size="lg" onClick={save}>{t('Log food')}</Button>
    </div>
  </div>
}
