import { describe, it, expect } from 'vitest'
import { missingNutritionInputs, computeNutritionGoals } from './nutrition-goals.js'

const BASE = { heightCm: 180, age: 30, sex: 'male', activityLevel: 'sedentary', weightGoal: 'maintain', weightKg: 80 }
const ACTIVITY_MULT_SEDENTARY = 1.2

describe('computeNutritionGoals', () => {
  it('matches Mifflin-St Jeor by hand for a sedentary maintain case', () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; TDEE = 1780*1.2 = 2136
    const g = computeNutritionGoals(BASE)
    expect(g.calories).toBe(2136)
    // Default split is 40/30/30 % of calories (carbs/protein/fat).
    expect(g.proteinG).toBe(160)      // 2136*0.30/4 = 160.2
    expect(g.fatG).toBe(71)           // 2136*0.30/9 = 71.2
    expect(g.carbsG).toBe(214)        // (2136 - 640.8 - 640.8) / 4 = 213.6
  })

  it('applies the lose/gain adjustment on top of TDEE', () => {
    // Default pace 0.5 kg/week: 0.5 * 7700 kcal / 7 days = 550 kcal/day either way.
    const lose = computeNutritionGoals({ ...BASE, weightGoal: 'lose' })
    const gain = computeNutritionGoals({ ...BASE, weightGoal: 'gain' })
    expect(lose.calories).toBe(2136 - 550)
    expect(gain.calories).toBe(2136 + 550)
  })

  it('scales the daily delta with the chosen pace', () => {
    // 1 kg/week = 1100 kcal/day (on 'gain', so the 1200 kcal floor can't mask it).
    expect(computeNutritionGoals({ ...BASE, weightGoal: 'gain' }, undefined, 1).calories).toBe(2136 + 1100)
    expect(computeNutritionGoals({ ...BASE, weightGoal: 'gain' }, undefined, 0.25).calories).toBe(2136 + 275)
  })

  it('never suggests less than the 1200 kcal safety floor', () => {
    const small = { ...BASE, weightKg: 45, heightCm: 150, age: 70, sex: 'female', weightGoal: 'lose' }
    expect(computeNutritionGoals(small, undefined, 1).calories).toBe(1200)
  })

  it('gives female a lower BMR than male by exactly the 166 kcal offset (5 vs -161)', () => {
    const male = computeNutritionGoals(BASE)
    const female = computeNutritionGoals({ ...BASE, sex: 'female' })
    // Both TDEE figures scale the same BMR gap by the same activity multiplier.
    expect(male.calories - female.calories).toBe(Math.round(166 * ACTIVITY_MULT_SEDENTARY))
  })

  it('signals missing inputs instead of producing NaN or a negative goal', () => {
    expect(missingNutritionInputs({})).toEqual(['height', 'age', 'sex', 'activity', 'goal', 'weight'])
    expect(missingNutritionInputs(BASE)).toEqual([])
    expect(missingNutritionInputs({ ...BASE, heightCm: null })).toEqual(['height'])
    expect(missingNutritionInputs({ ...BASE, age: 0 })).toEqual(['age'])
    expect(missingNutritionInputs({ ...BASE, sex: 'other' })).toEqual(['sex'])
    expect(missingNutritionInputs({ ...BASE, activityLevel: 'nope' })).toEqual(['activity'])
    expect(missingNutritionInputs({ ...BASE, weightGoal: 'bulk' })).toEqual(['goal'])
    expect(missingNutritionInputs({ ...BASE, weightKg: -5 })).toEqual(['weight'])

    expect(computeNutritionGoals({ ...BASE, heightCm: undefined })).toBeNull()
    expect(computeNutritionGoals({})).toBeNull()
  })
})
