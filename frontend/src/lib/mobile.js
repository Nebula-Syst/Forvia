// Native-shell hooks (Capacitor). This repo builds the web app only for now — the mobile
// shell is being rebuilt separately (it will call into these same functions again once it
// lands) — so MOBILE is permanently false here and every function below is its safe no-op
// fallback. Kept (rather than deleted) so callers elsewhere don't need touching either way.
export const MOBILE = false

export async function nativeLoad() { return null }
export async function nativeSave(state) { /* no native shell yet */ }
export async function syncReminder(S, interactive = false) { return false }
export async function shareExport(json, filename) { /* no native shell yet */ }
