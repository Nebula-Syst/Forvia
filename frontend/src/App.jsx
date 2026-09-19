import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang, t } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { wsOn } from './lib/ws.js'
import { initBackButton } from './lib/back.js'
import { useWakeLock } from './lib/wakelock.js'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ActiveWorkoutPill from './components/ActiveWorkoutPill.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import CheatRevealTrigger from './components/CheatCaughtReveal.jsx'
import LevelUpRevealTrigger from './components/LevelUpReveal.jsx'
import Login from './views/Login.jsx'
import Terms from './views/legal/Terms.jsx'
import Privacy from './views/legal/Privacy.jsx'
import Licenses from './views/legal/Licenses.jsx'
import Home from './views/Home.jsx'
import Nutrition from './views/Nutrition.jsx'
import NutritionDiary from './views/NutritionDiary.jsx'
import NutritionLog from './views/NutritionLog.jsx'
import Routines from './views/Routines.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout, { WorkoutStartActions } from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import SettingsAccount from './views/settings/SettingsAccount.jsx'
import SettingsProfile from './views/settings/SettingsProfile.jsx'
import SettingsWorkout from './views/settings/SettingsWorkout.jsx'
import SettingsNutrition from './views/settings/SettingsNutrition.jsx'
import SettingsNutritionFoods from './views/settings/SettingsNutritionFoods.jsx'
import SettingsNutritionMeals from './views/settings/SettingsNutritionMeals.jsx'
import SettingsAppearance from './views/settings/SettingsAppearance.jsx'
import SettingsSubscription from './views/settings/SettingsSubscription.jsx'
import SettingsNotifications from './views/settings/SettingsNotifications.jsx'
import SettingsData from './views/settings/SettingsData.jsx'
import SettingsFairPlay from './views/settings/SettingsFairPlay.jsx'
import SettingsLegal from './views/settings/SettingsLegal.jsx'
import SettingsMobileApp from './views/settings/SettingsMobileApp.jsx'
import Social, { UserProfile } from './views/Social.jsx'
import Rank from './views/Rank.jsx'
import Penalties from './views/Penalties.jsx'
import Admin from './views/Admin.jsx'
import AdminUsers from './views/admin/AdminUsers.jsx'
import AdminTasks from './views/admin/AdminTasks.jsx'
import AdminExercises from './views/admin/AdminExercises.jsx'
import AdminMuscleGroups from './views/admin/AdminMuscleGroups.jsx'
import AdminMuscleGroupExercises from './views/admin/AdminMuscleGroupExercises.jsx'
import AdminStreaks from './views/admin/AdminStreaks.jsx'
import AdminLog from './views/admin/AdminLog.jsx'
import AdminAlpha from './views/admin/AdminAlpha.jsx'
import AdminBugs from './views/admin/AdminBugs.jsx'
import AdminAnticheat from './views/admin/AdminAnticheat.jsx'
import AdminCoachRequests from './views/admin/AdminCoachRequests.jsx'
import AdminBoxRequests from './views/admin/AdminBoxRequests.jsx'
import CoachApply from './views/CoachApply.jsx'
import CoachMarketplace from './views/CoachMarketplace.jsx'
import CoachBoxes from './views/coach/CoachBoxes.jsx'
import CoachBox from './views/coach/CoachBox.jsx'
import CoachAthlete from './views/coach/CoachAthlete.jsx'
import CoachClasses from './views/coach/CoachClasses.jsx'
import CoachBoxAbout from './views/coach/CoachBoxAbout.jsx'
import CoachBoxPlans from './views/coach/CoachBoxPlans.jsx'
import CoachBoxStaff from './views/coach/CoachBoxStaff.jsx'
import CoachBoxAthletes from './views/coach/CoachBoxAthletes.jsx'
import MyBoxes from './views/MyBoxes.jsx'
import BoxJoin from './views/BoxJoin.jsx'
import BoxWod from './views/BoxWod.jsx'
import BoxClasses from './views/BoxClasses.jsx'
import LiveClass from './views/LiveClass.jsx'
import BoxLeaderboard from './views/BoxLeaderboard.jsx'
import { DEFAULT_ACCENT } from './lib/palette.js'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// 'prestige' is the Prestige-8 perk's exclusive theme (gated in SettingsAppearance.jsx
// on perks.appTheme) — the palette itself lives here and in index.css.
function applyPrefs(theme, accent, reduceMotion) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : theme === 'prestige' ? 'prestige' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : DEFAULT_ACCENT
  de.toggleAttribute('data-reduce-motion', !!reduceMotion)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : de.dataset.theme === 'prestige' ? '#0d0221' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent, S.reduceMotion) }, [S.theme, S.accent, S.reduceMotion])
  useEffect(() => { setLang(S.lang || 'en') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'en' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // Same real-time path as LevelUpReveal's 'rank:changed' / CheatCaughtReveal's 'anticheat:*' —
  // an admin approving a coach application (api/server.js POST /api/admin/coach-requests/approve)
  // should flip Settings.jsx's card from "Become a coach" to "Coach dashboard" the instant it
  // happens, not whenever some unrelated action next happens to call refreshUser().
  useEffect(() => {
    if (!user) return
    return wsOn('coach:approved', () => {
      useStore.getState().refreshUser()
      useUI.getState().toast(t('You’re now a coach!'))
    })
  }, [user?.id])
  // Someone else cancelling is exactly the "arrives from outside this session" case — a waitlist
  // promotion (api/server.js POST /api/box/classes/cancel) needs a live nudge here, not just the
  // closed-app push already sent alongside it.
  useEffect(() => {
    if (!user) return
    return wsOn('class:promoted', msg => {
      useUI.getState().toast(t('A spot opened up — reserve it: {0} · {1} {2}', msg.name, msg.date, msg.startTime))
    })
  }, [user?.id])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      {/* The active-workout sticky bar bleeds to the viewport edge and sits right where #app's
          own top padding would otherwise leave a gap — just enough for the body's top-left
          accent glow to show through as a stray coloured line above it (issue #68). Trimmed to
          just the safe-area inset on this one screen; every other page keeps the normal padding. */}
      <div id="app" className={'vfade' + (loc.pathname === '/workout' && S.active ? ' notop' : '')} key={loc.pathname}>
        <ErrorBoundary>
          {loc.pathname === '/legal/terms' ? <Terms /> : loc.pathname === '/legal/privacy' ? <Privacy /> : loc.pathname === '/legal/licenses' ? <Licenses /> : !authed ? <Login /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/nutrition/diary" element={<NutritionDiary />} />
              <Route path="/nutrition/log" element={<NutritionLog />} />
              <Route path="/routines" element={<Routines />} />
              <Route path="/routines/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/account" element={<SettingsAccount />} />
              <Route path="/settings/profile" element={<SettingsProfile />} />
              <Route path="/settings/workout" element={<SettingsWorkout />} />
              <Route path="/settings/nutrition" element={<SettingsNutrition />} />
              <Route path="/settings/nutrition/foods" element={<SettingsNutritionFoods />} />
              <Route path="/settings/nutrition/meals" element={<SettingsNutritionMeals />} />
              <Route path="/settings/appearance" element={<SettingsAppearance />} />
              <Route path="/settings/subscription" element={<SettingsSubscription />} />
              <Route path="/settings/notifications" element={<SettingsNotifications />} />
              <Route path="/settings/data" element={<SettingsData />} />
              <Route path="/settings/fair-play" element={<SettingsFairPlay />} />
              <Route path="/settings/legal" element={<SettingsLegal />} />
              <Route path="/settings/mobile-app" element={<SettingsMobileApp />} />
              <Route path="/social" element={<Social />} />
              <Route path="/social/u/:uid" element={<UserProfile />} />
              <Route path="/rank" element={<Rank />} />
              <Route path="/penalties" element={<Penalties />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="/admin/users" element={user?.admin ? <AdminUsers /> : <Navigate to="/home" replace />} />
              <Route path="/admin/tasks" element={user?.admin ? <AdminTasks /> : <Navigate to="/home" replace />} />
              <Route path="/admin/exercises" element={user?.admin ? <AdminExercises /> : <Navigate to="/home" replace />} />
              <Route path="/admin/muscle-groups" element={user?.admin ? <AdminMuscleGroups /> : <Navigate to="/home" replace />} />
              <Route path="/admin/muscle-groups/:id" element={user?.admin ? <AdminMuscleGroupExercises /> : <Navigate to="/home" replace />} />
              <Route path="/admin/streaks" element={user?.admin ? <AdminStreaks /> : <Navigate to="/home" replace />} />
              <Route path="/admin/log" element={user?.admin ? <AdminLog /> : <Navigate to="/home" replace />} />
              <Route path="/admin/alpha" element={user?.admin ? <AdminAlpha /> : <Navigate to="/home" replace />} />
              <Route path="/admin/bugs" element={user?.admin ? <AdminBugs /> : <Navigate to="/home" replace />} />
              <Route path="/admin/anticheat" element={user?.admin ? <AdminAnticheat /> : <Navigate to="/home" replace />} />
              <Route path="/admin/coach-requests" element={user?.admin ? <AdminCoachRequests /> : <Navigate to="/home" replace />} />
              <Route path="/admin/box-requests" element={user?.admin ? <AdminBoxRequests /> : <Navigate to="/home" replace />} />
              <Route path="/coach/apply" element={user ? <CoachApply /> : <Navigate to="/home" replace />} />
              <Route path="/coaches" element={user ? <CoachMarketplace /> : <Navigate to="/home" replace />} />
              <Route path="/coach" element={user?.coach ? <CoachBoxes /> : <Navigate to="/home" replace />} />
              {/* Any signed-in user, not just user?.coach — a box's staff (added via @username,
                  not necessarily an approved marketplace coach themselves) needs to reach this
                  too. The actual gate is server-side (canManageBox/canViewAthlete in
                  api/server.js), re-checked on every request; a non-staff, non-owner visitor
                  here just gets 404s back from the API. */}
              <Route path="/coach/box/:boxId" element={user ? <CoachBox /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/athlete/:athleteId" element={user ? <CoachAthlete /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/classes" element={user ? <CoachClasses /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/about" element={user ? <CoachBoxAbout /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/plans" element={user ? <CoachBoxPlans /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/staff" element={user ? <CoachBoxStaff /> : <Navigate to="/home" replace />} />
              <Route path="/coach/box/:boxId/athletes" element={user ? <CoachBoxAthletes /> : <Navigate to="/home" replace />} />
              <Route path="/settings/boxes" element={user ? <MyBoxes /> : <Navigate to="/home" replace />} />
              <Route path="/box/join/:code" element={user ? <BoxJoin /> : <Navigate to="/home" replace />} />
              <Route path="/box/:boxId/wod" element={user ? <BoxWod /> : <Navigate to="/home" replace />} />
              <Route path="/box/:boxId/classes" element={user ? <BoxClasses /> : <Navigate to="/home" replace />} />
              <Route path="/box/:boxId/classes/:sessionId/live" element={user ? <LiveClass /> : <Navigate to="/home" replace />} />
              <Route path="/box/:boxId/leaderboard" element={user ? <BoxLeaderboard /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      <TabBar />
      <ActiveWorkoutPill />
      <RestTimer />
      <WorkoutStartActions />
      <Modals />
      <Toast />
      <CheatRevealTrigger />
      <LevelUpRevealTrigger />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  return <HashRouter><Shell /></HashRouter>
}
