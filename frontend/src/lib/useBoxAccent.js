import { useEffect } from 'react'
import { boxAccentVars } from './format.js'

// A box's custom accent has to apply to the WHOLE page, not just the current screen's own
// subtree — the app's ambient background glow (index.css's body{background:...}) reads --acc
// from `body` itself, an ancestor no inline style on a nested view's wrapper div could ever
// reach. Setting it directly on document.body cascades down to everything (buttons, badges,
// the glow) in one place; cleanup always just removes the override (never tries to restore a
// captured "previous" value), so it falls back to the same :root[data-accent] default no matter
// what order screens mount/unmount in while navigating around inside the same box.
export function useBoxAccent(hex) {
  useEffect(() => {
    if (!hex) return
    const vars = boxAccentVars(hex)
    const body = document.body
    for (const k of Object.keys(vars)) body.style.setProperty(k, vars[k])
    return () => { for (const k of Object.keys(vars)) body.style.removeProperty(k) }
  }, [hex])
}
