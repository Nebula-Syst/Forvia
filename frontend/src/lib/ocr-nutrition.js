// Best-effort extraction of calories/carbs/fat/protein from OCR'd nutrition-label text
// (Tesseract's raw output — noisy, unpredictable line order, English or Spanish wording).
// This is deliberately a plain regex heuristic, not a model: ScanMacrosSheet always shows
// the result in an editable form before saving, so a wrong or missing number here is a
// "the user fixes one field" annoyance, never a silent bad log.
//
// Kept as a pure function (no DOM, no Tesseract import) so it's unit-testable on its own —
// see ocr-nutrition.test.js — the same split as lib/back.js's decideBack.

const DIACRITICS = new RegExp(String.fromCharCode(91, 0x0300, 45, 0x036f, 93), 'g')
const norm = s => String(s).toLowerCase().normalize('NFD').replace(DIACRITICS, '')

// First number on a line, comma or period as the decimal separator, thousands-separator
// dots/commas are not a concern at nutrition-label magnitudes (never into the thousands).
function firstNumber(line) {
  const m = line.match(/\d+(?:[.,]\d+)?/)
  if (!m) return null
  return parseFloat(m[0].replace(',', '.'))
}

// A real photo's OCR often splits "Grasas:" and "52,5 g" onto separate recognized lines —
// especially under a "sparse text" page-segmentation mode, which reads scattered fragments
// in roughly the right order but never reassembles a visual row. So: find the keyword's
// line, take a number right there if there is one, otherwise look at the next couple of
// lines for the first one. A skip-word line (a sub-breakdown, "of which saturates") ends the
// search for that occurrence rather than being read past — grabbing the sub-value when the
// total's own number got lost would report a plausible-looking but wrong figure, worse than
// leaving it at 0 for the user to fill in themselves.
function findValueNear(lines, keywords, skipWords = []) {
  for (let i = 0; i < lines.length; i++) {
    if (!keywords.some(k => lines[i].includes(k))) continue
    if (skipWords.some(w => lines[i].includes(w))) continue
    const same = firstNumber(lines[i])
    if (same != null) return same
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (skipWords.some(w => lines[j].includes(w))) break
      const n = firstNumber(lines[j])
      if (n != null) return n
    }
  }
  return null
}

// A real label's number sits right next to its unit ("52,5 g"), and OCR noise loves to
// swallow the decimal separator or fuse the unit letter onto the digits — "52,5 g" misreads
// as "5258" often enough to matter. A macro can never physically exceed 100g per 100g of
// food, and 900 kcal/100g is already pure fat; a reading past either bound isn't a real
// number that happened to be scanned; it's noise that happens to look like one, and showing
// it as if it were a plausible answer is worse than admitting it wasn't found.
const clamp = (v, max) => (v == null || v > max ? null : v)

// Calories aren't an independent fourth number on the label — they're just carbs/protein/fat
// counted in energy units (the Atwater system every nutrition label is legally built on:
// ~4 kcal/g for carbs and protein, ~9 kcal/g for fat). A label's own declared kcal typically
// lands within ~20% of that arithmetic; a photo where the macros came through legible but the
// kcal line's digits got mangled shows up as a kcal reading that can't even cover what its
// own macros already account for. That's not a plausible low-calorie reading — a food that's
// 52g fat per 100g cannot be 19 kcal per 100g, fat alone is denser than that — it's a misread
// digit, and the fix is to trust the label's own physics over a couple of garbled characters.
const ATWATER = { carbs: 4, protein: 4, fat: 9 }

export function parseNutritionLabelText(text) {
  const raw = String(text || '')
  const lines = raw.split(/\r?\n/).map(norm).filter(Boolean)
  const flat = norm(raw)

  const carbs = clamp(findValueNear(lines, ['carbohidrat', 'hidratos de carbono', 'carbohydrate', 'carbs'], ['azucar', 'sugar']), 100) ?? 0
  const fat = clamp(findValueNear(lines, ['grasa', 'fat', 'lipid'], ['satur']), 100) ?? 0
  const protein = clamp(findValueNear(lines, ['proteina', 'protein']), 100) ?? 0
  const impliedKcal = carbs * ATWATER.carbs + protein * ATWATER.protein + fat * ATWATER.fat

  // Calories: prefer a number stuck to "kcal" anywhere in the text (labels often print
  // "920 kJ / 220 kcal" on one line — the kJ figure would otherwise win by appearing first).
  const kcalMatch = flat.match(/(\d+(?:[.,]\d+)?)\s*k\s?cal/)
  let kcal = kcalMatch ? parseFloat(kcalMatch[1].replace(',', '.')) : null
  if (kcal == null) kcal = findValueNear(lines, ['calor', 'energ', 'calorie'])
  kcal = clamp(kcal, 900)
  if (impliedKcal > 0 && (kcal == null || kcal < impliedKcal * 0.6)) kcal = impliedKcal

  return { kcal: Math.round(kcal ?? 0), carbs, fat, protein }
}
