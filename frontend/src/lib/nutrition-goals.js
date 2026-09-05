// Mifflin-St Jeor calorie/macro targets. Pure arithmetic, no store or i18n coupling here so
// the settings page and its test can both call it directly.
//
// The five inputs below are exactly the ones without which the formula is undefined — asking
// for "what's missing" (missingNutritionInputs) rather than letting a NaN or a bogus negative
// number leak into the UI is the point of splitting it out from computeNutritionGoals.

export const ACTIVITY_LEVELS = [
  { value: 'sedentary', mult: 1.2 },
  { value: 'light', mult: 1.375 },
  { value: 'moderate', mult: 1.55 },
  { value: 'active', mult: 1.725 },
  { value: 'very_active', mult: 1.9 },
]
export const ACTIVITY_MULTIPLIERS = Object.fromEntries(ACTIVITY_LEVELS.map(a => [a.value, a.mult]))

export const WEIGHT_GOALS = ['lose', 'maintain', 'gain']

// BMR formulas a person can pick between (SettingsNutrition's "BMR formula" row). Each has a
// different set of required inputs — FORMULA_FIELDS below is what missingNutritionInputs
// checks against instead of always requiring height+age+sex. Labels/descriptions live in the
// view (same split as ACTIVITY_LABELS) since this module stays pure arithmetic.
export const BMR_FORMULAS = ['mifflin', 'harris', 'katch', 'cunningham', 'who']
export const DEFAULT_BMR_FORMULA = 'mifflin'
const FORMULA_FIELDS = {
  mifflin: ['height', 'age', 'sex'],
  harris: ['height', 'age', 'sex'],
  katch: ['bodyFat'],
  cunningham: ['bodyFat'],
  who: ['age', 'sex'],
}
export const formulaNeedsBodyFat = formula => (FORMULA_FIELDS[formula] || FORMULA_FIELDS[DEFAULT_BMR_FORMULA]).includes('bodyFat')

function bmrMifflin({ weightKg, heightCm, age, sex }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161)
}
// Revised Harris-Benedict (Roza & Shizgal 1984) — the older, more commonly known calorie
// calculator; tends to run a little higher than Mifflin-St Jeor, which studies since have
// found more accurate for most people.
function bmrHarris({ weightKg, heightCm, age, sex }) {
  return sex === 'male'
    ? 88.362 + 13.397 * weightKg + 4.799 * heightCm - 5.677 * age
    : 447.593 + 9.247 * weightKg + 3.098 * heightCm - 4.330 * age
}
// Katch-McArdle uses lean body mass instead of total weight — no age or sex term at all — so
// it needs a body-fat % to derive LBM. More accurate for anyone lean or muscular, where two
// people at the same height/weight/age can have very different metabolisms.
function bmrKatch({ weightKg, bodyFatPct }) {
  return 370 + 21.6 * weightKg * (1 - bodyFatPct / 100)
}
// Cunningham — same lean-mass approach as Katch-McArdle with different constants, developed
// on and mostly cited for athletes.
function bmrCunningham({ weightKg, bodyFatPct }) {
  return 500 + 22 * weightKg * (1 - bodyFatPct / 100)
}
// WHO/FAO/UNU (Schofield) weight-only equations — no height needed, banded by age and sex.
// Widely used in population-level nutrition studies rather than individual coaching apps.
function bmrWHO({ weightKg, age, sex }) {
  if (sex === 'male') return age < 30 ? 15.3 * weightKg + 679 : age < 60 ? 11.6 * weightKg + 879 : 13.5 * weightKg + 487
  return age < 30 ? 14.7 * weightKg + 496 : age < 60 ? 8.7 * weightKg + 829 : 10.5 * weightKg + 596
}
const BMR_FNS = { mifflin: bmrMifflin, harris: bmrHarris, katch: bmrKatch, cunningham: bmrCunningham, who: bmrWHO }
export const computeBMR = (formula, input) => (BMR_FNS[formula] || bmrMifflin)(input)

// How aggressive the lose/gain pace is — MyFitnessPal-style stepped choice rather than a free
// number, so a person can't accidentally pick an unsafe deficit/surplus by fat-fingering a
// stepper. Magnitude only; sign comes from weightGoal (lose = negative, gain = positive).
export const RATE_STEPS_KG = [0.25, 0.5, 0.75, 1]
export const DEFAULT_RATE_KG = 0.5
// 1 kg of body fat ≈ 7700 kcal — the standard estimate calorie calculators use to turn a
// target weekly rate of change into a daily calorie deficit/surplus.
const KCAL_PER_KG = 7700
// Floor under any deficit so an aggressive rate + a low TDEE can't compute a dangerously low
// target — 1200 kcal/day is the commonly cited minimum for a calculator like this to suggest
// without a doctor/dietitian involved.
const MIN_SAFE_CALORIES = 1200

