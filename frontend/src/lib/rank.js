// 100 levels across 10 equal-width named tiers — matches the level table computed
// server-side (api/server.js: XP_FOR_LEVEL/LEVEL_CUM, perksFor). This file only owns how
// a level *displays*; the level number itself always comes from the server. `slug` maps
// to the real artwork at public/tiers/<slug>.svg (see RankIcon.jsx).
export const TIERS = [
  { name: 'Iron', slug: 'iron', min: 1, max: 10, color: 'var(--grey)' },
  { name: 'Bronze', slug: 'bronze', min: 11, max: 20, color: '#b08d57' },
  { name: 'Silver', slug: 'silver', min: 21, max: 30, color: '#c0c0c8' },
  { name: 'Gold', slug: 'gold', min: 31, max: 40, color: 'var(--yellow)' },
  { name: 'Platinum', slug: 'platinum', min: 41, max: 50, color: 'var(--teal)' },
  { name: 'Diamond', slug: 'diamond', min: 51, max: 60, color: 'var(--blue)' },
  { name: 'Master', slug: 'master', min: 61, max: 70, color: 'var(--purple)' },
  { name: 'Champion', slug: 'champion', min: 71, max: 80, color: 'var(--red)' },
  { name: 'Elite', slug: 'elite', min: 81, max: 90, color: 'var(--orange)' },
  { name: 'Legend', slug: 'legend', min: 91, max: 100, color: '#f0d9a8' },
]

export const tierFor = level => TIERS.find(t => level >= t.min && level <= t.max) || TIERS[0]

export const tierBySlug = slug => TIERS.find(t => t.slug === slug) || TIERS[0]

// Every tier at or below the level actually reached — these are the ones a "rank" showcase
// badge (SettingsProfile.jsx) may be set to, not just the current one.
export const unlockedTiers = level => TIERS.filter(t => level >= t.min)
