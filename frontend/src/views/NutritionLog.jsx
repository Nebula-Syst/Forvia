import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS } from '../lib/nutrition.js'
import { aiScanStatus } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Section, MethodCard } from '../components/ui.jsx'
import { barcodeScanSheet, scanMacrosSheet, aiScanSheet, startMealCreate, logFoodItem } from '../sheets.jsx'

// Landing page for "Log it"/"Log more" — was a direct jump into the search sheet, which left
// no room for the other ways to add a food (barcode, OCR) without burying them as rows inside
// that same sheet. Now a real page: one section per family of methods, each method its own
// small card.

export default function NutritionLog() {
  const nav = useNavigate()
  const clipboard = useUI(s => s.foodClipboard)
  const [params] = useSearchParams()
  const dateIso = params.get('d') || todayISO()
  const mealKey = params.get('m') || MEALS[0].key
  // Same feature check FoodSearchSheet used to gate its own barcode row on — no point
  // offering a card that can only ever fail on a browser with no BarcodeDetector.
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window
  // Off entirely on an instance with no OPENAI_API_KEY set — stays exactly like the old
  // hardcoded-disabled placeholder until then.
  const [aiStatus, setAiStatus] = useState(null)
  useEffect(() => { aiScanStatus().then(setAiStatus).catch(() => setAiStatus(null)) }, [])

  // The clipboard (NutritionDiary.jsx's per-meal Copy, NutritionFoodDetail.jsx's per-item
  // Copy) isn't cleared on paste — same "copy once, paste into several days/meals" semantics
  // as a real clipboard — so pasting here again, or on another day, keeps working.
  const paste = () => {
    clipboard.items.forEach(item => logFoodItem(dateIso, mealKey, item))
    nav('/nutrition/diary?d=' + dateIso, { replace: true })
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Add food')}</h1></div>
    </div>

    {clipboard && (
      <Section title={t('Paste')}>
        <div className="method-grid">
          <MethodCard icon="clipboard" label={t('Paste')}
            sub={clipboard.items.length === 1 ? t('{0} item from {1}', clipboard.items.length, clipboard.label) : t('{0} items from {1}', clipboard.items.length, clipboard.label)}
            onClick={paste} />
        </div>
      </Section>
    )}

    <Section title={t('Search')}>
      <div className="method-grid">
        <MethodCard icon="magnifier" label={t('Search')} onClick={() => nav('/nutrition/food-search?d=' + dateIso + '&m=' + mealKey)} />
        {canScan && <MethodCard icon="barcode" label={t('Scan barcode')} onClick={() => barcodeScanSheet(dateIso, mealKey)} />}
        {aiStatus?.enabled
          ? <MethodCard icon="sparkles" label={t('Scan with AI')}
              sub={aiStatus.credits > 0 ? t('{0} credits left', aiStatus.credits) : t('Buy credits')}
              onClick={() => aiStatus.credits > 0 ? aiScanSheet(dateIso, mealKey) : nav('/settings/ai-credits')} />
          : <MethodCard icon="sparkles" label={t('Scan with AI')} sub={t('Coming soon')} disabled />}
      </div>
    </Section>

    <Section title={t('Create')}>
      <div className="method-grid">
        <MethodCard icon="pencil" label={t('Create manually')} onClick={() => nav('/nutrition/food-create?d=' + dateIso + '&m=' + mealKey)} />
        <MethodCard icon="camera" label={t('Scan macros')} sub={t('Experimental')} onClick={() => scanMacrosSheet(dateIso, mealKey)} />
        <MethodCard icon="clipboard" label={t('Create meal')} onClick={() => startMealCreate('/nutrition/log?d=' + dateIso + '&m=' + mealKey)} />
      </div>
    </Section>
  </div>
}
