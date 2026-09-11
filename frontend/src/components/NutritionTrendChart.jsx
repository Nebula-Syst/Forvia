import { useRef, useState } from 'react'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const W = 340

// Several series (calories, macros, water — different units and scales) drawn on one shared
// chart, in different colors, the way Nutrition.jsx's own macro bars already read as "one
// picture" rather than four separate ones. The only way to put kcal and grams and ml on the
// same axis without one drowning out the others is to stop plotting raw units and plot each
// series as % of its own goal instead — 100% then means the same thing (today's target) for
// every line, and a flat reference line at 100 reads as "on target" for all of them at once.
//
// series: [{ key, label, color, unit, points: [{t,y,d}], goal }]
export default function NutritionTrendChart({ series, h = 190 }) {
  const svgRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)

  // Merge every series' days into one sorted timeline — a day with food but no water logged
  // still needs a slot so the water line can show a gap there instead of a straight lie
  // connecting across it.
  const dayMap = new Map()
  series.forEach(s => s.points.forEach(p => {
    if (!dayMap.has(p.d)) dayMap.set(p.d, { t: p.t, d: p.d })
    dayMap.get(p.d)[s.key] = p.y
  }))
  const days = [...dayMap.values()].sort((a, b) => a.t - b.t)

  if (days.length === 0) return <div className="empty small">{t('No data yet')}</div>

  const H = h
  const P = { l: 30, r: 12, t: 10, b: 22 }
  const t0 = days[0].t, t1 = days[days.length - 1].t || t0 + 1
  const X = tv => t1 === t0 ? (P.l + W - P.r) / 2 : P.l + (tv - t0) / (t1 - t0) * (W - P.l - P.r)
  const pctOf = (s, day) => { const v = day[s.key]; return v == null || !s.goal ? null : (v / s.goal) * 100 }

  let ymax = 100
  series.forEach(s => days.forEach(d => { const p = pctOf(s, d); if (p != null) ymax = Math.max(ymax, p) }))
  ymax = Math.max(120, Math.ceil((ymax + 15) / 20) * 20)
  const Y = pct => P.t + (1 - Math.max(0, pct) / ymax) * (H - P.t - P.b)

  const gridlines = []
  for (let v = 0; v <= ymax + 1e-9; v += 50) {
    const y = Y(v)
    gridlines.push(<g key={'y' + v}>
      <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
      <text x={P.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{v}%</text>
    </g>)
  }
  const dTicks = days.length > 1 ? [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]] : days
  const seen = new Set()
  dTicks.forEach((d, i) => {
    if (seen.has(d.d)) return
    seen.add(d.d)
    const x = X(d.t)
    gridlines.push(<text key={'x' + i} x={x} y={H - 7}
      textAnchor={i === 0 ? 'start' : i === dTicks.length - 1 ? 'end' : 'middle'}
      fontSize="9.5" fill="var(--label-2)">{fmtDate(d.d, true)}</text>)
  })

  const segmentsFor = s => {
    const segs = []
    let cur = []
    days.forEach(d => {
      const p = pctOf(s, d)
      if (p == null) { if (cur.length > 1) segs.push(cur); cur = []; return }
      cur.push({ x: X(d.t), y: Y(p) })
    })
    if (cur.length > 1) segs.push(cur)
    else if (cur.length === 1) segs.push([cur[0], cur[0]]) // a single day still draws a visible dot
    return segs
  }

  const onMove = e => {
    const c = e.touches ? e.touches[0] : e
    if (!c || c.clientX === undefined) return
    const r = svgRef.current.getBoundingClientRect()
    const vx = (c.clientX - r.left) / (r.width || W) * W
    let best = 0, bestDist = Infinity
    days.forEach((d, i) => { const dist = Math.abs(X(d.t) - vx); if (dist < bestDist) { bestDist = dist; best = i } })
    setHoverIdx(best)
  }
  const hoverDay = hoverIdx != null ? days[hoverIdx] : null

  return <div>
    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
      {series.map(s => (
        <span key={s.key} className="row" style={{ gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: s.color, flex: 'none' }} />
          <span className="dim small">{s.label}</span>
        </span>
      ))}
    </div>
    <div className="chart-i"
      onMouseMove={onMove} onMouseDown={onMove} onMouseLeave={() => setHoverIdx(null)}
      onTouchStart={onMove} onTouchMove={onMove}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        {gridlines}
        <line x1={P.l} y1={Y(100)} x2={W - P.r} y2={Y(100)} stroke="var(--label-3)" strokeWidth="1.4" strokeDasharray="6 4" />
        {series.map(s => segmentsFor(s).map((seg, i) => (
          <polyline key={s.key + i} points={seg.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}
            fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        )))}
        {hoverDay && <line x1={X(hoverDay.t)} y1={P.t} x2={X(hoverDay.t)} y2={H - P.b} stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
    </div>
    {hoverDay && <div className="card" style={{ marginTop: 8, padding: '10px 14px' }}>
      <div className="dim small" style={{ marginBottom: 6, fontWeight: 700 }}>{fmtDate(hoverDay.d, true)}</div>
      {series.map(s => hoverDay[s.key] == null ? null : (
        <div key={s.key} className="row between" style={{ fontSize: 13, padding: '3px 0' }}>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: s.color, flex: 'none' }} />
            {s.label}
          </span>
          <span>{fmtNum(hoverDay[s.key])} {s.unit} · {Math.round(pctOf(s, hoverDay))}%</span>
        </div>
      ))}
    </div>}
  </div>
}
