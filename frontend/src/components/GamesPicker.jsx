import { GAMES, randomGame } from '../lib/games.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// The games list + Random button, reused in three places: inline inside RestTimer.jsx (compact,
// icon-only — there's no room on a 360px phone for anything bigger), the small sheet opened by
// Workout.jsx's in-workout button, and the standalone catalog (GamesCatalog.jsx). `onPick`
// always receives a slug; callers decide what that means (close a sheet first, navigate, etc.).
export default function GamesPicker({ onPick, compact }) {
  if (compact) {
    return (
      <div className="games-row">
        {GAMES.map(g => (
          <button key={g.slug} className="iconbtn" style={{ '--tint': g.tint }} aria-label={t(g.label)} onClick={() => onPick(g.slug)}>
            <Icon name="gamepad" />
          </button>
        ))}
        <button className="iconbtn" aria-label={t('Random')} onClick={() => onPick(randomGame().slug)}>
          <Icon name="dice" />
        </button>
      </div>
    )
  }

  return (
    <div className="box-menu-grid">
      {GAMES.map(g => (
        <button key={g.slug} className="box-menu-card" onClick={() => onPick(g.slug)}>
          <span className="flat-badge" style={{ '--tint': g.tint }}><Icon name="gamepad" /></span>
          <span className="tt">{t(g.label)}</span>
        </button>
      ))}
      <button className="box-menu-card" onClick={() => onPick(randomGame().slug)}>
        <span className="flat-badge" style={{ '--tint': 'var(--acc)' }}><Icon name="dice" /></span>
        <span className="tt">{t('Random')}</span>
      </button>
    </div>
  )
}
