import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, LANGS, INSTR_LANGS } from '../../lib/i18n.js'
import { DEMO, REPO } from '../../lib/demo.js'
import { MOBILE } from '../../lib/mobile.js'
import { fmtDate } from '../../lib/format.js'
import { dateLocale } from '../../lib/i18n-core.js'
import { setPublic, setName, setUsername, setPhone, setEmail, resendEmailVerification, accountSessions, revokeSession } from '../../lib/api.js'
import { confirmSheet, passwordLoginSheet, passwordRegisterSheet, changePasswordSheet, deleteAccountSheet } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import PenaltiesRow from '../../components/PenaltiesRow.jsx'
import { Section, Row, SelectRow, Switch } from '../../components/ui.jsx'

// Good-enough OS/browser sniffing for a device label ("Windows · Chrome") — this app is
// dependency-light on purpose, so a couple of substring checks stand in for a real
// UA-parsing library. Order matters: iOS UAs also contain "Mac" (WebKit spoofing) and
// Edge/Chrome UAs both contain "Chrome" and "Safari".
function deviceLabel(ua) {
  const s = ua || ''
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : null
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera'
    : /Chrome\//.test(s) ? 'Chrome' : /CriOS/.test(s) ? 'Chrome' : /Firefox|FxiOS/.test(s) ? 'Firefox'
      : /Safari\//.test(s) ? 'Safari' : null
  if (os && browser) return `${os} · ${browser}`
  return os || browser || t('Unknown device')
}

// lib/audit.js has its own fmtWhen, but that one is deliberately English-only (the admin
// audit log stays out of the per-language packs — see that file's header) — this page is
// a normal translated screen, so session timestamps need their own locale-aware version
// rather than borrowing the admin one.
function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === new Date().toDateString()
  if (sameDay) return t('Today') + ' ' + time
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) + ' ' + time
}

function SessionsSection({ toast }) {
  const [sessions, setSessions] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = () => accountSessions().then(setSessions).catch(e => { toast(e.message || t('Could not load sessions')); setSessions([]) })
  useEffect(() => { load() }, [])

  const revoke = s => confirmSheet({
    title: t('Sign out this device?'),
    message: t('This device will need to sign in again to use your account.'),
    confirmText: t('Sign out device'), danger: true,
    onConfirm: async () => {
      setBusyId(s.id)
      try { await revokeSession(s.id); await load() }
      catch (e) { toast(e.message || t('Could not sign out that device')) }
      finally { setBusyId(null) }
    },
  })

  return <Section title={t('Sessions')} footer={t('Devices currently signed in to your account.')}>
    {sessions === null ? (
      <Row title={t('Loading…')} />
    ) : sessions.length === 0 ? (
      <Row title={t('No active sessions')} />
    ) : sessions.map(s => (
      <Row key={s.id} icon="personCircle" iconTint="var(--blue)" title={deviceLabel(s.ua)}
        subtitle={t('Created {0} · Last active {1}', fmtWhen(s.createdAt), fmtWhen(s.lastSeenAt))}>
        {s.current
          ? <span className="tag acc">{t('This device')}</span>
          : <button className="iconbtn" aria-label={t('Sign out this device')} disabled={busyId === s.id}
              onClick={() => revoke(s)}>
              <Icon name="signOut" />
            </button>}
      </Row>
    ))}
  </Section>
}

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

// Self-saving like the fields above, but a taken/invalid username is a real per-keystroke-
// unrelated failure (someone else has it, or the format's wrong) rather than a network
// hiccup — shown inline under the field instead of a toast, and the input reverts to the
// last saved value so it never displays a name that didn't actually take.
function UsernameField({ user, setUser, toast }) {
  const [v, setV] = useState(user.username || '')
  useEffect(() => { setV(user.username || '') }, [user.username])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const username = v.trim().toLowerCase()
    if (username === (user.username || '')) return
    setBusy(true); setErr('')
    try { setUser((await setUsername(username)).user) }
    catch (e) { setErr(e.message || t('Could not save')); setV(user.username || '') }
    finally { setBusy(false) }
  }

  return <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
    <span className="lrow-t">{t('Username')}</span>
    <div className="row" style={{ alignItems: 'center', gap: 0 }}>
      <span className="dim" style={{ paddingRight: 2 }}>@</span>
      <input className="input" value={v} placeholder={t('your_handle')} disabled={busy}
        onChange={e => { setV(e.target.value); setErr('') }} onBlur={save} style={{ flex: 1 }} />
    </div>
    {err ? <span className="small" style={{ color: 'var(--red)' }}>{err}</span>
      : <span className="small dim">{t('Shown instead of your name in Social — letters, numbers, underscore, 3–20 characters.')}</span>}
  </div>
}

