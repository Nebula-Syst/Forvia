// Admin-configured streak-badge tiers (day count -> name), fetched from the server rather
// than hardcoded like lib/rank.js's TIERS — the whole point (per the admin who's editing
// them) is being able to push the thresholds out over time without a release. A sensible
// fallback ladder covers the moment before that fetch lands (boot, offline).
export const FALLBACK_STREAK_TIERS = [
  { id: 'fallback-1', name: 'Iniciante', days: 1 },
  { id: 'fallback-2', name: 'Constante', days: 3 },
  { id: 'fallback-3', name: 'Comprometido', days: 7 },
  { id: 'fallback-4', name: 'Disciplinado', days: 14 },
  { id: 'fallback-5', name: 'Inquebrantable', days: 21 },
  { id: 'fallback-6', name: 'Imparable', days: 30 },
  { id: 'fallback-7', name: 'Leyenda', days: 60 },
  { id: 'fallback-8', name: 'Élite', days: 100 },
  { id: 'fallback-9', name: 'Maestro', days: 180 },
  { id: 'fallback-10', name: 'Inmortal', days: 365 },
]

// Ring/text color per streak-tier position (1-10, same indexing as the artwork) — the
// badges' own art already reads iron/bronze/silver/gold/green/blue/purple/red/orange/pale
// gold, so the hero ring on /rank echoes that instead of picking an unrelated color.
export const STREAK_TIER_COLORS = [
  '#9a9a9a', '#b08d57', '#c0c0c8', 'var(--yellow)', '#6fcf6f',
  'var(--blue)', 'var(--purple)', 'var(--red)', 'var(--orange)', '#f0d9a8',
]

// The badge artwork only covers 10 steps (public/streak/1..10.svg) — same "clamp past the
// end" idiom as PrestigeIcon for a config that can outgrow its own art without a broken
// image. `tiers` must already be sorted ascending by `days` (the API returns them that way).
export function tierForDays(daysStreak, tiers) {
  const list = tiers && tiers.length ? tiers : FALLBACK_STREAK_TIERS
  let idx = -1
  for (let i = 0; i < list.length; i++) {
    if (daysStreak >= list[i].days) idx = i
    else break
  }
  if (idx === -1) return null
  return { ...list[idx], artIdx: Math.min(10, idx + 1) }
}
