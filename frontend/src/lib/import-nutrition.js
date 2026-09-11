// Import/export a food diary against another app — MyFitnessPal is the one the user actually
// named, but this follows the exact same idea as lib/import-csv.js's workout importer: read a
// column map built from the header rather than fixed positions, so a new app (Cronometer,
// LoseIt, a plain spreadsheet) is usually a few header aliases away rather than another
// parser. No official MyFitnessPal export schema is hardcoded as gospel here — its exact
// column names have shifted between versions and aren't independently verifiable from this
// repo, so the alias list stays deliberately loose (a handful of common spellings per field)
// rather than one rigid exact match that would quietly reject a real file.

import { parseCSV } from './import-csv.js'
import { uid, isoOf } from './format.js'

// MyFitnessPal (and most food apps) export in whatever language the account's UI was set to
// — a real export from a Spanish account writes "Calorías", "Carbohidratos (g)", "Proteínas
// (g)" — so accents have to come out BEFORE the alphanumeric-only collapse below, or "í"/"í"
// just vanish into a stray space and "calorías" never matches "calorias". Built from char
// codes (Unicode's combining-diacritical-marks block) rather than a literal regex so this
// file never carries a raw combining character that renders invisibly in an editor/diff —
// same technique as lib/import-csv.js's own exercise-name matching.
const DIACRITIC_MARKS = new RegExp(String.fromCharCode(91, 0x0300, 45, 0x036f, 93), 'g')
const norm = h => h.toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS, '').replace(/[^a-z0-9]+/g, ' ').trim()

// English + Spanish aliases verified against a real MyFitnessPal export (2025-01 to 2026-09,
// Spanish account): header is exactly Fecha,Comida,Calorías,Grasa (g),...,Carbohidratos
// (g),...,Proteínas (g),... with no per-food name column at all — MFP's own diary export is
// one row per MEAL per DAY, already totalled, not itemized. parseNutritionCSV's fallbackName
// covers that: every row becomes one diary entry named generically, carrying that meal's
// real totals — still correct macros, just not broken down by individual food.
const COLUMNS = [
  ['date', ['date', 'fecha']],
  ['meal', ['meal', 'meal name', 'meal type', 'comida', 'tipo de comida']],
  ['name', ['food', 'food name', 'item', 'description', 'name', 'alimento', 'nombre']],
  ['kcal', ['calories', 'calories kcal', 'energy', 'energy kcal', 'energy kj', 'calorias']],
  ['carbsG', ['carbohydrates g', 'carbohydrates', 'carbs g', 'carbs', 'carbohydrate g', 'carbohydrate', 'carbohidratos g', 'carbohidratos']],
  ['fatG', ['fat g', 'fat', 'total fat g', 'total fat', 'grasa g', 'grasa', 'grasas g', 'grasas']],
  ['proteinG', ['protein g', 'protein', 'proteinas g', 'proteinas', 'proteina g', 'proteina']],
  ['grams', ['grams', 'quantity', 'amount', 'serving size g', 'serving size', 'weight g', 'cantidad', 'gramos']],
]

function mapHeader(header) {
  const map = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [field, names] of COLUMNS) {
      if (map[field] === undefined && names.includes(n)) { map[field] = i; return }
    }
  })
  return map
}

/** Name of the app a header looks like — same "shown back to the user" idea as the workout
 * importer's detectSource, best-effort since export schemas drift between app versions. */
export function detectNutritionSource(header) {
  const h = header.map(norm)
  const hasMeal = h.includes('meal') || h.includes('comida')
  const hasSatFat = h.includes('saturated fat') || h.includes('sodium mg') || h.includes('grasas saturadas') || h.includes('sodio mg')
  if (hasMeal && hasSatFat) return 'MyFitnessPal'
  if (h.includes('category') && h.includes('energy kcal')) return 'Cronometer'
  return null
}