// A first/last split isn't recoverable from a single "name" string in general — a compound
// given name ("Jose Maria") has no marker telling a splitter where the given name(s) end and
// the surname(s) start. That's why firstName/lastName are their OWN persisted fields
// (api/server.js POST /api/account/name), not re-derived from `name` on every load: this
// naive first-space split only ever runs ONCE, for an account that saved a name before this
// split existed and has never explicitly saved firstName/lastName — after that first save,
// the real fields are the source of truth and this function is never consulted again for
// that account. (The original bug: re-running this same split on every load silently undid
// any correction — "Jose Maria" as a first name kept getting cut back down to "Jose".)
function splitName(name) {
  const s = (name || '').trim()
  const i = s.indexOf(' ')
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}
function NameFields({ user, toast, setUser }) {
  const hasSplit = user.firstName != null || user.lastName != null
  const initial = () => hasSplit ? [user.firstName || '', user.lastName || ''] : splitName(user.name)
  // Both halves share one local draft (rather than each field tracking its own value
  // independently, the way the generic Field component does) — tabbing from Nombre straight
  // into Apellidos would otherwise commit the join using a stale, not-yet-saved copy of
  // whichever field was edited first, silently reverting it.
  const [firstName, setFirstName] = useState(() => initial()[0])
  const [lastName, setLastName] = useState(() => initial()[1])
  useEffect(() => {
    const [f, l] = initial()
    setFirstName(f); setLastName(l)
    // Deliberately NOT user.name — name is derived FROM these two once they're saved, so
    // reacting to it here would be the exact re-guessing bug this whole function exists to
    // avoid. Only react to the real fields actually changing (e.g. synced from another device).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.firstName, user.lastName])

  const commit = async () => {
    if (!firstName.trim() && !lastName.trim()) { toast(t('Enter a name')); return }
    if (hasSplit && firstName === (user.firstName || '') && lastName === (user.lastName || '')) return
    try { setUser(await setName({ firstName, lastName })) } catch (e) { toast(e.message || t('Could not save')) }
  }
  const fieldStyle = { flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }
  return <>
    <div className="lrow" style={fieldStyle}>
      <span className="lrow-t">{t('Nombre')}</span>
      <input className="input" value={firstName} placeholder={t('Nombre')}
        onChange={e => setFirstName(e.target.value)} onBlur={commit} />
    </div>
    <div className="lrow" style={fieldStyle}>
      <span className="lrow-t">{t('Apellidos')}</span>
      <input className="input" value={lastName} placeholder={t('Apellidos')}
        onChange={e => setLastName(e.target.value)} onBlur={commit} />
    </div>
  </>
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
    return <div className="narrow settings-page">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
        <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Account')}</h1></div>
      </div>
      <p className="settings-subtitle">{t('Your sign-in, contact info, and account security.')}</p>

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

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Account')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Your sign-in, contact info, and account security.')}</p>

    <PenaltiesRow onlyPending />

    {/* Hero — same avatar-and-identity idiom as the Profile page's preview card, adapted to
        Account's own read-only layout (no photo editing here, that stays on Profile) plus the
        one fact that's genuinely standard on an account page: how long this account has existed. */}
    <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
      <div style={{ width: 64, margin: '0 auto 10px' }}>
        <Avatar name={user.name} avatarUrl={user.avatarUrl} perks={{}} size={64} fontSize={22} />
      </div>
      <div className="tt" style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
      {user.email && <div className="small dim">{user.email}</div>}
      {user.created && <div className="small dim" style={{ marginTop: 4 }}>{t('Member since {0}', fmtDate(user.created.slice(0, 10), true))}</div>}
    </div>

    <Section title={t('Account info')}>
      <NameFields user={user} toast={toast} setUser={setUser} />
      <EmailField user={user} setUser={setUser} toast={toast} />
      <Field label={t('Phone number (optional)')} value={user.phone} type="tel" placeholder={t('Phone number (optional)')}
        onSave={save(setPhone)} />
    </Section>

    <Section title={t('Password')}>
      <Row icon="key" iconTint="var(--teal)" title={t('Change password')} accessory="chevron" onClick={() => changePasswordSheet()} />
    </Section>

    <SessionsSection toast={toast} />

    <Section title={t('Public profile')}>
      <Row icon="heart" iconTint="var(--pink)" title={t('Public profile')} subtitle={t('Lets other accounts on this instance follow you and see your workouts in Social.')}>
        <Switch checked={!!user.public} onChange={async v => { try { setUser(await setPublic(v)) } catch (e) { toast(e.message || t('Could not save')) } }} />
      </Row>
      <UsernameField user={user} setUser={setUser} toast={toast} />
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
