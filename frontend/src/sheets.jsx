import { useEffect, useRef, useState } from 'react'
import { useStore, hasData } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, smOf } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, uid, exCount, MONTHS_LONG, ACCENTS, normalizeSearch } from './lib/format.js'
import { lastEntryFor, bestWeightFor, buildSets, workoutVolume, workoutXp, PR_XP, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, defaultConfig, cleanupSg, modeOf, effortOf, isBw, isPerSide, sideReps, workSetsDone } from './lib/history.js'
import { MEASURE_ZONES, lastValueFor, zoneLabel } from './lib/measurements.js'
import { beep, vibrate } from './lib/sound.js'
import { t, instrFor, nameFor, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { refreshTasksNow } from './lib/tasksWatch.js'
import { starterRoutines } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, NumberField, TextField } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import { exerciseMuscleSnapshot, loadOfWorkouts } from './lib/muscles.js'
import { parseImport, mergeImport, preloadTranslatedNames, applyMatchOverride } from './lib/import-csv.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan } from './lib/plan-share.js'
import { estimate1RM, best1RM, is1RMRecord, REP_CAP } from './lib/onerm.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS } from './lib/progression.js'
import { MOBILE, shareExport } from './lib/mobile.js'
import { buildCompletedWorkout } from './lib/finish-workout.js'
import { isWarmupRow } from './lib/workout-model.js'
import { MEALS } from './lib/nutrition.js'
import { waterGoalForDate } from './lib/nutrition-goals.js'
import { parseNutritionCSV, mergeNutritionImport } from './lib/import-nutrition.js'
import { parseNutritionLabelText } from './lib/ocr-nutrition.js'
import { unzipSync, strFromU8 } from 'fflate'
import { StackedBar } from './components/MacroBars.jsx'
import LocationPicker from './components/LocationPicker.jsx'
import LiquidFillGauge from 'react-liquid-gauge'
import { passwordLogin, passwordRegister, setPassword, deleteAccount, socialComments, socialComment, socialCommentRemove, socialUpload, pinWorkout, unpinWorkout, pinPR, reportBug, foodSearch, foodByBarcode, publicFoodSearch, createPublicFood, coachAssignRoutine, coachRequestBox, coachAssignPlan } from './lib/api.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
// A downgrade from Pro can leave someone with more than the Free cap (5) of custom foods,
// saved meals, or custom exercises already made — the cap checks below only ever block
// *creating* a new one. Rather than delete the extras, they stay — just locked: visible
// everywhere, not usable to log/add until back on Pro. "Which 5 stay unlocked" is simply
// array order (oldest first — these arrays are only ever appended to, never reordered).
const lockedIds = (list, pro) => new Set(pro ? [] : (list || []).slice(5).map(x => x.id))
const snd = () => S().sound
const setUser = u => useStore.getState().setUser(u)

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

// Shared delete-with-confirm for a routine — reached from both Plan's "My routines" list and
// the Start tab's own routine picker (issue: deleting was only reachable from Plan, one hop
// deeper than where most people actually look for their routines first), so there's exactly one
// place that knows everything deleting a routine has to clean up alongside it.
export function deleteRoutine(r) {
  confirmSheet({
    title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => { s.routines = s.routines.filter(x => x.id !== r.id) })
  })
}

