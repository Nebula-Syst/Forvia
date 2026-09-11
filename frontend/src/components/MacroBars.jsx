// One bar, two segments: grey for whatever "already used" of a goal (Nutrition.jsx's
// meal cards pass in earlier meals' totals), then the caller's own share in its real
// color — clipped to the track's rounded ends by the parent's overflow:hidden, so
// neither segment needs its own border-radius. `prior={0}` (LogQuantitySheet's preview
// of a single not-yet-logged item) just renders the plain single-fill bar.
export function StackedBar({ prior, own, goal, color }) {
  const priorPct = goal ? Math.min(100, (prior / goal) * 100) : 0
  const ownPct = goal ? Math.min(100 - priorPct, (own / goal) * 100) : 0
  return <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', display: 'flex' }}>
    {priorPct > 0 && <div style={{ width: priorPct + '%', height: '100%', background: 'var(--grey)', flex: 'none' }} />}
    {ownPct > 0 && <div style={{ width: ownPct + '%', height: '100%', background: color, flex: 'none' }} />}
  </div>
}
