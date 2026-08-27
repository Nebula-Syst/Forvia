import { tierFor } from '../lib/rank.js'
import { t } from '../lib/i18n.js'
import RankIcon, { PrestigeIcon } from './RankIcon.jsx'

// Tier names (Iron, Bronze, …) are proper nouns, same call as workout template names
// like "Push Day" — they stay as written rather than going through every locale pack.
// `perks` are the OWNER's — Platinum's animatedBadge (pulse glow).
// `iconsOnly` drops the "Tier · Level N" text — just the two bigger badges of art, each
// with its bare number (no tier name), for spots where the icons alone already carry
// the tier/prestige identity (RankRow today).
export default function RankBadge({ level, prestige = 0, size = 'sm', onClick, perks, iconsOnly = false }) {
  const tier = tierFor(level)
  return (
    <span className={'rank-badge ' + size + (iconsOnly ? ' icons-only' : '') + (perks?.animatedBadge ? ' pulse' : '')}
      style={{ '--tier': tier.color, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}>
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
