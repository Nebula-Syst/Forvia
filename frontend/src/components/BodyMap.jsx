import { useEffect, useState } from 'react'
import { MUSCLES, INERT, MUSCLE_NAME, levelsOf } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'

// Front and back views of a body, each muscle shaded by how hard it was worked.
//
// The five shade steps are the same ones the activity heatmap uses (.hm-c.l0…l4), so
// "more accent = more training" means one thing everywhere in the app rather than two.
//
// The geometry is ~90 KB and only some screens show a map, so it is fetched on first
// render instead of riding along in the main bundle. Until it lands the component
// renders nothing but keeps its height, so nothing below it jumps on arrival.

// Module-level so every mounted <BodyMap> shares one fetch instead of racing each other.
const geometryCache = { data: null, inFlight: null }

function loadBodyGeometry() {
  if (geometryCache.data) return Promise.resolve(geometryCache.data)
  if (!geometryCache.inFlight) {
    geometryCache.inFlight = import('../lib/body-paths.js').then(mod => {
      geometryCache.data = mod.default
      return geometryCache.data
    })
  }
  return geometryCache.inFlight
}

function useBodyGeometry() {
  const [geometry, setGeometry] = useState(geometryCache.data)
  useEffect(() => {
    if (geometry) return
    let mounted = true
    loadBodyGeometry().then(g => { if (mounted) setGeometry(g) }).catch(() => {})
    return () => { mounted = false }
  }, [geometry])
  return geometry
}

function SilhouetteLayer({ shapes }) {
  return INERT.flatMap(slug => (shapes[slug] || []).map((d, i) =>
    <path key={slug + i} className="bm-sil" d={d} />
  ))
}

function MuscleLayer({ shapes, levels, selected, onMuscle }) {
  return MUSCLES.flatMap(slug => (shapes[slug] || []).map((d, i) => (
    <path
      key={slug + i}
      className={`bm-m l${levels[slug] || 0}${selected === slug ? ' sel' : ''}`}
      d={d}
      onClick={onMuscle ? () => onMuscle(slug) : undefined}
    >
      <title>{t(MUSCLE_NAME[slug])}</title>
    </path>
  )))
}

function BodyView({ view, levels, selected, onMuscle }) {
  return (
    <svg className="bm-v" viewBox={view.vb} role="img">
      <SilhouetteLayer shapes={view.p} />
      <MuscleLayer shapes={view.p} levels={levels} selected={selected} onMuscle={onMuscle} />
    </svg>
  )
}

/**
 * <BodyMap load={{ chest: 12, … }} body="male" />
 * `load` is effective sets per muscle (see lib/muscles.js); shading is relative to
 * the hardest-worked muscle in that same load, so it always reads as a balance. Pass ordered
 * `{ at, level, exclusive? }` `thresholds` for a fixed absolute scale (recovery views use this
 * to keep their semantic bands stable); omitting it preserves the balance behavior.
 */
export default function BodyMap({ load = {}, thresholds, body = 'male', onMuscle, selected, className = '' }) {
  const geometry = useBodyGeometry()
  const levels = levelsOf(load, thresholds)
  const bodySet = geometry && (geometry[body] || geometry.male)

  return (
    <div className={'bodymap ' + className}>
      {bodySet
        ? <>
          <BodyView view={bodySet.front} levels={levels} selected={selected} onMuscle={onMuscle} />
          <BodyView view={bodySet.back} levels={levels} selected={selected} onMuscle={onMuscle} />
        </>
        : <div className="bm-ph" aria-hidden="true" />}
    </div>
  )
}

export function BodyMapLegend() {
  return (
    <div className="hm-legend">
      {t('Less')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" />
      <div className="hm-c l3" /><div className="hm-c l4" /> {t('More')}
    </div>
  )
}
