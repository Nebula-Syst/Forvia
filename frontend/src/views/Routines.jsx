import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { exCount, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { planToolsSheet, deleteRoutine } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

// Was Plan.jsx (at /plan) — this screen used to also hold a "Week schedule" section
// (S.week, weekday → routine assignment) above this list. That concept is gone: a
// routine is picked freely each session from /workout, not pre-assigned to a weekday.
// What's left is just the routine CRUD list, renamed to match.
export default function Routines() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  // The only way back into a routine's own edit/delete screen used to be the instant after
  // creating it — nothing in the UI ever linked back to it afterwards, so a routine made by
  // accident (or one you just want to rename or clear out) had no way back at all.
  const createRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/routines/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Routines')}</h1><div className="sub">{t('Pick one freely each session')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
      {S.routines.map(r => (
        <div key={r.id} className="item" onClick={() => nav('/routines/r/' + r.id)}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          <button className="iconbtn" aria-label={t('Delete routine')} onClick={e => { e.stopPropagation(); deleteRoutine(r) }}><Icon name="trash" /></button>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
      {!S.routines.length && <div className="empty small" style={{ padding: '10px 2px' }}>{t('No routines yet.')}</div>}
      <div className="item" onClick={createRoutine}>
        <span className="lrow-i"><Icon name="plus" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div></div>
      </div>
    </div>
  </>
}
