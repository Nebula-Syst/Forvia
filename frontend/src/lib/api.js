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
export const setName = name => api('/api/account/name', { method: 'POST', body: JSON.stringify({ name }) }).then(r => r.user)
export const setPhone = phone => api('/api/account/phone', { method: 'POST', body: JSON.stringify({ phone }) }).then(r => r.user)
export const setBadges = badges => api('/api/account/badges', { method: 'POST', body: JSON.stringify({ badges }) }).then(r => r.user)
export const setPassword = (currentPassword, password) => api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }).then(r => r.user)
export const setEmail = email => api('/api/account/email', { method: 'POST', body: JSON.stringify({ email }) })
export const setAvatar = dataUrl => api('/api/account/avatar', { method: 'POST', body: JSON.stringify({ dataUrl }) }).then(r => r.user)
export const removeAvatar = () => api('/api/account/avatar/remove', { method: 'POST', body: '{}' }).then(r => r.user)
export const resendEmailVerification = () => api('/api/account/email/resend', { method: 'POST', body: '{}' })
export const deleteAccount = password => api('/api/account/delete', { method: 'POST', body: JSON.stringify({ password }) })

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
