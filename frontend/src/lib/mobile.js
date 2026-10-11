// Native-shell hooks (Capacitor). forvia-mobile is a thin WebView pointed at this same live
// site (no bundled build, no build-time flag — see its README), so whether we're inside it is a
// runtime check, not a build flag — same reasoning as lib/back.js's own MOBILE check. A plain
// browser tab or PWA never has window.Capacitor, so every function below stays a no-op there.
import { registerPlugin } from '@capacitor/core'
import { MUSCLES, MUSCLE_NAME, loadOfWorkouts } from './muscles.js'
import { t } from './i18n.js'
import { api } from './api.js'
import { workoutXp, streakDays } from './history.js'
import { tierFor } from './rank.js'

export const MOBILE = !!window.Capacitor?.isNativePlatform?.()

// registerPlugin() is what actually wires a name to the native bridge — window.Capacitor.Plugins
// only gets populated for a plugin that went through this call; a raw window.Capacitor.Plugins
// .AppReady lookup without it is always undefined (a past bug — see git log — that made
// notifyNativeReady() below a permanent no-op).
const AppReady = registerPlugin('AppReady')

// One-way signal to MainActivity (AppReadyPlugin, forvia-mobile) that there's real content on
// screen — Home or Login, doesn't matter which — so it can stop covering the WebView with its own
// loading overlay (it enforces its own minimum display time and a timeout independently; this
// just reports the moment the web side actually has something to show). App.jsx calls this
// exactly once, right when it would stop rendering its own boot placeholder.
export function notifyNativeReady() {
  if (!MOBILE) return
  AppReady.ready().catch(() => { /* plugin not linked yet — older installed build */ })
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

// No time picker — when to fire is inferred from when this account actually trains, not asked
// for. Each of the last 20 workouts' own `start` (Date.now() at the moment the session began,
// local time) is rounded to the nearest half hour, and whichever slot comes up most often wins;
// ties go to whichever was seen most recently, so a schedule that's drifted in the last few
// weeks beats an older habit that happens to tie on count. A brand new account (no workouts
// yet) has nothing to infer from, so this falls back to 08:00 — the same default the old manual
// picker used, before there's enough history to do better than a guess.
export function inferredReminderTime(S) {
  const workouts = (S.workouts || []).filter(w => w.start).slice(-20)
  if (!workouts.length) return '08:00'
  const slots = new Map() // 'HH:MM' -> { count, lastIndex }
  workouts.forEach((w, i) => {
    const d = new Date(w.start)
    const totalMin = d.getHours() * 60 + Math.round(d.getMinutes() / 30) * 30
    const key = String(Math.floor(totalMin / 60) % 24).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0')
    const cur = slots.get(key)
    slots.set(key, { count: (cur?.count || 0) + 1, lastIndex: i })
  })
  let best = null
  for (const [key, v] of slots) {
    if (!best || v.count > best.v.count || (v.count === best.v.count && v.lastIndex > best.v.lastIndex)) best = { key, v }
  }
  return best.key
}

// Which muscles to name in the workout reminder: the two that have gone longest without a
// set, same "what am I neglecting" question rankOf's `missed` answers, but with a full recency
// order instead of just worked-vs-missed — an untrained muscle sorts before any trained date
// (empty string < any 'YYYY-MM-DD'). There's no weekly split left to read a literal "today's
// muscles" off of (routines are picked freely each session, see forvia-core's reminderTick) —
// this is the closest honest stand-in: whatever's been neglected longest is, in practice,
// usually what a split would have scheduled for today anyway. Ties (several muscles never
// trained, or trained on the same day) rotate through by day-of-year instead of always naming
// the same ones first.
function suggestedMuscles(S, n = 2) {
  const workouts = S.workouts || []
  if (!workouts.length) return []
  const lastTrained = {}
  workouts.forEach(w => {
    const load = loadOfWorkouts([w])
    Object.keys(load).forEach(slug => {
      if (load[slug] > 0 && (!lastTrained[slug] || w.d > lastTrained[slug])) lastTrained[slug] = w.d
    })
  })
  const dayIdx = Math.floor(Date.now() / 86400000)
  const ranked = MUSCLES.slice().sort((a, b) => (lastTrained[a] || '') < (lastTrained[b] || '') ? -1 : 1)
  // Rotate ties (equal last-trained date) so a big block of "never trained" muscles doesn't
  // always lead with the same two — same day-of-year trick the old single-muscle version used,
  // applied per equal-date run instead of just the very first one.
  let i = 0
  while (i < ranked.length) {
    let j = i + 1
    while (j < ranked.length && (lastTrained[ranked[j]] || '') === (lastTrained[ranked[i]] || '')) j++
    const run = ranked.slice(i, j)
    const shift = dayIdx % run.length
    ranked.splice(i, run.length, ...run.slice(shift), ...run.slice(0, shift))
    i = j
  }
  return ranked.slice(0, n)
}

// "One more session and you'll level up" is only worth saying when it's actually true — close
// enough that a normal session plausibly closes the gap. "Normal" is this user's own last 10
// sessions' average XP (workoutXp — mirrors api/server.js's formula, see lib/history.js),
// never a fixed guess: a light-training account and a heavy-volume one earn wildly different
// XP per session, and a flat threshold would be honest for neither. `rank` comes from a fresh
// GET /api/me/nebula fetch at sync time (not S — the client has no local XP/level math, that's
// server-only), so this degrades to nothing (not a guess) if that fetch fails or never ran yet.
function levelUpLine(rank, S) {
  if (!rank || rank.readyToPrestige) return null
  const remaining = rank.xpForLevel - rank.xpInLevel
  const recent = (S.workouts || []).slice(-10)
  if (!recent.length) return null
  const avgXp = recent.reduce((n, w) => n + workoutXp(w), 0) / recent.length
  if (avgXp <= 0 || remaining > avgXp * 1.15) return null
  const nextLevel = rank.level + 1
  const tier = tierFor(nextLevel)
  return t("One more session and you'll level up to {0}", tier.name + ' · ' + t('Level {0}', nextLevel))
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
// already passed today) — "today's slot" itself is inferredReminderTime(S) above, recomputed
// fresh every sync, so a training schedule that's shifted gets picked up the same way a logged
// workout does. initRemindersResync() below calls this again on every app resume, so a workout
// logged (or a shift in when they train) and then the app reopened corrects the schedule before
// evening; it just can't correct itself while the app is never reopened at all that day.
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

    const [hh, mm] = inferredReminderTime(S).split(':').map(Number)
    const now = new Date()
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
    const today = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0')
    const loggedToday = (S.workouts || []).some(w => w.d === today)
    if (loggedToday || at <= now) at.setDate(at.getDate() + 1)

    const muscles = suggestedMuscles(S)
    const names = muscles.map(slug => t(MUSCLE_NAME[slug]))
    const title = names.length > 1 ? t('Time to train {0} and {1}', names[0], names[1])
      : names.length ? t('Time to train {0}', names[0])
      : t('Workout day reminder')

    // The rank fetch needs a live session — never the thing that blocks scheduling the
    // reminder itself (offline, or this resync ran before login finished): falls back to the
    // plain base line below, same as it always has, rather than failing the whole sync.
    let rank = null
    try { rank = (await api('/api/me/nebula')).user?.rank || null } catch { /* degrade, don't fail */ }
    const streak = streakDays(S)

    const parts = [t("You haven't logged a workout today — let's go") + ' 💪']
    const levelUp = levelUpLine(rank, S)
    if (levelUp) parts.push(levelUp)
    if (streak >= 3) parts.push(t("Keep your {0}-day streak going", streak) + ' 🔥')

    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title,
        body: parts.join(' '),
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
