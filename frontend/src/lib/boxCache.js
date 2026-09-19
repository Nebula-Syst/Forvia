// Every box-scoped screen fetches its own box data fresh on mount, so useBoxAccent sees `null`
// for a beat on every navigation — even between two screens of the same, already-visited box —
// which flashes the default accent before the fetch resolves. This remembers the last-seen
// colors per box (module-level, not React state, since it needs to survive the very screens
// unmounting) so a screen can seed its color on the first render instead of waiting a round
// trip; the real fetch still runs and corrects it if anything actually changed.
const cache = new Map()

export function cachedBoxColor(boxId, theme) {
  const c = cache.get(boxId)
  return c && c.colorsEnabled ? (c.colors[theme] || null) : null
}

export function setCachedBoxColors(boxId, colors, colorsEnabled) {
  if (boxId) cache.set(boxId, { colors: colors || {}, colorsEnabled: colorsEnabled !== false })
}
