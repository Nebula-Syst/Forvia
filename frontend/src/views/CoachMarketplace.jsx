import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { coachMarketplace } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import Avatar from '../components/Avatar.jsx'
import LocationPicker from '../components/LocationPicker.jsx'

// Browse coaches offering personal training — opt-in only (Coach dashboard's "List me in the
// marketplace" switch), independent of running a box. No hire/booking flow yet — that's a
// separate, not-yet-specified next step; this is just the listing.
//
// The location picker here is the BROWSING athlete's own search point, not saved anywhere —
// it's only ever sent along with this one request. Coaches farther than the backend's own
// radius (api/server.js MARKETPLACE_RADIUS_KM) are left out entirely rather than just sorted
// last, so nobody sees someone impractically far away unless they deliberately search a
// different place.
export default function CoachMarketplace() {
  const toast = useUI(s => s.toast)
  const [coaches, setCoaches] = useState(null)
  const [radiusKm, setRadiusKm] = useState(null)
  const [searchLoc, setSearchLoc] = useState(null)

  useEffect(() => {
    coachMarketplace(searchLoc?.lat, searchLoc?.lon)
      .then(r => { setCoaches(r.coaches); setRadiusKm(r.radiusKm) })
      .catch(e => toast(e.message))
  }, [searchLoc?.lat, searchLoc?.lon])

  return <div className="narrow">
    <div className="hdr">
      <h1 style={{ margin: 0 }}>{t('Find a coach')}</h1>
    </div>
    <p className="sub" style={{ marginBottom: 14 }}>{t('Coaches offering one-on-one personal training.')}</p>

    <LocationPicker value={searchLoc} onChange={setSearchLoc} />
    {radiusKm != null && (
      <div className="muted small" style={{ margin: '8px 2px 18px' }}>{t('Showing coaches within {0} km — search a different place to look elsewhere.', radiusKm)}</div>
    )}
    {radiusKm == null && <div style={{ height: 18 }} />}

    {!coaches ? <div className="muted">{t('Loading…')}</div> : !coaches.length ? (
      <div className="muted">{radiusKm != null ? t('No coaches within {0} km of there.', radiusKm) : t('No coaches listed yet.')}</div>
    ) : (
      <div className="coach-list">
        {coaches.map(c => (
          <div key={c.id} className="coach-card">
            <Avatar name={c.name} avatarUrl={c.avatarUrl} perks={c.perks} size={52} />
            <div className="body">
              <div className="top-row">
                <div className="name">{c.name}</div>
                {c.hourlyRate != null && <div className="rate"><span className="n">{c.hourlyRate}€</span><span className="u">{t('per hour')}</span></div>}
              </div>
              {c.bio && <div className="bio">{c.bio}</div>}
              {c.coachLocation && (
                <div className="loc">
                  <Icon name="pin" />
                  {c.coachLocation.label}
                  {c.distanceKm != null && <span> · {t('{0} km', c.distanceKm)}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
}
