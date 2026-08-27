// Backend helpers.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

export async function passwordLogin(username, password) {
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  return res.user
}
export async function passwordRegister(name, username, password, code) {
  const res = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, username, password, code: code || '' }) })
  return res.user
}
/* ---------- account ---------- */
export const setName = name => api('/api/account/name', { method: 'POST', body: JSON.stringify({ name }) }).then(r => r.user)
export const setPhone = phone => api('/api/account/phone', { method: 'POST', body: JSON.stringify({ phone }) }).then(r => r.user)
export const setUsername = username => api('/api/account/username', { method: 'POST', body: JSON.stringify({ username }) }).then(r => r.user)
export const setPassword = (currentPassword, password) => api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }).then(r => r.user)
export const setEmail = email => api('/api/account/email', { method: 'POST', body: JSON.stringify({ email }) })
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
export const tasksToday = () => api('/api/tasks/today').then(r => r.tasks)
export const completeTask = taskId => api('/api/tasks/complete', { method: 'POST', body: JSON.stringify({ taskId }) })
export const adminTasks = () => api('/api/admin/tasks').then(r => r.tasks)
export const adminTaskAdd = (name, desc, points) => api('/api/admin/tasks', { method: 'POST', body: JSON.stringify({ name, desc, points }) }).then(r => r.task)
export const adminTaskRemove = id => api('/api/admin/tasks/remove', { method: 'POST', body: JSON.stringify({ id }) })
