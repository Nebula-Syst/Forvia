import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import {
  coachBox, coachBoxRoster, coachRemoveMember, coachCreateInvite, coachRevokeInvite,
  coachSetWod, boxLeaderboard,
} from '../../lib/api.js'
import { assignRoutineSheet } from '../../sheets.jsx'
import { todayISO } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField, Section, Segmented } from '../../components/ui.jsx'

const joinUrl = code => `${location.origin}${location.pathname}#/box/join/${code}`

export default function CoachBox() {
  const { boxId } = useParams()
  const SCORING = [
    { value: 'time', label: t('Time') }, { value: 'reps', label: t('Reps') },
    { value: 'weight', label: t('Weight') }, { value: 'rounds', label: t('Rounds') },
  ]
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [box, setBox] = useState(null)
  const [roster, setRoster] = useState(null)
  const [board, setBoard] = useState(null)
  const [invite, setInvite] = useState(null)
  const [wodName, setWodName] = useState('')
  const [wodDesc, setWodDesc] = useState('')
  const [scoringType, setScoringType] = useState('reps')
  const [busy, setBusy] = useState(false)

  const load = () => {
    coachBox(boxId).then(setBox).catch(e => toast(e.message))
    coachBoxRoster(boxId).then(setRoster).catch(e => toast(e.message))
    boxLeaderboard(boxId).then(r => { setBoard(r.leaderboard); if (r.wod) { setWodName(r.wod.name); setWodDesc(r.wod.description || ''); setScoringType(r.wod.scoringType) } }).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId])

  const mintInvite = () => coachCreateInvite(boxId).then(setInvite).catch(e => toast(e.message))
  const revokeInvite = () => coachRevokeInvite(boxId, invite.code).then(() => { setInvite(null); toast(t('Revoked')) }).catch(e => toast(e.message))
  const removeMember = a => coachRemoveMember(boxId, a.id).then(() => { toast(t('Removed from box')); load() }).catch(e => toast(e.message))

  const saveWod = () => {
    if (!wodName.trim()) return toast(t('Name required'))
    setBusy(true)
    coachSetWod(boxId, { date: todayISO(), name: wodName.trim(), description: wodDesc.trim(), scoringType })
      .then(() => { toast(t('WOD saved')); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  if (!box) return <div className="narrow"><div className="muted">{t('Loading…')}</div></div>

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{box.name}</h1></div>
    </div>

    <Section title={t('Invite athletes')} footer={t('Not single-use — share this link with your whole box.')}>
      {invite ? <>
        <div className="row" style={{ gap: 8 }}>
          <TextField readOnly value={joinUrl(invite.code)} style={{ flex: 1 }} />
          <Button style={{ width: 'auto' }} onClick={() => { navigator.clipboard?.writeText(joinUrl(invite.code)).catch(() => {}); toast(t('Link copied')) }}>{t('Copy')}</Button>
        </div>
        <Button variant="danger" size="sm" style={{ marginTop: 8 }} onClick={revokeInvite}>{t('Revoke')}</Button>
      </> : <Button variant="primary" onClick={mintInvite}>{t('Create invite link')}</Button>}
    </Section>

    <Section title={t('WOD of the day')}>
      <TextField placeholder={t('Name')} value={wodName} onChange={e => setWodName(e.target.value)} style={{ marginBottom: 8, width: '100%' }} />
      <textarea className="field area" rows={3} placeholder={t('Description (optional)')} value={wodDesc} onChange={e => setWodDesc(e.target.value)} style={{ marginBottom: 8, width: '100%' }} />
      <div className="muted small" style={{ margin: '6px 0' }}>{t('Scored by')}</div>
      <Segmented options={SCORING} value={scoringType} onChange={setScoringType} />
      <Button variant="primary" style={{ marginTop: 12 }} onClick={saveWod} disabled={busy}>{t('Save today’s WOD')}</Button>
    </Section>

    <Section title={t('Leaderboard — today')}>
      {!board?.length ? <div className="muted small">{t('No athletes yet.')}</div> : (
        <div className="lrow-list">
          {board.map((a, i) => (
            <div key={a.id} className="lrow">
              <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}>{i + 1}</span>
              <span className="lrow-m"><span className="lrow-t">{a.name}{a.coach ? ' · ' + t('Coach') : ''}</span></span>
              <span className="lrow-v">{a.value == null ? t('no result') : a.value}</span>
            </div>
          ))}
        </div>
      )}
    </Section>

    <Section title={t('Roster')}>
      {roster && <Button size="sm" style={{ marginBottom: 10 }} onClick={() => assignRoutineSheet(box, roster, load)}>{t('Assign a routine')}</Button>}
      {!roster?.length ? <div className="muted small">{t('No athletes yet — share the invite link above.')}</div> : (
        <div className="lrow-list">
          {roster.map(a => (
            <div key={a.id} className="lrow">
              <button className="lrow-m tap" style={{ textAlign: 'left' }} onClick={() => nav('/coach/box/' + boxId + '/athlete/' + a.id)}>
                <span className="lrow-t">{a.name}</span>
                <span className="lrow-s">{t('{0}-day streak · {1} this week', a.streakDays, a.thisWeek)}</span>
              </button>
              <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)' }} onClick={() => removeMember(a)} aria-label={t('remove')}><Icon name="xmark" /></button>
            </div>
          ))}
        </div>
      )}
    </Section>
  </div>
}
