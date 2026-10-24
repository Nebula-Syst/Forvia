import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, uid } from '../lib/format.js'
import { MEALS } from '../lib/nutrition.js'
import { aiScanStatus } from '../lib/api.js'
import { MacroRing } from '../components/MacroBars.jsx'
import { TextField, Button, Section, MethodCard } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { barcodeScanSheet, aiScanSheet } from '../sheets.jsx'

// Was CreateMealSheet, a bottom sheet with its own cramped, search-only "add ingredient" step
// (IngredientSearch/IngredientQtyForm, now gone) — building a reusable meal (recipe) out of
// several foods deserved the same three ways NutritionLog.jsx itself offers to add one: search
// the food database, scan a barcode, or define a brand new food. All three now reuse THOSE
// exact screens (NutritionFoodSearch.jsx, BarcodeScanSheet, NutritionFoodCreate.jsx) in a
// `forMeal` mode that collects into this draft instead of logging to a specific day — see
// useUI's mealDraft, the thing that survives those screens' own navigate-away-and-back.
export default function NutritionMealCreate() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const draft = useUI(s => s.mealDraft)
  const startMealDraft = useUI(s => s.startMealDraft)
  const setMealDraftName = useUI(s => s.setMealDraftName)
  const removeFromMealDraft = useUI(s => s.removeFromMealDraft)
  const clearMealDraft = useUI(s => s.clearMealDraft)
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window
  const [aiEnabled, setAiEnabled] = useState(false)
  useEffect(() => { aiScanStatus().then(s => setAiEnabled(!!s.enabled)).catch(() => {}) }, [])

  // Landing here fresh (not back from a sub-flow that already filled one in) needs a draft to
  // bind the name field and item list to.
  useEffect(() => { if (!draft) startMealDraft() }, [draft, startMealDraft])

  const items = draft?.items || []
  const totals = items.reduce((a, it) => ({
    kcal: a.kcal + (it.kcal || 0), carbs: a.carbs + (it.carbsG || 0), fat: a.fat + (it.fatG || 0), protein: a.protein + (it.proteinG || 0),
  }), { kcal: 0, carbs: 0, fat: 0, protein: 0 })

  // A placeholder day/meal — the three add-ingredient screens need one in their URL (they're
  // also reachable for an ordinary day-specific log), but forMeal:true means none of them ever
  // actually logs anything against it.
  const placeholderDate = todayISO(), placeholderMeal = MEALS[0].key
  const addFood = () => nav('/nutrition/food-search?d=' + placeholderDate + '&m=' + placeholderMeal, { state: { forMeal: true } })
  const createFood = () => nav('/nutrition/food-create?d=' + placeholderDate + '&m=' + placeholderMeal, { state: { forMeal: true } })
  const scanBarcode = () => barcodeScanSheet(placeholderDate, placeholderMeal, { forMeal: true })
  const scanAi = () => aiScanSheet(placeholderDate, placeholderMeal, { forMeal: true })

  // nav(-1) would be one step back in *browser* history, which the add-ingredient sub-flows
  // (some pushed, some replaced underneath) leave in an unpredictable shape — returnTo (set
  // once, when the draft started, by whichever screen's "Create meal" button got here) is
  // reliable regardless of how many of those round-trips happened in between.
  const exit = () => { const to = draft?.returnTo || '/nutrition/log'; clearMealDraft(); nav(to, { replace: true }) }

  const save = () => {
    const n = (draft?.name || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!items.length) { toast(t('Add at least one ingredient')); return }
    useStore.getState().update(s => { s.savedMeals.push({ id: uid(), name: n, items }) })
    toast(t('Meal saved'))
    exit()
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={exit} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1 className="hdr-sub">{t('Create meal')}</h1></div>
    </div>

    <TextField autoFocus placeholder={t('Name')} value={draft?.name || ''} onChange={e => setMealDraftName(e.target.value)}
      style={{ width: '100%', marginBottom: 18 }} />

    {items.length > 0 && <>
      <MacroRing kcal={totals.kcal} carbs={totals.carbs} fat={totals.fat} protein={totals.protein} />
      <div className="list" style={{ margin: '6px 0 18px' }}>
        {items.map((it, i) => (
          <div key={i} className="item">
            <div className="grow">
              <div className="tt">{it.name}</div>
              <div className="ss">{it.grams != null ? it.grams + ' g' : t('{0} units', it.units)}</div>
            </div>
            <span style={{ fontWeight: 700, marginRight: 6 }}>{it.kcal}</span>
            <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={() => removeFromMealDraft(i)} aria-label={t('Delete')}><Icon name="xmark" /></button>
          </div>
        ))}
      </div>
    </>}

    <Section title={t('Add ingredient')}>
      <div className="method-grid">
        <MethodCard icon="magnifier" label={t('Search')} onClick={addFood} />
        {canScan && <MethodCard icon="barcode" label={t('Scan barcode')} onClick={scanBarcode} />}
        <MethodCard icon="pencil" label={t('Create manually')} onClick={createFood} />
        {aiEnabled && <MethodCard icon="sparkles" label={t('Scan with AI')} onClick={scanAi} />}
      </div>
    </Section>

    <Button variant="primary" onClick={save} disabled={!items.length}>{t('Save meal')}</Button>
    <div style={{ height: 20 }} />
  </div>
}
