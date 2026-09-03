import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, exCount, uid } from '../lib/format.js'
import { FREESTYLE_DAY } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, planToolsSheet, deleteRoutine } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  // The only way back into a routine's own edit/delete screen used to be the instant after
  // creating it — nothing in the UI ever linked back to it afterwards, so a routine made by
  // accident (or one you just want to rename or clear out) had no way back at all.
  const createRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <h4 className="sec">{t('Week schedule')}</h4>
    <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => {
        const r = S.routines.find(x => x.id === S.week[d])
        const isFreestyle = S.week[d] === FREESTYLE_DAY
        return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
          <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
          {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span>
            : isFreestyle ? <span className="tag acc"><Icon name="shuffle" />{t('Freestyle')}</span>
            : <span className="tag">{t('Rest')}</span>}
          <Icon name="chevronRight" className="chev" /></div>
      })}
    </div>

    <h4 className="sec">{t('My routines')}</h4>
    <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
      {S.routines.map(r => (
        <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
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
