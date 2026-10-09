// Registry of vendored mini-games (frontend/public/games/, see NOTICE.md) playable during a
// workout's rest periods or standalone from Settings → Mini-games. Adding a future repo of games
// is meant to be exactly this: vendor its folder under public/games/, append one entry here —
// nothing else needs to know how many games exist.
//
// `label` is a raw t() key (English), translated at render time by callers — same convention as
// lib/exercises.js's BODYPARTS, never baked into the constant itself so a runtime language
// switch still picks it up.
export const GAMES = [
  { slug: 'snake', label: 'Snake', tint: 'var(--green)' },
  { slug: 'labyrinth', label: 'Labyrinth', tint: 'var(--indigo)' },
  { slug: 'memory', label: 'Memory', tint: 'var(--purple)' },
  { slug: 'whac-a-mole', label: 'Whac-a-mole', tint: 'var(--orange)' },
]

// Uniform random pick, optionally avoiding a repeat of the game just played.
export function randomGame(excludeSlug) {
  const pool = excludeSlug ? GAMES.filter(g => g.slug !== excludeSlug) : GAMES
  return pool[Math.floor(Math.random() * pool.length)]
}
