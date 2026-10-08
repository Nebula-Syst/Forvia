import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { registerAllowed } from '../lib/guest.js'
import { passwordLogin } from '../lib/api.js'
import EntranceHeader from '../components/EntranceHeader.jsx'
import LoadingScreen from '../components/LoadingScreen.jsx'
import { Button } from '../components/ui.jsx'

// A real, routed page (see App.jsx's pre-auth branch) rather than the bottom-sheet form this
// used to be (still in sheets.jsx as PasswordLoginForm, kept there for Settings ▸ Account's own
// sign-in row, which a self-hoster running with ALLOW_GUEST=1 can still reach while guest —
// see that file's own comment). Same fields, same submit logic, just a full screen reached from
// Login.jsx's "Sign in" button instead of a modal.
export default function SignIn() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const canRegister = registerAllowed(config)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [entering, setEntering] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const go = async () => {
    if (!email.trim() || !pw) { toast(t('Enter your email and password')); return }
    setBusy(true)
    try {
      const u = await passwordLogin(email.trim(), pw)
      useStore.getState().setUser(u)
      // A real loading beat instead of the form snapping straight to Home — pullState() usually
      // resolves well under a second on its own, so the fixed minimum is what actually makes this
      // read as a deliberate transition rather than a flash. A pullState failure here (rare —
      // network hiccup right after a successful login) shouldn't strand anyone on this screen;
      // Home re-syncs on its own once the connection's back, same as any other transient failure.
      setEntering(true)
      await Promise.all([useStore.getState().pullState().catch(() => {}), new Promise(r => setTimeout(r, 900))])
      toast(t('Welcome back, {0}', u.name))
      nav('/home', { replace: true })
    } catch (e) { toast(e.message || t('Sign-in failed')); setEntering(false) }
    finally { setBusy(false) }
  }
  if (entering) return <LoadingScreen />
  return <div className="narrow" style={{ textAlign: 'center' }}>
    <EntranceHeader title={t('Sign in')} onBack={() => nav(-1)} />
    <div className="card auth-card" style={{ maxWidth: 380, textAlign: 'left' }}>
      <div className="entrance-in" style={{ '--d': '0ms' }}>
        <input ref={ref} className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email}
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      </div>
      <div style={{ height: 10 }} />
      <div className="entrance-in" style={{ '--d': '50ms' }}>
        <input className="input" type="password" autoComplete="current-password" placeholder={t('Password')} value={pw}
          onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      </div>
      <div className="entrance-in" style={{ '--d': '75ms', textAlign: 'right', marginTop: 8 }}>
        <button onClick={() => nav('/login/forgot-password')}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--label-2)', textDecoration: 'underline', font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
          {t('Forgot password?')}
        </button>
      </div>
      <div style={{ height: 18 }} />
      <div className="entrance-actions entrance-in" style={{ '--d': '100ms' }}>
        <Button variant="primary" onClick={go} disabled={busy}>{t('Sign in')}</Button>
      </div>
      {canRegister && <div className="dim small entrance-in" style={{ '--d': '150ms', textAlign: 'center', marginTop: 18 }}>
        {t("Don't have an account?")} <button onClick={() => nav('/login/register')}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
          {t('Create one')}
        </button>
      </div>}
    </div>
  </div>
}
