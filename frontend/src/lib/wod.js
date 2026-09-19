// A WOD is free text (whatever the coach would write on a real whiteboard — sections,
// EMOM minutes with several movements packed into one, ladders shared across two exercises,
// notes) with a real exercise "chip" droppable inline anywhere in that text — including more
// than one per line (an EMOM minute pairing two movements: "M1: Power Clean + Push Jerk").
// That's the one thing a plain textarea + whole-line link couldn't do, and it's exactly the
// case a real whiteboard needs.
//
// Storage shape, deliberately NOT Lexical's own (verbose, tied to its internal schema, and
// every read-only view — the athlete's class sheet, the live-class display — would otherwise
// need to load the editor just to render text):
//   { lines: [ { type: 'text'|'title'|'subtitle'|'note'|'divider', segments: [ {t:'text', v} | {t:'ex', id, label} ] }, ... ] }
// `label` on an exercise segment is the exercise's name *at the time it was inserted* — a
// fallback if that catalog entry is ever renamed or removed later. `type` is a display hint
// only (bold+centered heading, a smaller left-aligned heading, an italic aside, or a plain rule
// with no text) — a coach can still just type plain lines without ever touching it, same as
// before; missing/unknown `type` means 'text'. A 'divider' line carries no segments — there's
// nothing to link an exercise to on a rule.

export const EMPTY_WOD = { lines: [] }

const LINE_TYPES = ['title', 'subtitle', 'note', 'divider']
export const wodLineType = line => LINE_TYPES.includes(line?.type) ? line.type : 'text'

export const wodLineText = line => (line?.segments || []).map(s => s.t === 'ex' ? s.label : s.v).join('')

export const wodIsEmpty = wod => !(wod?.lines || []).some(l => wodLineText(l).trim())

export const wodLineCount = wod => (wod?.lines || []).filter(l => wodLineText(l).trim()).length

// Ordered exercise sequence for live-class stepping (CoachClasses.jsx's control panel,
// LiveClass.jsx's big-screen display) — document order, each carrying its own mention text
// (`label`) plus the full line (`text`) for context, since two steps can now share one line.
export function wodSteps(wod) {
  const steps = []
  for (const line of wod?.lines || []) {
    const text = wodLineText(line)
    for (const seg of line.segments || []) {
      if (seg.t === 'ex') steps.push({ exerciseId: seg.id, label: seg.label, text })
    }
  }
  return steps
}
