import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coachApply } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Section, TextArea, Button } from '../components/ui.jsx'

const MAX_DOCUMENT_MB = 10

// Applying to become a coach is manual, not self-serve: this just files a request
// (POST /api/coach/apply) that an admin reviews (AdminCoachRequests.jsx). Approval flips
// user.coach server-side; the next refreshUser() picks it up with no re-login needed.
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
    if (!experience.trim()) return toast(t('Tell us about your coaching experience'))
    if (!docDataUrl) return toast(t('Attach a document proving you’re a trainer/coach'))
    setBusy(true)
    coachApply(experience.trim(), certifications.trim(), message.trim(), docDataUrl)
      .then(() => setSent(true))
      .catch(e => toast(e.message))
      .finally(() => setBusy(false))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Become a coach')}</h1></div>
    </div>

    {user?.coach ? (
      <p className="sub">{t('You are already a coach.')}</p>
    ) : sent ? (
      <Section title={t('Request sent')}>
        <p className="sub">{t('An admin will review your application. You’ll be able to create a box once it’s approved.')}</p>
      </Section>
    ) : <>
      <p className="sub" style={{ marginBottom: 14 }}>
        {t('Coaches manage a box of athletes — assigning routines, reviewing progress, running a WOD of the day. Tell us a bit about your coaching background so an admin can review your request.')}
      </p>
      <Section title={t('Your application')}>
        <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Experience')}</div>
        <TextArea rows={4} value={experience} onChange={e => setExperience(e.target.value)} placeholder={t('How long have you been coaching, and who have you coached?')} />

        <div className="muted small" style={{ margin: '16px 0 6px' }}>{t('Certifications (optional)')}</div>
        <TextArea rows={2} value={certifications} onChange={e => setCertifications(e.target.value)} placeholder={t('e.g. CrossFit L1, personal training certification…')} />

        <div className="muted small" style={{ margin: '16px 0 6px' }}>{t('Anything else? (optional)')}</div>
        <TextArea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('Tell us more…')} />

        <div className="muted small" style={{ margin: '16px 0 6px' }}>{t('Proof you’re a trainer/coach')}</div>
        <label className="doc-upload">
          <input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={pickDocument} />
          <span className="ico"><Icon name={docName ? 'checkCircle' : 'upload'} /></span>
          <div>
            <div className="t">{docName || t('Upload a document')}</div>
            <div className="s">{docName ? t('Tap to change') : t('A certification, ID, or similar — PDF or photo')}</div>
          </div>
        </label>
      </Section>
      <Button variant="primary" size="lg" style={{ marginTop: 16 }} onClick={submit} disabled={busy}>{t('Send request')}</Button>
    </>}
  </div>
}