/* ============================ password login ============================ */
// Opened from two places — Login (no session yet) and Settings (already signed in) — so it lives
// here rather than inline in either view, same reason bwSheet/calendarSheet do.
function PasswordLoginForm({ close }) {
  const [email, setEmailField] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    if (!email.trim() || !pw) { toast(t('Enter your email and password')); return }
    setBusy(true)
    try {
      const u = await passwordLogin(email.trim(), pw)
      useStore.getState().setUser(u); close()
      await useStore.getState().pullState()
      toast(t('Welcome back, {0}', u.name))
    } catch (e) { toast(e.message || t('Sign-in failed')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Sign in')}</h3>
    <input ref={ref} className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmailField(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" autoComplete="current-password" placeholder={t('Password')} value={pw} onChange={e => setPw(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && go()} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{t('Sign in')}</Button>
  </>
}
export function passwordLoginSheet() {
  ui().openSheet(close => <PasswordLoginForm close={close} />)
}

// "Button styled as inline text" — same pattern as SettingsAccount.jsx's "Resend verification
// email": a real <button>, not a bare <a>, so it stays keyboard/screen-reader operable without
// needing a real href for what's actually in-app navigation (views/legal/Terms.jsx, Privacy.jsx).
const LinkBtn = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer' }}>
    {children}
  </button>
)

function PasswordRegisterForm({ close, prefillCode }) {
  const config = useStore(s => s.config)
  const inviteOnly = !!config?.invite_only
  const registerClosed = config?.allow_register === false
  const codeRequired = inviteOnly || registerClosed || !!prefillCode
  const [name, setName] = useState('')
  const [email, setEmailField] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState(prefillCode || '')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
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
      useStore.getState().setUser(u); close()
      if (hasData(useStore.getState().S)) { await useStore.getState().pushState(); toast(t('Profile created — data from this device moved into it')) }
      else { await useStore.getState().pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { toast(e.message || t('Registration failed')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Create account')}</h3>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmailField(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" autoComplete="new-password" placeholder={t('Password (min 8 characters)')} value={pw} onChange={e => setPw(e.target.value)} />
    {codeRequired && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{registerClosed ? t('Registration is closed — enter the invite code you were given.') : t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{t('Create account')}</Button>
    <div className="dim small" style={{ marginTop: 12, lineHeight: 1.5, textAlign: 'center' }}>
      {/* close() first — the sheet overlay isn't part of the route-keyed #app subtree (see
          App.jsx), so it would otherwise stay open on top of the legal page underneath it. */}
      {t('By creating an account you accept the')} <LinkBtn onClick={() => { close(); nav('/legal/terms') }}>{t('Terms of service')}</LinkBtn> {t('and the')} <LinkBtn onClick={() => { close(); nav('/legal/privacy') }}>{t('Privacy policy')}</LinkBtn>.
    </div>
  </>
}
export function passwordRegisterSheet(prefillCode) {
  ui().openSheet(close => <PasswordRegisterForm close={close} prefillCode={prefillCode} />)
}

function ChangePasswordForm({ close }) {
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!current) { toast(t('Enter your current password')); return }
    if (pw.length < 8) { toast(t('Password must be at least 8 characters')); return }
    if (pw !== confirm) { toast(t('New passwords don’t match')); return }
    setBusy(true)
    try {
      await setPassword(current, pw)
      close()
      toast(t('Password updated'))
    } catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Change password')}</h3>
    <input className="input" type="password" placeholder={t('Current password')} value={current}
      onChange={e => setCurrent(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('New password (min 8 characters)')} value={pw}
      onChange={e => setPw(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('Repeat new password')} value={confirm}
      onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save} disabled={busy}>{t('Save changes')}</Button>
  </>
}
export function changePasswordSheet() {
  ui().openSheet(close => <ChangePasswordForm close={close} />)
}

/* ============================ danger zone: delete account ============================ */
function DeleteAccountForm({ close }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!pw) { toast(t('Enter your password to confirm')); return }
    setBusy(true)
    try {
      await deleteAccount(pw)
      close()
      useStore.getState().setUser(null)
      nav('/home')
      toast(t('Account deleted'))
    } catch (e) { toast(e.message || t('Could not delete account')); setBusy(false) }
  }
  return <>
    <h3>{t('Delete account?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('This permanently deletes your profile, workout history, photos and everything you posted. This cannot be undone.')}
    </div>
    <input className="input" type="password" placeholder={t('Confirm your password')} value={pw}
      onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
    <div style={{ height: 12 }} />
    <button className="btn danger" onClick={go} disabled={busy}>{t('Delete my account')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export function deleteAccountSheet() {
  ui().openSheet(close => <DeleteAccountForm close={close} />, { locked: true })
}

/* ============================ bug reports (alpha issue tracker) ============================ */
// Deliberately one field — what went wrong, described in your own words. No severity picker,
// no category: this is alpha, the point is a report an admin can read in the panel (see
// AdminBugs.jsx), not a real issue tracker. Works signed out too (a guest never has a server
// session — see the .env note on ALLOW_GUEST — so there's nothing to attach beyond the text
// itself); the server records those as Anonymous rather than rejecting them.
function ReportBugForm({ close }) {
  const me = useStore.getState().user
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    try {
      await reportBug(v, location.hash.replace(/^#/, '') || '/')
      toast(t('Thanks — logged it.'))
      close()
    } catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Report a bug')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>{t('Describe what happened — the more detail, the easier it is to fix.')}</div>
    <textarea className="input" rows={5} maxLength={1000} placeholder={t('What went wrong? Steps to reproduce help a lot.')}
      value={text} onChange={e => setText(e.target.value)} autoFocus />
    <div className="muted small" style={{ margin: '10px 0' }}>
      {me ? t('Sent as {0}', me.name) : t('Sent anonymously — sign in first so we can follow up with you.')}
    </div>
    <Button variant="primary" onClick={send} disabled={busy || !text.trim()}>{t('Send')}</Button>
  </>
}
export function reportBugSheet() {
  ui().openSheet(close => <ReportBugForm close={close} />)
}

/* ============================ coach: assign a routine ============================ */
// The coach picks one of their OWN routines (S().routines — same list Routines.jsx manages)
// and a target: one specific athlete from the roster, or the whole box. The server stamps a
// fresh routine id on save (POST /api/coach/box/assign-routine) so every athlete who later
// applies it gets an independently-editable copy — this sheet just picks and sends, it never
// mutates the coach's own routine.
function AssignRoutineForm({ box, roster, close, onDone }) {
  const routines = S().routines || []
  const [routineId, setRoutineId] = useState(routines[0]?.id || '')
  const [athleteId, setAthleteId] = useState('__all__')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const routine = routines.find(r => r.id === routineId)
    if (!routine) return toast(t('Pick a routine'))
    setBusy(true)
    try {
      await coachAssignRoutine(box.id, athleteId === '__all__' ? null : athleteId, routine)
      toast(t('Routine assigned'))
      close()
      onDone && onDone()
    } catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Assign a routine')}</h3>
    {!routines.length ? (
      <div className="muted small" style={{ margin: '10px 0' }}>{t('Create a routine of your own first, then come back to assign it.')}</div>
    ) : <>
      <div className="muted small" style={{ margin: '10px 0 6px' }}>{t('Routine')}</div>
      <Segmented options={routines.map(r => ({ value: r.id, label: r.name }))} value={routineId} onChange={setRoutineId} />
      <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Assign to')}</div>
      <Segmented options={[{ value: '__all__', label: t('Whole box') }, ...roster.map(a => ({ value: a.id, label: a.name }))]} value={athleteId} onChange={setAthleteId} />
      <Button variant="primary" style={{ marginTop: 16 }} onClick={send} disabled={busy}>{t('Assign')}</Button>
    </>}
  </>
}
export function assignRoutineSheet(box, roster, onDone) {
  ui().openSheet(close => <AssignRoutineForm box={box} roster={roster} close={close} onDone={onDone} />)
}

/* ============================ coach: request a box ============================ */
// A coach no longer creates a box directly — this files a request (title, description, an
// optional cover image) for an admin to review, same shape as the coach application itself.
const MAX_BOX_IMAGE_MB = 6
function BoxRequestForm({ close, onDone }) {
  const user = useStore(s => s.user)
  // Self-hoster's choice (BOX_LOCATION_MODE, see .env.example): 'off' is a plain manual text
  // field (no geocoding at all — for an instance with no address geocoder set up, or one that
  // would rather not depend on a third party for this), 'search' is the free Photon/OSM real-
  // place picker (default), 'precise' also merges in Google's Geocoding API.
  const boxLocMode = useStore(s => s.config)?.box_location_mode || 'search'
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState(null)
  const [imageName, setImageName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const pickImage = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast(t('JPEG, PNG or WebP only'))
    if (file.size > MAX_BOX_IMAGE_MB * 1024 * 1024) return toast(t('That file is too large — max {0} MB', MAX_BOX_IMAGE_MB))
    const reader = new FileReader()
    reader.onload = () => { setImageDataUrl(reader.result); setImageName(file.name) }
    reader.readAsDataURL(file)
  }

  const send = async () => {
    const v = title.trim()
    if (!v) return toast(t('Name required'))
    const loc = boxLocMode === 'off' ? (location?.label?.trim() ? { label: location.label.trim() } : null) : location
    if (!loc) return toast(t('Set where this box is located'))
    setBusy(true)
    try {
      await coachRequestBox(v, description.trim(), loc, imageDataUrl || null)
      toast(t('Box request sent'))
      close()
      onDone && onDone()
    } catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }

  return <>
    <h3>{t('Request a box')}</h3>
    <div className="muted small" style={{ margin: '10px 0 6px' }}>{t('Title')}</div>
    <TextField value={title} onChange={e => setTitle(e.target.value)} placeholder={t('e.g. CrossFit Sevilla')} autoFocus />
    <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Location')}</div>
    {boxLocMode === 'off' ? (
      <TextField value={location?.label || ''} onChange={e => setLocation({ label: e.target.value })} placeholder={t('e.g. a street address')} />
    ) : (
      <LocationPicker value={location} onChange={setLocation} autoDetect={false} placeholder={t('Search a street address…')} biasFrom={user?.coachLocation} precise={boxLocMode === 'precise'} />
    )}
    <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Description (optional)')}</div>
    <textarea className="field area sm" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('Tell us more…')} />
    <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Cover image (optional)')}</div>
    <label className="doc-upload">
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickImage} />
      <span className="ico"><Icon name={imageName ? 'checkCircle' : 'upload'} /></span>
      <div>
        <div className="t">{imageName || t('Upload an image')}</div>
        <div className="s">{imageName ? t('Tap to change') : t('JPEG, PNG or WebP')}</div>
      </div>
    </label>
    <Button variant="primary" style={{ marginTop: 16 }} onClick={send} disabled={busy}>{t('Send request')}</Button>
  </>
}
export function boxRequestSheet(onDone) {
  ui().openSheet(close => <BoxRequestForm close={close} onDone={onDone} />)
}

/* ============================ box membership plans ============================ */
// name/description/features/price are display-only (Forvia never charges anyone directly — see
// the coach box roadmap's payments notes); monthlyLimit is the one field with real teeth,
// enforced server-side at booking time. Features are edited as one bullet per line and
// joined/split at the boundary rather than as a real add/remove list — a plan's feature list is
// short, freeform marketing copy, not structured data anything else reads.
// A vertical tap-to-pick list, not a Segmented control — Segmented is built for 2-4 equal-width
// options and breaks down visually once a box has more than a couple of plans (each option's
// label wraps into a cramped column). Picking a row applies it immediately (same idiom as
// SelectRow's own picker sheet), no separate "Save changes" step.
function AssignPlanForm({ box, athlete, plans, currentPlanId, close, onDone }) {
  const [busy, setBusy] = useState(false)
  const pick = async planId => {
    if (planId === (currentPlanId || '')) return close()
    setBusy(true)
    try {
      await coachAssignPlan(box.id, athlete.id, planId || null)
      toast(t('Plan updated'))
      close()
      onDone && onDone()
    } catch (e) { toast(e.message || t('Could not save')); setBusy(false) }
  }
  const planSubtitle = p => `${p.price} · ${p.monthlyLimit == null ? t('Unlimited') : t('{0} classes/mo', p.monthlyLimit)}`
  return <>
    <h3>{athlete.name}</h3>
    <div className="muted small" style={{ margin: '10px 0 6px' }}>{t('Plan')}</div>
    <div className="sect-b">
      <button className="lrow tap" disabled={busy} onClick={() => pick('')}>
        <span className="lrow-m"><span className="lrow-t">{t('No plan')}</span></span>
        {!currentPlanId && <Icon name="check" className="lrow-k" />}
      </button>
      {plans.map(p => (
        <button key={p.id} className="lrow tap" disabled={busy} onClick={() => pick(p.id)}>
          <span className="lrow-m"><span className="lrow-t">{p.name}</span><span className="lrow-s">{planSubtitle(p)}</span></span>
          {p.id === currentPlanId && <Icon name="check" className="lrow-k" />}
        </button>
      ))}
    </div>
    <div style={{ height: 8 }} />
  </>
}
export function assignPlanSheet(box, athlete, plans, currentPlanId, onDone) {
  ui().openSheet(close => <AssignPlanForm box={box} athlete={athlete} plans={plans} currentPlanId={currentPlanId} close={close} onDone={onDone} />)
}

/* ============================ social: comments on a workout ============================ */
function CommentsForm({ targetUid, workoutId, close }) {
  const me = useStore.getState().user
  const [rows, setRows] = useState(null)
  const [text, setTextV] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => socialComments(targetUid, workoutId).then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])
  const send = async () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    try { const c = await socialComment(targetUid, workoutId, v); setRows(r => [...(r || []), c]); setTextV('') }
    catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }
  const remove = async id => {
    setRows(r => r.filter(c => c.id !== id))
    try { await socialCommentRemove(id) } catch (e) { toast(e.message || t('Could not save')); load() }
  }
  const canRemove = c => me && (c.userId === me.id || targetUid === me.id || me.admin)
  return <>
    <h3>{t('Comments')}</h3>
    {rows === null ? null : rows.length === 0 ? <div className="muted small" style={{ marginBottom: 14 }}>{t('No comments yet.')}</div> : (
      <div className="list" style={{ marginBottom: 14 }}>
        {rows.map(c => <div key={c.id} className={'item' + (c.commentHighlight ? ' comment-highlight' : '')} style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="tt" style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
            <div className="ss">{c.text}</div>
          </div>
          {canRemove(c) && <button className="iconbtn" style={{ width: 28, height: 28, fontSize: 13 }} onClick={() => remove(c.id)} aria-label={t('Delete')}><Icon name="trash" /></button>}
        </div>)}
      </div>
    )}
    <input className="input" placeholder={t('Write a comment…')} maxLength={500} value={text}
      onChange={e => setTextV(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={send} disabled={busy || !text.trim()}>{t('Post')}</Button>
  </>
}
export function commentsSheet(targetUid, workoutId) {
  ui().openSheet(close => <CommentsForm targetUid={targetUid} workoutId={workoutId} close={close} />)
}

// "Click to see everything" from a feed card — the full post (every photo, the whole
// exercise list, description) plus the same comment thread as commentsSheet, so there's
// one place a comment count and a tap both lead to instead of two overlapping sheets.
// (Distinct from workoutDetailSheet below, which is your OWN history — read-only here,
// no delete, and the workout shape is the feed's summary, not the raw stored one.)
function FeedPost({ item, close }) {
  const unit = useStore(s => s.S.unit)
  const w = item.workout
  return <>
    {(w.images || []).map((url, i) => <img key={i} src={url} alt="" style={{ width: '100%', maxHeight: 420, objectFit: 'cover', borderRadius: 'var(--r)', marginBottom: i === w.images.length - 1 ? 14 : 8 }} />)}
    <h3>{w.name || t('Freestyle')}</h3>
    <div className="ss" style={{ marginBottom: 10 }}>{item.name} · {fmtDate(w.d, true)}</div>
    {w.desc && <div className="small" style={{ marginBottom: 14, lineHeight: 1.5 }}>{w.desc}</div>}
    <div className="tiles" style={{ marginBottom: 14 }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, unit)}</div></div>
      <div className="tile"><div className="l">{t('Records')}</div><div className="v" style={{ fontSize: 20 }}>{w.prs.length || '—'}</div></div>
    </div>
    {w.exercises.length > 0 && <div style={{ marginBottom: 14 }}>
      {w.exercises.map(e => {
        const ex = EXIDX[e.id] || {}
        return <div key={e.id} className="row" style={{ gap: 10, padding: '5px 0' }}>
          <Thumb ex={ex} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="tt capitalize" style={{ fontSize: 14 }}>{nameFor(ex) || e.id}</div>
            <div className="ss">{t('{0} sets', e.sets)}</div>
          </div>
          {w.prs.includes(e.id) && <Icon name="trophy" style={{ color: 'var(--yellow)', fontSize: 15, flex: 'none' }} />}
        </div>
      })}
    </div>}
    <div className="divider" />
    <CommentsForm targetUid={item.uid} workoutId={w.id} close={close} />
  </>
}
export function feedPostSheet(item) {
  ui().openSheet(close => <FeedPost item={item} close={close} />)
}

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const [push, pull, legs] = starterRoutines()
  update(st => { st.routines.push(push, pull, legs) })
  toast(t('Starter routines loaded — Push, Pull & Legs'))
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label="minus 0.1"><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label="plus 0.1"><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{required ? t('Quick check-in') : t('Log body weight')}</h3>
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); nav('/workout') }}>{t('Choose a different workout')}</Button>
      {/* Neither of the two above actually backs out — one starts this workout, the other
          starts a different one. Tapping "start" by mistake needs a real way out: close the
          sheet without calling onDone at all, so nothing gets created. */}
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" onClick={() => close()}>{t('Cancel')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label="delete"><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

/* ============================ body measurements ============================ */
function MeasurementSheet({ close }) {
  const st = useStore(s => s.S)
  const iso = todayISO()
  const today = st.measurements.find(m => m.d === iso)
  // A blank field means "leave this zone alone", not "clear it" — most sessions only touch a
  // couple of zones, so save() only writes the ones actually filled in, same as this draft.
  const [draft, setDraft] = useState(() => Object.fromEntries(MEASURE_ZONES.map(z => [z, today?.values?.[z] ?? null])))
  const setZone = (z, v) => setDraft(d => ({ ...d, [z]: v }))
  const save = () => {
    const values = Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null && v > 0))
    if (!Object.keys(values).length) { toast(t('Enter at least one measurement')); return }
    update(s => {
      let row = s.measurements.find(m => m.d === iso)
      if (!row) { row = { d: iso, t: Date.now(), values: {} }; s.measurements.push(row); s.measurements.sort((a, b) => (a.d < b.d ? -1 : 1)) }
      else row.t = Date.now()
      Object.assign(row.values, values)
    })
    close()
    toast(t('Measurements saved'))
  }
  return <>
    <h3>{t('Log body measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Today')}, {fmtDate(iso, true)} — {t('cm, leave a field blank to keep it as it is')}</div>
    <div className="list" style={{ gap: 0 }}>
      {MEASURE_ZONES.map(z => (
        <div key={z} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small">{zoneLabel(z)}</span>
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <NumberField value={draft[z]} onChange={v => setZone(z, v)} nullable style={{ width: 76, textAlign: 'right', padding: '7px 10px' }}
              placeholder={lastValueFor(st, z) != null ? String(lastValueFor(st, z)) : '—'} />
            <span className="small muted">cm</span>
          </span>
        </div>
      ))}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export function measurementSheet() {
  ui().openSheet(close => <MeasurementSheet close={close} />)
}

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
function ImportSummary({ parsed: initial, close }) {
  const st = useStore(s => s.S)
  // Local, editable copy — applyMatchOverride hands back a full replacement parsed object
  // (rebuilt workouts + recomputed counts) each time a row's link is changed here.
  const [parsed, setParsed] = useState(initial)
  const isBW = parsed.kind === 'bodyweight'
  const isMeasure = parsed.kind === 'measurements'
  const isWorkouts = !isBW && !isMeasure
  const have = isBW
    ? parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    : isMeasure
    ? parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
      + parsed.measurements.filter(m => (st.measurements || []).some(x => x.d === m.d)).length
    // Must match mergeImport's own dedup key exactly (lib/import-csv.js) — date alone used to
    // count a day as "already have it" even when the imported workout was completely different
    // content, which both hid it here (this button disables at fresh:0) and dropped it there.
    : parsed.workouts.filter(w => st.workouts.some(x => x.d === w.d && x.start === w.start)).length
  const totalItems = isBW ? parsed.bodyweight.length : isMeasure ? parsed.bodyweight.length + parsed.measurements.length : parsed.workouts.length
  const fresh = totalItems - have

  // Single-select exercisePicker taps call onPick and leave the sheet open, on the assumption
  // onPick opens something else on top (see its own comment) — nothing here does, so a pick
  // would otherwise just sit there looking like it did nothing. Close it ourselves instead.
  const changeMatch = m => {
    const picker = exercisePicker(ex => { setParsed(p => applyMatchOverride(p, m.key, ex.id)); picker.close() })
  }

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, parsed) })
    close()
    toast(isBW ? t('{0} weigh-ins imported', res.added)
      : isMeasure ? t('{0} entries imported', res.added)
      : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from === parsed.to ? fmtDate(parsed.from, true) : fmtDate(parsed.from, true) + ' – ' + fmtDate(parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'left' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : isMeasure ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('Body measurements')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.measurements.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb — each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {isWorkouts && !parsed.fileUnit && !parsed.mixedUnits && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file does not say which unit it uses — numbers are imported as they are.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {isWorkouts && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {/* Every exercise name the file used, matched or not — a confident match needs nothing
        from you, but is still shown and still changeable, since "confident" just means the
        name looked unambiguous, not that it's necessarily the right lift. */}
    {isWorkouts && !!parsed.nameMatches?.length && <>
      <h4 className="sec">{t('Link your exercises')}</h4>
      <div className="list" style={{ gap: 0, marginBottom: 12 }}>
        {parsed.nameMatches.map(m => (
          <div key={m.key} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 10 }}>
            <span className="small" style={{ minWidth: 0, flex: 1 }}>
              <span className="capitalize">{m.name}</span>
              <span className="dim" style={{ display: 'block', fontSize: 12, marginTop: 1 }}>
                {m.confident ? '→ ' + nameFor(EXIDX[m.id]) : t('New custom exercise')}
              </span>
            </span>
            <Button size="sm" variant={m.confident ? 'ghost' : 'tinted'} onClick={() => changeMatch(m)}>{t('Change')}</Button>
          </div>
        ))}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const importAppKindEmpty = parsed => parsed.kind === 'bodyweight' ? !parsed.bodyweight.length
  : parsed.kind === 'measurements' ? !parsed.bodyweight.length && !parsed.measurements.length
  : !parsed.workouts.length

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const isZip = /\.zip$/i.test(file.name) || /zip/i.test(file.type)
  if (isZip) { importZipFromApp(file, onDone); return }
  const rd = new FileReader()
  // Kicked off in parallel with the file read, not awaited up front — by the time the (much
  // slower, user-picked) file finishes reading, the ~60KB name pack has almost always already
  // landed, so this never feels like an extra loading step.
  const names = preloadTranslatedNames().catch(() => {})
  rd.onload = async () => {
    await names
    let parsed
    try { parsed = parseImport(String(rd.result), { unit: S().unit }) }
    catch (e) { toast(t('Could not read that file')); return }
    // This button and the food-diary one in Settings ▸ Nutrition are easy to mix up — MyFitnessPal
    // alone hands out three CSVs at once (workouts, measurements, and a food diary with its own
    // schema). Rather than reject a diary file dropped here, fall back to the other parser too.
    if (parsed.error) {
      let asNutrition
      try { asNutrition = parseNutritionCSV(String(rd.result), { fallbackName: t('Imported item') }) } catch { asNutrition = { error: true } }
      if (!asNutrition.error) { ui().openSheet(close => <NutritionImportSummary parsed={asNutrition} close={close} />); onDone && onDone(); return }
    }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    if (importAppKindEmpty(parsed)) { toast(t('Nothing to import from that file')); return }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

// Apps that export several files at once (MyFitnessPal: a workout/exercise summary, a body
// measurements summary, and a separate nutrition-diary summary with its own column schema and
// its own summary screen) hand the user one zip, not one CSV — so a plain "unrecognised columns"
// error on the zip's raw bytes was the actual bug being hit here. Unzip it, run every .csv entry
// through whichever parser recognises it, and walk the user through one summary sheet per
// recognised file (chained via each sheet's own close) so nothing inside gets silently skipped.
function importZipFromApp(file, onDone) {
  const rd = new FileReader()
  const names = preloadTranslatedNames().catch(() => {})
  rd.onload = async () => {
    await names
    let entries
    try { entries = unzipSync(new Uint8Array(rd.result)) }
    catch (e) { toast(t('Could not read that file')); return }

    const jobs = []
    for (const [name, data] of Object.entries(entries)) {
      if (!/\.csv$/i.test(name) || !data.length) continue
      let text
      try { text = strFromU8(data) } catch { continue }
      let asImport
      try { asImport = parseImport(text, { unit: S().unit }) } catch { asImport = { error: true } }
      if (!asImport.error && !importAppKindEmpty(asImport)) { jobs.push({ kind: 'app', parsed: asImport }); continue }
      let asNutrition
      try { asNutrition = parseNutritionCSV(text, { fallbackName: t('Imported item') }) } catch { asNutrition = { error: true } }
      if (!asNutrition.error) jobs.push({ kind: 'nutrition', parsed: asNutrition })
    }

    if (!jobs.length) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }

    const showNext = i => {
      if (i >= jobs.length) { onDone && onDone(); return }
      const advance = () => showNext(i + 1)
      const job = jobs[i]
      if (job.kind === 'nutrition') ui().openSheet(close => <NutritionImportSummary parsed={job.parsed} close={() => { close(); advance() }} />)
      else ui().openSheet(close => <ImportSummary parsed={job.parsed} close={() => { close(); advance() }} />)
    }
    showNext(0)
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsArrayBuffer(file)
}

// Same "existing days win" summary-then-confirm flow as ImportSummary above, for a food
// diary CSV instead of a workout history one — see lib/import-nutrition.js.
function NutritionImportSummary({ parsed, close }) {
  const st = useStore(s => s.S)
  const have = Object.keys(parsed.byDate).filter(iso => (st.foodDiary[iso] || []).length).length
  const fresh = Object.keys(parsed.byDate).length - have

  const doImport = () => {
    let res
    update(s => { res = mergeNutritionImport(s, parsed) })
    close()
    toast(t('{0} days imported', res.addedDays))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import food diary')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from === parsed.to ? fmtDate(parsed.from, true) : fmtDate(parsed.from, true) + ' – ' + fmtDate(parsed.to, true)}
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Days')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{Object.keys(parsed.byDate).length}</div></div>
      <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      <div className="tile"><div className="l">{t('Items')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.count}</div></div>
    </div>
    {have > 0 && <div className="small dim" style={{ margin: '10px 0' }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    <div style={{ height: have > 0 ? 0 : 10 }} />
    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}


/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

// hideAddToPlan: mid-workout you're already doing the exercise, not planning one — the
// picker/library callers still get the button, this is the one context that doesn't.
function ExerciseDetail({ ex, close, hideAddToPlan, hideCustomActions }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  return <>
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {ex.tg && <span className="tag"><Icon name="target" />{t(ex.tg)}</span>}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {smOf(ex).slice(0, 3).map((s, i) => <span key={i} className="tag">{t(s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
    {!hideAddToPlan && <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>}
    {ex.custom && !hideCustomActions && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = (ex, opts = {}) => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} hideAddToPlan={opts.hideAddToPlan} hideCustomActions={opts.hideCustomActions} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', nameFor(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/routines/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className="capitalize">{t('Add “{0}”', nameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" onClick={() => pick('_new')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => {
  const { user, S } = useStore.getState()
  if (lockedIds(S.customEx, user?.pro).has(ex.id)) return toast(t('This exercise is locked — go Pro to use it again.'))
  ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)
}

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats), just without an animation.
function CustomExForm({ existing, prefill, onDone, close }) {
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.id !== (existing || {}).id && (e.n.toLowerCase() === name.toLowerCase() || nameFor(e).toLowerCase() === name.toLowerCase()))
    if (dup) { toast(t('“{0}” already exists', nameFor(dup))); return }
    const d = desc.trim().slice(0, 1000)
    let id = existing && existing.id
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) { c.n = name; c.bp = bp; c.desc = d } })
    else {
      id = 'c' + uid()
      update(s => { (s.customEx = s.customEx || []).push({ id, n: name, bp, desc: d, tg: '', eq: 'custom', custom: true }) })
    }
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise, just without an animation.')}</div>
    <input className="input" placeholder={t('Exercise name')} value={n} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
// Same 5-item Free cap as customFoodDefSheet/saveMealSheet/createMealSheet above — checked
// only when creating (no `existing`), never editing/deleting one already made.
export const customExSheet = (existing, onDone, prefill) => {
  if (!existing) {
    const { user, S } = useStore.getState()
    if (!user?.pro && (S.customEx || []).length >= 5) return toast(t('Free is limited to 5 custom exercises — go Pro for unlimited.'))
  }
  ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)
}

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        // Keep display and muscle metadata in history before the custom catalogue row disappears.
        const snapshot = exerciseMuscleSnapshot(ex)
        s.workouts.forEach(w => w.entries.forEach(e => {
          if (e.id !== ex.id) return
          e.n = ex.n
          if (!e.muscleSnapshot || !Object.keys(e.muscleSnapshot).length) e.muscleSnapshot = snapshot
        }))
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
// multi: lets several exercises be checked before one "Add N" commits them all at once
// (onPick then receives the array) — used when adding mid-workout, where picking is the
// only step left (no per-exercise config sheet follows). Single mode (the default, used
// by the routine editor) is unchanged: each tap calls onPick(ex) immediately and the sheet
// stays open underneath whatever that opens, ready for the next pick.
function ExercisePicker({ onPick, multi, close }) {
  const st = useStore(s => s.S)
  const pro = useStore(s => s.user?.pro)
  const locked = lockedIds(st.customEx, pro)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [shown, setShown] = useState(50)
  const [picked, setPicked] = useState([])  // multi mode only
  const ql = normalizeSearch(q.trim())
  const all = allExercises(st)
  let base = all.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || normalizeSearch(e.n).includes(ql) || normalizeSearch(nameFor(e)).includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || normalizeSearch(e.desc).includes(ql)))
  if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || (nameFor(a) < nameFor(b) ? -1 : 1))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const chosenCount = Object.keys(usage).length
  const isPicked = id => picked.some(p => p.id === id)
  const tap = e => {
    if (locked.has(e.id)) return toast(t('This exercise is locked — go Pro to use it again.'))
    return multi
      ? setPicked(ps => isPicked(e.id) ? ps.filter(p => p.id !== e.id) : [...ps, e])
      : onPick(e)
  }
  const addNew = ex => multi ? setPicked(ps => [...ps, ex]) : onPick(ex)
  const typeLabel = bp === '★' ? `${t('Chosen')} (${chosenCount})` : (bp ? t(bp) : t('All'))
  const eqLabel = eqOn ? t(eqOn) : t('Any equipment')
  const openTypePicker = () => {
    const options = [
      ...(chosenCount > 0 ? [{ value: '★', label: `${t('Chosen')} (${chosenCount})` }] : []),
      { value: '', label: t('All') },
      ...BODYPARTS.map(b => ({ value: b, label: t(b) })),
    ]
    ui().openSheet(close2 => (
      <>
        <h3>{t('Pick a body part')}</h3>
        <div className="sect-b">
          {options.map(o => (
            <button key={o.value} className="lrow tap" onClick={() => { close2(); setBp(o.value); setEq(''); setShown(50) }}>
              <span className="lrow-m"><span className="lrow-t">{o.label}</span></span>
              {o.value === bp && <Icon name="check" className="lrow-k" />}
            </button>
          ))}
        </div>
        <div style={{ height: 8 }} />
      </>
    ))
  }
  const openEquipmentPicker = () => {
    const options = [{ value: '', label: t('Any equipment') }, ...eqOpts.map(x => ({ value: x, label: t(x) }))]
    ui().openSheet(close2 => (
      <>
        <h3>{t('Equipment')}</h3>
        <div className="sect-b">
          {options.map(o => (
            <button key={o.value} className="lrow tap" onClick={() => { close2(); setEq(o.value); setShown(50) }}>
              <span className="lrow-m"><span className="lrow-t">{o.label}</span></span>
              {o.value === eqOn && <Icon name="check" className="lrow-k" />}
            </button>
          ))}
        </div>
        <div style={{ height: 8 }} />
      </>
    ))
  }
  return <>
    {/* Sticky — in multi-select mode this is the only way to confirm a pick, and scrolling
        back to the top of a 700-exercise list just to tap it was the actual complaint. */}
    <div className="row between sheet-hdr-sticky">
      <h3 style={{ margin: 0 }}>{t('Add exercise')}</h3>
      {multi && <Button size="sm" variant="primary" disabled={!picked.length} onClick={() => { close(); onPick(picked) }}>{t('Add')}{picked.length > 0 ? ` (${picked.length})` : ''}</Button>}
    </div>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="row" style={{ gap: 8, margin: '10px 0 12px' }}>
      <Button variant="tinted" trailingIcon="chevronDown" style={{ flex: 1, justifyContent: 'space-between' }} onClick={openTypePicker}>{typeLabel}</Button>
      {eqOpts.length > 1 && <Button variant="tinted" trailingIcon="chevronDown" style={{ flex: 1, justifyContent: 'space-between' }} onClick={openEquipmentPicker}>{eqLabel}</Button>}
    </div>
    <div className="list">
      {bp !== '★' && <div className="item" onClick={() => customExSheet(null, addNew, q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => {
        const on = multi && isPicked(e.id)
        const isLocked = locked.has(e.id)
        return <div key={e.id} className={'item' + (on ? ' on' : '')} style={isLocked ? { opacity: .5 } : undefined} onClick={() => tap(e)}>
          <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{nameFor(e)}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
          {isLocked ? <Icon name="lock" style={{ color: 'var(--label-3)' }} /> : usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}
          <button className="iconbtn" aria-label={t('Exercise info')} onClick={ev => { ev.stopPropagation(); exerciseDetailSheet(e) }}><Icon name="info" /></button>
        </div>
      })}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
export const exercisePicker = (onPick, opts = {}) => ui().openSheet(close => <ExercisePicker onPick={onPick} multi={opts.multi} close={close} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
function ProgressionFields({ ex, mode, c, setC, routine, unit }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={v => setC(x => ({ ...x, prog: v || undefined }))}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <Stepper label={t('Reps from')} value={c.repsMin || Math.max(1, (c.reps || 10) - 2)}
        step={1} decimal={false} onChange={v => setC(x => ({ ...x, repsMin: v }))} />}
    </div>}
  </>
}

function ExConfig({ ex, existing, onSave, onDelete, close, routine, initial }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [c, setC] = useState(existing || initial || defaultConfig(ex.id))
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => ({ ...defaultConfig(ex.id, m), ...x, mode: m }))
  const save = () => {
    close()
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps; `side` is not — it counts
    // reps, and a timed hold has none. Switching an exercise to Time therefore drops it
    // rather than carrying a flag nothing downstream can read.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...prog })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const reps = perSide ? Math.ceil(typed / 2) * 2 : typed
      const out = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog }
      if (policyFor({ ...c, id: ex.id }, routine, 'reps') === 'double') out.repsMin = Math.min(reps, Math.max(1, Math.round(c.repsMin) || Math.max(1, reps - 2)))
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      onSave(out)
    }
  }
  return <>
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </> : <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? t('No weight to enter — just log the reps.') : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode === 'reps' && <Row icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
        subtitle={perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.')}>
        {/* Turning it on rounds the target up to an even number, since half of an odd
            total is a rep one side does not get. */}
        <Switch checked={perSide} onChange={v => setC(x => ({ ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }))} />
      </Row>}
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to routine')}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine, initial) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} initial={initial} onSave={onSave} onDelete={onDelete} routine={routine} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
    const json = JSON.stringify(bundle, null, 2)
    const name = 'forvia-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own Forvia — routines only, none of your workouts or weigh-ins.')}</div>
    {!MOBILE && <>
      <div style={{ height: 12 }} />
      <Button variant="tinted" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    </>}
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const apply = () => {
    update(s => mergePlan(s, bundle))
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/routines')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const perks = user?.perks
  const pinnedPR = user?.pinnedPR
  const isPinned = user?.pinnedWorkoutIds?.includes(w.id)
  const togglePin = async () => {
    try { setUser(isPinned ? await unpinWorkout(w.id) : await pinWorkout(w.id)) }
    catch (e) { toast(e.message || t('Could not save')) }
  }
  const togglePinPR = async id => {
    const already = pinnedPR?.workoutId === w.id && pinnedPR?.exerciseId === id
    try { setUser(already ? await pinPR('', '') : await pinPR(w.id, id)) }
    catch (e) { toast(e.message || t('Could not save')) }
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{w.name}</h3>
      {!!perks?.pinnedMax && <button className="iconbtn" aria-label={t('Pin to profile')} onClick={togglePin}><Icon name="flag" className={isPinned ? 'accent' : undefined} /></button>}
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      const isPr = w.prs && w.prs.includes(e.id)
      const prPinned = pinnedPR?.workoutId === w.id && pinnedPR?.exerciseId === e.id
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? nameFor(ex) : (e.n || e.id)} {isPr && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div></div>
        {isPr && perks?.pinFavoritePR && <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 14 }} aria-label={t('Pin as favorite PR')} onClick={() => togglePinPR(e.id)}><Icon name={prPinned ? 'starFill' : 'star'} className={prPinned ? 'accent' : undefined} /></button>}
      </div>
    })}
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.workouts = s.workouts.filter(x => x.id !== w.id)
          // A tombstone, not just an absent id — the server merges workouts by id union across
          // devices (see api/server.js mergeWorkoutsInto) so a stale second device can never
          // silently erase one it just hasn't synced yet; without this the same merge would
          // undo every delete the instant that other device next pushed.
          s.deletedWorkoutIds = [...(s.deletedWorkoutIds || []), { id: w.id, at: Date.now() }]
        })
        close(); toast(t('Workout deleted'))
      }
    })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, onPick, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso]
    const ate = (st.foodDiary[iso] || []).length > 0
    // Trained and ate are tracked independently — see the has-workout/has-food CSS — so a
    // day can carry either tint, both, or neither. Every day still opens the day-detail
    // sheet (or calls onPick, browsing from Nutrition.jsx), workout or not.
    cells.push(
      <button key={d} className={'cal-d' + (ws ? ' has-workout' : '') + (ate ? ' has-food' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => { close(); onPick ? onPick(iso) : dayDetailSheet(iso) }}>
        <span>{d}</span>
        <span className="dots">
          {ws && <i className="workout" />}
          {ate && <i className="food" />}
        </span>
      </button>
    )
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--blue)' }} />{t('Ate')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{onPick ? t('Tap a day to view it') : t('Tap a day for its workout and nutrition log')}</div>
  </>
}
export const calendarSheet = (start, onPick) => ui().openSheet(close => <Calendar start={start} onPick={onPick} close={close} />)

