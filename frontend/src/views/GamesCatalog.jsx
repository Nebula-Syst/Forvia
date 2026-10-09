import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDur } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { playGame } from '../sheets.jsx'
import GamesPicker from '../components/GamesPicker.jsx'
import Icon from '../components/Icon.jsx'

// Access point #1 (outside training) — see frontend/public/games/ (NOTICE.md) for what's vendored
// here. The other two entry points reuse the same GamesPicker/playGame: Workout.jsx's in-session
// button, and RestTimer.jsx's inline strip during rest.
export default function GamesCatalog() {
  const nav = useNavigate()
  const totalMs = useStore(s => s.S.gameStats?.totalMs || 0)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1 style={{ margin: 0 }}>{t('Mini-games')}</h1>
        {totalMs > 0 && <div className="sub">{t('{0} played so far', fmtDur(totalMs))}</div>}
      </div>
    </div>

    <GamesPicker onPick={playGame} />
  </div>
}
