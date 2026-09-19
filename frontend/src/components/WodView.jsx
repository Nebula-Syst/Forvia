import { EXIDX } from '../lib/exercises.js'
import { nameFor } from '../lib/i18n.js'
import { wodLineType } from '../lib/wod.js'
import { Thumb } from './Media.jsx'
import { exerciseDetailSheet } from '../sheets.jsx'

// Read-only rendering of a WOD saved by WodEditor.jsx — same free text, with any linked
// exercise shown inline as a small chip + thumbnail (BoxClasses.jsx's "View exercises" sheet).
export default function WodView({ wod }) {
  return (
    <div className="wod-view">
      {(wod?.lines || []).map((line, i) => {
        const type = wodLineType(line)
        if (type === 'divider') return <hr key={i} className="wod-divider" />
        return (
          <p key={i} className={'wod-line-view' + (type !== 'text' ? ' wod-' + type : '')}>
            {(line.segments || []).map((seg, j) => seg.t === 'ex'
              ? <ExerciseChipView key={j} id={seg.id} label={seg.label} />
              : <span key={j}>{seg.v}</span>)}
          </p>
        )
      })}
    </div>
  )
}

// Only a chip that resolved to a real catalog exercise opens a preview — one that didn't
// (renamed/removed since it was linked) is shown but isn't tappable, since there's nothing to
// preview and no gif to show.
// This preview is athlete-facing, read-only info about what's in the class — not a routine
// editor, so the "Add to my plan" and custom-exercise edit/delete actions never show here.
function ExerciseChipView({ id, label }) {
  const ex = EXIDX[id]
  if (!ex) return <span className="wod-chip-view">{label}</span>
  return (
    <span className="wod-chip-view" role="button" tabIndex={0} onClick={() => exerciseDetailSheet(ex, { hideAddToPlan: true, hideCustomActions: true })}>
      <Thumb ex={ex} />{nameFor(ex)}
    </span>
  )
}
