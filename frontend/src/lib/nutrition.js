import { t } from './i18n.js'

// Shared between Nutrition.jsx (day view), NutritionDiary.jsx (full diary list) and
// sheets.jsx (meal pickers) — one source of truth for meal keys/names/icons/colors so all
// three stay in sync instead of drifting.
//
// Chronological order, not the old breakfast/lunch/dinner/snack grouping — `priorKeys` is
// what actually depends on it: each meal's bars (Nutrition.jsx) show a grey segment for
// everything already eaten earlier that day, so lunch needs breakfast counted before it and
// dinner needs breakfast+lunch+snack. Snack itself gets no grey segment (could be a
// mid-morning bite or an afternoon one — its place in the day isn't fixed), it just still
// feeds forward into dinner's total.
export const MEALS = [
  { key: 'breakfast', name: () => t('Breakfast'), color: 'var(--orange)', icon: 'cup', priorKeys: [] },
  { key: 'lunch', name: () => t('Lunch'), color: 'var(--blue)', icon: 'burger', priorKeys: ['breakfast'] },
  { key: 'snack', name: () => t('Snack'), color: 'var(--acc)', icon: 'cookie', priorKeys: [] },
  { key: 'dinner', name: () => t('Dinner'), color: 'var(--indigo)', icon: 'bowl', priorKeys: ['breakfast', 'lunch', 'snack'] },
]
