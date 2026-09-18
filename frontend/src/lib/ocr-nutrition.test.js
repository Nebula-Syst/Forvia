import { describe, expect, it } from 'vitest'
import { parseNutritionLabelText } from './ocr-nutrition.js'

describe('parseNutritionLabelText', () => {
  it('reads a typical EU-style Spanish label', () => {
    const text = [
      'INFORMACIÓN NUTRICIONAL',
      'Valores medios por 100g',
      'Energía 920 kJ / 220 kcal',
      'Grasas 8,5 g',
      'de las cuales saturadas 3,2 g',
      'Hidratos de carbono 25 g',
      'de los cuales azúcares 10 g',
      'Proteínas 12 g',
      'Sal 0,8 g',
    ].join('\n')
    expect(parseNutritionLabelText(text)).toEqual({ kcal: 220, carbs: 25, fat: 8.5, protein: 12 })
  })

  it('reads a typical US-style English label', () => {
    const text = [
      'Nutrition Facts',
      'Calories 250',
      'Total Fat 5g',
      'Total Carbohydrate 30g',
      'Protein 12g',
    ].join('\n')
    expect(parseNutritionLabelText(text)).toEqual({ kcal: 250, carbs: 30, fat: 5, protein: 12 })
  })

  it('prefers the kcal figure over kJ when both share a line', () => {
    const text = 'Energy 1046kJ/250kcal'
    expect(parseNutritionLabelText(text).kcal).toBe(250)
  })

  it('skips a saturated-fat sub-line when a total-fat line exists', () => {
    const text = ['Fat 9g', 'of which saturates 2g'].join('\n')
    expect(parseNutritionLabelText(text).fat).toBe(9)
  })

  it('falls back to zero for anything it cannot find, never throws', () => {
    expect(parseNutritionLabelText('')).toEqual({ kcal: 0, carbs: 0, fat: 0, protein: 0 })
    expect(parseNutritionLabelText('garbled unreadable ocr noise')).toEqual({ kcal: 0, carbs: 0, fat: 0, protein: 0 })
  })

  // A real phone photo under Tesseract's sparse-text mode reads scattered fragments in
  // roughly the right order rather than reassembling a visual row — label and number often
  // land on separate lines instead of "Grasas: 52,5 g" together. No "kcal" text at all here,
  // so the Atwater estimate (see below) is what fills kcal in — 52.5*9 + 21*4 = 556.5 → 557.
  it('reads a value from the line after its label when they are split apart', () => {
    const text = ['ruido', 'Grasas', '52,5', 'ruido', 'Proteinas:', 'ruido', '21,0'].join('\n')
    expect(parseNutritionLabelText(text)).toEqual({ kcal: 557, carbs: 0, fat: 52.5, protein: 21 })
  })

  // The actual bug report this guards against: a real photo where the macros (fat 52.5g) came
  // through legible but the kcal line's leading digit got dropped by OCR ("619 kcal" read as
  // "19 kcal") — 19 kcal can't be right for a food that's over half fat by weight, since fat
  // alone is 9 kcal/g. The Atwater estimate from the macros that WERE read correctly (52.5g
  // fat ≈ 472.5 kcal) is far more trustworthy than the two garbled digits.
  it('overrides an implausibly low kcal reading with the Atwater estimate from its own macros', () => {
    const text = ['19 kcal', 'Grasas', '52,5'].join('\n')
    expect(parseNutritionLabelText(text)).toEqual({ kcal: 473, carbs: 0, fat: 52.5, protein: 0 })
  })

  it('keeps a directly-read kcal figure that is already consistent with its macros', () => {
    const text = ['220 kcal', 'Grasas 8,5', 'Proteinas 12', 'Hidratos de carbono 25'].join('\n')
    expect(parseNutritionLabelText(text).kcal).toBe(220)
  })

  it('gives up rather than borrowing a sub-breakdown value when the total is missing', () => {
    const text = ['Grasas', 'de las cuales saturadas', '4,1'].join('\n')
    expect(parseNutritionLabelText(text).fat).toBe(0)
  })

  // OCR noise loves to swallow "52,5 g"'s comma and fuse the "g" onto the digits, reading
  // "5258" — a macro can't physically be more than 100g per 100g of food, so this must be
  // treated as not-found rather than shown as a real-looking but impossible number.
  it('discards a macro reading above 100g per 100g as noise, not a real value', () => {
    expect(parseNutritionLabelText('Grasas\n5258').fat).toBe(0)
    expect(parseNutritionLabelText('Grasas\n85').fat).toBe(85)
  })

  it('discards a calorie reading above 900 kcal/100g as noise', () => {
    expect(parseNutritionLabelText('9999 kcal').kcal).toBe(0)
  })
})