/* ============================ day detail (workout + nutrition) ============================ */
// One sheet for "what happened on this date" — reached from the month calendar and from
// Home's week strip alike, so both entry points land on the exact same view instead of
// each growing its own half-featured version.
function DayDetail({ iso, close }) {
  const st = useStore(s => s.S)
  const ws = st.workouts.filter(w => w.d === iso)
  const goals = st.nutritionGoals
  const food = st.foodDiary[iso] || []
  const sum = key => food.reduce((n, it) => n + (it[key] || 0), 0)
  const kcal = sum('kcal'), carbs = sum('carbsG'), fat = sum('fatG'), protein = sum('proteinG')
  return <>
    <h3 style={{ marginBottom: 12 }}>{fmtDate(iso, true)}</h3>

    <div className="muted small" style={{ marginBottom: 8 }}>{t('Workout')}</div>
    {ws.length
      ? <div className="list" style={{ marginBottom: 20 }}>{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { close(); workoutDetailSheet(w) }} />)}</div>
      : <div className="empty" style={{ padding: '18px 0', marginBottom: 20 }}><div className="ico"><Icon name="dumbbell" /></div>{t('No workout logged this day')}</div>}

    <div className="muted small" style={{ marginBottom: 8 }}>{t('Nutrition')}</div>
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="row between small" style={{ marginBottom: 3 }}>
        <span className="muted">{t('Calories')}</span><span className="dim">{kcal} / {goals.calories} kcal</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ width: Math.min(100, goals.calories ? (kcal / goals.calories) * 100 : 0) + '%', height: '100%', background: 'var(--acc)' }} />
      </div>
      {[
        { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
        { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
        { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' }
      ].map((m, i, arr) => <div key={m.l} style={{ marginBottom: i === arr.length - 1 ? 0 : 8 }}>
        <div className="row between small" style={{ marginBottom: 3 }}>
          <span className="muted">{m.l}</span><span className="dim">{m.v} / {m.g}g</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: Math.min(100, m.g ? (m.v / m.g) * 100 : 0) + '%', height: '100%', background: m.c }} />
        </div>
      </div>)}
    </div>
  </>
}
export const dayDetailSheet = iso => ui().openSheet(close => <DayDetail iso={iso} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ workout lifecycle ============================ */
export function startFlow(routineId) {
  bwSheet({ required: true, onDone: bw => beginWorkout(routineId, bw) })
}
export function beginWorkout(routineId, bw) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const entries = (r ? r.ex : []).map(cfg => {
    const plan = nextPrescription(st, cfg, r)
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg }, plan, sets: applyPrescription(buildSets(st, cfg), plan) }
  })
  update(s => {
    s.active = { id: uid(), d: todayISO(), start: Date.now(), routineId, name: r ? r.name : t('Freestyle'), bw: bw || null, cur: 0, entries }
  })
  useUI.getState().stopRest()
  nav('/workout')
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const maxSet = entry ? Math.max(0, ...entry.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w || 0)) : 0
  const prevBest = entry ? Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
  }
  return <>
    <h3 className="capitalize row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', nameFor(ex))}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={isLastUnit ? null : 'chevronRight'} onClick={() => commit(true)}>{isLastUnit ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

