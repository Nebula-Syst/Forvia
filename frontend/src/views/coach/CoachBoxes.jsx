import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { coachBoxes, coachBoxRequests, coachSetVisibility, boxImageUrl } from '../../lib/api.js'
import { boxRequestSheet } from '../../sheets.jsx'
import { wsOn } from '../../lib/ws.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Section, Switch, NumberField, Button } from '../../components/ui.jsx'
import LocationPicker from '../../components/LocationPicker.jsx'

// Coach-only dashboard: the personal-training marketplace opt-in, the boxes a coach already
// runs (roster + WOD + leaderboard a tap away), and the requests they've filed for new ones —
// a coach no longer creates a box directly, an admin reviews each request (BoxRequestForm in
// sheets.jsx / AdminBoxRequests.jsx).
export default function CoachBoxes() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const refreshUser = useStore(s => s.refreshUser)
  const toast = useUI(s => s.toast)
  const [boxes, setBoxes] = useState(null)
  const [requests, setRequests] = useState(null)
  const [visible, setVisible] = useState(!!user?.coachVisible)
  const [rate, setRate] = useState(user?.hourlyRate ?? '')
  const [location, setLocation] = useState(user?.coachLocation ?? null)
  const [savingVis, setSavingVis] = useState(false)
  // The location cell shows the committed place as a plain value, matching the rate cell —
  // tapping it reveals the actual search/geolocate picker below, since a real picker (dropdown,
  // crosshair button) can't fit inside a compact stat-style cell the way a number can.
  const [locOpen, setLocOpen] = useState(false)

  const load = () => {
    coachBoxes().then(setBoxes).catch(e => toast(e.message))
    coachBoxRequests().then(setRequests).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    setVisible(!!user?.coachVisible); setRate(user?.hourlyRate ?? ''); setLocation(user?.coachLocation ?? null)
  }, [user?.coachVisible, user?.hourlyRate, user?.coachLocation])
  // An admin approving/dismissing a request while this page is open (api/server.js
  // POST /api/admin/box-requests/approve wsSend's 'box:reviewed') should move it out of
  // "pending" and into "Your boxes" without the coach needing to reload.
  useEffect(() => wsOn('box:reviewed', load), [])

  // toastMsg: only the visibility toggle itself gets a confirmation toast — silently saving
  // the rate or location on every edit (as the two do below) would otherwise re-show it
  // every time, which reads as if visibility changed when it didn't.
  const saveVisibility = (nextVisible, nextRate, nextLocation, toastMsg) => {
    setSavingVis(true)
    coachSetVisibility(nextVisible, nextRate === '' ? null : nextRate, nextLocation ?? null)
      .then(u => { useStore.getState().setUser(u); if (toastMsg) toast(toastMsg) })
      .catch(e => { toast(e.message); refreshUser() })
      .finally(() => setSavingVis(false))
  }

  const toggleVisible = v => {
    if (v && !rate) return toast(t('Set an hourly rate first'))
    setVisible(v)
    saveVisibility(v, rate, location, v ? t('You’re now listed in the marketplace') : t('Hidden from the marketplace'))
  }
  const commitRate = () => { if (visible) saveVisibility(visible, rate, location) }
  const changeLocation = next => { setLocation(next); saveVisibility(visible, rate, next); setLocOpen(false) }

  const pendingCount = (requests || []).filter(r => r.status === 'pending').length
  const totalAthletes = (boxes || []).reduce((sum, b) => sum + (b.members || 0), 0)
  // Cycled per box (by list position) purely for visual variety in the icon tiles — not tied
  // to any per-box property, same idea as the marketplace's coach-card avatars all sharing
  // one accent recipe.
  const TINTS = ['var(--indigo)', 'var(--purple)', 'var(--teal)', 'var(--orange)']

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Coach dashboard')}</h1></div>
    </div>

    {/* "Resumen de coach" — one hero card leads with real numbers (boxes run, athletes across
        them) before the marketplace toggle and rate, so this reads like a Home-style stat card
        rather than a settings form. Picked over the "membership card" direction on the design
        canvas. */}
    <div className="coach-hero">
      <div className="coach-hero-eyebrow">
        <span className="flat-badge" style={{ '--tint': 'var(--acc)', width: 36, height: 36, borderRadius: 11 }}><Icon name="sparkles" /></span>
        <span className="t">{t('Your coach profile')}</span>
      </div>

      <div className="coach-stats">
        <div className="coach-stat"><div className="n">{boxes?.length ?? '–'}</div><div className="l">{t('Active boxes')}</div></div>
        <div className="coach-vsep" />
        <div className="coach-stat"><div className="n">{totalAthletes}</div><div className="l">{t('Total athletes')}</div></div>
      </div>

      <div className="divider" />

      <div className="coach-toggle-row">
        <div className="t">
          <div className="n">{visible ? t('You’re listed in the marketplace') : t('Not listed yet')}</div>
          <div className="s">{visible ? t('Athletes can find and reach out to you.') : t('Set a rate and location, then switch this on.')}</div>
        </div>
        <Switch checked={visible} disabled={savingVis} onChange={toggleVisible} />
      </div>

      <div className="divider" />

      <div className="coach-cells">
        <div className="coach-cell">
          <div className="lbl"><Icon name="barbell" className="icn" style={{ color: 'var(--orange)' }} />{t('Rate')}</div>
          {/* Wrapping div, not NumberField's own onBlur prop — NumberField already defines its
              own onBlur internally (clears its draft state) and a passed-in one would replace
              it outright since the component spreads ...rest after that handler. Blur bubbles
              in React, so the wrapper hears it just the same. */}
          <div className="rate-row" onBlur={commitRate}>
            <NumberField value={rate} onChange={setRate} placeholder="0" className="val" />
            <span className="unit">€/h</span>
          </div>
        </div>
        <button type="button" className="coach-cell tap" onClick={() => setLocOpen(o => !o)}>
          <div className="lbl"><Icon name="pin" className="icn" style={{ color: 'var(--teal)' }} />{t('Location')}</div>
          <div className="val">{location?.label?.split(',')[0] || t('Not set')}</div>
        </button>
      </div>

      {locOpen && <div style={{ marginTop: 12 }}><LocationPicker value={location} onChange={changeLocation} biasFrom={location} /></div>}
    </div>

    {/* Not a <Section> — its .sect-b wrapper is its own glass card, and every box below is
        already a full card in its own right, so wrapping the list in another one just nested
        a card inside a card. Bare .sect-t label directly on the page instead, same idiom as
        CoachMarketplace.jsx's .coach-list. */}
    <div className="sect">
      <h2 className="sect-t">{t('Your boxes')}</h2>
      {!boxes ? <div className="muted small">{t('Loading…')}</div> : !boxes.length ? (
        <div className="empty"><div className="ico"><Icon name="shield" /></div>{t('No boxes yet — request one below.')}</div>
      ) : (
        <div className="box-list">
          {boxes.map((b, i) => (
            <button key={b.id} className="box-card" onClick={() => nav('/coach/box/' + b.id)} style={{ '--tint': b.colors?.[myTheme] || TINTS[i % TINTS.length] }}>
              {b.imageFile
                ? <img src={boxImageUrl(b.id)} alt="" className="thumb" />
                : <span className="thumb flat-badge"><Icon name="shield" /></span>}
              <span className="body">
                <span className="t">{b.title}</span>
                {b.location?.label && <span className="box-loc"><Icon name="pin" className="icn" />{b.location.label}</span>}
                <span className="chip-pill"><Icon name="person" className="icn" />{t('{0} athletes', b.members)}</span>
              </span>
              <Icon name="chevronRight" className="lrow-c" />
            </button>
          ))}
        </div>
      )}
    </div>

    <Section title={t('Box requests')} footer={pendingCount ? t('{0} awaiting review', pendingCount) : null}>
      {/* Once a request has a verdict (approved or dismissed) it drops off this list — an
          approved one already shows under "Your boxes" above, and a dismissed one has nothing
          left to act on, so keeping either around here is just clutter. */}
      {(() => {
        const pending = (requests || []).filter(r => r.status === 'pending')
        return !!pending.length && (
          <div className="lrow-list" style={{ marginBottom: 10 }}>
            {pending.map(r => (
              <div key={r.id} className="lrow">
                <span className="lrow-m">
                  <span className="lrow-t">{r.title}</span>
                  {r.location?.label && <span className="lrow-s">{r.location.label}</span>}
                </span>
                <span className="tag">{t('pending')}</span>
              </div>
            ))}
          </div>
        )
      })()}
      <Button variant="tinted" onClick={() => boxRequestSheet(load)}>{t('Request a box')}</Button>
    </Section>
  </div>
}
