import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDur } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Ring from './Ring.jsx'
import { fastingGoalSheet } from '../sheets.jsx'

// A live countdown, not a diary entry — S.fasting.active is either null or {start: ms}, only
// ticked (setInterval) while a fast is actually running so nothing else on the page re-renders
// on its account. Ending a fast logs its real duration to S.fasting.log for the "last fast"
// line shown once you're not fasting — no full history view yet, just enough context to see
// whether you kept it up since the last one.
export default function FastingCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [now, setNow] = useState(Date.now())
  const active = S.fasting.active

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  const goalMs = (S.fasting.goalHours || 16) * 3600000
  const elapsed = active ? now - active.start : 0
  const pct = goalMs ? Math.min(100, elapsed / goalMs * 100) : 0
  const reached = elapsed >= goalMs

  const start = () => update(s => { s.fasting.active = { start: Date.now() } })
  const stop = () => update(s => {
    if (!s.fasting.active) return
    const dur = Date.now() - s.fasting.active.start
    s.fasting.log.push({ id: s.fasting.active.start + '', start: s.fasting.active.start, end: Date.now() })
    s.fasting.active = null
    toast(t('Fast ended: {0}', fmtDur(dur)))
  })

  const lastLog = S.fasting.log[S.fasting.log.length - 1]

  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between" style={{ marginBottom: 12 }}>
      <h2 className="row" style={{ margin: 0, gap: 6 }}><Icon name="timer" style={{ fontSize: 16, color: 'var(--indigo)' }} />{t('Fasting')}</h2>
      <button className="iconbtn" onClick={() => fastingGoalSheet(S.fasting.goalHours || 16)} aria-label={t('Fasting goal')}><Icon name="gear" /></button>
    </div>
    {active
      ? <div className="row" style={{ gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <Ring size={68} stroke={7} pct={pct / 100} color={reached ? 'var(--acc)' : 'var(--indigo)'}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{Math.round(pct)}%</div>
        </Ring>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtDur(elapsed)}</div>
          <div className="dim small">{reached ? t('Goal reached — keep going or end it') : t('Goal: {0}h', S.fasting.goalHours || 16)}</div>
        </div>
      </div>
      : <div className="dim small" style={{ marginBottom: 12 }}>
        {lastLog ? t('Last fast: {0}', fmtDur(lastLog.end - lastLog.start)) : t('Not fasting right now.')}
      </div>}
    <button className="btn tinted" style={{ width: '100%' }} onClick={active ? stop : start}>
      {active ? t('End fast') : t('Start fast')}
    </button>
  </div>
}