const DEFAULT_MAX_WORKOUT_IMAGES = 4
const MAX_IMAGE_MB = 6

// Every field here is optional and saves itself as soon as it's known (blur for text, on
// upload for photos) — closing the sheet without touching anything leaves the workout exactly
// as buildCompletedWorkout() made it, same as before this existed.
function FinishSummary({ w, prs, e1prs = [], xp = 0, close }) {
  const st = useStore(s => s.S)
  const maxImages = useStore(s => s.user?.perks?.maxPhotos) || DEFAULT_MAX_WORKOUT_IMAGES
  const [title, setTitle] = useState(w.name || '')
  const [desc, setDesc] = useState(w.desc || '')
  const [images, setImages] = useState(w.images || [])
  const [uploading, setUploading] = useState(false)

  const patch = fields => update(s => { const wk = s.workouts.find(x => x.id === w.id); if (wk) Object.assign(wk, fields) })
  const saveTitle = () => { const v = title.trim() || w.name; setTitle(v); patch({ name: v }) }
  const saveDesc = () => { const v = desc.trim(); setDesc(v); patch({ desc: v }) }

  const addPhotos = async e => {
    const files = Array.from(e.target.files || []).slice(0, maxImages - images.length)
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    for (const f of files) {
      if (f.size > MAX_IMAGE_MB * 1024 * 1024) { toast(t('{0} is too large — max {1} MB', f.name, MAX_IMAGE_MB)); continue }
      try {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
        const url = await socialUpload(dataUrl)
        setImages(list => { const next = [...list, url]; patch({ images: next }); return next })
      } catch (err) { toast(err.message || t('Could not upload image')) }
    }
    setUploading(false)
  }
  const removeImage = url => setImages(list => { const next = list.filter(x => x !== url); patch({ images: next }); return next })

  return <div style={{ padding: '8px 0' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
      <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
      {xp > 0 && <div className="row" style={{ justifyContent: 'center', gap: 5, marginBottom: 4, color: 'var(--acc)', fontWeight: 700, fontSize: 15 }}>
        <Icon name="bolt" /><span>{t('+{0} XP', xp)}</span>
      </div>}
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{t('{0} sets · {1} work', setsDone(w), workSetsDone(w))}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {EXIDX[id] ? nameFor(EXIDX[id]) : id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {EXIDX[p.id] ? nameFor(EXIDX[p.id]) : p.id} · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}

    <h4 className="sec" style={{ textAlign: 'left' }}>{t('Title & photos')}</h4>
    <input className="input" value={title} maxLength={60} placeholder={t('Name this workout')}
      onChange={e => setTitle(e.target.value)} onBlur={saveTitle} style={{ marginBottom: 8 }} />
    <textarea className="input" value={desc} maxLength={280} rows={3} placeholder={t('Add a description (optional)')}
      onChange={e => setDesc(e.target.value)} onBlur={saveDesc} style={{ marginBottom: 10 }} />
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {images.map(url => (
        <div key={url} style={{ position: 'relative' }}>
          <img src={url} className="thumb" style={{ width: 60, height: 60 }} />
          <button className="iconbtn" aria-label={t('Delete')}
            style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, fontSize: 10, background: 'var(--red)', color: '#fff' }}
            onClick={() => removeImage(url)}><Icon name="xmark" /></button>
        </div>
      ))}
      {images.length < maxImages && (
        <label className="thumb thumb-x" style={{ width: 60, height: 60, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? .5 : 1 }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={uploading} onChange={addPhotos} />
          <Icon name="plus" />
        </label>
      )}
    </div>

    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = buildCompletedWorkout(A, {
    end: Date.now(),
    prs,
    snapshotFor: e => EXIDX[e.id]?.custom ? exerciseMuscleSnapshot(EXIDX[e.id]) : null,
    bpFor: e => EXIDX[e.id]?.bp || null,
  })
  w.vol = workoutVolume(w)
  update(s => {
    w.entries.forEach(e => {
      const mx = Math.max(0, ...e.sets.filter(x => x.done && !isWarmupRow(x)).map(x => x.w || 0), e.topW || 0)
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
    })
    s.workouts.push(w)
    s.active = null
  })
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  // Finishing a workout is exactly what can push XP over a rank threshold, and the very next
  // screen is the one place a fresh maxPhotos matters immediately. update() above only
  // SCHEDULES the debounced sync (1500ms), so rank/perks are computed server-side from data
  // that hasn't landed yet if this reads them right away — push this workout up explicitly
  // first, then refresh. FinishSummary is already subscribed to user.perks, so it picks up the
  // new limit live once this resolves, sheet already open or not.
  useStore.getState().pushState().then(() => { useStore.getState().refreshUser(); refreshTasksNow() })
  const xp = workoutXp(w) + prs.length * PR_XP
  ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} xp={xp} close={close} />, { locked: true })
}

/* ============================ nutrition: food logging ============================ */
// The "phase 1 shell" the diary shipped with had a real S.foodDiary/S.nutritionGoals model
// but no way to actually put food into it — every add button just toasted "coming soon".
// These three sheets are that missing piece: search (Open Food Facts, proxied server-side —
// see api/server.js), a custom entry for anything not in that database, and a barcode scan
// where the browser supports one. All three end the same way: push a logged item onto
// S.foodDiary[dateIso], synced like everything else in S — `dateIso` is whatever day
// Nutrition.jsx currently has open (its own calendar picker, not necessarily today).

// Meal labels computed fresh on every call (not a module constant) so they follow a language
// switch — derived from the shared MEALS list (lib/nutrition.js) so the order here matches
// the chronological breakfast→lunch→snack→dinner order used everywhere else.
const mealOptions = () => MEALS.map(m => ({ value: m.key, label: m.name() }))

// Weight vs. units — shared by LogQuantitySheet (a searched/scanned food only ever reports
// per-100g macros, so "units" there also needs a weight-per-unit to convert through) and
// CustomFoodForm (which collects the rate directly in whichever unit you pick).
const FOOD_QTY_MODES = () => [{ value: 'weight', label: t('By weight') }, { value: 'unit', label: t('By units') }]
const FOOD_VISIBILITY = () => [{ value: 'private', label: t('Private') }, { value: 'public', label: t('Public') }]
// A food search now merges three sources (yours, the community's, Open Food Facts) — this
// filters which of them actually render, same list either way, nothing re-fetched on change.
const FOOD_SOURCES = () => [{ value: 'all', label: t('All') }, { value: 'mine', label: t('Mine') }, { value: 'community', label: t('Community') }, { value: 'off', label: t('Database') }]

function logFoodItem(dateIso, meal, item) {
  update(s => {
    const list = s.foodDiary[dateIso] || (s.foodDiary[dateIso] = [])
    list.push({ id: uid(), meal, ...item })
  })
  toast(t('Food logged'))
}

