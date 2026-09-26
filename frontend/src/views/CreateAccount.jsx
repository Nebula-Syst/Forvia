import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { passwordRegister } from '../lib/api.js'
import EntranceHeader from '../components/EntranceHeader.jsx'
import { Button } from '../components/ui.jsx'

// "Button styled as inline text" — same pattern as SettingsAccount.jsx's "Resend verification
// email": a real <button>, not a bare <a>, so it stays keyboard/screen-reader operable without
// needing a real href for what's actually in-app navigation.
const LinkBtn = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
    {children}
  </button>
)

// A real, routed page (see App.jsx's pre-auth branch) rather than the bottom-sheet form this
// used to be (still in sheets.jsx as PasswordRegisterForm, kept there for Settings ▸ Account's
// own "Create account" row, which a self-hoster running with ALLOW_GUEST=1 can still reach while
// a guest — see that file's own comment). Same fields, same validation, same submit logic as
// that sheet — just a full screen reached from Login.jsx's "Create account" button, or from an
// invite link (/#/join/<code>, handled in Login.jsx by redirecting here with the code in state)
// instead of a modal.
//
// This form's consent line is the actual GDPR consent moment for Google Analytics — see
// lib/analytics.js. Guest mode is off (.env: ALLOW_GUEST=0) so an account, created here, is the
// only way into the app at all.
export default function CreateAccount() {
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const prefillCode = loc.state?.code || ''
  const inviteOnly = !!config?.invite_only
  const registerClosed = config?.allow_register === false
  const codeRequired = inviteOnly || registerClosed || !!prefillCode
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState(prefillCode)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => { useStore.getState().loadConfig() }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast(t('Enter a valid email address')); return }
    if (pw.length < 8) { toast(t('Password must be at least 8 characters')); return }
    if (codeRequired && !code.trim()) { toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await passwordRegister(n, email.trim(), pw, code.trim())
      useStore.getState().setUser(u)
      if (hasData(useStore.getState().S)) { await useStore.getState().pushState(); toast(t('Profile created — data from this device moved into it')) }
      else { await useStore.getState().pullState(); toast(t('Welcome, {0}', u.name)) }
      nav('/home', { replace: true })
    } catch (e) { toast(e.message || t('Registration failed')) }
    finally { setBusy(false) }
  }
  return <div className="narrow" style={{ textAlign: 'center' }}>
    <EntranceHeader title={t('Create account')} onBack={() => nav(-1)} />
    <div className="card auth-card" style={{ maxWidth: 380, textAlign: 'left' }}>
      <div className="entrance-in" style={{ '--d': '0ms' }}>
        <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ height: 10 }} />
      <div className="entrance-in" style={{ '--d': '40ms' }}>
        <input className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div style={{ height: 10 }} />
      <div className="entrance-in" style={{ '--d': '80ms' }}>
        <input className="input" type="password" autoComplete="new-password" placeholder={t('Password (min 8 characters)')} value={pw} onChange={e => setPw(e.target.value)} />
      </div>
      {codeRequired && <div className="entrance-in" style={{ '--d': '120ms' }}>
        <div style={{ height: 10 }} />
        <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
        <div className="dim small" style={{ marginTop: 6 }}>{registerClosed ? t('Registration is closed — enter the invite code you were given.') : t('This app is invite-only — enter the code you were given.')}</div>
      </div>}
      <div style={{ height: 18 }} />
      <div className="entrance-actions entrance-in" style={{ '--d': '160ms' }}>
        <Button variant="primary" onClick={go} disabled={busy}>{t('Create account')}</Button>
      </div>
      <div className="dim small entrance-in" style={{ '--d': '200ms', marginTop: 16, lineHeight: 1.5, textAlign: 'center' }}>
        {t('By creating an account you accept the')} <LinkBtn onClick={() => nav('/legal/terms')}>{t('Terms of service')}</LinkBtn>{t(', the')} <LinkBtn onClick={() => nav('/legal/privacy')}>{t('Privacy policy')}</LinkBtn> {t('and the')} <LinkBtn onClick={() => nav('/legal/cookies')}>{t('Cookies policy')}</LinkBtn>.
      </div>
      <div className="dim small entrance-in" style={{ '--d': '220ms', textAlign: 'center', marginTop: 14 }}>
        {t('Already have an account?')} <button onClick={() => nav('/login/signin')}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
          {t('Sign in')}
        </button>
      </div>
    </div>
  </div>
}
