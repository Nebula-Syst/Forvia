import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { forgotPassword } from '../lib/api.js'
import EntranceHeader from '../components/EntranceHeader.jsx'
import { Button } from '../components/ui.jsx'

// Reached from SignIn's "Forgot password?" link. Always ends the same way regardless of
// whether the email matched an account — the backend already answers that way on purpose
// (see api/account/forgot-password's own comment), so this just reflects that back rather
// than branching on it, which would leak exactly what the backend is trying not to.
export default function ForgotPassword() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { mailConfigured }
  const ref = useRef(null)
  const go = async () => {
    if (!email.trim()) { toast(t('Enter your email')); return }
    setBusy(true)
    try {
      const r = await forgotPassword(email.trim())
      setSent({ mailConfigured: r.mailConfigured })
    } catch (e) { toast(e.message || t('Something went wrong')) }
    finally { setBusy(false) }
  }
  return <div className="narrow" style={{ textAlign: 'center' }}>
    <EntranceHeader title={t('Forgot password')} onBack={() => nav(-1)} />
    <div className="card auth-card" style={{ maxWidth: 380, textAlign: 'left' }}>
      {sent ? (
        sent.mailConfigured ? <>
          <p className="muted" style={{ lineHeight: 1.5 }}>{t('If an account exists for that email, a reset link is on its way. It works for 1 hour.')}</p>
          <div style={{ height: 14 }} />
          <Button variant="primary" onClick={() => nav('/login/signin')}>{t('Back to sign in')}</Button>
        </> : <>
          <p className="muted" style={{ lineHeight: 1.5 }}>{t("This instance hasn't got email set up, so a reset link can't be sent. Ask whoever runs it to reset your password from the admin panel.")}</p>
          <div style={{ height: 14 }} />
          <Button variant="primary" onClick={() => nav('/login/signin')}>{t('Back to sign in')}</Button>
        </>
      ) : <>
        <p className="muted" style={{ lineHeight: 1.5, marginTop: 0 }}>{t("Enter your account's email and we'll send you a link to set a new password.")}</p>
        <input ref={ref} className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email}
          onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} autoFocus />
        <div style={{ height: 18 }} />
        <Button variant="primary" onClick={go} disabled={busy}>{t('Send reset link')}</Button>
      </>}
    </div>
  </div>
}
