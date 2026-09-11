import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { customFoodDefSheet } from '../../sheets.jsx'

// "Mis alimentos" — reusable food definitions (one rate per food, weight- or unit-based —
// see CustomFoodDefForm in sheets.jsx), separate from foodDiary's day-by-day logged
// instances of actually eating one. Populated either from here directly or automatically
// the first time a food is logged via "Create custom food" in the search sheet.
export default function SettingsNutritionFoods() {
  const nav = useNavigate()
  const foods = useStore(s => s.S.customFoods)

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/nutrition')} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('My foods')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Create foods here to reuse them later without retyping their macros.')}</p>

    {foods.length === 0
      ? <div className="empty"><div className="ico"><Icon name="sparkles" /></div>{t('No custom foods yet.')}</div>
      : <div className="list" style={{ marginBottom: 14 }}>
        {foods.map(f => (
          <div key={f.id} className="item" onClick={() => customFoodDefSheet(f)}>
            <div className="grow">
              <div className="tt">{f.name}</div>
              <div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
      </div>}

    <Button variant="primary" onClick={() => customFoodDefSheet()}>{t('New food')}</Button>
  </div>
}
