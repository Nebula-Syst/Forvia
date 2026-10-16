import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { WorkoutRow, workoutDetailSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import AdUnit from '../components/AdUnit.jsx'

// Opt-in (Settings → Ads) — off by default. Every 6th row, same "feed-native, not stuffed in"
// shape as Social's own Discover placement (AdUnit itself no-ops without a configured slot).
const AD_EVERY = 6

function EmptyHistory() {
  return (
    <div className="empty">
      <div className="ico"><Icon name="history" /></div>
      {t('No workouts yet.')}
    </div>
  )
}

function HistoryList({ workouts }) {
  const newestFirst = workouts.slice().reverse()
  const adOn = useStore(s => s.S.adPlacements?.history)
  const adSlot = useStore(s => s.config?.adsense_slot_feed)
  return (
    <div className="list">
      {newestFirst.map((w, i) => <>
        <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />
        {adOn && i > 0 && (i + 1) % AD_EVERY === 0 && <AdUnit key={'ad' + i} slot={adSlot} />}
      </>)}
    </div>
  )
}

export default function History() {
  const nav = useNavigate()
  const workouts = useStore(s => s.S.workouts)

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}>
        <Icon name="chevronLeft" />
      </button>
      <div style={{ flex: 1, marginLeft: 12 }}>
        <h1>{t('History')}</h1>
        <div className="sub">{t('{0} workouts', workouts.length)}</div>
      </div>
    </div>
    {workouts.length ? <HistoryList workouts={workouts} /> : <EmptyHistory />}
  </>
}