function LogQuantitySheet({ dateIso, mealKey, food, close }) {
  const [mode, setMode] = useState('weight')
  const [grams, setGrams] = useState(100)
  const [units, setUnits] = useState(1)
  // Open Food Facts only ever reports per-100g macros, never a per-unit rate — logging "3 of
  // these" still has to go through grams somewhere, so unit mode also asks the weight of one
  // unit and converts. Once saved, though, the item stores `units` (not grams) and its own
  // baked-in per-unit kcal/macros, same as a unit-mode CustomFoodForm entry — editing it
  // later (EditFoodSheet) just scales the unit count, the gram conversion doesn't resurface.
  const [unitGrams, setUnitGrams] = useState(100)
  const [meal, setMeal] = useState(mealKey)
  const [detail, setDetail] = useState(false)
  const goals = S().nutritionGoals
  const effectiveGrams = mode === 'weight' ? (grams || 0) : (units || 0) * (unitGrams || 0)
  const factor = effectiveGrams / 100
  const kcal = Math.round(food.kcal100 * factor)
  const carbs = Math.round(food.carbs100 * factor)
  const fat = Math.round(food.fat100 * factor)
  const protein = Math.round(food.protein100 * factor)
  const save = () => {
    if (mode === 'weight') {
      if (!grams || grams <= 0) { toast(t('Enter a valid amount')); return }
      logFoodItem(dateIso, meal, { name: food.name, grams, kcal, carbsG: carbs, fatG: fat, proteinG: protein })
    } else {
      if (!units || units <= 0 || !unitGrams || unitGrams <= 0) { toast(t('Enter a valid amount')); return }
      logFoodItem(dateIso, meal, { name: food.name, units, kcal, carbsG: carbs, fatG: fat, proteinG: protein })
    }
    close()
  }
  return <>
    <h3>{food.name}</h3>
    <Segmented options={FOOD_QTY_MODES()} value={mode} onChange={setMode} />
    <div style={{ height: 12 }} />
    {/* A plain NumberField has no styling of its own outside a .stp/.unit-field wrapper —
        left bare here it fell back to the browser's native (white) input chrome. */}
    {mode === 'weight'
      ? <div className="unit-field" style={{ width: 140, margin: '2px 0 14px' }}>
        <NumberField value={grams} decimal={false} onChange={setGrams} />
        <span className="dim">{t('grams')}</span>
      </div>
      : <div className="row" style={{ gap: 10, margin: '2px 0 14px' }}>
        <div className="unit-field" style={{ flex: 1 }}>
          <NumberField value={units} decimal={false} onChange={setUnits} />
          <span className="dim">{t('units')}</span>
        </div>
        <div className="unit-field" style={{ flex: 1 }}>
          <NumberField value={unitGrams} decimal={false} onChange={setUnitGrams} />
          <span className="dim">{t('g/unit')}</span>
        </div>
      </div>}
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 16 }} />
    {/* Same bar language as Nutrition.jsx's meal cards (a calorie bar + 3 macro bars against
        the day's goals) rather than the old bare "46 kcal · C 12g · G 0g · P 0g" text card —
        prior={0} since this is a single not-yet-logged item, not a cumulative meal total. */}
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="small" style={{ fontWeight: 600 }}>{t('Calories')}</span>
      <span className="small" style={{ color: 'var(--label-2)' }}>{t('{0} kcal', kcal)}</span>
    </div>
    <div style={{ marginBottom: 12 }}><StackedBar prior={0} own={kcal} goal={goals.calories} color="var(--acc)" /></div>
    <div className="row" style={{ gap: 10 }}>
      {[
        { l: t('Carbs'), v: carbs, g: goals.carbsG, c: 'var(--orange)' },
        { l: t('Fat'), v: fat, g: goals.fatG, c: 'var(--indigo)' },
        { l: t('Protein'), v: protein, g: goals.proteinG, c: 'var(--blue)' },
      ].map((m, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.l}</span>
            {detail && <span style={{ fontSize: 11, color: 'var(--label-2)' }}>{m.v}g</span>}
          </div>
          <StackedBar prior={0} own={m.v} goal={m.g} color={m.c} />
          {detail && <div className="dim small" style={{ marginTop: 4, textAlign: 'center' }}>{Math.round(m.g ? m.v / m.g * 100 : 0)}%</div>}
        </div>
      ))}
    </div>
    {detail && <>
      <div className="divider" style={{ margin: '14px 0 10px' }} />
      {/* The 4 headline macros above are only ever the ones the search/barcode result
          actually reported for — sugars, fibre, saturated fat and salt come from the same
          Open Food Facts product, when it has them (extraNutriments in api/server.js omits
          any that are genuinely missing rather than showing a fake 0). */}
      {['satFat100', 'sugars100', 'fiber100', 'salt100'].some(k => food[k] != null)
        ? <div className="list">
          {food.satFat100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Saturated fat')}</span><span className="small">{Math.round(food.satFat100 * factor * 10) / 10}g</span></div>}
          {food.sugars100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Sugars')}</span><span className="small">{Math.round(food.sugars100 * factor * 10) / 10}g</span></div>}
          {food.fiber100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Fiber')}</span><span className="small">{Math.round(food.fiber100 * factor * 10) / 10}g</span></div>}
          {food.salt100 != null && <div className="row between" style={{ padding: '7px 0' }}><span className="small dim">{t('Salt')}</span><span className="small">{Math.round(food.salt100 * factor * 10) / 10}g</span></div>}
        </div>
        : <div className="dim small">{t('No further nutrition data for this item.')}</div>}
    </>}
    <div style={{ height: 8 }} />
    <button className="small" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--label-2)', fontWeight: 600 }} onClick={() => setDetail(v => !v)}>
      {detail ? t('Show less') : t('See all nutrients')}
    </button>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Log food')}</Button>
  </>
}
export const logQuantitySheet = (dateIso, mealKey, food) => ui().openSheet(close => <LogQuantitySheet dateIso={dateIso} mealKey={mealKey} food={food} close={close} />)

// A custom food's macros are entered as a rate (per 100g, or per single unit — "manzana" is
// the same food whether you log 200g of it or 10 of them) plus a quantity in whichever unit
// the rate is in, exactly like a searched result's kcal100/grams — not a flat total for
// "whatever I ate right now". That's what lets EditFoodSheet later touch only the quantity
// and never the macros directly, the same as it already does for search/barcode results.
function CustomFoodForm({ dateIso, mealKey, close, initial, title }) {
  // A guest has no server session at all (see /api/bugs's own note on the same thing) — the
  // public-food endpoints require one, so there's no point offering a choice that can only
  // ever fail here.
  const canGoPublic = !useStore(s => s.isGuest())
  const [name, setName] = useState('')
  const [mode, setMode] = useState('weight')
  const [kcalRate, setKcalRate] = useState(initial?.kcal || 0)
  const [carbsRate, setCarbsRate] = useState(initial?.carbs || 0)
  const [fatRate, setFatRate] = useState(initial?.fat || 0)
  const [proteinRate, setProteinRate] = useState(initial?.protein || 0)
  const [qty, setQty] = useState(100)
  const [meal, setMeal] = useState(mealKey)
  // Public/private is a food-database question, not a diary one — it decides whether this
  // recipe/food becomes searchable by every other user (always anonymised, see the server
  // route) or stays exactly like today, visible only in this account's own "Mis alimentos".
  const [visibility, setVisibility] = useState('private')
  const switchMode = m => { setMode(m); setQty(m === 'weight' ? 100 : 1) }
  const factor = mode === 'weight' ? (qty || 0) / 100 : (qty || 0)
  const kcal = Math.round(kcalRate * factor)
  const carbs = Math.round(carbsRate * factor)
  const fat = Math.round(fatRate * factor)
  const protein = Math.round(proteinRate * factor)
  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!qty || qty <= 0) { toast(t('Enter a valid amount')); return }
    const item = { name: n, kcal, carbsG: carbs, fatG: fat, proteinG: protein }
    if (mode === 'weight') item.grams = qty; else item.units = qty
    logFoodItem(dateIso, meal, item)
    // Also remembered in "Mis alimentos" (Settings → Nutrition) so this exact food/mode can
    // be re-logged in a different quantity later without retyping its macros — skipped if
    // the same name+mode is already there (edited from Settings, or logged once before).
    // Kept regardless of visibility: sharing it publicly doesn't stop it being useful to
    // re-log for yourself too.
    update(s => {
      if (!s.customFoods.some(f => f.name.toLowerCase() === n.toLowerCase() && f.mode === mode)) {
        s.customFoods.push({ id: uid(), name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
      }
    })
    if (visibility === 'public') {
      createPublicFood({ name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
        .catch(() => toast(t('Saved, but sharing it publicly failed — try again from “My foods”.')))
    }
    close()
  }
  return <>
    <h3>{title || t('Create custom food')}</h3>
    {/* A scanned label's numbers came from OCR reading a photo, not a database — worth a
        beat of "double-check this before you trust it", not just quietly pre-filled. */}
    {initial && <div className="dim small" style={{ marginBottom: 12 }}>{t('Check the values read from the label before saving.')}</div>}
    <TextField autoFocus placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 12, width: '100%' }} />
    <Segmented options={FOOD_QTY_MODES()} value={mode} onChange={switchMode} />
    <div className="dim small" style={{ margin: '12px 0 6px' }}>{mode === 'weight' ? t('Per 100g') : t('Per unit')}</div>
    <div className="grid2" style={{ marginBottom: 12 }}>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Calories')}</div><NumberField value={kcalRate} decimal={false} onChange={setKcalRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Carbs')} (g)</div><NumberField value={carbsRate} onChange={setCarbsRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Fat')} (g)</div><NumberField value={fatRate} onChange={setFatRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Protein')} (g)</div><NumberField value={proteinRate} onChange={setProteinRate} /></div>
    </div>
    <div className="unit-field" style={{ width: 140, marginBottom: 12 }}>
      <NumberField value={qty} decimal={false} onChange={setQty} />
      <span className="dim">{mode === 'weight' ? t('grams') : t('units')}</span>
    </div>
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    {canGoPublic && <>
      <div className="dim small" style={{ margin: '14px 0 6px' }}>{t('Visibility')}</div>
      <Segmented options={FOOD_VISIBILITY()} value={visibility} onChange={setVisibility} />
      <div className="dim small" style={{ margin: '6px 2px 0' }}>
        {visibility === 'public' ? t('Anyone can find and use this food when searching — never with your name on it.') : t('Only you can see and use this food.')}
      </div>
    </>}
    <div style={{ height: 14 }} />
    <div className="card" style={{ textAlign: 'center', padding: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{kcal} <span className="dim small" style={{ fontWeight: 500 }}>kcal</span></div>
      <div className="dim small" style={{ marginTop: 4 }}>{carbs}g · {fat}g · {protein}g</div>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Log food')}</Button>
  </>
}
export const customFoodSheet = (dateIso, mealKey) => ui().openSheet(close => <CustomFoodForm dateIso={dateIso} mealKey={mealKey} close={close} />)

// A phone photo's pixels are almost always stored sideways or upside-down relative to how it
// looks on screen — the camera saves an EXIF orientation tag and lets the viewer rotate it,
// rather than rotating the actual pixel data. `createImageBitmap` with `imageOrientation:
// 'from-image'` is what applies that tag; skip it (or hand Tesseract the raw File directly,
// as this used to) and OCR reads perfectly real text rotated 90°, which reads as pure noise —
// the exact "everything came back 0" failure a real label photo hit that a synthetic
// already-upright test image never could have caught.
//
// Grayscale + a contrast stretch on top of that measurably helps a real, wrinkled/curved
// plastic-bag photo read better (verified against one) — cheap operations worth doing every
// time, not just a fallback for a bad shot. A sharpening pass was tried too, but a plain
// unity-sum 3x3 kernel mostly amplified JPEG noise on a real phone photo and made results
// worse, not better — dropped rather than shipped on the strength of a synthetic test alone.
//
// Downscaling looked like a reasonable idea to keep this fast, but verified against a real
// photo it was the single biggest accuracy loss in the whole pipeline: a nutrition table's
// numbers are small print to begin with, and shrinking a 4000px photo down to ~2200px pushed
// their character height below what Tesseract needs — "619 kcal" only ever read correctly at
// the phone's native resolution, and came back as "19" or "9" at every downscaled size tried.
// The cap below is a memory/time safety ceiling for unusually large phone photos, not a
// routine resize — most photos pass through it untouched.
async function preprocessLabelPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const maxEdge = 4500
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data
  let min = 255, max = 0
  const gray = new Float32Array(d.length / 4)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    gray[p] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const range = Math.max(1, max - min)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = Math.round((gray[p] - min) / range * 255)
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(imgData, 0, 0)
  return canvas
}

