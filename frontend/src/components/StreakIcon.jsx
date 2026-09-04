// Real artwork, same idiom as RankIcon (components/RankIcon.jsx) — one file per streak
// tier at public/streak/<1-10>.svg, cropped/background-removed from the set the user
// supplied. `tier` (1-10) is the tier's position in the (admin-configurable) streak-tier
// list, already clamped to the art's range by lib/streak.js's tierForDays.
//
// These are served with a 30-day immutable Cache-Control (same as tiers/prestige), so a
// re-crop after the first deploy is invisible to anyone who already loaded the old file —
// a hard refresh doesn't reliably bust it either. STREAK_ASSET_VERSION is the same fix
// RankIcon already uses for this: bump it any time these specific files change, and the
// query string makes it a new URL, not a cache revalidation.
const STREAK_ASSET_VERSION = '3'
export default function StreakIcon({ tier = 1, size, className = '' }) {
  const n = Math.min(10, Math.max(1, tier))
  const s = size ? { width: size, height: size } : null
  return (
    <span className={'rank-icon tier-icon ' + className} style={s}>
      <img src={`/streak/${n}.svg?v=${STREAK_ASSET_VERSION}`} alt="" />
    </span>
  )
}
