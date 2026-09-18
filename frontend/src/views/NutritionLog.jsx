import { useNavigate, useSearchParams } from 'react-router-dom'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS } from '../lib/nutrition.js'
import Icon from '../components/Icon.jsx'
import { Section } from '../components/ui.jsx'
import { foodSearchSheet, barcodeScanSheet, customFoodSheet, scanMacrosSheet, createMealSheet } from '../sheets.jsx'

// Landing page for "Log it"/"Log more" — was a direct jump into the search sheet, which left
// no room for the other ways to add a food (barcode, OCR) without burying them as rows inside
// that same sheet. Now a real page: one section per family of methods, each method its own
// small card so a future one (AI scan is wired up disabled, ready for when it lands) just
// slots in without restructuring anything.
function MethodCard({ icon, label, sub, onClick, disabled }) {
  return (
    <button type="button" className={'method-card' + (disabled ? ' disabled' : ' tappable')}
      onClick={disabled ? undefined : onClick} disabled={disabled}>
      <span className="icn"><Icon name={icon} /></span>
      <span className="lbl">{label}</span>
      {sub && <span className="sub">{sub}</span>}
    </button>
  )
}

export default function NutritionLog() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const dateIso = params.get('d') || todayISO()
  const mealKey = params.get('m') || MEALS[0].key
  // Same feature check FoodSearchSheet used to gate its own barcode row on — no point
  // offering a card that can only ever fail on a browser with no BarcodeDetector.
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Add food')}</h1></div>
    </div>

    <Section title={t('Search')}>
      <div className="method-grid">
        <MethodCard icon="magnifier" label={t('Search')} onClick={() => foodSearchSheet(dateIso, mealKey)} />
        {canScan && <MethodCard icon="barcode" label={t('Scan barcode')} onClick={() => barcodeScanSheet(dateIso, mealKey)} />}
        <MethodCard icon="sparkles" label={t('Scan with AI')} sub={t('Coming soon')} disabled />
      </div>
    </Section>

    <Section title={t('Create')}>
      <div className="method-grid">
        <MethodCard icon="pencil" label={t('Create manually')} onClick={() => customFoodSheet(dateIso, mealKey)} />
        <MethodCard icon="camera" label={t('Scan macros')} sub={t('Experimental')} onClick={() => scanMacrosSheet(dateIso, mealKey)} />
        <MethodCard icon="clipboard" label={t('Create meal')} onClick={() => createMealSheet()} />
      </div>
    </Section>
  </div>
}
