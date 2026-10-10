// Registry of vendored mini-games (frontend/public/games/, see NOTICE.md) playable during a
// workout's rest periods or standalone from Settings → Mini-games. Adding a future repo of games
// is meant to be exactly this: vendor its folder under public/games/, append one entry here —
// nothing else needs to know how many games exist.
//
// `label` is a raw t() key (English), translated at render time by callers — same convention as
// lib/exercises.js's BODYPARTS, never baked into the constant itself so a runtime language
// switch still picks it up. `path` is the folder under public/games/ the game actually lives in
// (defaults to `slug` when omitted) — the crisp-game-lib batch is grouped under games/crisp/<slug>
// so its shared engine files don't clutter the top-level games/ folder. `landscape: true` marks
// a game whose own internal viewSize is wide (16:9-ish or wider) — these were built to be played
// on a landscape screen, and come out tiny/letterboxed on a portrait phone no matter how the
// canvas is framed. GamePlayer.jsx tries to lock the screen to landscape for just these games.
export const GAMES = [
  { slug: 'snake', label: 'Snake', tint: 'var(--green)' },
  { slug: 'labyrinth', label: 'Labyrinth', tint: 'var(--indigo)' },
  { slug: 'memory', label: 'Memory', tint: 'var(--purple)' },
  { slug: 'whac-a-mole', label: 'Whac-a-mole', tint: 'var(--orange)' },
  { slug: '2048', label: '2048', tint: 'var(--yellow)' },
  // crisp-game-lib batch (abagames/crisp-game-lib-11-games) — tap/hold/drag, single input.
  { slug: 'attackchain', label: 'Attack Chain', path: 'crisp/attackchain', tint: 'var(--red)' },
  { slug: 'cardq', label: 'Card Q', path: 'crisp/cardq', tint: 'var(--pink)' },
  { slug: 'chargebeam', label: 'Charge Beam', path: 'crisp/chargebeam', tint: 'var(--blue)', landscape: true },
  { slug: 'cleanrobo', label: 'Clean Robo', path: 'crisp/cleanrobo', tint: 'var(--teal)', landscape: true },
  { slug: 'clockturret', label: 'Clock Turret', path: 'crisp/clockturret', tint: 'var(--indigo)' },
  { slug: 'dango', label: 'Dango', path: 'crisp/dango', tint: 'var(--pink)' },
  { slug: 'flipo', label: 'Flip O', path: 'crisp/flipo', tint: 'var(--purple)' },
  { slug: 'footlaser', label: 'Foot Laser', path: 'crisp/footlaser', tint: 'var(--red)', landscape: true },
  { slug: 'growth', label: 'Growth', path: 'crisp/growth', tint: 'var(--green)', landscape: true },
  { slug: 'invincibleman', label: 'Invincible Man', path: 'crisp/invincibleman', tint: 'var(--orange)' },
  { slug: 'magnetblocks', label: 'Magnet Blocks', path: 'crisp/magnetblocks', tint: 'var(--blue)' },
  { slug: 'marusansi', label: 'Marusansi', path: 'crisp/marusansi', tint: 'var(--teal)' },
  { slug: 'meteoplanet', label: 'Meteo Planet', path: 'crisp/meteoplanet', tint: 'var(--indigo)' },
  { slug: 'paintball', label: 'Paint Ball', path: 'crisp/paintball', tint: 'var(--pink)' },
  { slug: 'pakupaku', label: 'Paku Paku', path: 'crisp/pakupaku', tint: 'var(--yellow)', landscape: true },
  { slug: 'pillars3d', label: 'Pillars 3D', path: 'crisp/pillars3d', tint: 'var(--purple)' },
  { slug: 'pinclimb', label: 'Pin Climb', path: 'crisp/pinclimb', tint: 'var(--green)' },
  { slug: 'rbdrive', label: 'RB Drive', path: 'crisp/rbdrive', tint: 'var(--red)' },
  { slug: 'ringblast', label: 'Ring Blast', path: 'crisp/ringblast', tint: 'var(--orange)' },
  { slug: 'rollhold', label: 'Roll Hold', path: 'crisp/rollhold', tint: 'var(--blue)' },
  { slug: 'shiny', label: 'Shiny', path: 'crisp/shiny', tint: 'var(--yellow)', landscape: true },
  { slug: 'skygolf', label: 'Sky Golf', path: 'crisp/skygolf', tint: 'var(--teal)', landscape: true },
  { slug: 'survivor', label: 'Survivor', path: 'crisp/survivor', tint: 'var(--indigo)' },
  { slug: 'thunder', label: 'Thunder', path: 'crisp/thunder', tint: 'var(--purple)' },
  { slug: 'timbertest', label: 'Timber Test', path: 'crisp/timbertest', tint: 'var(--orange)' },
  { slug: 'up1way', label: 'Up 1 Way', path: 'crisp/up1way', tint: 'var(--pink)', landscape: true },
]

// The original, most-tested batch (pure swipe/tap, no reading required) — used wherever space is
// tight and the choice has to stay glanceable: RestTimer's inline strip, mid-set. The full
// GAMES list (everything above) only ever shows on the catalog page and the in-workout sheet,
// where browsing is a deliberate action, not an ambient one during a timed rest.
export const FEATURED_SLUGS = ['snake', 'labyrinth', 'memory', 'whac-a-mole']

// Uniform random pick, optionally avoiding a repeat of the game just played. Draws from the
// FULL catalog (not just FEATURED_SLUGS) — Random is how the compact rest-timer strip still
// surfaces the wider catalog without listing all of it.
export function randomGame(excludeSlug) {
  const pool = excludeSlug ? GAMES.filter(g => g.slug !== excludeSlug) : GAMES
  return pool[Math.floor(Math.random() * pool.length)]
}
