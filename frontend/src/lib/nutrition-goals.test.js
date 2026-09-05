import { describe, it, expect } from 'vitest'
import { missingNutritionInputs, computeNutritionGoals } from './nutrition-goals.js'

const BASE = { heightCm: 180, age: 30, sex: 'male', activityLevel: 'sedentary', weightGoal: 'maintain', weightKg: 80 }
const ACTIVITY_MULT_SEDENTARY = 1.2

describe('computeNutritionGoals', () => {
  it('matches Mifflin-St Jeor by hand for a sedentary maintain case', () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; TDEE = 1780*1.2 = 2136
    const g = computeNutritionGoals(BASE)
    expect(g.calories).toBe(2136)
    expect(g.proteinG).toBe(144)      // 1.8 * 80
    expect(g.fatG).toBe(59)           // 2136*0.25/9 = 59.33
    expect(g.carbsG).toBe(257)        // (2136 - 576 - 534) / 4 = 256.5
  })

  it('applies the lose/gain adjustment on top of TDEE', () => {
    const lose = computeNutritionGoals({ ...BASE, weightGoal: 'lose' })
    const gain = computeNutritionGoals({ ...BASE, weightGoal: 'gain' })
    expect(lose.calories).toBe(Math.round(2136 * 0.8))
    expect(gain.calories).toBe(Math.round(2136 * 1.1))
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
