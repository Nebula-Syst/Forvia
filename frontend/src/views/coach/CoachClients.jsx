import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { coachClients, coachClientRequests, coachClientRequestApprove, coachClientRequestDismiss, coachClientRemove } from '../../lib/api.js'
import { wsOn } from '../../lib/ws.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import { Button, SearchField, Section } from '../../components/ui.jsx'

// A coach's box-less roster: athletes hired through the marketplace (CoachMarketplace.jsx),
// never through a box. Mirrors CoachBoxAthletes.jsx's roster list (no plan tag — a direct
// client never has a plan) plus CoachBoxes.jsx's pending-requests section, except here the
// COACH approves/dismisses (no admin involved) — see api/server.js POST /api/coach/clients/
// requests/approve|dismiss. The coach, not the athlete, finalizes the relationship, specifically
// so an athlete can't just declare themselves someone's client.
export default function CoachClients() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [clients, setClients] = useState(null)
  const [requests, setRequests] = useState(null)
  const [search, setSearch] = useState('')

  const load = () => {
    coachClients().then(setClients).catch(e => toast(e.message))
    coachClientRequests().then(setRequests).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [])
  // POST /api/coach/clients/requests/approve|dismiss wsSend's these to the coach (and
  // POST /api/coach/clients/remove / /api/athlete/coaches/leave both end a relationship from
  // either side) — same live-refresh idiom as CoachBoxes.jsx's wsOn('box:reviewed', load).
  useEffect(() => wsOn('coach:client-request', load), [])
  useEffect(() => wsOn('coach:client-ended', load), [])

  const approve = r => coachClientRequestApprove(r.id).then(() => { toast(t('{0} is now your client', r.athlete.name)); load() }).catch(e => toast(e.message))
  const dismiss = r => coachClientRequestDismiss(r.id).then(() => { toast(t('Dismissed')); load() }).catch(e => toast(e.message))
  const remove = m => coachClientRemove(m.id).then(() => { toast(t('{0} removed', m.name)); load() }).catch(e => toast(e.message))

  const q = search.trim().toLowerCase()
  const filtered = !clients ? null : !q ? clients : clients.filter(m =>
    m.name.toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q))
  const active7d = clients?.filter(m => m.thisWeek > 0).length ?? 0

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('Clients')}</h1>
    </div>

    <Section title={t('Requests')} footer={requests?.length ? t('{0} awaiting review', requests.length) : null}>
      {!requests?.length ? (
        <div className="muted small">{t('No pending requests.')}</div>
      ) : (
        <div className="lrow-list">
          {requests.map(r => (
            <div key={r.id} className="lrow">
              <Avatar name={r.athlete.name} avatarUrl={r.athlete.avatarUrl} size={34} />
              <span className="lrow-m">
                <span className="lrow-t">{r.athlete.name}</span>
                <span className="lrow-s">@{r.athlete.username}</span>
              </span>
              <Button size="sm" variant="primary" onClick={() => approve(r)}>{t('Approve')}</Button>
              <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13, color: 'var(--red)', marginLeft: 4 }} onClick={() => dismiss(r)} aria-label={t('dismiss')}><Icon name="xmark" /></button>
            </div>
          ))}
        </div>
      )}
    </Section>

    {!clients ? <div className="muted small">{t('Loading…')}</div> : !clients.length ? (
      <div className="empty"><div className="ico"><Icon name="person" /></div>{t('No clients yet — approve a request above, or wait for one from the marketplace.')}</div>
    ) : <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="coach-stats">
          <div className="coach-stat"><div className="n">{clients.length}</div><div className="l">{t('Clients')}</div></div>
          <div className="coach-vsep" />
          <div className="coach-stat"><div className="n">{active7d}</div><div className="l">{t('Active 7d')}</div></div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <SearchField value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder={t('Search client…')} />
      </div>

      {!filtered.length ? (
        <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No matches.')}</div>
      ) : (
        <div className="staff-list">
          {filtered.map(m => (
            <div key={m.id} className="lrow">
              <button style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => nav('/coach/athlete/' + m.id)}>
                <Avatar name={m.name} avatarUrl={m.avatarUrl} size={34} />
                <span className="lrow-m">
                  <span className="lrow-t"><span className={'roster-dot' + (m.thisWeek > 0 ? ' on' : '')} />{m.name}</span>
                  <span className="lrow-s">@{m.username}{m.streakDays > 0 ? ` · ${t('{0} day streak', m.streakDays)}` : ''}</span>
                </span>
              </button>
              <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(m)} aria-label={t('Remove')}><Icon name="xmark" /></button>
            </div>
          ))}
        </div>
      )}
    </>}
  </div>
}
