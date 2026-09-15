import { useEffect, useRef, useState } from 'react'

const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

// Column count scales with capacity so a tiny 8-person class and a 100-person open gym slot
// both read as one coherent grid instead of either a few huge squares or a wall of tiny ones —
// aiming for a roughly square overall shape (sqrt of capacity), clamped so ~5 fit per row on
// average.
const colsFor = capacity => Math.max(5, Math.min(14, Math.round(Math.sqrt(capacity))))
const GAP = 5

// Root cause of an earlier "empty seats render as tall rectangles" bug, finally found: the
// modifier class was plain "empty", which collides with an unrelated, already-existing global
// ".empty" class elsewhere in the app (an empty-state block with padding:44px 20px;
// font-size:15px) — both rules matched the same span, and the empty-state's padding leaked in
// underneath whatever sizing technique was tried here. "seat-empty" can't collide with
// anything. Height is still a real pixel value measured from the column's own rendered width
// (a ResizeObserver keeps it correct live) rather than aspect-ratio or the padding-percentage
// trick, since neither reliably drives a CSS grid's row-track sizing for a content-less cell.
export default function SeatGrid({ capacity, attendees = [], tint }) {
  const cols = colsFor(capacity)
  const seats = Array.from({ length: capacity }, (_, i) => attendees[i] || null)
  const ref = useRef(null)
  const [cell, setCell] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setCell(Math.floor((el.clientWidth - GAP * (cols - 1)) / cols))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols])

  return (
    <div ref={ref} className="seat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: GAP, '--tint': tint }}>
      {seats.map((a, i) => a ? (
        <span key={a.id} className="seat filled" title={a.name} style={{ height: cell || undefined }}>
          {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : initials(a.name)}
        </span>
      ) : (
        <span key={'e' + i} className="seat seat-empty" style={{ height: cell || undefined }} />
      ))}
    </div>
  )
}
