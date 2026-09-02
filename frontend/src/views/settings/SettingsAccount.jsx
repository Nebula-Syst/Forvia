import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, LANGS, INSTR_LANGS } from '../../lib/i18n.js'
import { DEMO, REPO } from '../../lib/demo.js'
import { MOBILE } from '../../lib/mobile.js'
import { setPublic, setName, setPhone, setEmail, resendEmailVerification } from '../../lib/api.js'
import { confirmSheet, passwordLoginSheet, passwordRegisterSheet, changePasswordSheet, deleteAccountSheet } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import PenaltiesRow from '../../components/PenaltiesRow.jsx'
import { Section, Row, SelectRow, Switch } from '../../components/ui.jsx'

// Every field here saves itself on blur, same idiom as the Bio field in Profile settings —
// no separate "edit mode" or save button, just type and tab/click away.
function Field({ label, value, onSave, placeholder, type = 'text' }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  return <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
    <span className="lrow-t">{label}</span>
    <input className="input" type={type} value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)} onBlur={() => { if (v !== (value || '')) onSave(v.trim()) }} />
  </div>
}

function EmailField({ user, setUser, toast }) {
  const [v, setV] = useState(user.email || '')
  useEffect(() => { setV(user.email || '') }, [user.email])
  const [busy, setBusy] = useState(false)

  const reportSend = ({ mailSent, mailConfigured }) => {
    if (mailSent) toast(t('Verification email sent — check your inbox.'))
    else if (!mailConfigured) toast(t('Email saved, but this server has no email delivery set up — ask your admin.'))
    else toast(t('Could not send the verification email — try again later.'))
  }

  const save = async () => {
    const email = v.trim()
    if (email === (user.email || '')) return
    setBusy(true)
    try {
      const res = await setEmail(email)
      setUser(res.user)
      reportSend(res)
    } catch (e) { toast(e.message || t('Could not save')); setV(user.email || '') }
    finally { setBusy(false) }
  }
  const resend = async () => {
    setBusy(true)
    try { reportSend(await resendEmailVerification()) }
    catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }

  return <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
    <span className="lrow-t">{t('Email')}</span>
    <input className="input" type="email" value={v} placeholder={t('you@example.com')} disabled={busy}
      onChange={e => setV(e.target.value)} onBlur={save} />
    {user.email && (
      user.emailVerified ? (
        <span className="small" style={{ color: 'var(--acc)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="checkCircle" style={{ fontSize: 14 }} />{t('Verified')}
        </span>
      ) : (
        <span className="small dim row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {t('Not verified')}
          <button onClick={resend} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
            {t('Resend verification email')}
          </button>
        </span>
      )
    )}
  </div>
}

export default function SettingsAccount() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, setUser, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)

  const save = fn => async v => {
    try { setUser(await fn(v)) } catch (e) { toast(e.message || t('Could not save')) }
  }

  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Sign in with your email and password again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  if (MOBILE || DEMO || !user) {
    return <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
        <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Account')}</h1></div>
      </div>

      <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
        {MOBILE ? <>
          <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
          <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host Forvia')} subtitle={t('Account sign-in, sync across your devices, your own data.')} accessory="chevron"
            onClick={() => window.open(REPO, '_blank', 'noopener')} />
        </> : DEMO ? <>
          <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
          <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
            onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
          <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host Forvia')} subtitle={t('Account sign-in, sync across your devices, your own data.')} accessory="chevron"
            onClick={() => window.open(REPO, '_blank', 'noopener')} />
        </> : <>
          <Row icon="person" iconTint="var(--blue)" title={t('Sign in')} accessory="chevron" onClick={() => passwordLoginSheet()} />
          <Row icon="sparkles" iconTint="var(--acc)" title={t('Create account')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={() => passwordRegisterSheet()} />
        </>}
      </Section>
      {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

      <Section title={t('General')}>
        <SelectRow
          icon="globe" iconTint="var(--blue)" title={t('Language')}
          value={S.lang || 'en'} onChange={v => update(s => { s.lang = v })}
          options={Object.entries(LANGS).map(([k, name]) => ({
            value: k, label: name,
            subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
          }))}
        />
      </Section>
    </div>
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Account')}</h1></div>
    </div>

    <PenaltiesRow />

    <Section title={t('Account info')}>
      {/* One field, not split into first/last — a compound name ("Jose Maria") isn't "first
          name Jose, last name Maria", and splitting on the first space silently moved half of
          whatever was typed into a separate field the person never meant to fill in. */}
      <Field label={t('Name')} value={user.name} placeholder={t('Your name')}
        onSave={v => { if (!v) { toast(t('Enter a name')); return } save(setName)(v) }} />
      <EmailField user={user} setUser={setUser} toast={toast} />
      <Field label={t('Phone number (optional)')} value={user.phone} type="tel" placeholder={t('Phone number (optional)')}
        onSave={save(setPhone)} />
    </Section>

    <Section title={t('Password')}>
      <Row icon="key" iconTint="var(--teal)" title={t('Change password')} accessory="chevron" onClick={() => changePasswordSheet()} />
    </Section>

    <Section title={t('Public profile')}>
      <Row icon="heart" iconTint="var(--pink)" title={t('Public profile')} subtitle={t('Lets other accounts on this instance follow you and see your workouts in Social.')}>
        <Switch checked={!!user.public} onChange={async v => { try { setUser(await setPublic(v)) } catch (e) { toast(e.message || t('Could not save')) } }} />
      </Row>
    </Section>

    <Section title={t('General')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'en'} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
    </Section>

    <Section title={t('Danger zone')}>
      <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
      <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
      <Row icon="trash" iconTint="var(--red)" title={t('Delete account')} subtitle={t('Permanently deletes everything. This cannot be undone.')} danger onClick={() => deleteAccountSheet()} />
    </Section>
  </div>
}
