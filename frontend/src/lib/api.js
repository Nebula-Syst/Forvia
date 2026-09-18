// Backend helpers.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

export async function passwordLogin(email, password) {
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  return res.user
}
export async function passwordRegister(name, email, password, code) {
  const res = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password, code: code || '' }) })
  return res.user
}
/* ---------- account ---------- */
// Takes {firstName, lastName} — see api/server.js POST /api/account/name for why (name
// alone can't be un-split from a compound given name, so the two parts are the real payload).
export const setName = ({ firstName, lastName }) => api('/api/account/name', { method: 'POST', body: JSON.stringify({ firstName, lastName }) }).then(r => r.user)
export const setUsername = username => api('/api/account/username', { method: 'POST', body: JSON.stringify({ username }) })
export const setPhone = phone => api('/api/account/phone', { method: 'POST', body: JSON.stringify({ phone }) }).then(r => r.user)
export const setBadges = badges => api('/api/account/badges', { method: 'POST', body: JSON.stringify({ badges }) }).then(r => r.user)
export const setPassword = (currentPassword, password) => api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }).then(r => r.user)
export const setEmail = email => api('/api/account/email', { method: 'POST', body: JSON.stringify({ email }) })
export const setAvatar = dataUrl => api('/api/account/avatar', { method: 'POST', body: JSON.stringify({ dataUrl }) }).then(r => r.user)
export const removeAvatar = () => api('/api/account/avatar/remove', { method: 'POST', body: '{}' }).then(r => r.user)
export const resendEmailVerification = () => api('/api/account/email/resend', { method: 'POST', body: '{}' })
export const deleteAccount = password => api('/api/account/delete', { method: 'POST', body: JSON.stringify({ password }) })
export const accountSessions = () => api('/api/account/sessions').then(r => r.sessions)
export const revokeSession = id => api('/api/account/sessions/revoke', { method: 'POST', body: JSON.stringify({ id }) })

