import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed, registerAllowed } from '../lib/guest.js'
import { passwordLoginSheet, passwordRegisterSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'

// Same "button styled as inline text" pattern as SettingsAccount.jsx's "Resend verification
// email" — an actual <button>, not a bare <a>, so it stays keyboard/screen-reader operable
// without needing a real href (this is in-app navigation, not a link to another page).
const LinkBtn = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
    {children}
  </button>
)

export default function Login() {
  const { setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const canRegister = registerAllowed(config)
  const loc = useLocation()
  const nav = useNavigate()
  // A shared invite link (Admin panel → Users → Invite codes) is /#/join/<code> — land here,
  // open straight to the register form with the code already filled in, then clear the hash
  // so a refresh mid-signup doesn't reopen it with a code that may already be spent.
  const joinCode = loc.pathname.startsWith('/join/') ? decodeURIComponent(loc.pathname.slice('/join/'.length)) : null
  useEffect(() => {
    if (!joinCode) return
    passwordRegisterSheet(joinCode)
    nav('/', { replace: true })
  }, [joinCode])
  const head = <>
    {/* The real brand mark (assets/brand/) instead of the generic dumbbell glyph — both
        crops are transparent, so neither drops a background tile onto the page behind it.
        Two ink colors because the mark itself doesn't adapt: white reads on the dark theme's
        near-black background, black on the light theme's near-white one; CSS picks one per
        data-theme exactly like every other themed asset in index.css. */}
    <div className="login-mark">
      <img className="dark" src="/logo-mark-dark.png" alt="" />
      <img className="light" src="/logo-mark-light.png" alt="" />
    </div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>Forvia</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Account sign-in and sync across your devices come with the Forvia server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      <Button variant="primary" icon="person" onClick={() => passwordLoginSheet()}>{t('Sign in')}</Button>
      {canRegister && <div style={{ height: 10 }} />}
      {canRegister && <Button icon="sparkles" onClick={() => passwordRegisterSheet()}>{t('Create account')}</Button>}
      {canGuest && <div style={{ height: 10 }} />}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      {!canRegister && (
        <div style={{ marginTop: 14 }}>
          <Button variant="ghost" className="dim" size="sm" onClick={() => passwordRegisterSheet()}>{t('Have an invite code?')}</Button>
        </div>
      )}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Each profile keeps its own plan, workouts & body weight.')}</div>
      <div className="dim small" style={{ marginTop: 14, lineHeight: 1.5 }}>
        {t('By continuing you accept the')} <LinkBtn onClick={() => nav('/legal/terms')}>{t('Terms of service')}</LinkBtn> {t('and the')} <LinkBtn onClick={() => nav('/legal/privacy')}>{t('Privacy policy')}</LinkBtn>.
      </div>
    </div>
  )
}
