import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { savedMealDetailSheet, createMealSheet } from '../../sheets.jsx'

// "Mis comidas" — bundles of food items, either saved from a meal card's clipboard button
// (Nutrition.jsx, from something already logged) or built here from scratch by searching
// and combining several foods (createMealSheet) before ever logging anything.
export default function SettingsNutritionMeals() {
  const nav = useNavigate()
  const meals = useStore(s => s.S.savedMeals)
  const pro = useStore(s => s.user?.pro)
  // A downgrade from Pro can leave more than 5 around — the extras (oldest 5 stay unlocked)
  // still show here and can still be deleted, just can't be logged until back on Pro (enforced
  // in sheets.jsx's logSavedMeal/FoodSearchSheet).
  const lockedIds = new Set(pro ? [] : meals.slice(5).map(m => m.id))

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/nutrition')} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('My meals')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Save a combination of foods once, log it again in one tap.')}</p>

    {meals.length === 0
      ? <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No saved meals yet.')}</div>
      : <div className="list">
        {meals.map(m => (
          <div key={m.id} className="item" onClick={() => savedMealDetailSheet(m)}>
            <div className="grow">
              <div className="tt">{m.name}</div>
              <div className="ss">{t('{0} items · {1} kcal', m.items.length, m.items.reduce((n, it) => n + (it.kcal || 0), 0))}{lockedIds.has(m.id) ? ` · ${t('Locked')}` : ''}</div>
            </div>
            {lockedIds.has(m.id) && <Icon name="lock" style={{ color: 'var(--label-3)', marginRight: 6 }} />}
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
      </div>}

    <Button variant="primary" onClick={() => createMealSheet()}>{t('New meal')}</Button>
  </div>
}
