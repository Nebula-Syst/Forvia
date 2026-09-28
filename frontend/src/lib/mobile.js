// Native-shell hooks (Capacitor). forvia-mobile is a thin WebView pointed at this same live
// site (no bundled build, no build-time flag — see its README), so whether we're inside it is a
// runtime check, not a build flag — same reasoning as lib/back.js's own MOBILE check. A plain
// browser tab or PWA never has window.Capacitor, so every function below stays a no-op there.
import { MUSCLES, MUSCLE_NAME, loadOfWorkouts } from './muscles.js'
import { t } from './i18n.js'

export const MOBILE = !!window.Capacitor?.isNativePlatform?.()

// One-way signal to MainActivity (AppReadyPlugin, forvia-mobile) that there's real content on
// screen — Home or Login, doesn't matter which — so it can stop covering the WebView with its
// own looping native splash overlay (it enforces its own minimum loop count and a timeout
// independently; this just reports the moment the web side actually has something to show).
// App.jsx calls this exactly once, right when it would stop rendering its own boot placeholder.
export function notifyNativeReady() {
  if (!MOBILE) return
  try { window.Capacitor?.Plugins?.AppReady?.ready?.() } catch { /* plugin not linked yet */ }
}

// The installed app's own versionName ("1.0.<run>" — see forvia-mobile's build-apk.yml), for
// SettingsMobileApp's update check. null outside the native app, or if the plugin call fails.
export async function nativeAppVersion() {
  if (!MOBILE) return null
  try {
    const { App } = await import('@capacitor/app')
    return (await App.getInfo()).version
  } catch { return null }
}

export async function nativeLoad() { return null }
export async function nativeSave(state) { /* no native persistence yet — synced state already covers this */ }
export async function shareExport(json, filename) { /* no native share sheet yet */ }

// Which muscle to name in the workout reminder: whichever has gone longest without a set,
// same "what am I neglecting" question rankOf's `missed` answers, but with a full recency
// order instead of just worked-vs-missed — an untrained muscle sorts before any trained date
// (empty string < any 'YYYY-MM-DD'). Ties (several muscles never trained, or trained on the
// same day) rotate through by day-of-year instead of always naming the first one in body order.
function suggestedMuscle(S) {
  const workouts = S.workouts || []
  if (!workouts.length) return null
  const lastTrained = {}
  workouts.forEach(w => {
    const load = loadOfWorkouts([w])
    Object.keys(load).forEach(slug => {
      if (load[slug] > 0 && (!lastTrained[slug] || w.d > lastTrained[slug])) lastTrained[slug] = w.d
    })
  })
  const oldestDate = MUSCLES.reduce((min, slug) => (lastTrained[slug] || '') < min ? (lastTrained[slug] || '') : min, '9999-99-99')
  const tied = MUSCLES.filter(slug => (lastTrained[slug] || '') === oldestDate)
  const dayIdx = Math.floor(Date.now() / 86400000)
  return tied[dayIdx % tied.length]
}

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
// already passed today). initRemindersResync() below calls this again on every app resume, so a
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

    const muscle = suggestedMuscle(S)
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: muscle ? t('Time to train {0}', t(MUSCLE_NAME[muscle])) : t('Workout day reminder'),
        body: t("You haven't logged a workout today — let's go") + ' 💪',
        schedule: { at, allowWhileIdle: true },
      }],
    })
    return true
  } catch {
    return false   // plugin not registered on the native side (cap sync pending) — leave it off
  }
}

// Same idea as the workout reminder, but checking foodDiary instead of workouts — a nudge to
// log a meal if none was logged yet today. A separate id/settings slot (S.foodReminder), same
// cancel-and-reschedule-from-scratch approach for the same reason (a local alarm can't check
// live state when it actually fires).
const FOOD_REMINDER_ID = 19414
export async function syncFoodReminder(S, interactive = false) {
  if (!MOBILE) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if (interactive) {
      const perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return false
    }
    await LocalNotifications.cancel({ notifications: [{ id: FOOD_REMINDER_ID }] })
    if (!S.foodReminder?.on) return true

    const [hh, mm] = (S.foodReminder.time || '20:00').split(':').map(Number)
    const now = new Date()
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
    const today = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0')
    const loggedToday = (S.foodDiary?.[today] || []).length > 0
    if (loggedToday || at <= now) at.setDate(at.getDate() + 1)

    await LocalNotifications.schedule({
      notifications: [{
        id: FOOD_REMINDER_ID,
        title: t("Log today's food") + ' 🍽️',
        body: t("You haven't logged any meals today"),
        schedule: { at, allowWhileIdle: true },
      }],
    })
    return true
  } catch {
    return false
  }
}

// Registered once from App.jsx, same shape as lib/back.js's initBackButton — resyncs both
// reminders (never interactively, never re-prompting for permission) whenever the app comes
// back to the foreground, so reopening it after a workout or a meal is what corrects today's
// schedule.
export async function initRemindersResync(getS) {
  if (!MOBILE) return () => {}
  try {
    const { App } = await import('@capacitor/app')
    const sub = await App.addListener('resume', () => {
      const S = getS()
      syncReminder(S)
      syncFoodReminder(S)
    })
    return () => sub.remove()
  } catch {
    return () => {}
  }
}