/* ---------- social ---------- */
export async function setPublic(pub) {
  const res = await api('/api/social/public', { method: 'POST', body: JSON.stringify({ public: pub }) })
  return res.user
}
export const socialUsers = () => api('/api/social/users').then(r => r.users)
export const socialUser = uid => api('/api/social/user?uid=' + encodeURIComponent(uid))
export const socialFollow = userId => api('/api/social/follow', { method: 'POST', body: JSON.stringify({ userId }) })
export const socialUnfollow = userId => api('/api/social/unfollow', { method: 'POST', body: JSON.stringify({ userId }) })
export const socialFollowing = () => api('/api/social/following').then(r => r.following)
export const socialLeaderboard = () => api('/api/social/leaderboard').then(r => r.leaderboard)
export const socialFeed = () => api('/api/social/feed').then(r => r.items)
export const socialDiscover = () => api('/api/social/discover').then(r => r.items)
export const socialReact = (targetUid, workoutId) => api('/api/social/react', { method: 'POST', body: JSON.stringify({ targetUid, workoutId }) })
export const socialComments = (targetUid, workoutId) => api(`/api/social/comments?targetUid=${encodeURIComponent(targetUid)}&workoutId=${encodeURIComponent(workoutId)}`).then(r => r.comments)
export const socialComment = (targetUid, workoutId, text) => api('/api/social/comment', { method: 'POST', body: JSON.stringify({ targetUid, workoutId, text }) }).then(r => r.comment)
export const socialCommentRemove = id => api('/api/social/comment/remove', { method: 'POST', body: JSON.stringify({ id }) })
export const socialMe = () => api('/api/social/me')
export const socialUpload = dataUrl => api('/api/social/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) }).then(r => r.url)

/* ---------- rank/prestige perks ---------- */
export const setBio = bio => api('/api/social/bio', { method: 'POST', body: JSON.stringify({ bio }) }).then(r => r.user)
export const pinWorkout = workoutId => api('/api/social/pin', { method: 'POST', body: JSON.stringify({ workoutId }) }).then(r => r.user)
export const unpinWorkout = workoutId => api('/api/social/unpin', { method: 'POST', body: JSON.stringify({ workoutId }) }).then(r => r.user)
export const pinPR = (workoutId, exerciseId) => api('/api/social/pin-pr', { method: 'POST', body: JSON.stringify({ workoutId, exerciseId }) }).then(r => r.user)

/* ---------- rank / daily tasks ---------- */
export const confirmPrestige = () => api('/api/prestige', { method: 'POST' }).then(r => r.user)
export const tasksToday = () => api('/api/tasks/today').then(r => r.tasks)
export const adminTasks = () => api('/api/admin/tasks')
export const adminTaskAdd = (name, desc, points, criteria) => api('/api/admin/tasks', { method: 'POST', body: JSON.stringify({ name, desc, points, criteria }) }).then(r => r.task)
export const adminTaskRemove = id => api('/api/admin/tasks/remove', { method: 'POST', body: JSON.stringify({ id }) })
export const adminUserCreate = (name, email, password) => api('/api/admin/user/create', { method: 'POST', body: JSON.stringify({ name, email, password }) }).then(r => r.user)
export const adminSetEmployeeTypes = (id, employeeTypes) => api('/api/admin/user/employee-types', { method: 'POST', body: JSON.stringify({ id, employeeTypes }) })
export const adminUserLevel = (id, delta) => api('/api/admin/user/level', { method: 'POST', body: JSON.stringify({ id, delta }) }).then(r => r.rank)
export const adminUserPrestige = (id, delta) => api('/api/admin/user/prestige', { method: 'POST', body: JSON.stringify({ id, delta }) }).then(r => r.rank)
export const adminUserStreak = (id, delta) => api('/api/admin/user/streak', { method: 'POST', body: JSON.stringify({ id, delta }) }).then(r => r.streakBonus)

/* ---------- exercise name overrides ---------- */
export const exerciseOverrides = () => api('/api/exercises/overrides').then(r => r.overrides)
export const adminExerciseOverrideSet = (id, lang, name) => api('/api/admin/exercises/override', { method: 'POST', body: JSON.stringify({ id, lang, name }) }).then(r => r.overrides)

/* ---------- custom muscle groups ---------- */
export const adminMuscleGroups = () => api('/api/admin/muscle-groups').then(r => r.groups)
export const adminMuscleGroupCreate = (lang, name) => api('/api/admin/muscle-groups', { method: 'POST', body: JSON.stringify({ lang, name }) }).then(r => r.groups)
export const adminMuscleGroupRename = (id, lang, name) => api('/api/admin/muscle-groups/rename', { method: 'POST', body: JSON.stringify({ id, lang, name }) }).then(r => r.groups)
export const adminMuscleGroupRemove = id => api('/api/admin/muscle-groups/remove', { method: 'POST', body: JSON.stringify({ id }) }).then(r => r.groups)
export const adminMuscleGroupAddExercise = (id, exerciseId) => api('/api/admin/muscle-groups/add-exercise', { method: 'POST', body: JSON.stringify({ id, exerciseId }) }).then(r => r.groups)
export const adminMuscleGroupRemoveExercise = (id, exerciseId) => api('/api/admin/muscle-groups/remove-exercise', { method: 'POST', body: JSON.stringify({ id, exerciseId }) }).then(r => r.groups)
export const adminMuscleGroupSetExercises = (id, exerciseIds) => api('/api/admin/muscle-groups/set-exercises', { method: 'POST', body: JSON.stringify({ id, exerciseIds }) }).then(r => r.groups)

/* ---------- streak tiers ---------- */
export const streakTiers = () => api('/api/streak-tiers').then(r => r.tiers)
export const adminStreakTierAdd = (name, days) => api('/api/admin/streak-tiers', { method: 'POST', body: JSON.stringify({ name, days }) }).then(r => r.tiers)
export const adminStreakTierUpdate = (id, name, days) => api('/api/admin/streak-tiers/update', { method: 'POST', body: JSON.stringify({ id, name, days }) }).then(r => r.tiers)
export const adminStreakTierRemove = id => api('/api/admin/streak-tiers/remove', { method: 'POST', body: JSON.stringify({ id }) }).then(r => r.tiers)

/* ---------- nutrition: food search (Open Food Facts proxy) ---------- */
export const foodSearch = q => api('/api/nutrition/search?q=' + encodeURIComponent(q)).then(r => r.items)
export const foodByBarcode = code => api('/api/nutrition/barcode?code=' + encodeURIComponent(code)).then(r => r.item)
// Forvia's own community food database — separate from the Open Food Facts proxy above.
// Search always comes back anonymised (no ownerId ever leaves the server); creating one
// only ever happens when the submitter picked "Public" — see CustomFoodForm.
export const publicFoodSearch = q => api('/api/nutrition/foods/search?q=' + encodeURIComponent(q)).then(r => r.items)
export const createPublicFood = food => api('/api/nutrition/foods', { method: 'POST', body: JSON.stringify(food) })

/* ---------- bug reports ---------- */
export const reportBug = (message, page) => api('/api/bugs', { method: 'POST', body: JSON.stringify({ message, page }) })
export const adminBugs = () => api('/api/admin/bugs').then(r => r.reports)
export const adminBugResolve = id => api('/api/admin/bugs/resolve', { method: 'POST', body: JSON.stringify({ id }) }).then(r => r.report)
export const adminBugDelete = id => api('/api/admin/bugs/delete', { method: 'POST', body: JSON.stringify({ id }) })

/* ---------- alpha waitlist ---------- */
export const alphaApply = (name, email, message) => api('/api/alpha/apply', { method: 'POST', body: JSON.stringify({ name, email, message }) })
export const adminAlpha = () => api('/api/admin/alpha').then(r => r.requests)
export const adminAlphaInvite = id => api('/api/admin/alpha/invite', { method: 'POST', body: JSON.stringify({ id }) })
export const adminAlphaDismiss = id => api('/api/admin/alpha/dismiss', { method: 'POST', body: JSON.stringify({ id }) })

/* ---------- anti-cheat review ---------- */
export const anticheatStatus = () => api('/api/anticheat/status').then(r => r.penalties)
export const anticheatAppeal = (id, message) => api('/api/anticheat/appeal', { method: 'POST', body: JSON.stringify({ id, message }) })
export const anticheatAck = id => api('/api/anticheat/ack', { method: 'POST', body: JSON.stringify({ id }) })
export const adminAnticheat = () => api('/api/admin/anticheat').then(r => r.penalties)
export const adminAnticheatReview = (id, decision, reviewNote) => api('/api/admin/anticheat/review', { method: 'POST', body: JSON.stringify({ id, decision, reviewNote }) })

/* ---------- coach application ---------- */
export const coachApply = (experience, certifications, message, documentDataUrl) => api('/api/coach/apply', { method: 'POST', body: JSON.stringify({ experience, certifications, message, documentDataUrl }) })
export const coachApplyStatus = () => api('/api/coach/apply/status').then(r => r.pending)
export const adminCoachRequests = () => api('/api/admin/coach-requests').then(r => r.requests)
export const adminCoachApprove = id => api('/api/admin/coach-requests/approve', { method: 'POST', body: JSON.stringify({ id }) })
export const adminCoachDismiss = id => api('/api/admin/coach-requests/dismiss', { method: 'POST', body: JSON.stringify({ id }) })
export const coachRequestDocumentUrl = id => '/api/admin/coach-requests/document?id=' + encodeURIComponent(id)

/* ---------- coach + box (WODbuster-style) ---------- */
export const coachBoxes = () => api('/api/coach/boxes').then(r => r.boxes)
export const coachBox = boxId => api('/api/coach/box?boxId=' + encodeURIComponent(boxId))
export const coachUpdateBox = (boxId, fields) => api('/api/coach/box/update', { method: 'POST', body: JSON.stringify({ boxId, ...fields }) }).then(r => r.box)
export const coachBoxRoster = boxId => api('/api/coach/box/roster?boxId=' + encodeURIComponent(boxId)).then(r => r.roster)
export const userSearch = q => api('/api/users/search?q=' + encodeURIComponent(q)).then(r => r.users)
export const coachBoxStaff = boxId => api('/api/coach/box/staff?boxId=' + encodeURIComponent(boxId)).then(r => r.staff)
export const coachAddStaff = (boxId, userId) => api('/api/coach/box/staff/add', { method: 'POST', body: JSON.stringify({ boxId, userId }) })
export const coachRemoveStaff = (boxId, userId) => api('/api/coach/box/staff/remove', { method: 'POST', body: JSON.stringify({ boxId, userId }) })
export const coachRemoveMember = (boxId, athleteId) => api('/api/coach/box/member/remove', { method: 'POST', body: JSON.stringify({ boxId, athleteId }) })
export const coachCreateInvite = boxId => api('/api/coach/box/invite', { method: 'POST', body: JSON.stringify({ boxId }) }).then(r => r.invite)
export const coachRevokeInvite = (boxId, code) => api('/api/coach/box/invite/revoke', { method: 'POST', body: JSON.stringify({ boxId, code }) })
export const boxJoin = code => api('/api/box/join', { method: 'POST', body: JSON.stringify({ code }) }).then(r => r.box)
export const athleteBoxes = () => api('/api/athlete/boxes').then(r => r.boxes)
export const coachAthleteWorkouts = (athleteId, days) => api('/api/coach/athlete/workouts?athleteId=' + encodeURIComponent(athleteId) + (days ? '&days=' + days : '')).then(r => r.workouts)
export const boxImageUrl = boxId => '/api/box/image?boxId=' + encodeURIComponent(boxId)

/* ---------- box requests (a coach asks for a new box, an admin approves it) ---------- */
export const coachRequestBox = (title, description, location, imageDataUrl) => api('/api/coach/box-request', { method: 'POST', body: JSON.stringify({ title, description, location, imageDataUrl }) }).then(r => r.request)
export const coachBoxRequests = () => api('/api/coach/box-requests').then(r => r.requests)
export const adminBoxRequests = () => api('/api/admin/box-requests').then(r => r.requests)
export const adminBoxRequestApprove = id => api('/api/admin/box-requests/approve', { method: 'POST', body: JSON.stringify({ id }) })
export const adminBoxRequestDismiss = id => api('/api/admin/box-requests/dismiss', { method: 'POST', body: JSON.stringify({ id }) })
export const boxRequestImageUrl = id => '/api/admin/box-requests/image?id=' + encodeURIComponent(id)

/* ---------- personal-training marketplace ---------- */
export const coachSetVisibility = (visible, hourlyRate, location) => api('/api/coach/visibility', { method: 'POST', body: JSON.stringify({ visible, hourlyRate, location }) }).then(r => r.user)
export const coachMarketplace = (lat, lon) => api('/api/coaches/marketplace' + (lat != null && lon != null ? '?lat=' + lat + '&lon=' + lon : ''))

/* ---------- geocoding (real places only — no free text) ---------- */
export const geoSearch = (q, near, precise) => api('/api/geo/search?q=' + encodeURIComponent(q) + (near ? '&lat=' + near.lat + '&lon=' + near.lon : '') + (precise ? '&precise=1' : '')).then(r => r.places)
export const geoReverse = (lat, lon) => api('/api/geo/reverse?lat=' + lat + '&lon=' + lon).then(r => r.place)

/* ---------- routine assignment ---------- */
export const coachAssignRoutine = (boxId, athleteId, routine) => api('/api/coach/box/assign-routine', { method: 'POST', body: JSON.stringify({ boxId, athleteId, routine }) }).then(r => r.assignment)
export const athleteRoutineAssignments = () => api('/api/athlete/routine-assignments').then(r => r.assignments)
export const athleteApplyAssignment = id => api('/api/athlete/routine-assignments/apply', { method: 'POST', body: JSON.stringify({ id }) })

/* ---------- WOD of the day + box leaderboard ---------- */
export const coachSetWod = (boxId, wod) => api('/api/coach/box/wod', { method: 'POST', body: JSON.stringify({ boxId, ...wod }) }).then(r => r.wod)
export const boxWod = (boxId, date) => api('/api/box/wod?boxId=' + encodeURIComponent(boxId) + (date ? '&date=' + date : ''))
export const boxWodResult = (boxId, wodId, value) => api('/api/box/wod/result', { method: 'POST', body: JSON.stringify({ boxId, wodId, value }) }).then(r => r.result)
export const boxLeaderboard = (boxId, date) => api('/api/coach/box/leaderboard?boxId=' + encodeURIComponent(boxId) + (date ? '&date=' + date : ''))

/* ---------- classes & schedule ---------- */
export const coachClassTypes = boxId => api('/api/coach/box/class-types?boxId=' + encodeURIComponent(boxId)).then(r => r.types)
export const coachCreateClassType = (boxId, fields) => api('/api/coach/box/class-types', { method: 'POST', body: JSON.stringify({ boxId, ...fields }) }).then(r => r.type)
export const coachUpdateClassType = (boxId, id, fields) => api('/api/coach/box/class-types/update', { method: 'POST', body: JSON.stringify({ boxId, id, ...fields }) }).then(r => r.type)
export const coachDeleteClassType = (boxId, id) => api('/api/coach/box/class-types/delete', { method: 'POST', body: JSON.stringify({ boxId, id }) })
export const coachCreateClass = (boxId, fields) => api('/api/coach/box/classes/create', { method: 'POST', body: JSON.stringify({ boxId, ...fields }) }).then(r => r.session)
export const coachRemoveClass = (boxId, id) => api('/api/coach/box/classes/remove', { method: 'POST', body: JSON.stringify({ boxId, id }) })
export const coachSetClassExercises = (boxId, sessionId, exercises) => api('/api/coach/box/classes/exercises', { method: 'POST', body: JSON.stringify({ boxId, sessionId, exercises }) }).then(r => r.exercises)
export const coachDayTemplates = boxId => api('/api/coach/box/day-templates?boxId=' + encodeURIComponent(boxId)).then(r => r.templates)
export const coachCreateDayTemplate = (boxId, name, date) => api('/api/coach/box/day-templates', { method: 'POST', body: JSON.stringify({ boxId, name, date }) }).then(r => r.template)
export const coachApplyDayTemplate = (boxId, id, date) => api('/api/coach/box/day-templates/apply', { method: 'POST', body: JSON.stringify({ boxId, id, date }) }).then(r => r.count)
export const coachDeleteDayTemplate = (boxId, id) => api('/api/coach/box/day-templates/delete', { method: 'POST', body: JSON.stringify({ boxId, id }) })
export const coachWeekTemplates = boxId => api('/api/coach/box/week-templates?boxId=' + encodeURIComponent(boxId)).then(r => r.templates)
export const coachCreateWeekTemplate = (boxId, name, weekStart) => api('/api/coach/box/week-templates', { method: 'POST', body: JSON.stringify({ boxId, name, weekStart }) }).then(r => r.template)
export const coachApplyWeekTemplate = (boxId, id, weekStart) => api('/api/coach/box/week-templates/apply', { method: 'POST', body: JSON.stringify({ boxId, id, weekStart }) }).then(r => r.count)
export const coachDeleteWeekTemplate = (boxId, id) => api('/api/coach/box/week-templates/delete', { method: 'POST', body: JSON.stringify({ boxId, id }) })
export const coachWodTemplates = boxId => api('/api/coach/box/wod-templates?boxId=' + encodeURIComponent(boxId)).then(r => r.templates)
export const coachCreateWodTemplate = (boxId, name, exercises) => api('/api/coach/box/wod-templates', { method: 'POST', body: JSON.stringify({ boxId, name, exercises }) }).then(r => r.template)
export const coachApplyWodTemplate = (boxId, id, sessionId) => api('/api/coach/box/wod-templates/apply', { method: 'POST', body: JSON.stringify({ boxId, id, sessionId }) }).then(r => r.exercises)
export const coachDeleteWodTemplate = (boxId, id) => api('/api/coach/box/wod-templates/delete', { method: 'POST', body: JSON.stringify({ boxId, id }) })
export const boxClasses = (boxId, from, to) => api('/api/box/classes?boxId=' + encodeURIComponent(boxId) + '&from=' + from + '&to=' + to).then(r => r.sessions)
export const classBook = sessionId => api('/api/box/classes/book', { method: 'POST', body: JSON.stringify({ sessionId }) }).then(r => r.booking)
export const classCancel = sessionId => api('/api/box/classes/cancel', { method: 'POST', body: JSON.stringify({ sessionId }) })
export const coachClassRoster = sessionId => api('/api/coach/box/classes/roster?sessionId=' + encodeURIComponent(sessionId))
export const coachClassAttendance = (bookingId, status) => api('/api/coach/box/classes/attendance', { method: 'POST', body: JSON.stringify({ bookingId, status }) })
export const coachStartLiveClass = (boxId, sessionId, timerType, params) => api('/api/coach/box/classes/live/start', { method: 'POST', body: JSON.stringify({ boxId, sessionId, timerType, ...params }) }).then(r => r.live)
export const coachControlLiveClass = (boxId, sessionId, action) => api('/api/coach/box/classes/live/control', { method: 'POST', body: JSON.stringify({ boxId, sessionId, action }) }).then(r => r.live)
export const boxLiveClass = sessionId => api('/api/box/classes/live?sessionId=' + encodeURIComponent(sessionId)).then(r => r.live)