const MEAL_ALIASES = {
  breakfast: 'breakfast', desayuno: 'breakfast',
  lunch: 'lunch', comida: 'lunch', almuerzo: 'lunch',
  dinner: 'dinner', cena: 'dinner',
  snack: 'snack', snacks: 'snack', merienda: 'snack', aperitivos: 'snack', aperitivo: 'snack', refrigerio: 'snack',
}
const normalizeMeal = raw => MEAL_ALIASES[norm(raw || '')] || 'snack'

function toNumber(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return isFinite(n) ? n : 0
}

// Accepts an ISO date directly, or falls back to native Date parsing for MM/DD/YYYY-style
// exports (MyFitnessPal's own default locale format) — whichever the file actually used.
function toIso(raw) {
  const s = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d) ? null : isoOf(d)
}

/** opts.fallbackName: what to call a row with no food-name column (a per-meal daily-totals
 * export, not itemized) — passed in so this file stays i18n-free like import-csv.js. */
export function parseNutritionCSV(text, opts = {}) {
  const rows = parseCSV(text)
  if (!rows.length) return { error: 'empty' }
  const header = rows[0]
  const map = mapHeader(header)
  if (map.date === undefined || map.kcal === undefined) return { error: 'unrecognized' }
  const source = detectNutritionSource(header)
  const fallbackName = opts.fallbackName || 'Imported item'

  const byDate = {}
  let count = 0
  for (const row of rows.slice(1)) {
    const iso = toIso(row[map.date])
    if (!iso) continue
    const kcal = toNumber(row[map.kcal])
    const carbsG = map.carbsG !== undefined ? toNumber(row[map.carbsG]) : 0
    const fatG = map.fatG !== undefined ? toNumber(row[map.fatG]) : 0
    const proteinG = map.proteinG !== undefined ? toNumber(row[map.proteinG]) : 0
    if (!kcal && !carbsG && !fatG && !proteinG) continue
    const item = {
      id: uid(),
      meal: normalizeMeal(map.meal !== undefined ? row[map.meal] : ''),
      name: (map.name !== undefined ? String(row[map.name] || '').trim() : '') || fallbackName,
      kcal: Math.round(kcal), carbsG: Math.round(carbsG), fatG: Math.round(fatG), proteinG: Math.round(proteinG),
    }
    const grams = map.grams !== undefined ? toNumber(row[map.grams]) : 0
    if (grams > 0) item.grams = Math.round(grams)
    ;(byDate[iso] || (byDate[iso] = [])).push(item)
    count++
  }
  const dates = Object.keys(byDate).sort()
  if (!dates.length) return { error: 'unrecognized' }
  return { kind: 'nutrition', source, byDate, count, from: dates[0], to: dates[dates.length - 1] }
}

/** Existing days win — importing twice never duplicates a day's diary. */
export function mergeNutritionImport(S, parsed) {
  let added = 0, addedDays = 0
  const totalDays = Object.keys(parsed.byDate).length
  for (const iso of Object.keys(parsed.byDate)) {
    if ((S.foodDiary[iso] || []).length) continue
    S.foodDiary[iso] = parsed.byDate[iso]
    added += parsed.byDate[iso].length
    addedDays++
  }
  return { added, addedDays, skippedDays: totalDays - addedDays, totalDays }
}

const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' }
function csvField(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** One row per logged item — the same shape a MyFitnessPal-style diary export uses, and
 * exactly what parseNutritionCSV above reads back in, so exporting and re-importing round-trips. */
export function exportNutritionCSV(S) {
  const rows = [['Date', 'Meal', 'Food', 'Calories', 'Carbohydrates (g)', 'Fat (g)', 'Protein (g)', 'Quantity']]
  Object.keys(S.foodDiary).sort().forEach(iso => {
    (S.foodDiary[iso] || []).forEach(it => {
      const qty = it.grams != null ? `${it.grams} g` : it.units != null ? `${it.units} units` : ''
      rows.push([iso, MEAL_LABEL[it.meal] || it.meal, it.name, it.kcal || 0, it.carbsG || 0, it.fatG || 0, it.proteinG || 0, qty])
    })
  })
  return rows.map(r => r.map(csvField).join(',')).join('\r\n')
}