// A nutrition label's calories/macros, read off a photo instead of typed in — Tesseract.js
// runs the OCR entirely client-side (no image ever leaves the device, no AI/paid API — a
// plain text recognizer is all this actually needs), and lib/ocr-nutrition.js's regex
// heuristic pulls the four numbers out of whatever text comes back. Reuses CustomFoodForm
// for the actual review/save step so a bad OCR read is just a field to fix, never a dead end.
function ScanMacrosSheet({ dateIso, mealKey, close }) {
  const [phase, setPhase] = useState('capture') // capture -> processing -> review | error
  const [progress, setProgress] = useState(0)
  const [parsed, setParsed] = useState(null)
  const inputRef = useRef(null)
  const workerRef = useRef(null)

  // Closing mid-recognition (back button, backdrop tap) must not leave a worker running in
  // the background — it holds a wasm instance alive for nothing once nobody's waiting on it.
  useEffect(() => () => { workerRef.current?.terminate() }, [])

  const onFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhase('processing')
    setProgress(0)
    const passRef = { current: 0 } // 0 during the first recognize() call, 1 during the second
    try {
      const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), preprocessLabelPhoto(file)])
      const worker = await createWorker('eng+spa', 1, {
        logger: m => { if (m.status === 'recognizing text') setProgress((passRef.current + m.progress) / 2) },
      })
      workerRef.current = worker
      // Two passes, not one: PSM 11 ("sparse text") beats the single-block default badly on
      // a real photo — a phone shot of a curved package is full of non-label clutter a single
      // block forces into one false reading order — but PSM 6 occasionally catches a line 11
      // drops entirely (verified against a real photo: 11 alone missed a value 6 alone
      // caught). Concatenating both, PSM 11's text first, costs a second recognition pass but
      // never does worse than running only one — findValueNear takes the first match it
      // finds per nutrient, so 11's better reading always wins when both have one.
      await worker.setParameters({ tessedit_pageseg_mode: '11' })
      const { data: sparse } = await worker.recognize(canvas)
      passRef.current = 1
      await worker.setParameters({ tessedit_pageseg_mode: '6' })
      const { data: block } = await worker.recognize(canvas)
      await worker.terminate()
      workerRef.current = null
      setParsed(parseNutritionLabelText(sparse.text + '\n' + block.text))
      setPhase('review')
    } catch (e) {
      workerRef.current = null
      setPhase('error')
    }
  }

  if (phase === 'review' && parsed) {
    return <CustomFoodForm dateIso={dateIso} mealKey={mealKey} close={close} initial={parsed} title={t('Scan macros')} />
  }

  return <>
    <div className="row" style={{ gap: 8, marginBottom: phase === 'capture' ? 4 : 14 }}>
      <h3 style={{ margin: 0 }}>{t('Scan macros')}</h3>
      <span className="chip-pill" style={{ '--tint': 'var(--orange)', marginTop: 0 }}>{t('Experimental')}</span>
    </div>
    {phase === 'capture' && <>
      {/* Every improvement here (see lib/ocr-nutrition.js) was verified against a real,
          hard photo — but a client-side, free OCR engine reading a phone snapshot of a
          curved, glare-prone label still has a real, honest ceiling. Said upfront rather
          than only discovered after a wrong number almost got logged. */}
      <p className="dim small">{t('Take a photo of the nutrition label — calories and macros are read automatically, you just name the food. Results can be off on an angled or blurry photo, always double-check before saving.')}</p>
      <div style={{ height: 10 }} />
      <Button variant="primary" onClick={() => inputRef.current?.click()}>{t('Take photo')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </>}
    {phase === 'processing' && <>
      <div className="empty">{t('Reading label…')}</div>
      <div style={{ height: 8 }} />
      <div className="dim small" style={{ textAlign: 'center' }}>{Math.round(progress * 100)}%</div>
    </>}
    {phase === 'error' && <>
      <div className="empty">{t('Could not read that photo — try again with better light, or enter it manually.')}</div>
      <div style={{ height: 10 }} />
      <Button variant="primary" onClick={() => setPhase('capture')}>{t('Try again')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </>}
    <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFile} />
  </>
}
export const scanMacrosSheet = (dateIso, mealKey) => ui().openSheet(close => <ScanMacrosSheet dateIso={dateIso} mealKey={mealKey} close={close} />)

