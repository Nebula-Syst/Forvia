import { useLayoutEffect, useRef, useState } from 'react'
import { fmtNum, fmtDate, MONTHS, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const VIEWBOX_WIDTH = 340   // the svg stretches to its container; only the height (`h`) varies

// "Nice" step sizes for the y-axis gridlines — 1/2/2.5/5/10 × a power of ten, whichever is
// the smallest that still fits roughly a third of the value range per step.
const NICE_STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10]

function niceStep(range) {
  const raw = range / 3
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const fit = NICE_STEP_MULTIPLIERS.find(m => raw <= m * magnitude)
  return (fit ?? 10) * magnitude
}

// Builds the pixel-space mapping for one chart: X(timestamp) and Y(value), plus the
// resolved value range (goal-inclusive, padded) callers need for gridlines.
function buildScale(points, { height, padding, goal, invert }) {
  const values = points.map(p => p.y)
  let ymin = Math.min(...values)
  let ymax = Math.max(...values)
  if (goal != null && isFinite(goal)) { ymin = Math.min(ymin, goal); ymax = Math.max(ymax, goal) }
  if (ymin === ymax) { ymin -= 1; ymax += 1 }
  else { const slack = (ymax - ymin) * 0.12; ymin -= slack; ymax += slack }

  const t0 = points[0].t
  const t1 = points[points.length - 1].t || t0 + 1
  const plotWidth = VIEWBOX_WIDTH - padding.l - padding.r
  const plotHeight = height - padding.t - padding.b

  const X = time => t1 === t0
    ? padding.l + plotWidth / 2
    : padding.l + (time - t0) / (t1 - t0) * plotWidth
  const Y = value => {
    const frac = (value - ymin) / (ymax - ymin)
    return padding.t + (invert ? frac : 1 - frac) * plotHeight
  }
  return { X, Y, ymin, ymax, t0, t1 }
}

function buildYGridlines(scale, padding, width) {
  const step = niceStep(scale.ymax - scale.ymin)
  const lines = []
  for (let v = Math.ceil(scale.ymin / step) * step; v <= scale.ymax + 1e-9; v += step) {
    const y = scale.Y(v)
    lines.push(
      <g key={'y' + v}>
        <line x1={padding.l} y1={y} x2={width - padding.r} y2={y} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={padding.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtNum(v)}</text>
      </g>
    )
  }
  return lines
}

function monthTicks(t0, t1) {
  const ticks = []
  let cursor = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() + 1, 1)
  const end = new Date(t1)
  while (cursor <= end) {
    ticks.push({ t: +cursor, label: t(MONTHS[cursor.getMonth()]) })
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  return ticks
}

function fallbackDateTicks(t0, t1) {
  return [0, 1, 2].map(i => {
    const time = t0 + (t1 - t0) * i / 2
    const d = new Date(time)
    return {
      t: time,
      label: `${d.getDate()} ${t(MONTHS[d.getMonth()])}`,
      anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
    }
  })
}

function buildXGridlines(scale, padding, height, isSinglePoint) {
  const ticks = monthTicks(scale.t0, scale.t1)
  const resolved = ticks.length || isSinglePoint ? ticks : fallbackDateTicks(scale.t0, scale.t1)
  const stride = Math.max(1, Math.ceil(resolved.length / 7))
  return resolved
    .filter((_, i) => i % stride === 0)
    .map((tick, i) => {
      const x = scale.X(tick.t)
      return (
        <g key={'x' + i}>
          <line x1={x} y1={padding.t} x2={x} y2={height - padding.b} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={x} y={height - 7} textAnchor={tick.anchor || 'middle'} fontSize="9.5" fill="var(--label-2)">{tick.label}</text>
        </g>
      )
    })
}

function nearestPoint(hoverCandidates, targetX) {
  return hoverCandidates.reduce((closest, p) =>
    Math.abs(p.x - targetX) < Math.abs(closest.x - targetX) ? p : closest, hoverCandidates[0])
}

// Positions the hover tooltip from its own measured size, after layout — the chart lives in
// an overflow-clipped box, so a fixed half-width offset hangs the label off the edge at the
// first and last point, and the clip then eats it. Reading offsetWidth here also covers
// translated labels, which are not all the same length; writing straight to the node's style
// keeps this off the render path, since hover fires on every mouse move.
function usePositionedTooltip(hover, height, wrapRef, tipRef) {
  useLayoutEffect(() => {
    const tip = tipRef.current, wrap = wrapRef.current
    if (!hover || !tip || !wrap) return
    const cw = wrap.clientWidth, ch = wrap.clientHeight
    const tw = tip.offsetWidth, th = tip.offsetHeight
    const margin = 4
    const cx = hover.x / VIEWBOX_WIDTH * cw
    const cy = hover.y / height * ch
    tip.style.left = Math.max(margin, Math.min(cw - tw - margin, cx - tw / 2)) + 'px'
    // Parked at the top, but dropped below the point when the point sits high enough that
    // the label would otherwise cover the very value it's reporting.
    tip.style.top = (cy < th + 14 ? Math.min(ch - th - margin, cy + 14) : margin) + 'px'
  })
}

