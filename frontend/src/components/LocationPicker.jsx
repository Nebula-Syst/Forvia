import { useEffect, useRef, useState } from 'react'
import { geoSearch, geoReverse } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// A location the user can never freehand-type into existence: typing only ever searches real
// geocoded places (Komoot Photon, proxied through api/server.js's GET /api/geo/*, which
// indexes street/house-level addresses too — not just cities), and `value` only ever changes
// when one of those real results — or a reverse-geocoded GPS fix — is picked.
//
// autoDetect (default true): silently try GPS once on mount if there's no value yet — right
// for "where are YOU" (a coach's own marketplace location, an athlete's search origin), wrong
// for "where is this PLACE" (a box's street address): the person filing the request usually
// isn't standing at the box while filling out the form, so autofiring the OS permission prompt
// there just fires it for no reason — every open of that sheet re-mounts a fresh
// LocationPicker, so on Android that's a repeated permission dialog, which is what read as the
// reported "black screen flashes". False also hides the crosshair button entirely.
// biasFrom ({lat,lon}, optional): ranks search results near this point first. Photon otherwise
// ranks purely by global place "importance", which buries an ordinary street in a small town
// under unrelated same-named places anywhere on earth — confirmed by hand, a real house
// address search found nothing usable without this. Pass the best already-known point for
// where the result probably is (a coach's own saved location for a box address, say).
//
// precise (default false): also queries Google's Geocoding API server-side, when the instance
// has GOOGLE_MAPS_API_KEY configured — Photon/OSM has real, unfixable gaps for exact house
// numbers on ordinary residential streets (confirmed: an address Google Maps resolves fine can
// come back with nothing from Photon because OSM never had that house mapped). That's a paid,
// metered call, so only pass this for an actual street-address field (a box's location) — never
// for "what city are you generally in" (a coach's own marketplace location), which Photon alone
// already answers fine and for free. A no-op with no visible difference when no key is set.
export default function LocationPicker({ value, onChange, autoDetect = true, placeholder, biasFrom, precise = false }) {
  const [query, setQuery] = useState(value?.label || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)
  const boxRef = useRef(null)
  const triedAutoRef = useRef(false)

  useEffect(() => { setQuery(value?.label || '') }, [value?.label])

  const detect = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        geoReverse(pos.coords.latitude, pos.coords.longitude)
          .then(place => { onChange(place); setOpen(false) })
          .catch(() => {})
          .finally(() => setLocating(false))
      },
      () => setLocating(false),
      { timeout: 8000 },
    )
  }

  // Try once, silently, if this coach has never set a location — "intenta que sea
  // automático" — but never re-prompt on every render, and never overwrite a value they
  // already picked (including one they've since cleared on purpose).
  useEffect(() => {
    if (!autoDetect || triedAutoRef.current || value) return
    triedAutoRef.current = true
    detect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!open || query.trim().length < 2 || query === value?.label) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      geoSearch(query.trim(), biasFrom, precise).then(setResults).catch(() => setResults([])).finally(() => setSearching(false))
    }, 400)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, value?.label, biasFrom?.lat, biasFrom?.lon])

  useEffect(() => {
    const onDocClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = place => { onChange(place); setQuery(place.label); setOpen(false) }

  return (
    <div className="loc-picker" ref={boxRef}>
      <div className="loc-field">
        <Icon name="pin" />
        <input
          className="loc-input"
          value={query}
          placeholder={placeholder || t('Search a city…')}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(null) }}
        />
        {autoDetect && (
          <button type="button" className="loc-detect" onClick={detect} disabled={locating} aria-label={t('Use my current location')}>
            <Icon name="crosshair" className={locating ? 'spin' : ''} />
          </button>
        )}
      </div>
      {open && (query.trim().length >= 2) && (
        <div className="loc-drop">
          {searching ? (
            <div className="loc-empty">{t('Loading…')}</div>
          ) : results.length ? results.map((p, i) => (
            <button type="button" key={i} className="loc-opt" onClick={() => pick(p)}>
              <Icon name="pin" />
              <span>{p.label}</span>
            </button>
          )) : (
            <div className="loc-empty">{t('No matches')}</div>
          )}
        </div>
      )}
    </div>
  )
}
