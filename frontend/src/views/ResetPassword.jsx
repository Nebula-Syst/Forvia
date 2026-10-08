import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { resetPassword } from '../lib/api.js'
import EntranceHeader from '../components/EntranceHeader.jsx'
import LoadingScreen from '../components/LoadingScreen.jsx'
import { Button } from '../components/ui.jsx'

// Reached from the link forgot-password emails — token rides in the URL as
// #/login/reset-password?token=..., same ?query-inside-the-hash shape NutritionLog already
// reads with useSearchParams, so this does too rather than inventing a second way to parse it.
// Resetting also signs the account in immediately (the backend returns a fresh session
// cookie, same as register/login), rather than bouncing back to a separate sign-in step.
export default function ResetPassword() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [entering, setEntering] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const go = async () => {
    if (pw.length < 8) { toast(t('Password must be at least 8 characters')); return }
    if (pw !== pw2) { toast(t("Passwords don't match")); return }
    setBusy(true)
    try {
      const u = await resetPassword(token, pw)
      useStore.getState().setUser(u)
      setEntering(true)
      await Promise.all([useStore.getState().pullState().catch(() => {}), new Promise(r => setTimeout(r, 900))])
      toast(t('Password updated'))
      nav('/home', { replace: true })
    } catch (e) { toast(e.message || t('Something went wrong')); setEntering(false) }
    finally { setBusy(false) }
  }
  if (entering) return <LoadingScreen />
  return <div className="narrow" style={{ textAlign: 'center' }}>
    <EntranceHeader title={t('Set a new password')} onBack={() => nav('/login/signin')} />
    <div className="card auth-card" style={{ maxWidth: 380, textAlign: 'left' }}>
      {!token ? <p className="muted" style={{ lineHeight: 1.5, marginTop: 0 }}>{t('This link is missing its token — open it again from the email you received.')}</p> : <>
        <input ref={ref} className="input" type="password" autoComplete="new-password" placeholder={t('New password')} value={pw}
          onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <div style={{ height: 10 }} />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('Confirm password')} value={pw2}
          onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <div style={{ height: 18 }} />
        <Button variant="primary" onClick={go} disabled={busy}>{t('Set password')}</Button>
      </>}
    </div>
  </div>
}