// points: [{ t: ms, y: num, d?: iso, m?: 0..1, note?: str }] sorted by t.
//   m    marks the point — a second reading carried by the same dot (bigger and more solid =
//        more of it). Used for effort on the weight curve, where the two belong on one line:
//        the same weight with less left in the tank is not the same session.
//   note extra text for that point's tooltip.
// opts: { h, unit, color, axes, goal, invert }
//   invert flips the y axis, for a scale that counts down as it gets harder (RIR). Without it
//   a curve of reps-in-reserve reads upside down, with the hardest sets at the floor.
export default function LineChart({ points, h = 150, unit = '', color = 'var(--acc)', axes = true, goal = null, invert = false }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const tipRef = useRef(null)
  const [hover, setHover] = useState(null)

  usePositionedTooltip(hover, h, wrapRef, tipRef)

  if (!points || points.length === 0) return <div className="empty small">{t('No data yet')}</div>

  const isSinglePoint = points.length === 1
  const plotted = isSinglePoint ? [points[0], points[0]] : points
  const padding = { l: axes ? 34 : 8, r: 12, t: 10, b: axes ? 22 : 8 }
  const scale = buildScale(plotted, { height: h, padding, goal, invert })

  const gridlines = axes
    ? [...buildYGridlines(scale, padding, VIEWBOX_WIDTH), ...buildXGridlines(scale, padding, h, isSinglePoint)]
    : []

  const linePoints = plotted.map(p => `${scale.X(p.t).toFixed(1)},${scale.Y(p.y).toFixed(1)}`).join(' ')
  const lastPoint = plotted[plotted.length - 1]
  const gradientId = 'g' + Math.round(scale.t0 % 1e7) + '_' + h
  const hasMarks = points.some(p => p.m != null)

  const hoverCandidates = (isSinglePoint ? [points[0]] : points).map(p => ({
    x: scale.X(p.t), y: scale.Y(p.y), iso: p.d || isoOf(new Date(p.t)), v: p.y, note: p.note,
  }))

  const updateHoverFromEvent = e => {
    const pointerEvent = e.touches ? e.touches[0] : e
    if (!pointerEvent || pointerEvent.clientX === undefined) return
    const rect = svgRef.current.getBoundingClientRect()
    const viewX = (pointerEvent.clientX - rect.left) / (rect.width || VIEWBOX_WIDTH) * VIEWBOX_WIDTH
    setHover(nearestPoint(hoverCandidates, viewX))
  }

  return (
    <div className="chart-i" ref={wrapRef}
      onMouseMove={updateHoverFromEvent} onMouseDown={updateHoverFromEvent}
      onMouseLeave={() => setHover(null)}
      onTouchStart={updateHoverFromEvent} onTouchMove={updateHoverFromEvent}>
      <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX_WIDTH} ${h}`} preserveAspectRatio="none" style={{ aspectRatio: `${VIEWBOX_WIDTH}/${h}` }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridlines}
        {goal != null && isFinite(goal) && <>
          <line x1={padding.l} y1={scale.Y(goal)} x2={VIEWBOX_WIDTH - padding.r} y2={scale.Y(goal)} stroke="var(--yellow)" strokeWidth="1.6" strokeDasharray="7 4" />
          <text x={VIEWBOX_WIDTH - padding.r - 2} y={scale.Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--yellow)">{fmtNum(goal)}</text>
        </>}
        <polygon points={`${padding.l},${h - padding.b} ${linePoints} ${scale.X(lastPoint.t).toFixed(1)},${h - padding.b}`} fill={`url(#${gradientId})`} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {hasMarks && plotted.map((p, i) => p.m == null ? null : (
          <circle key={'m' + i} cx={scale.X(p.t)} cy={scale.Y(p.y)} r={2.4 + p.m * 3} fill={color} opacity={0.3 + p.m * 0.7} />
        ))}
        <circle cx={scale.X(lastPoint.t)} cy={scale.Y(lastPoint.y)} r="4" fill={color} />
        {hover && <g>
          <line className="cvl" x1={hover.x} y1={padding.t} x2={hover.x} y2={h - padding.b} stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />
          <line className="chl" x1={padding.l} y1={hover.y} x2={VIEWBOX_WIDTH - padding.r} y2={hover.y} stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hover.x} cy={hover.y} r="5" fill={color} stroke="var(--bg)" strokeWidth="2" />
        </g>}
      </svg>
      {hover && <div className="ctip" ref={tipRef}>
        {fmtDate(hover.iso, true)} · {fmtNum(hover.v)}{unit ? ' ' + unit : ''}{hover.note ? ' · ' + hover.note : ''}
      </div>}
    </div>
  )
}
