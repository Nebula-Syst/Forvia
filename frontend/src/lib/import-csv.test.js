import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport, applyMatchOverride, parseWhen } from './import-csv.js'

const CSV = [
  'Date,Exercise,Weight,Reps,Set Type',
  '2026-08-08,Bench Press,100,5,Warm-up',
  '2026-08-08,Bench Press,80,5,Working',
].join('\n')

// Issue: Hevy exports dates in the device's locale ("7 sept 2026"). MON only had English
// abbreviations, so Spanish months whose 3-letter form differs (ene/abr/ago/dic vs jan/apr/
// aug/dec) failed to parse and every row for that month was silently skipped — a whole-month
// data loss that looked like a successful import.
describe('parseWhen recognizes Spanish month abbreviations', () => {
  it('parses ene/abr/ago/dic dates', () => {
    expect(parseWhen('20 ene 2026, 07:30')).toEqual({ d: '2026-01-20', t: 27000000 })
    expect(parseWhen('3 abr 2026, 09:15')).toEqual({ d: '2026-04-03', t: 33300000 })
    expect(parseWhen('15 ago 2026, 18:00')).toEqual({ d: '2026-08-15', t: 64800000 })
    expect(parseWhen('10 dic 2025, 20:00')).toEqual({ d: '2025-12-10', t: 72000000 })
  })

  it('does not skip a month using a Spanish-only abbreviation during CSV import', () => {
    const csv = [
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Push,"15 ago 2026, 18:00","15 ago 2026, 19:00",Bench Press,0,normal,80,5',
    ].join('\n')
    const parsed = parseWorkoutCSV(csv, { unit: 'kg' })
    expect(parsed.skipped).toBe(0)
    expect(parsed.workouts[0].d).toBe('2026-08-15')
  })
})

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

// Issue: correcting a second exercise in the "link your exercises" review view silently undid
// the first correction — resolveId only special-cased whichever key THIS call was fixing and
// fell back to the ORIGINAL match for every other key, never a previous override, so only the
// most recent correction ever made it into the rebuilt workouts (the review list itself still
// looked right, since nameMatches display is independent of what workouts actually got built).
describe('applyMatchOverride accumulates corrections', () => {
  it('keeps an earlier override after a second, different exercise is corrected', () => {
    const csv = [
      'Date,Exercise,Weight,Reps',
      '2026-09-01,Totally Unknown Move One,50,10',
      '2026-09-01,Totally Unknown Move Two,60,8',
    ].join('\n')
    let parsed = parseWorkoutCSV(csv, { unit: 'kg' })
    const keyOne = parsed.nameMatches.find(m => m.name === 'Totally Unknown Move One').key
    const keyTwo = parsed.nameMatches.find(m => m.name === 'Totally Unknown Move Two').key

    parsed = applyMatchOverride(parsed, keyOne, '0025')   // bench press
    parsed = applyMatchOverride(parsed, keyTwo, '0043')   // squat

    const ids = parsed.workouts[0].entries.map(e => e.id).sort()
    expect(ids).toEqual(['0025', '0043'])
    expect(parsed.nameMatches.find(m => m.key === keyOne).id).toBe('0025')
    expect(parsed.nameMatches.find(m => m.key === keyTwo).id).toBe('0043')
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