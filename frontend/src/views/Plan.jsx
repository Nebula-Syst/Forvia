import { useStore } from '../store/useStore.js'
import { DAYN } from '../lib/format.js'
import { FREESTYLE_DAY } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'

export default function Plan() {
  const S = useStore(s => s.S)

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
  </>
}
