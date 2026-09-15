import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coachApply, coachApplyStatus } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { TextArea, Button } from '../components/ui.jsx'

const MAX_DOCUMENT_MB = 10

// Applying to become a coach is manual, not self-serve: this just files a request
// (POST /api/coach/apply) that an admin reviews (AdminCoachRequests.jsx). Approval flips
// user.coach server-side; the next refreshUser() picks it up with no re-login needed.
//
// "Document-first" layout — of the three directions sketched on the design canvas, this is
// the one the user picked: the proof-of-coaching upload leads as its own prominent card
// (it's the one genuinely gating field), the text fields follow underneath as a compact,
// icon-led list rather than three equally-weighted boxes.
export default function CoachApply() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [experience, setExperience] = useState('')
  const [certifications, setCertifications] = useState('')
  const [message, setMessage] = useState('')
  const [docName, setDocName] = useState('')
  const [docDataUrl, setDocDataUrl] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  // null = still checking; true = a pending request already exists for this account, so the
  // form is never even shown (fixes duplicate applications — the previous version let anyone
  // revisit this screen and refill the form regardless of an already-pending request).
  const [pending, setPending] = useState(user?.coach ? false : null)
  // A ref, not state: React batches setBusy(true) into the next render, which leaves a real
  // window for a fast double-tap to call submit() twice before the button's disabled attribute
  // actually lands in the DOM. This is checked and set synchronously, in the same tick as the
  // click, so a second near-simultaneous tap is blocked regardless of render timing.
  const submitting = useRef(false)

  useEffect(() => {
    if (user?.coach) return
    coachApplyStatus().then(setPending).catch(() => setPending(false))
  }, [user?.coach])

  const pickDocument = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return toast(t('PDF or a photo (JPEG/PNG) only'))
    if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) return toast(t('That file is too large — max {0} MB', MAX_DOCUMENT_MB))
    const reader = new FileReader()
    reader.onload = () => { setDocDataUrl(reader.result); setDocName(file.name) }
    reader.readAsDataURL(file)
  }

  const submit = () => {
    if (submitting.current) return
    if (!experience.trim()) return toast(t('Tell us about your coaching experience'))
    if (!docDataUrl) return toast(t('Attach a document proving you’re a trainer/coach'))
    submitting.current = true
    setBusy(true)
    coachApply(experience.trim(), certifications.trim(), message.trim(), docDataUrl)
      .then(() => setSent(true))
      .catch(e => { toast(e.message); submitting.current = false })
      .finally(() => setBusy(false))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Become a coach')}</h1></div>
    </div>

    {user?.coach ? (
      <p className="sub">{t('You are already a coach.')}</p>
    ) : pending === null ? null : (sent || pending) ? (
      <div className="sent-hero">
        <div className="ring"><Icon name="checkCircle" /></div>
        <h2>{t('Request sent')}</h2>
        <p>{t('An admin will review your application. You’ll be able to create a box once it’s approved.')}</p>

        <div className="sent-steps">
          <div className="sent-step done">
            <span className="n"><Icon name="check" /></span>
            <div><h4>{t('Sent')}</h4><p>{t('Your experience and document reached the admin team.')}</p></div>
          </div>
          <div className="sent-step">
            <span className="n">2</span>
            <div><h4>{t('Review')}</h4><p>{t('An admin checks your experience and the document you attached.')}</p></div>
          </div>
          <div className="sent-step">
            <span className="n">3</span>
            <div><h4>{t('Approval')}</h4><p>{t('Once approved, your account becomes a coach and you can create your box.')}</p></div>
          </div>
        </div>

        <Button variant="tinted" onClick={() => nav('/settings')}>{t('Back to Settings')}</Button>
      </div>
    ) : <>
      <p className="sub" style={{ marginBottom: 20 }}>
        {t('Coaches manage a box of athletes — assigning routines, reviewing progress, running a WOD of the day.')}
      </p>

      <label className="doc-hero">
        <input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={pickDocument} />
        <span className="ring">
          <span className="dot"><Icon name={docName ? 'checkCircle' : 'upload'} /></span>
        </span>
        {docName ? <>
          <h2>{docName}</h2>
          <p>{t('Tap to change')}</p>
        </> : <>
          <h2>{t('Upload your proof')}</h2>
          <p>{t('A certification, ID, or similar that shows you’re a trainer or coach.')}</p>
          <span className="pick-btn"><Icon name="plus" />{t('Choose a file')}</span>
          <div className="fmt">{t('PDF, JPEG or PNG · max {0} MB', MAX_DOCUMENT_MB)}</div>
        </>}
      </label>

      <div className="card compact-fields">
        <div className="cf-item">
          <div className="cf-head">
            <span className="lrow-i" style={{ '--tint': 'var(--teal)' }}><Icon name="dumbbell" /></span>
            <span className="cf-t">{t('Experience')}</span>
          </div>
          <TextArea className="sm" rows={2} value={experience} onChange={e => setExperience(e.target.value)} placeholder={t('How long have you been coaching, and who have you coached?')} />
        </div>
        <div className="cf-item">
          <div className="cf-head">
            <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="sparkles" /></span>
            <span className="cf-t">{t('Certifications')}</span><span className="cf-opt">{t('(optional)')}</span>
          </div>
          <TextArea className="sm" rows={1} value={certifications} onChange={e => setCertifications(e.target.value)} placeholder={t('e.g. CrossFit L1, personal training certification…')} />
        </div>
        <div className="cf-item">
          <div className="cf-head">
            <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="comment" /></span>
            <span className="cf-t">{t('Anything else?')}</span><span className="cf-opt">{t('(optional)')}</span>
          </div>
          <TextArea className="sm" rows={1} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('Tell us more…')} />
        </div>
      </div>

      <Button variant="primary" size="lg" style={{ marginTop: 16 }} onClick={submit} disabled={busy}>{t('Send request')}</Button>
    </>}
  </div>
}
