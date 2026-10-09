import { GAMES, FEATURED_SLUGS, randomGame } from '../lib/games.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import GameCover from './GameCover.jsx'

// The games list + Random button, reused in three places: inline inside RestTimer.jsx (compact,
// icon-only — there's no room on a 360px phone for anything bigger, and a timed rest is the
// wrong moment to browse a long catalog), the small sheet opened by Workout.jsx's in-workout
// button, and the standalone catalog (GamesCatalog.jsx) — these last two show the full GAMES
// list (browsing is a deliberate action there), while compact sticks to FEATURED_SLUGS. `onPick`
// always receives a slug; callers decide what that means (close a sheet first, navigate, etc.).
// Each game shows its own small cover illustration (GameCover.jsx) rather than a repeated
// gamepad glyph — Random is the one tile that's genuinely iconic, not a specific game.
export default function GamesPicker({ onPick, compact }) {
  if (compact) {
    const featured = GAMES.filter(g => FEATURED_SLUGS.includes(g.slug))
    return (
      <div className="games-row">
        {featured.map(g => (
          <button key={g.slug} className="iconbtn" aria-label={t(g.label)} onClick={() => onPick(g.slug)}>
            <GameCover slug={g.slug} label={t(g.label)} tint={g.tint} size={22} />
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
          <GameCover slug={g.slug} label={t(g.label)} tint={g.tint} size={44} />
          <span className="tt">{t(g.label)}</span>
        </button>
      ))}
      <button className="box-menu-card" onClick={() => onPick(randomGame().slug)}>
        <span className="flat-badge" style={{ '--tint': 'var(--acc)', width: 44, height: 44, borderRadius: 13 }}><Icon name="dice" /></span>
        <span className="tt">{t('Random')}</span>
      </button>
    </div>
  )
}
