// Tracks "the last rank this device has already shown a level-up reveal for" — purely a local,
// per-device watermark (localStorage), not server state: level-ups aren't discrete stored
// events like a cheat penalty, they're just where xpFor() currently lands, so there's nothing
// server-side to mark "seen". A composite score (prestige matters far more than level, so it's
// weighted above the 1-100 level range) lets a single number comparison catch "went up" while
// still telling a level-up apart from a prestige reset, which has its own separate reveal.
const SCORE_PRESTIGE_WEIGHT = 1000

export function rankScore(rank) {
  return rank.prestige * SCORE_PRESTIGE_WEIGHT + rank.level
}

const key = uid => 'forvia:lastRankSeen:' + uid

// Design-iteration mode for the level-up reveal — off now that the animation's done being
// tuned. When true, skips persisting the watermark after a hit, so the exact same level-up
// keeps re-triggering on every check instead of only once; never what a real account should see.
const REPLAY_FOREVER = false

// Returns { prevLevel, prevPrestige } if this score is a genuine level-up to animate (same
// prestige, level went up), or null otherwise — including the very first read for an account on
// this device, where there's nothing to compare against yet and no reveal should fire.
export function checkLevelUp(uid, rank) {
  const raw = localStorage.getItem(key(uid))
  const score = rankScore(rank)
  if (raw === null) { localStorage.setItem(key(uid), String(score)); return null }
  const prev = Number(raw)
  const prevLevel = prev % SCORE_PRESTIGE_WEIGHT
  const prevPrestige = Math.floor(prev / SCORE_PRESTIGE_WEIGHT)
  const isLevelUp = score > prev && rank.prestige === prevPrestige && rank.level > prevLevel
  if (!(REPLAY_FOREVER && isLevelUp)) localStorage.setItem(key(uid), String(score))
  return isLevelUp ? { prevLevel, prevPrestige } : null
}

// The prestige-upgrade reveal (Rank.jsx) already shows its own celebration for the reset —
// it calls this directly so the level-up watcher's next poll sees "already caught up" instead
// of reading the level-1 drop as a fresh baseline to compare future gains against.
export function markRankSeen(uid, rank) {
  localStorage.setItem(key(uid), String(rankScore(rank)))
}

// Same idiom as lib/nav.js's setNav: lets a non-component module (useStore's refreshUser,
// which can't import a component file without a circular/layering mess) ask the mounted
// LevelUpRevealTrigger to check right now, instead of waiting for its poll interval — the
// moment a workout save actually lands is the most common source of a level-up, so that's
// worth an immediate check rather than a several-second delay. Passing the already-fetched
// user (refreshUser just called /api/me itself) skips a second, redundant request.
let _checkNow = () => {}
export const setLevelUpChecker = fn => { _checkNow = fn }
export const checkNowForLevelUp = user => _checkNow(user)
