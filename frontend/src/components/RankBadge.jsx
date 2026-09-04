import { tierFor } from '../lib/rank.js'
import { t } from '../lib/i18n.js'
import RankIcon, { PrestigeIcon } from './RankIcon.jsx'
import StreakIcon from './StreakIcon.jsx'

// Tier names (Iron, Bronze, …) are proper nouns, same call as workout template names
// like "Push Day" — they stay as written rather than going through every locale pack.
// `perks` are the OWNER's — Platinum's animatedBadge (pulse glow).
// `iconsOnly` drops the "Tier · Level N" text — just the two bigger badges of art, each
// with its bare number (no tier name), for spots where the icons alone already carry
// the tier/prestige identity (RankRow today).
// `streak`/`streakTier` are opt-in (Home only, via RankRow) — every other call site
// (Social, Settings profile) doesn't pass them, so the badge renders exactly as it always
// has there. `streakTier` is the tier's 1-10 position in the (admin-configurable) streak
// ladder — lib/streak.js's tierForDays resolves it — which is what picks the badge art;
// `streak` itself is just the day count shown next to it.
export default function RankBadge({ level, prestige = 0, streak = 0, streakTier = 1, size = 'sm', onClick, perks, iconsOnly = false }) {
  const tier = tierFor(level)
  return (
    <span className={'rank-badge ' + size + (iconsOnly ? ' icons-only' : '') + (perks?.animatedBadge ? ' pulse' : '')}
      style={{ '--tier': tier.color, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}>
      {streak > 0 && (
        <span className="rank-badge-streak" style={iconsOnly ? { gap: 0 } : undefined}>
          <StreakIcon tier={streakTier} size={iconsOnly ? 30 : undefined} />
          {streak}
        </span>
      )}
      {prestige > 0 && (
        <span className="rank-badge-prestige" style={iconsOnly ? { gap: 0 } : undefined}>
          <PrestigeIcon level={prestige} size={iconsOnly ? 30 : undefined} />
          {prestige}
        </span>
      )}
      <span className="rank-badge-tier" style={iconsOnly ? { gap: 0 } : undefined}>
        <RankIcon tier={tier.name} className="rank-badge-icon" size={iconsOnly ? 36 : undefined} />
        {iconsOnly || size === 'sm' ? level : <>{tier.name} · {t('Level {0}', level)}</>}
      </span>
    </span>
  )
}