// Default macro split (% of calories) — carb-forward like most calorie trackers default to.
// Always sums to 100; setMacroSplitPct keeps that invariant when the person adjusts one macro.
export const DEFAULT_MACRO_SPLIT = { carbsPct: 40, proteinPct: 30, fatPct: 30 }
const MACRO_PCT_KEYS = ['carbsPct', 'proteinPct', 'fatPct']

const isPositiveNumber = n => typeof n === 'number' && Number.isFinite(n) && n > 0

// Returns the subset of ['height','age','sex','bodyFat','activity','goal','weight'] that isn't
// usable yet, for the given BMR formula (each needs a different subset — see FORMULA_FIELDS).
// An empty array means computeNutritionGoals below is safe to call.
export function missingNutritionInputs({ heightCm, age, sex, activityLevel, weightGoal, weightKg, bodyFatPct } = {}, formula = DEFAULT_BMR_FORMULA) {
  const fields = FORMULA_FIELDS[formula] || FORMULA_FIELDS[DEFAULT_BMR_FORMULA]
  const missing = []
  if (fields.includes('height') && !isPositiveNumber(heightCm)) missing.push('height')
  if (fields.includes('age') && !isPositiveNumber(age)) missing.push('age')
  if (fields.includes('sex') && sex !== 'male' && sex !== 'female') missing.push('sex')
  if (fields.includes('bodyFat') && !(typeof bodyFatPct === 'number' && bodyFatPct > 0 && bodyFatPct < 60)) missing.push('bodyFat')
  if (!ACTIVITY_MULTIPLIERS[activityLevel]) missing.push('activity')
  if (!WEIGHT_GOALS.includes(weightGoal)) missing.push('goal')
  if (!isPositiveNumber(weightKg)) missing.push('weight')
  return missing
}

// Grams for each macro from a calorie goal + a %-of-calories split. Carbs get whatever's left
// over after protein/fat are computed from the unrounded calorie split, so the three macros'
// calories still add up to the calorie goal after all numbers are rounded for display.
export function macroGramsFromSplit(calories, split) {
  const proteinG = (calories * split.proteinPct / 100) / 4
  const fatG = (calories * split.fatPct / 100) / 9
  const carbsG = Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4)
  return { proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbsG: Math.round(carbsG) }
}

// Changing one macro's % (MyFitnessPal-style) redistributes the remainder across the other two
// in proportion to their current ratio, so the total always stays exactly 100 — never lets one
// slider drift the split out of balance or leave it needing a separate "normalize" step.
export function setMacroSplitPct(split, key, value) {
  value = Math.max(0, Math.min(100, Math.round(value)))
  const others = MACRO_PCT_KEYS.filter(k => k !== key)
  const remaining = 100 - value
  const otherSum = others[0] in split && others[1] in split ? split[others[0]] + split[others[1]] : 0
  const next = { ...split, [key]: value }
  if (otherSum <= 0) {
    next[others[0]] = Math.round(remaining / 2)
  } else {
    next[others[0]] = Math.round(remaining * split[others[0]] / otherSum)
  }
  next[others[1]] = remaining - next[others[0]]
  return next
}

// null when an input is missing — callers check missingNutritionInputs (or just the null
// return) rather than getting a NaN or a negative calorie goal out of half-filled inputs.
export function computeNutritionGoals(input, split = DEFAULT_MACRO_SPLIT, rateKg = DEFAULT_RATE_KG, formula = DEFAULT_BMR_FORMULA) {
  if (missingNutritionInputs(input, formula).length) return null
  const { activityLevel, weightGoal } = input

  const bmr = computeBMR(formula, input)
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activityLevel]
  const dailyDelta = (Math.abs(rateKg) * KCAL_PER_KG) / 7
  const rawCalories = weightGoal === 'lose' ? tdee - dailyDelta : weightGoal === 'gain' ? tdee + dailyDelta : tdee
  const calories = Math.max(MIN_SAFE_CALORIES, rawCalories)

  return { calories: Math.round(calories), ...macroGramsFromSplit(calories, split) }
}
