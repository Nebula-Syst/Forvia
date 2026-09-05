// Real artwork (user-generated, background removed), not hand-drawn SVG — one image per
// rank tier at public/tiers/<slug>.svg and one per prestige level at
// public/prestige/<n>.svg. Each file is a plain <svg> wrapping a base64 raster image
// (photoreal metallic/gem art doesn't vectorize into clean paths), so it drops into an
// <img> like any other icon: scales via CSS, no extra JS, cacheable as a static asset.
import Icon from './Icon.jsx'
import { TIERS } from '../lib/rank.js'

const SLUG_BY_TIER = Object.fromEntries(TIERS.map(t => [t.name, t.slug]))
// Bump on ANY change to the files under public/tiers or public/prestige — 30-day immutable
// Cache-Control (nginx) means a re-crop is otherwise invisible to anyone who already loaded
// the old file, hard refresh included. Bumped this round for the alpha-fringe cleanup on
// all 10 tiers + all 10 prestige levels.
const RANK_ASSET_VERSION = '4'

export default function RankIcon({ tier, size, className = '' }) {
  const slug = SLUG_BY_TIER[tier] || TIERS[0].slug
  const s = size ? { width: size, height: size } : null
  return (
    <span className={'rank-icon tier-icon ' + className} style={s}>
      <img src={`/tiers/${slug}.svg?v=${RANK_ASSET_VERSION}`} alt="" />
    </span>
  )
}

// Prestige is uncapped, so anything past 10 clamps to the level-10 artwork — the exact
// prestige count is still shown as a number next to the badge (RankBadge.jsx). `locked`
// desaturates the same image and overlays a padlock, same idiom as the tier roadmap.
export function PrestigeIcon({ level = 1, locked = false, size, className = '' }) {
  const n = Math.min(10, Math.max(1, level))
  const s = size ? { width: size, height: size } : null
  return (
    <span className={'prestige-icon' + (locked ? ' locked' : '') + ' ' + className} style={s}>
      <img src={`/prestige/${n}.svg?v=${RANK_ASSET_VERSION}`} alt="" />
      {locked && <Icon name="lock" className="prestige-icon-lock" />}
    </span>
  )
}