// Logging a quantity of an already-defined "Mis alimentos" food (FoodSearchSheet's results,
// or re-logging from Settings) — its rate is already in the right unit (per 100g for
// mode:'weight', per single unit for mode:'unit'), so unlike LogQuantitySheet's Open Food
// Facts flow there's no weight/unit toggle or gram conversion to offer, just the one
// quantity its mode already implies.
function LogCustomFoodSheet({ dateIso, mealKey, food, close }) {
  const [qty, setQty] = useState(food.mode === 'weight' ? 100 : 1)
  const [meal, setMeal] = useState(mealKey)
  const factor = food.mode === 'weight' ? (qty || 0) / 100 : (qty || 0)
  const kcal = Math.round(food.kcal * factor)
  const carbs = Math.round(food.carbs * factor)
  const fat = Math.round(food.fat * factor)
  const protein = Math.round(food.protein * factor)
  const save = () => {
    if (!qty || qty <= 0) { toast(t('Enter a valid amount')); return }
    const item = { name: food.name, kcal, carbsG: carbs, fatG: fat, proteinG: protein }
    if (food.mode === 'weight') item.grams = qty; else item.units = qty
    logFoodItem(dateIso, meal, item)
    close()
  }
  return <>
    <h3>{food.name}</h3>
    <div className="unit-field" style={{ width: 140, margin: '14px 0' }}>
      <NumberField value={qty} decimal={false} onChange={setQty} />
      <span className="dim">{food.mode === 'weight' ? t('grams') : t('units')}</span>
    </div>
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 14 }} />
    <div className="card" style={{ textAlign: 'center', padding: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{kcal} <span className="dim small" style={{ fontWeight: 500 }}>kcal</span></div>
      <div className="dim small" style={{ marginTop: 4 }}>{carbs}g · {fat}g · {protein}g</div>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Log food')}</Button>
  </>
}
export const logCustomFoodSheet = (dateIso, mealKey, food) => {
  const { user, S } = useStore.getState()
  if (lockedIds(S.customFoods, user?.pro).has(food.id)) return toast(t('This food is locked — go Pro to use it again.'))
  ui().openSheet(close => <LogCustomFoodSheet dateIso={dateIso} mealKey={mealKey} food={food} close={close} />)
}

// Creating or editing a "Mis alimentos" definition itself (Settings → Nutrition → My foods)
// — just the rate, no quantity or meal, since those only make sense at logging time.
function CustomFoodDefForm({ existing, close }) {
  const canGoPublic = !useStore(s => s.isGuest())
  const [name, setName] = useState(existing?.name || '')
  const [mode, setMode] = useState(existing?.mode || 'weight')
  const [kcalRate, setKcalRate] = useState(existing?.kcal ?? 0)
  const [carbsRate, setCarbsRate] = useState(existing?.carbs ?? 0)
  const [fatRate, setFatRate] = useState(existing?.fat ?? 0)
  const [proteinRate, setProteinRate] = useState(existing?.protein ?? 0)
  // Only offered when creating one fresh — the public copy this creates is its own row on
  // the server with no link back to this local id, so there's nothing later edits here
  // could keep in sync with it. Re-sharing a changed food means creating it again.
  const [visibility, setVisibility] = useState('private')
  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    update(s => {
      if (existing) {
        const f = s.customFoods.find(x => x.id === existing.id)
        if (f) { f.name = n; f.mode = mode; f.kcal = kcalRate; f.carbs = carbsRate; f.fat = fatRate; f.protein = proteinRate }
      } else {
        s.customFoods.push({ id: uid(), name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
      }
    })
    if (!existing && visibility === 'public') {
      createPublicFood({ name: n, mode, kcal: kcalRate, carbs: carbsRate, fat: fatRate, protein: proteinRate })
        .catch(() => toast(t('Saved, but sharing it publicly failed — try again from “My foods”.')))
    }
    toast(existing ? t('Food updated') : t('Food saved'))
    close()
  }
  const del = () => {
    update(s => { s.customFoods = s.customFoods.filter(x => x.id !== existing.id) })
    toast(t('Food removed'))
    close()
  }
  return <>
    <h3>{existing ? existing.name : t('New food')}</h3>
    <TextField autoFocus placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ margin: '14px 0 12px', width: '100%' }} />
    <Segmented options={FOOD_QTY_MODES()} value={mode} onChange={setMode} />
    <div className="dim small" style={{ margin: '12px 0 6px' }}>{mode === 'weight' ? t('Per 100g') : t('Per unit')}</div>
    <div className="grid2">
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Calories')}</div><NumberField value={kcalRate} decimal={false} onChange={setKcalRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Carbs')} (g)</div><NumberField value={carbsRate} onChange={setCarbsRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Fat')} (g)</div><NumberField value={fatRate} onChange={setFatRate} /></div>
      <div><div className="dim small" style={{ marginBottom: 4 }}>{t('Protein')} (g)</div><NumberField value={proteinRate} onChange={setProteinRate} /></div>
    </div>
    {!existing && canGoPublic && <>
      <div className="dim small" style={{ margin: '14px 0 6px' }}>{t('Visibility')}</div>
      <Segmented options={FOOD_VISIBILITY()} value={visibility} onChange={setVisibility} />
      <div className="dim small" style={{ margin: '6px 2px 0' }}>
        {visibility === 'public' ? t('Anyone can find and use this food when searching — never with your name on it.') : t('Only you can see and use this food.')}
      </div>
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save changes')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" onClick={del}>{t('Delete')}</Button></>}
  </>
}
// Free is capped at 5 custom foods (and, below, 5 saved meals) — only checked when creating a
// new one, never when editing/deleting an existing one, so going over the cap before this
// existed (or dropping back to Free later) never locks someone out of their own data.
export const customFoodDefSheet = existing => {
  if (!existing) {
    const { user, S } = useStore.getState()
    if (!user?.pro && (S.customFoods || []).length >= 5) return toast(t('Free is limited to 5 custom foods — go Pro for unlimited.'))
  }
  ui().openSheet(close => <CustomFoodDefForm existing={existing} close={close} />)
}

// "Mis comidas" — saving a meal card's current items as a reusable bundle (Nutrition.jsx's
// clipboard button) and logging one back into the diary (FoodSearchSheet's search results).
function saveMealTotals(items) {
  return { kcal: items.reduce((n, it) => n + (it.kcal || 0), 0), count: items.length }
}
function logSavedMeal(dateIso, meal, savedMeal) {
  const { user, S } = useStore.getState()
  if (lockedIds(S.savedMeals, user?.pro).has(savedMeal.id)) return toast(t('This meal is locked — go Pro to use it again.'))
  update(s => {
    const list = s.foodDiary[dateIso] || (s.foodDiary[dateIso] = [])
    savedMeal.items.forEach(it => list.push({ ...it, id: uid(), meal }))
  })
  toast(t('Meal logged'))
}
function SaveMealForm({ items, close }) {
  const [name, setName] = useState('')
  const { kcal, count } = saveMealTotals(items)
  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    update(s => { s.savedMeals.push({ id: uid(), name: n, items: items.map(({ id, meal, ...rest }) => rest) }) })
    toast(t('Meal saved'))
    close()
  }
  return <>
    <h3>{t('Save as meal')}</h3>
    <TextField autoFocus placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', margin: '14px 0 12px' }} />
    <div className="list">
      {items.map((it, i) => <div key={i} className="item"><div className="grow tt">{it.name}</div><span style={{ fontWeight: 700 }}>{it.kcal} kcal</span></div>)}
    </div>
    <div className="dim small" style={{ margin: '8px 4px 0' }}>{t('{0} items · {1} kcal', count, kcal)}</div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const saveMealSheet = items => {
  const { user, S } = useStore.getState()
  if (!user?.pro && (S.savedMeals || []).length >= 5) return toast(t('Free is limited to 5 saved meals — go Pro for unlimited.'))
  ui().openSheet(close => <SaveMealForm items={items} close={close} />)
}

// Viewing (and deleting) a saved meal from Settings → Nutrition → "My meals" — no editing its
// items here, same reasoning as a custom food's macros: that belongs to whatever created it.
function SavedMealDetailSheet({ meal, close }) {
  const del = () => {
    update(s => { s.savedMeals = s.savedMeals.filter(m => m.id !== meal.id) })
    toast(t('Meal removed'))
    close()
  }
  return <>
    <h3>{meal.name}</h3>
    <div className="list" style={{ margin: '14px 0' }}>
      {meal.items.map((it, i) => <div key={i} className="item"><div className="grow tt">{it.name}</div><span style={{ fontWeight: 700 }}>{it.kcal} kcal</span></div>)}
    </div>
    <Button variant="danger" onClick={del}>{t('Delete')}</Button>
  </>
}
export const savedMealDetailSheet = meal => ui().openSheet(close => <SavedMealDetailSheet meal={meal} close={close} />)

/* ------------------------------------------------------------ create a meal from scratch */
// Building a reusable meal (recipe) out of the food database instead of only bundling
// something already logged (SaveMealForm above) — "Lentejas con chorizo" as lentils +
// chorizo + onion + carrot, searched and summed before ever touching the diary. Ends up in
// the exact same S.savedMeals shape SaveMealForm produces, so every existing consumer
// (FoodSearchSheet's mealMatches, "My meals") already knows what to do with the result.

// A search result is either a rate (Mis alimentos / community food — per-100g or per-unit,
// already the unit its own mode implies) or a per-100g Open Food Facts hit — the two only
// differ in which fields their macros live under, so this normalises both to one shape the
// quantity step can treat identically.
function ingredientRate(pending) {
  const { kind, food } = pending
  return kind === 'rate'
    ? { name: food.name, isUnit: food.mode === 'unit', kcal: food.kcal, carbs: food.carbs, fat: food.fat, protein: food.protein }
    : { name: food.name, isUnit: false, kcal: food.kcal100, carbs: food.carbs100, fat: food.fat100, protein: food.protein100 }
}

function IngredientSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [source, setSource] = useState('all')
  const [items, setItems] = useState(null)
  const [communityItems, setCommunityItems] = useState([])
  const [busy, setBusy] = useState(false)
  const customFoods = useStore(s => s.S.customFoods)
  const pro = useStore(s => s.user?.pro)
  const lockedFoodIds = lockedIds(customFoods, pro)
  const myMatches = q.trim() ? customFoods.filter(f => f.name.toLowerCase().includes(q.trim().toLowerCase())) : []
  useEffect(() => {
    const query = q.trim()
    if (!query) { setItems(null); setCommunityItems([]); setBusy(false); return }
    setBusy(true)
    const h = setTimeout(() => {
      Promise.all([
        foodSearch(query).catch(() => { toast(t('Search unavailable — try again')); return [] }),
        publicFoodSearch(query).catch(() => []),
      ]).then(([off, community]) => { setItems(off); setCommunityItems(community) }).finally(() => setBusy(false))
    }, 350)
    return () => clearTimeout(h)
  }, [q])
  const showMine = source === 'all' || source === 'mine'
  const showCommunity = source === 'all' || source === 'community'
  const showOff = source === 'all' || source === 'off'
  const nothingFound = q.trim() && !busy && items
    && !(showMine && myMatches.length) && !(showCommunity && communityItems.length) && !(showOff && items.length)
  return <>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" autoFocus placeholder={t('Search foods…')} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div style={{ height: 10 }} />
    <Segmented options={FOOD_SOURCES()} value={source} onChange={setSource} />
    <div style={{ height: 10 }} />
    <div className="list">
      {showMine && myMatches.map(f => {
        const locked = lockedFoodIds.has(f.id)
        return <div key={f.id} className="item" style={locked ? { opacity: .5 } : undefined}
          onClick={() => locked ? toast(t('This food is locked — go Pro to use it again.')) : onPick({ kind: 'rate', food: f })}>
          <div className="thumb thumb-x"><Icon name="sparkles" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name={locked ? 'lock' : 'chevronRight'} className={locked ? undefined : 'chev'} style={locked ? { color: 'var(--label-3)' } : undefined} />
        </div>
      })}
      {showCommunity && communityItems.map(f => (
        <div key={f.id} className="item" onClick={() => onPick({ kind: 'rate', food: f })}>
          <div className="thumb thumb-x"><Icon name="globe" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
      {nothingFound
        ? <div className="empty">{t('No matches — try a different search or add it yourself.')}</div>
        : showOff && (items || []).map((food, i) => (
          <div key={food.code || i} className="item" onClick={() => onPick({ kind: 'per100', food })}>
            <div className="grow"><div className="tt">{food.name}</div><div className="ss">{t('{0} kcal / 100g', food.kcal100)}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
    </div>
  </>
}

function IngredientQtyForm({ pending, onAdd, onCancel }) {
  const rate = ingredientRate(pending)
  const [qty, setQty] = useState(rate.isUnit ? 1 : 100)
  const factor = rate.isUnit ? (qty || 0) : (qty || 0) / 100
  const kcal = Math.round(rate.kcal * factor)
  const carbs = Math.round(rate.carbs * factor)
  const fat = Math.round(rate.fat * factor)
  const protein = Math.round(rate.protein * factor)
  const add = () => {
    if (!qty || qty <= 0) { toast(t('Enter a valid amount')); return }
    const item = { name: rate.name, kcal, carbsG: carbs, fatG: fat, proteinG: protein }
    if (rate.isUnit) item.units = qty; else item.grams = qty
    onAdd(item)
  }
  return <>
    <h3>{rate.name}</h3>
    <div className="unit-field" style={{ width: 140, margin: '14px 0' }}>
      <NumberField value={qty} decimal={false} onChange={setQty} />
      <span className="dim">{rate.isUnit ? t('units') : t('grams')}</span>
    </div>
    <div className="card" style={{ textAlign: 'center', padding: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{kcal} <span className="dim small" style={{ fontWeight: 500 }}>kcal</span></div>
      <div className="dim small" style={{ marginTop: 4 }}>{carbs}g · {fat}g · {protein}g</div>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={add}>{t('Add ingredient')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}

function CreateMealSheet({ close }) {
  const [step, setStep] = useState('list') // 'list' | 'search' | 'qty'
  const [ingredients, setIngredients] = useState([])
  const [pending, setPending] = useState(null)
  const [name, setName] = useState('')

  const totals = ingredients.reduce((a, it) => ({
    kcal: a.kcal + (it.kcal || 0), carbs: a.carbs + (it.carbsG || 0), fat: a.fat + (it.fatG || 0), protein: a.protein + (it.proteinG || 0),
  }), { kcal: 0, carbs: 0, fat: 0, protein: 0 })

  const addIngredient = item => { setIngredients(list => [...list, item]); setPending(null); setStep('list') }
  const removeIngredient = i => setIngredients(list => list.filter((_, idx) => idx !== i))

  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!ingredients.length) { toast(t('Add at least one ingredient')); return }
    update(s => { s.savedMeals.push({ id: uid(), name: n, items: ingredients }) })
    toast(t('Meal saved'))
    close()
  }

  if (step === 'search') return <>
    <h3>{t('Add ingredient')}</h3>
    <IngredientSearch onPick={food => { setPending(food); setStep('qty') }} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setStep('list')}>{t('Cancel')}</Button>
  </>

  if (step === 'qty' && pending) return <IngredientQtyForm pending={pending} onAdd={addIngredient} onCancel={() => setStep('search')} />

  return <>
    <h3>{t('Create meal')}</h3>
    <TextField autoFocus placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', margin: '14px 0 12px' }} />
    {ingredients.length > 0 && <div className="list" style={{ marginBottom: 10 }}>
      {ingredients.map((it, i) => (
        <div key={i} className="item">
          <div className="grow">
            <div className="tt">{it.name}</div>
            <div className="ss">{it.grams != null ? it.grams + ' g' : t('{0} units', it.units)}</div>
          </div>
          <span style={{ fontWeight: 700, marginRight: 6 }}>{it.kcal}</span>
          <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={() => removeIngredient(i)} aria-label={t('Delete')}><Icon name="xmark" /></button>
        </div>
      ))}
    </div>}
    <Button variant="ghost" onClick={() => setStep('search')}>{t('Add ingredient')}</Button>
    {ingredients.length > 0 && <>
      <div style={{ height: 14 }} />
      <div className="card" style={{ textAlign: 'center', padding: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{totals.kcal} <span className="dim small" style={{ fontWeight: 500 }}>kcal</span></div>
        <div className="dim small" style={{ marginTop: 4 }}>{totals.carbs}g · {totals.fat}g · {totals.protein}g</div>
      </div>
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save} disabled={!ingredients.length}>{t('Save meal')}</Button>
  </>
}
export const createMealSheet = () => {
  const { user, S } = useStore.getState()
  if (!user?.pro && (S.savedMeals || []).length >= 5) return toast(t('Free is limited to 5 saved meals — go Pro for unlimited.'))
  ui().openSheet(close => <CreateMealSheet close={close} />)
}

// Editing (and deleting) an already-logged item — reached from NutritionDiary.jsx's "See
// all" list, the one place a food item renders as its own row rather than folded into a
// meal's "X and N more" summary. Quantity is the only thing that's ever editable here —
// never calories/macros directly — so an item with a `grams` or `units` quantity (a search
// result, a barcode scan, or a weight/unit custom food — see CustomFoodForm) rescales
// kcal/macros off its own current per-quantity ratio when you drag the amount. An item with
// neither (only truly old data from before quantities existed) has no ratio to scale from,
// so this only offers moving it to a different meal or deleting it.
function EditFoodSheet({ dateIso, item, close }) {
  const qtyKind = item.grams != null ? 'grams' : item.units != null ? 'units' : null
  const initialQty = qtyKind ? item[qtyKind] : null
  const ratio = qtyKind && initialQty ? { kcal: item.kcal / initialQty, carbs: item.carbsG / initialQty, fat: item.fatG / initialQty, protein: item.proteinG / initialQty } : null
  const [qty, setQty] = useState(initialQty || 100)
  const [meal, setMeal] = useState(item.meal)
  const kcal = ratio ? Math.round(ratio.kcal * qty) : item.kcal
  const carbs = ratio ? Math.round(ratio.carbs * qty) : item.carbsG
  const fat = ratio ? Math.round(ratio.fat * qty) : item.fatG
  const protein = ratio ? Math.round(ratio.protein * qty) : item.proteinG
  const save = () => {
    update(s => {
      const it = (s.foodDiary[dateIso] || []).find(x => x.id === item.id)
      if (!it) return
      it.meal = meal
      if (ratio) { it[qtyKind] = qty; it.kcal = kcal; it.carbsG = carbs; it.fatG = fat; it.proteinG = protein }
    })
    toast(t('Food updated'))
    close()
  }
  const del = () => {
    update(s => {
      s.foodDiary[dateIso] = (s.foodDiary[dateIso] || []).filter(x => x.id !== item.id)
      // Without this, a stale device merging this day back in (mergeFoodDiaryInto) can't tell
      // "deleted on purpose" apart from "never synced yet" and would resurrect it — see
      // deletedWorkoutIds in useStore.js for the same fix, first done for workouts.
      s.deletedFoodEntryIds = [...(s.deletedFoodEntryIds || []), { id: item.id, at: Date.now() }]
    })
    toast(t('Food removed'))
    close()
  }
  return <>
    <h3>{item.name}</h3>
    {ratio && <div className="unit-field" style={{ width: 140, margin: '14px 0' }}>
      <NumberField value={qty} decimal={false} onChange={setQty} />
      <span className="dim">{qtyKind === 'grams' ? t('grams') : t('units')}</span>
    </div>}
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    {ratio && <>
      <div style={{ height: 14 }} />
      <div className="card" style={{ textAlign: 'center', padding: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{kcal} <span className="dim small" style={{ fontWeight: 500 }}>kcal</span></div>
        <div className="dim small" style={{ marginTop: 4 }}>{carbs}g · {fat}g · {protein}g</div>
      </div>
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save changes')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" onClick={del}>{t('Delete')}</Button>
  </>
}
export const editFoodSheet = (dateIso, item) => ui().openSheet(close => <EditFoodSheet dateIso={dateIso} item={item} close={close} />)

// Best-effort: the native BarcodeDetector only ships in Chromium-based browsers today, so
// FoodSearchSheet below hides the "Scan barcode" row entirely rather than opening this to a
// dead camera on Safari/Firefox. `stopped` guards every async continuation (the detect loop,
// the lookup after a hit) against running past an unmount or a hit already handled.
//
// Full-bleed camera view (see the 'fullscreen' sheet kind in Modals.jsx) with a rectangular
// viewfinder in the middle — everything outside it is darkened/blurred (.scan-band) purely for
// aim, but the crop below is what actually enforces it: each tick draws only the on-screen box's
// region into an offscreen canvas (mapping it back to source-video pixel coordinates, since the
// video is object-fit:cover and its displayed size rarely matches its native resolution) and
// only THAT gets handed to the detector, so a code has to actually sit inside the box to read,
// not just be visible anywhere in the wider frame.
function BarcodeScanSheet({ dateIso, mealKey, close }) {
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('starting')
  useEffect(() => {
    let stream = null, timer = null, stopped = false
    const stop = () => { if (stream) stream.getTracks().forEach(tr => tr.stop()) }
    async function start() {
      try {
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) { stop(); return }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setStatus('scanning')
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        // A barcode doesn't need 60 scans/sec (requestAnimationFrame's rate) to read — that pace
        // just kept the main thread busy enough that taps on the close button above needed
        // several tries to land. ~7/sec (setTimeout, not rAF) reads just as fast in practice and
        // leaves the thread free between scans.
        const loop = async () => {
          if (stopped) return
          try {
            const video = videoRef.current
            const vRect = video.getBoundingClientRect()
            const bRect = boxRef.current.getBoundingClientRect()
            // object-fit:cover scales the source to fully cover the element, cropping whichever
            // axis overflows — recover that scale/offset to convert an on-screen rect into the
            // matching rect in the source video's own pixel coordinates.
            const scale = Math.max(vRect.width / video.videoWidth, vRect.height / video.videoHeight)
            const offX = (video.videoWidth * scale - vRect.width) / 2
            const offY = (video.videoHeight * scale - vRect.height) / 2
            const sx = (offX + (bRect.left - vRect.left)) / scale
            const sy = (offY + (bRect.top - vRect.top)) / scale
            const sw = bRect.width / scale, sh = bRect.height / scale
            canvas.width = sw; canvas.height = sh
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
            const codes = await detector.detect(canvas)
            if (codes.length) {
              stopped = true
              stop()
              const code = codes[0].rawValue
              const food = await foodByBarcode(code).catch(() => null)
              close()
              if (food) logQuantitySheet(dateIso, mealKey, food)
              else toast(t('Product not found — try search instead'))
              return
            }
          } catch { /* a frame with no readable code — keep scanning */ }
          timer = setTimeout(loop, 140)
        }
        timer = setTimeout(loop, 140)
      } catch (e) {
        if (!stopped) setStatus('error')
      }
    }
    start()
    return () => { stopped = true; if (timer) clearTimeout(timer); stop() }
  }, [])
  return (
    <div className="fs-view">
      <button className="iconbtn scan-close" aria-label={t('Cancel')} onPointerDown={e => { e.preventDefault(); close() }}><Icon name="xmark" /></button>
      <h3 className="scan-title">{t('Scan barcode')}</h3>
      {/* The small top-left icon button above has been unreliable on-device for reasons CSS
          inspection alone hasn't pinned down (likely the camera <video> compositing oddly on
          some mobile browsers). This is the same plain Button component used for "Cancel"
          everywhere else in the app — already proven to register taps reliably — as a large,
          unmissable, definitely-working way out regardless of what's wrong with the icon one. */}
      <Button variant="ghost" className="scan-cancel-btn" onClick={close}>{t('Cancel')}</Button>
      {status === 'error' ? (
        <div className="empty" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: '0 24px', textAlign: 'center' }}>
          {t('Could not access the camera.')}
        </div>
      ) : <>
        <video ref={videoRef} muted playsInline className="scan-video" />
        <div className="scan-mask">
          <div className="scan-band" />
          <div className="scan-mid">
            <div className="scan-band" />
            <div className="scan-box" ref={boxRef} />
            <div className="scan-band" />
          </div>
          <div className="scan-band">
            <div className="scan-hint">{t('Line up the barcode inside the box')}</div>
          </div>
        </div>
      </>}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}
// Deliberately NOT locked: a fullscreen sheet has no backdrop/swipe gesture to accidentally
// trigger a dismiss, so there's no upside to locking it — only downside, since locking also
// disables the Android back button and Escape as escape hatches (see Modals.jsx), leaving the
// small close button as the only way out. If that button is ever slow to register a tap (a busy
// main thread, a mis-tap), back/Escape still get you out instead of trapping you on camera.
export const barcodeScanSheet = (dateIso, mealKey) => ui().openSheet(close => <BarcodeScanSheet dateIso={dateIso} mealKey={mealKey} close={close} />, { kind: 'fullscreen' })

function FoodSearchSheet({ dateIso, mealKey, close }) {
  const [q, setQ] = useState('')
  const [source, setSource] = useState('all')
  const [items, setItems] = useState(null)
  const [communityItems, setCommunityItems] = useState([])
  const [busy, setBusy] = useState(false)
  // "Mis alimentos" (Settings → Nutrition) surfaces here too — reusing a food you defined
  // once (see CustomFoodForm/CustomFoodDefForm) shouldn't mean retyping its macros every time.
  const customFoods = useStore(s => s.S.customFoods)
  const savedMeals = useStore(s => s.S.savedMeals)
  const pro = useStore(s => s.user?.pro)
  const lockedFoodIds = lockedIds(customFoods, pro)
  const lockedMealIds = lockedIds(savedMeals, pro)
  const myMatches = q.trim() ? customFoods.filter(f => f.name.toLowerCase().includes(q.trim().toLowerCase())) : []
  const mealMatches = q.trim() ? savedMeals.filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase())) : []
  useEffect(() => {
    const query = q.trim()
    if (!query) { setItems(null); setCommunityItems([]); setBusy(false); return }
    setBusy(true)
    const h = setTimeout(() => {
      // Same shape as a "Mis alimentos" match (rate + mode, not per-100g like Open Food
      // Facts) — LogCustomFoodSheet already handles either source identically.
      Promise.all([
        foodSearch(query).catch(() => { toast(t('Search unavailable — try again')); return [] }),
        publicFoodSearch(query).catch(() => []),
      ]).then(([off, community]) => { setItems(off); setCommunityItems(community) }).finally(() => setBusy(false))
    }, 350)
    return () => clearTimeout(h)
  }, [q])

  const showMine = source === 'all' || source === 'mine'
  const showCommunity = source === 'all' || source === 'community'
  const showOff = source === 'all' || source === 'off'
  const nothingShown = q.trim() && !busy && items
    && !(showMine && myMatches.length) && !mealMatches.length
    && !(showCommunity && communityItems.length) && !(showOff && items.length)

  return <>
    <h3>{t('Add food')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" autoFocus placeholder={t('Search foods…')} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div style={{ height: 10 }} />
    <Segmented options={FOOD_SOURCES()} value={source} onChange={setSource} />
    <div style={{ height: 10 }} />
    <div className="list">
      {showMine && myMatches.map(f => {
        const locked = lockedFoodIds.has(f.id)
        return <div key={f.id} className="item" style={locked ? { opacity: .5 } : undefined}
          onClick={() => { if (locked) return toast(t('This food is locked — go Pro to use it again.')); close(); logCustomFoodSheet(dateIso, mealKey, f) }}>
          <div className="thumb thumb-x"><Icon name="sparkles" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name={locked ? 'lock' : 'chevronRight'} className={locked ? undefined : 'chev'} style={locked ? { color: 'var(--label-3)' } : undefined} />
        </div>
      })}
      {mealMatches.map(m => {
        const locked = lockedMealIds.has(m.id)
        return <div key={m.id} className="item" style={locked ? { opacity: .5 } : undefined}
          onClick={() => { if (locked) return toast(t('This meal is locked — go Pro to use it again.')); logSavedMeal(dateIso, mealKey, m); close() }}>
          <div className="thumb thumb-x"><Icon name="clipboard" /></div>
          <div className="grow"><div className="tt">{m.name}</div><div className="ss">{t('{0} items · {1} kcal', m.items.length, saveMealTotals(m.items).kcal)}</div></div>
          <Icon name={locked ? 'lock' : 'chevronRight'} className={locked ? undefined : 'chev'} style={locked ? { color: 'var(--label-3)' } : undefined} />
        </div>
      })}
      {/* Forvia's own community food database — anonymised by the server, so this row never
          shows or knows who submitted it, same as anyone finding a food you shared. */}
      {showCommunity && communityItems.map(f => (
        <div key={f.id} className="item" onClick={() => { close(); logCustomFoodSheet(dateIso, mealKey, f) }}>
          <div className="thumb thumb-x"><Icon name="globe" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
      {nothingShown
        ? <div className="empty">{t('No matches — try a different search or add it yourself.')}</div>
        : showOff && (items || []).map((food, i) => (
          <div key={food.code || i} className="item" onClick={() => { close(); logQuantitySheet(dateIso, mealKey, food) }}>
            <div className="grow"><div className="tt">{food.name}</div><div className="ss">{t('{0} kcal / 100g', food.kcal100)}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
    </div>
  </>
}
export const foodSearchSheet = (dateIso, mealKey) => ui().openSheet(close => <FoodSearchSheet dateIso={dateIso} mealKey={mealKey} close={close} />)

// Water isn't itemized (Nutrition.jsx's waterLog is a plain per-day ml total), so this sheet
// starts from whatever's already logged for the day (not 0 — the gauge is meant to read as
// "here's today so far", not an empty add-on tank) and presets/custom amounts build on top
// of that; save just writes the resulting total back.
// Real container sizes (not equal-ish generic steps) — water isn't weighed like food, so a
// glass/bottle you can picture is a faster way to log it than typing a number every time.
const WATER_PRESETS = [
  { ml: 150, icon: 'glassSmall' },
  { ml: 250, icon: 'glass' },
  { ml: 500, icon: 'bottleSmall' },
  { ml: 1000, icon: 'bottleLarge' },
]
function WaterLogSheet({ dateIso, close }) {
  const initial = S().waterLog[dateIso] || 0
  const [amount, setAmount] = useState(initial)
  const [editOpen, setEditOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customMl, setCustomMl] = useState(200)
  const goal = waterGoalForDate(S().nutritionGoals.waterMl || 2000, S().waterProtocol, dateIso)
  const add = ml => setAmount(a => Math.max(0, a + ml))
  const save = () => {
    if (amount !== initial) {
      update(s => { s.waterLog[dateIso] = Math.max(0, amount) })
      toast(t('Water logged'))
    }
    close()
  }
  const del = () => {
    update(s => { s.waterLog[dateIso] = 0 })
    toast(t('Water removed'))
    close()
  }
  const pct = Math.min(100, goal ? (amount / goal) * 100 : 0)
  return <>
    <h3>{t('Log how much water you drink.')}</h3>
    <div className="row" style={{ justifyContent: 'center', gap: 6, margin: '4px 0 2px' }}>
      <span className="dim small">{t('Total volume')}</span>
      <button className="iconbtn" style={{ width: 22, height: 22 }} onClick={() => setEditOpen(v => !v)} aria-label={t('Edit')}><Icon name="pencil" style={{ fontSize: 11 }} /></button>
    </div>
    {editOpen && <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
      <div className="unit-field" style={{ width: 140 }}>
        <NumberField value={amount} decimal={false} onChange={setAmount} />
        <span className="dim">ml</span>
      </div>
    </div>}
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 16px' }}>
      {/* react-liquid-gauge (d3-shape wave path + d3-ease rise/wave animation) — the water
          actually rises and ripples with the logged amount instead of a hand-rolled CSS
          fake. gradientStops={[]} skips its default d3-color gradient calc, which otherwise
          runs unconditionally and can't parse a CSS var() for waveStyle.fill. */}
      <LiquidFillGauge
        width={140} height={140}
        value={pct}
        riseAnimation
        waveAnimation={pct > 0}
        waveFrequency={2}
        waveAmplitude={pct > 0 && pct < 100 ? 1.4 : 0}
        gradientStops={[]}
        circleStyle={{ fill: 'var(--surface-2)' }}
        waveStyle={{ fill: 'var(--blue)' }}
        textStyle={{ fill: 'var(--label)' }}
        waveTextStyle={{ fill: '#fff' }}
        textRenderer={({ width: w, height: h, textSize }) => {
          const r = Math.min(w, h) / 2
          const valuePx = textSize * r * 0.4, labelPx = valuePx * 0.4
          return <tspan>
            <tspan x="0" dy="-0.2em" style={{ fontSize: valuePx, fontWeight: 800 }}>{amount}</tspan>
            <tspan x="0" dy="1.3em" style={{ fontSize: labelPx, fontWeight: 600 }}>ml</tspan>
          </tspan>
        }}
      />
    </div>
    <div className="dim small" style={{ textAlign: 'center', marginBottom: 22 }}>{t('Your daily goal: {0} ml', goal)}</div>
    <div className="row" style={{ gap: 8 }}>
      {WATER_PRESETS.map(p => (
        <button key={p.ml} style={{ textAlign: 'center', flex: 1, background: 'none', border: 'none', padding: 0 }} onClick={() => add(p.ml)}>
          <div style={{ width: 48, height: 48, margin: '0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--blue) 18%, transparent)', color: 'var(--blue)' }}>
            <Icon name={p.icon} style={{ fontSize: 24 }} />
          </div>
          <div className="small" style={{ margin: '8px 0 0' }}>{t('{0} ml', p.ml)}</div>
        </button>
      ))}
    </div>
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <button className="small" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--label-2)', fontWeight: 600 }} onClick={() => setCustomOpen(v => !v)}>{t('Custom amount')}</button>
    </div>
    {customOpen && <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 14 }}>
      <div className="unit-field" style={{ flex: 1 }}>
        <NumberField value={customMl} decimal={false} onChange={setCustomMl} />
        <span className="dim">ml</span>
      </div>
      <Button variant="tinted" onClick={() => { if (customMl > 0) add(customMl); setCustomOpen(false) }}>{t('Add')}</Button>
    </div>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {initial > 0 && <><div style={{ height: 8 }} /><Button variant="danger" onClick={del}>{t('Delete')}</Button></>}
  </>
}
export const waterLogSheet = dateIso => ui().openSheet(close => <WaterLogSheet dateIso={dateIso} close={close} />)

// Fasting goal (FastingCard's gear icon) — a handful of common protocol presets (hours
// fasting : hours eating adds to 24) plus a free-entry field for anything else.
const FASTING_PRESETS = [16, 18, 20, 23]
function FastingGoalForm({ current, close }) {
  const [hours, setHours] = useState(current)
  const save = () => {
    if (!hours || hours <= 0 || hours >= 24) { toast(t('Enter a valid amount')); return }
    update(s => { s.fasting.goalHours = hours })
    close()
  }
  return <>
    <h3>{t('Fasting goal')}</h3>
    <div className="row" style={{ gap: 8, margin: '14px 0' }}>
      {FASTING_PRESETS.map(h => (
        <button key={h} className={'chip' + (hours === h ? ' on' : '')} onClick={() => setHours(h)}>{h}:{24 - h}</button>
      ))}
    </div>
    <div className="unit-field" style={{ width: 140 }}>
      <NumberField value={hours} decimal={false} onChange={setHours} />
      <span className="dim">{t('hours')}</span>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const fastingGoalSheet = current => ui().openSheet(close => <FastingGoalForm current={current} close={close} />)

// The full diary list's (NutritionDiary.jsx) "Todos los alimentos ▾" selector — same
// small option-list idiom as everywhere else that picks one of a few named things, not a
// bespoke dropdown widget.
function MealFilterSheet({ value, onPick, close }) {
  const options = [{ key: 'all', label: t('All meals'), icon: 'list' }, ...MEALS.map(m => ({ key: m.key, label: m.name(), icon: m.icon }))]
  return <>
    <h3>{t('Show')}</h3>
    <div className="list">
      {options.map(o => (
        <div key={o.key} className={'item' + (o.key === value ? ' on' : '')} onClick={() => { close(); onPick(o.key) }}>
          <div className="thumb thumb-x"><Icon name={o.icon} /></div>
          <div className="grow tt">{o.label}</div>
          {o.key === value && <Icon name="check" style={{ color: 'var(--acc)' }} />}
        </div>
      ))}
    </div>
  </>
}
export const mealFilterSheet = (value, onPick) => ui().openSheet(close => <MealFilterSheet value={value} onPick={onPick} close={close} />)
