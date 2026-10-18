import { useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, uid } from '../lib/format.js'
import { createPublicFood } from '../lib/api.js'
import { MEALS } from '../lib/nutrition.js'
import { MacroRing } from '../components/MacroBars.jsx'
import { Segmented, Stepper, TextField, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { logFoodItem, mealOptions, FOOD_QTY_MODES } from '../sheets.jsx'

const FOOD_VISIBILITY = () => [{ value: 'private', label: t('Private') }, { value: 'public', label: t('Public') }]

// Was CustomFoodForm, a bottom sheet (also reused, pre-filled, as the review step after
// ScanMacrosSheet's OCR pass — see its own `initial`/`title` handoff via location.state).
// A custom food's macros are entered as a rate (per 100g, or per single unit — "manzana" is
// the same food whether you log 200g of it or 10 of them) plus a quantity in whichever unit
// the rate is in, exactly like a searched result's kcal100/grams — not a flat total for
// "whatever I ate right now". That's what lets NutritionFoodDetail.jsx's edit mode later
// touch only the quantity and never the macros directly, the same as any other logged item.
export default function NutritionFoodCreate() {
  const nav = useNavigate()
  const location = useLocation()
  const toast = useUI(s => s.toast)
  const setMealDraft = useUI(s => s.addToMealDraft)
  const [params] = useSearchParams()
  const dateIso = params.get('d') || todayISO()
  const mealParam = params.get('m') || MEALS[0].key
  const initial = location.state?.initial || null
  const screenTitle = location.state?.title || null
  // Reached from NutritionMealCreate.jsx building a reusable meal — Save collects the new
  // food into that draft (and still remembers it in "Mis alimentos", same as logging one
  // normally does) instead of logging it to a specific day/meal.
  const forMeal = !!location.state?.forMeal
  const canGoPublic = !useStore(s => s.isGuest())

  const [name, setName] = useState('')
  const [mode, setMode] = useState('weight')
  const [kcalRate, setKcalRate] = useState(initial?.kcal || 0)
  const [carbsRate, setCarbsRate] = useState(initial?.carbs || 0)
  const [fatRate, setFatRate] = useState(initial?.fat || 0)
  const [proteinRate, setProteinRate] = useState(initial?.protein || 0)
  const [qty, setQty] = useState(100)
  const [meal, setMeal] = useState(mealParam)
  const [visibility, setVisibility] = useState('private')

  const switchMode = m => { setMode(m); setQty(m === 'weight' ? 100 : 1) }
  const factor = mode === 'weight' ? (qty || 0) / 100 : (qty || 0)
  const kcal = Math.round(kcalRate * factor)
  const carbs = Math.round(carbsRate * factor)
  const fat = Math.round(fatRate * factor)
  const protein = Math.round(proteinRate * factor)

  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!qty || qty <= 0) { toast(t('Enter a valid amount')); return }
    const item = { name: n, kcal, carbsG: carbs, fatG: fat, proteinG: protein }
    if (mode === 'weight') item.grams = qty; else item.units = qty
    forMeal ? setMealDraft(item) : logFoodItem(dateIso, meal, item)
    // Also remembered in "Mis alimentos" (Settings → Nutrition) so this exact food/mode can
    // be re-logged in a different quantity later without retyping its macros — skipped if
    // the same name+mode is already there (edited from Settings, or logged once before).
    // Kept regardless of visibility: sharing it publicly doesn't stop it being useful to
    // re-log for yourself too.
    useStore.getState().update(s => {
      if (!s.customFoods.some(f => f.name.toLowerCase() === n.toLowerCase() && f.mode === mode)) {
        s.customFoods.push({ id: uid(), name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
      }
    })
    if (visibility === 'public') {
      createPublicFood({ name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
        .catch(() => toast(t('Saved, but sharing it publicly failed — try again from “My foods”.')))
    }
    nav(forMeal ? '/nutrition/meal-create' : '/nutrition/diary?d=' + dateIso, { replace: true })
  }

  return <div className="narrow food-detail-view">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1 className="hdr-sub">{screenTitle || t('Create custom food')}</h1></div>
    </div>

    {/* A scanned label's numbers came from OCR reading a photo, not a database — worth a
        beat of "double-check this before you trust it", not just quietly pre-filled. */}
    {initial && <p className="dim small" style={{ margin: '0 0 14px' }}>{t('Check the values read from the label before saving.')}</p>}

    <MacroRing kcal={kcal} carbs={carbs} fat={fat} protein={protein} />

    <TextField autoFocus placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />

    <Segmented options={FOOD_QTY_MODES()} value={mode} onChange={switchMode} />
    <div className="dim small" style={{ margin: '14px 0 8px' }}>{mode === 'weight' ? t('Per 100g') : t('Per unit')}</div>
    <div className="grid2" style={{ marginBottom: 16 }}>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Calories')}</div><Stepper value={kcalRate} step={10} decimal={false} onChange={setKcalRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Carbs')} (g)</div><Stepper value={carbsRate} step={1} onChange={setCarbsRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Fat')} (g)</div><Stepper value={fatRate} step={1} onChange={setFatRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Protein')} (g)</div><Stepper value={proteinRate} step={1} onChange={setProteinRate} /></div>
    </div>

    <div className="food-detail-qty">
      <Stepper value={qty} step={mode === 'weight' ? 10 : 1} decimal={false} onChange={setQty}
        unit={mode === 'weight' ? t('g') : t('units')} label={t('Amount')} />
    </div>

    {!forMeal && <>
      <div style={{ height: 18 }} />
      <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    </>}

    {canGoPublic && <>
      <div className="dim small" style={{ margin: '18px 0 6px' }}>{t('Visibility')}</div>
      <Segmented options={FOOD_VISIBILITY()} value={visibility} onChange={setVisibility} />
      <div className="dim small" style={{ margin: '6px 2px 0' }}>
        {visibility === 'public' ? t('Anyone can find and use this food when searching — never with your name on it.') : t('Only you can see and use this food.')}
      </div>
    </>}

    <div className="food-detail-actions">
      <Button variant="primary" size="lg" onClick={save}>{forMeal ? t('Add to meal') : t('Log food')}</Button>
    </div>
  </div>
}
