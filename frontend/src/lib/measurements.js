// i18n-core, not i18n.js — this module is imported by import-csv.js, which stays plain-Node
// loadable (no import.meta.glob) so its parsers can be exercised directly outside Vite.
import { t } from './i18n-core.js'

// Body-part circumference tracking (tape-measure numbers), a separate feature from bodyweight:
// one weigh-in is a single scalar per day, but a measurement session touches several zones at
// once, so a row is `{ d, t, values: { zone: cm } }` rather than bodyweight's flat `{ d, t, w }`.
// Centimetres only for now — no unit toggle exists yet for lengths, unlike S.unit's kg/lb.
export const MEASURE_ZONES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'bicep', 'forearm', 'thigh', 'calf']

// t() reads the active language live, so this stays a function called at render time (not a
// module-level object) — see LiveClass.jsx's timerTypeLabel for the same reasoning.
export const zoneLabel = zone => ({
  neck: t('Neck'), shoulders: t('Shoulders'), chest: t('Chest'), waist: t('Waist'), hips: t('Hips'),
  bicep: t('Biceps'), forearm: t('Forearms'), thigh: t('Thighs'), calf: t('Calves'),
}[zone] || zone)

export const lastMeasurement = S => (S.measurements?.length ? S.measurements[S.measurements.length - 1] : null)

// The most recent logged value for one zone, regardless of which day it was on — used to
// pre-fill the log sheet with last time's number instead of starting blank every time.
export function lastValueFor(S, zone) {
  const rows = S.measurements || []
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].values?.[zone]
    if (v != null) return v
  }
  return null
}

// Points for LineChart: only days that actually logged this zone, sorted by time (the rows
// themselves already are, kept sorted on insert — see sheets.jsx's MeasurementSheet.save()).
export function pointsFor(S, zone, sinceMs) {
  return (S.measurements || [])
    .filter(m => m.values?.[zone] != null && (!sinceMs || (m.t || new Date(m.d).getTime()) >= sinceMs))
    .map(m => ({ t: m.t || new Date(m.d).getTime(), y: m.values[zone], d: m.d }))
}

/* --------------------------------------------- "your biggest zones" body map --------------- */
// General-population reference circumferences (cm) — rough averages for an untrained adult,
// not a clinical or athletic dataset, used only to give "bigger than average" something to mean.
// The info sheet (measurementsHelpSheet, Stats.jsx) says as much to the viewer directly.
const AVERAGE_CM = {
  male: { neck: 38, shoulders: 112, chest: 100, waist: 90, hips: 98, bicep: 33, forearm: 28, thigh: 56, calf: 37 },
  female: { neck: 32, shoulders: 100, chest: 90, waist: 75, hips: 98, bicep: 27, forearm: 23, thigh: 56, calf: 34 },
}

// A tape-measure zone maps to one or more of BodyMap's anatomical muscle slugs (lib/muscles.js)
// so the existing body silhouette can shade it — "thigh" alone doesn't distinguish quads from
// hamstrings, so both get the same shade. `neck` has no muscle path of its own in that geometry
// (drawn as plain silhouette), so it's tracked and charted but can't be highlighted on the map.
const ZONE_TO_MUSCLES = {
  shoulders: ['deltoids'], chest: ['chest'], waist: ['abs', 'obliques'], hips: ['gluteal'],
  bicep: ['biceps'], forearm: ['forearm'], thigh: ['quadriceps', 'hamstring', 'adductors'], calf: ['calves'],
}

// Below the general average shows as unmarked (level 0) — this is specifically a "what stands
// out" map, not a balance-across-everything one like MuscleBalance's training-load version.
export const BEST_ZONE_THRESHOLDS = [
  { at: 1.0, level: 1 }, { at: 1.05, level: 2 }, { at: 1.12, level: 3 }, { at: 1.2, level: 4 },
]

// { muscleSlug: measured/average ratio } for BodyMap's `load` prop, from whatever each zone's
// most recent value is — a zone never measured contributes nothing, same as a muscle never
// trained on the ordinary training-load map.
export function bestZonesLoad(S) {
  const avg = AVERAGE_CM[S.body === 'female' ? 'female' : 'male']
  const load = {}
  for (const zone of MEASURE_ZONES) {
    const v = lastValueFor(S, zone)
    if (v == null || !avg[zone]) continue
    const ratio = v / avg[zone]
    for (const slug of ZONE_TO_MUSCLES[zone] || []) load[slug] = Math.max(load[slug] || 0, ratio)
  }
  return load
}
