// Native-shell hooks (Capacitor). forvia-mobile is a thin WebView pointed at this same live
// site (no bundled build, no build-time flag — see its README), so whether we're inside it is a
// runtime check, not a build flag — same reasoning as lib/back.js's own MOBILE check. A plain
// browser tab or PWA never has window.Capacitor, so every function below stays a no-op there.
export const MOBILE = !!window.Capacitor?.isNativePlatform?.()

export async function nativeLoad() { return null }
export async function nativeSave(state) { /* no native persistence yet — synced state already covers this */ }
export async function shareExport(json, filename) { /* no native share sheet yet */ }

// The workout-day reminder, natively: forvia-core's own reminderTick() (server.js) does the
// exact same "haven't logged a workout today" check server-side and delivers it over Web Push —
// a WebView's own service worker can't reliably keep running once Android has killed the app, so
// the native app schedules this itself instead, with @capacitor/local-notifications (a real
// on-device alarm, not tied to the page staying alive).
//
// The one real limitation next to the server version: an Android local notification is a
// fire-and-forget alarm — there's no way to ask "have they logged a workout yet?" at the moment
// it actually fires. This resyncs instead: every call cancels whatever was scheduled and
// re-decides from scratch using the S already in memory — if today's workout is already logged,
// it schedules for tomorrow instead of today; if not, today's slot (or tomorrow's, if that time
// already passed today). initReminderResync() below calls this again on every app resume, so a
// workout logged and then the app reopened corrects the schedule before evening; it just can't
// correct itself while the app is never reopened at all that day.
const REMINDER_ID = 19412
export async function syncReminder(S, interactive = false) {
  if (!MOBILE) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if (interactive) {
      const perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return false
    }
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] })
    if (!S.reminder?.on) return true

    const [hh, mm] = (S.reminder.time || '08:00').split(':').map(Number)
    const now = new Date()
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
    const today = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0')
    const loggedToday = (S.workouts || []).some(w => w.d === today)
    if (loggedToday || at <= now) at.setDate(at.getDate() + 1)

    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: 'Workout reminder',
        body: "You haven't logged a workout today — let's go 💪",
        schedule: { at, allowWhileIdle: true },
      }],
    })
    return true
  } catch {
    return false   // plugin not registered on the native side (cap sync pending) — leave it off
  }
}

// Registered once from App.jsx, same shape as lib/back.js's initBackButton — resyncs the
// reminder (never interactively, never re-prompting for permission) whenever the app comes back
// to the foreground, so reopening it after a workout is what corrects today's schedule.
export async function initReminderResync(getS) {
  if (!MOBILE) return () => {}
  try {
    const { App } = await import('@capacitor/app')
    const sub = await App.addListener('resume', () => syncReminder(getS()))
    return () => sub.remove()
  } catch {
    return () => {}
  }
}
