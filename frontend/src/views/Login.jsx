import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed, registerAllowed } from '../lib/guest.js'
import EntranceHeader from '../components/EntranceHeader.jsx'
import { Button } from '../components/ui.jsx'

// Same "button styled as inline text" pattern as SettingsAccount.jsx's "Resend verification
// email" — an actual <button>, not a bare <a>, so it stays keyboard/screen-reader operable
// without needing a real href (this is in-app navigation, not a link to another page).
const LinkBtn = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
    {children}
  </button>
)

// Each direct child fades/rises in on its own delay (see .entrance-in/@entrance-rise in
// index.css) — kept short and independent of EntranceHeader's own (much slower) draw-in, so
// re-visiting this screen — every "Volver" from Sign in/Create account remounts it fresh, same
// as any other route change — never makes the actual buttons wait on the logo to finish drawing
// before they're usable. Small, cheap, pure CSS: no animation library in this codebase (checked
// package.json before reaching for one), same convention as the route-transition .vfade this
// screen already sits inside (App.jsx's #app wrapper).
const stag = ms => ({ '--d': ms + 'ms' })

export default function Login() {
  const { setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const canRegister = registerAllowed(config)
  const loc = useLocation()
  const nav = useNavigate()
  // A shared invite link (Admin panel → Users → Invite codes) is /#/join/<code> — land here,
  // then redirect straight to the real Create account page with the code carried in route
  // state (not a query string — it's single-use and shouldn't linger in a shareable URL once
  // consumed), and clear the hash so a refresh mid-signup doesn't reopen it with a code that
  // may already be spent.
  const joinCode = loc.pathname.startsWith('/join/') ? decodeURIComponent(loc.pathname.slice('/join/'.length)) : null
  useEffect(() => {
    if (!joinCode) return
    nav('/login/register', { replace: true, state: { code: joinCode } })
  }, [joinCode])
  const wrap = { textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      <EntranceHeader title="Forvia" still />
      <div className="muted entrance-in" style={{ ...stag(0), marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <div className="entrance-in" style={stag(40)}>
        <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      </div>
      <div className="card small muted entrance-in" style={{ ...stag(80), textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Account sign-in and sync across your devices come with the Forvia server, which you get by self-hosting it.')}
      </div>
      <div className="dim small entrance-in" style={{ ...stag(120), marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      <EntranceHeader title="Forvia" brand still />
      <div className="entrance-tagline entrance-in" style={{ ...stag(0), marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      <div className="entrance-actions">
        <div className="entrance-in" style={stag(40)}>
          <Button variant="primary" icon="person" onClick={() => nav('/login/signin')}>{t('Sign in')}</Button>
        </div>
        {canRegister && <div style={{ height: 10 }} />}
        {canRegister && <div className="entrance-in" style={stag(70)}>
          <Button variant="tinted" icon="sparkles" onClick={() => nav('/login/register')}>{t('Create account')}</Button>
        </div>}
      </div>
      {canGuest && <div style={{ height: 10 }} />}
      {canGuest && <div className="entrance-in" style={stag(100)}>
        <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      </div>}
      {!canRegister && (
        <div className="entrance-in" style={{ ...stag(70), marginTop: 14 }}>
          <Button variant="ghost" className="dim" size="sm" onClick={() => nav('/login/register')}>{t('Have an invite code?')}</Button>
        </div>
      )}
      <div className="dim small entrance-in" style={{ ...stag(130), marginTop: 26, lineHeight: 1.5 }}>{t('Each profile keeps its own plan, workouts & body weight.')}</div>
      <div className="dim small entrance-in" style={{ ...stag(160), marginTop: 14, lineHeight: 1.5 }}>
        {t('By continuing you accept the')} <LinkBtn onClick={() => nav('/legal/terms')}>{t('Terms of service')}</LinkBtn>{t(', the')} <LinkBtn onClick={() => nav('/legal/privacy')}>{t('Privacy policy')}</LinkBtn> {t('and the')} <LinkBtn onClick={() => nav('/legal/cookies')}>{t('Cookies policy')}</LinkBtn>.
      </div>
    </div>
  )
}
