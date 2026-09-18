import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport } from './import-csv.js'

const CSV = [
  'Date,Exercise,Weight,Reps,Set Type',
  '2026-08-08,Bench Press,100,5,Warm-up',
  '2026-08-08,Bench Press,80,5,Working',
].join('\n')

describe('CSV warm-up provenance', () => {
  it('retains the imported warm-up phase and excludes it from topW', () => {
    const parsed = parseWorkoutCSV(CSV, { unit: 'kg' })
    const entry = parsed.workouts[0].entries[0]

    expect(parsed.warmups).toBe(1)
    expect(entry.sets).toEqual([
      { w: 100, r: 5, done: true, phase: 'warmup' },
      { w: 80, r: 5, done: true },
    ])
    expect(entry.topW).toBe(80)
  })
})

// Issue: mergeImport used to dedup by date alone, so a Hevy import silently dropped every day
// that already had ANY workout logged on it in Forvia — a native session that same day, or an
// earlier partial import — even when the imported workout was completely different content.
describe('mergeImport day-collision handling', () => {
  const emptyS = () => ({ workouts: [], customEx: [], exWeights: {} })

  it('still imports a day that already has an unrelated native workout logged on it', () => {
    const S = emptyS()
    S.workouts.push({ id: 'native1', d: '2026-09-14', start: new Date('2026-09-14T08:00:00').getTime(), end: 0, entries: [], prs: [] })
    const parsed = parseWorkoutCSV([
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Push,2026-09-14 19:30,2026-09-14 20:15,Bench Press,0,normal,80,5',
    ].join('\n'), { unit: 'kg' })

    const res = mergeImport(S, parsed)

    expect(res.added).toBe(1)
    expect(res.skipped).toBe(0)
    expect(S.workouts).toHaveLength(2)
  })

  it('still skips re-importing the exact same file (same date + start)', () => {
    const S = emptyS()
    const csv = [
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Push,2026-09-14 19:30,2026-09-14 20:15,Bench Press,0,normal,80,5',
    ].join('\n')
    mergeImport(S, parseWorkoutCSV(csv, { unit: 'kg' }))
    const res = mergeImport(S, parseWorkoutCSV(csv, { unit: 'kg' }))

    expect(res.added).toBe(0)
    expect(res.skipped).toBe(1)
    expect(S.workouts).toHaveLength(1)
  })
})