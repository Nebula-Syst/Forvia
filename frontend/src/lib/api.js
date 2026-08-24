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
export async function setPassword(username, password) {
  const res = await api('/api/password/set', { method: 'POST', body: JSON.stringify({ username, password }) })
  return res.user
}
