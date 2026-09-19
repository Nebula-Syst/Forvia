import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { coachBox, coachUpdateBox, boxImageUrl } from '../../lib/api.js'
import { CLASS_COLORS } from '../../lib/classDisciplines.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { THEMES } from '../settings/SettingsAppearance.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { TextField, Button, Switch } from '../../components/ui.jsx'
import LocationPicker from '../../components/LocationPicker.jsx'

const MAX_BOX_IMAGE_MB = 6

// --- hex <-> HSV, just enough math to drive the saturation/value square + hue slider below.
function hsvToHex(h, s, v) {
  s /= 100; v /= 100
  const k = n => (n + h / 60) % 6
  const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
function hexToHsv(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '')
  const [r, g, b] = m ? [1, 2, 3].map(i => parseInt(m[i], 16) / 255) : [1, 1, 1]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100]
}

// A real saturation/value square + hue slider, not the browser's own native color input —
// stays inside the app's own look instead of dropping into whatever picker UI a given browser/
// OS happens to ship. Drags update live; the hex readout below always reflects the current spot.
function HexColorPicker({ value, onChange }) {
  const [[hue, sat, val], setHsv] = useState(() => hexToHsv(value))
  const squareRef = useRef(null)
  const hueRef = useRef(null)

  const fromSquare = (clientX, clientY) => {
    const r = squareRef.current.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100
    const v = 100 - Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * 100
    setHsv([hue, s, v]); onChange(hsvToHex(hue, s, v))
  }
  const fromHue = clientX => {
    const r = hueRef.current.getBoundingClientRect()
    const h = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 360
    setHsv([h, sat, val]); onChange(hsvToHex(h, sat, val))
  }
  const dragOn = (fn) => e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    fn(e.clientX, e.clientY)
    const move = ev => fn(ev.clientX, ev.clientY)
    const up = () => { e.currentTarget.removeEventListener('pointermove', move); e.currentTarget.removeEventListener('pointerup', up) }
    e.currentTarget.addEventListener('pointermove', move)
    e.currentTarget.addEventListener('pointerup', up)
  }

  return <>
    <div ref={squareRef} className="hex-picker-square" style={{ '--hue': hue }}
      onPointerDown={dragOn((x, y) => fromSquare(x, y))}>
      <div className="hex-picker-dot" style={{ left: sat + '%', top: (100 - val) + '%' }} />
    </div>
    <div ref={hueRef} className="hex-picker-hue" onPointerDown={dragOn(x => fromHue(x))}>
      <div className="hex-picker-hue-dot" style={{ left: (hue / 360 * 100) + '%' }} />
    </div>
    <div className="hex-input" style={{ marginTop: 10 }}>{value.toUpperCase()}</div>
  </>
}

// Tap-to-reveal, same shape as the amenity "+" chip above it: tap the "custom" tile, get the
// picker above plus a green check / red cross to confirm or back out.
function ColorPickerRow({ value, onChange }) {
  const [editingHex, setEditingHex] = useState(false)
  const [draft, setDraft] = useState(value)
  const isPreset = CLASS_COLORS.includes(value)

  const openHex = () => { setDraft(isPreset ? '#0a84ff' : value); setEditingHex(true) }
  const confirmHex = () => { onChange(draft); setEditingHex(false) }

  if (editingHex) return (
    <div>
      <HexColorPicker value={draft} onChange={setDraft} />
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--green)' }} onClick={confirmHex} aria-label={t('Add')}><Icon name="check" /></button>
        <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => setEditingHex(false)} aria-label={t('Cancel')}><Icon name="xmark" /></button>
      </div>
    </div>
  )
  return (
    <div className="color-picker" style={{ marginBottom: 0 }}>
      {CLASS_COLORS.map(opt => (
        <button key={opt} type="button" className={'color-opt' + (value === opt ? ' on' : '')} style={{ background: opt }} onClick={() => onChange(opt)} aria-label={opt} />
      ))}
      <button type="button" className={'color-opt color-opt-custom' + (!isPreset ? ' on' : '')} style={{ background: !isPreset ? value : undefined }} onClick={openHex} aria-label={t('Custom color')}>
        {isPreset && <Icon name="pencil" />}
      </button>
    </div>
  )
}

// Fully inline, always-editable — no "Edit box" button, no sheet. Every card on this screen is
// a real form field; changes autosave (debounced) a moment after you stop typing, the same way
// the rest of this feature's edit sheet used to work but without ever leaving this page. A
// coach who touches nothing sees the same info any athlete would see; there's no separate
// read-only mode to fall back to since owner-only fields simply don't render for a staff viewer.
export default function CoachBoxAbout() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const boxLocMode = useStore(s => s.config)?.box_location_mode || 'search'

  const [isOwner, setIsOwner] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [imageFile, setImageFile] = useState(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState(null)
  const [hours, setHours] = useState('')
  const [phone, setPhone] = useState('')
  const [link, setLink] = useState('')
  const [amenities, setAmenities] = useState([])
  const [addingAmenity, setAddingAmenity] = useState(false)
  const [amenityDraft, setAmenityDraft] = useState('')
  // One hex per viewer theme (dark/light/prestige, or whatever THEMES lists later) — a coach
  // can pick a color that reads well against a light background and a different one for dark,
  // instead of one fixed color silently vanishing depending who's looking.
  const [colors, setColors] = useState({})
  const [colorsEnabled, setColorsEnabled] = useState(true)
  const [imageName, setImageName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [removeImage, setRemoveImage] = useState(false)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved
  const saveTimer = useRef(null)

  useEffect(() => {
    setLoaded(false)
    coachBox(boxId).then(r => {
      const b = r.box
      setIsOwner(!!r.isOwner)
      setImageFile(b.imageFile || null)
      setTitle(b.title || '')
      setDescription(b.description || '')
      setLocation(b.location || null)
      setHours(b.hours || '')
      setPhone(b.phone || '')
      setLink(b.link || '')
      setAmenities(b.amenities || [])
      setAddingAmenity(false); setAmenityDraft('')
      setColors(b.colors || {})
      setColorsEnabled(b.colorsEnabled !== false)
      setCachedBoxColors(boxId, b.colors, b.colorsEnabled)
      setImageDataUrl(''); setImageName(''); setRemoveImage(false)
      setLoaded(true)
    }).catch(e => toast(e.message))
  }, [boxId])

  const save = () => {
    const v = title.trim()
    const loc = boxLocMode === 'off' ? (location?.label?.trim() ? { label: location.label.trim() } : null) : location
    if (!v || !loc) return // required fields incomplete — wait for them before autosaving
    setSaveState('saving')
    coachUpdateBox(boxId, {
      title: v, description: description.trim(), location: loc,
      hours: hours.trim(), phone: phone.trim(), link: link.trim(),
      amenities, colors, colorsEnabled, imageDataUrl: imageDataUrl || null, removeImage,
    }).then(b => {
      setImageFile(b.imageFile || null); setImageDataUrl(''); setImageName(''); setRemoveImage(false)
      setCachedBoxColors(boxId, b.colors, b.colorsEnabled)
      setSaveState('saved')
      setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 1500)
    }).catch(e => { toast(e.message); setSaveState('idle') })
  }

  // One debounced autosave for every field — avoids a request per keystroke, and skips firing
  // on the initial load (before `loaded` flips true) so opening the screen never itself triggers
  // a save of the exact data it just fetched.
  useEffect(() => {
    if (!loaded || !isOwner) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 700)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, title, description, location, hours, phone, link, amenities, colors, colorsEnabled, imageDataUrl, removeImage])

  const pickImage = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast(t('JPEG, PNG or WebP only'))
    if (file.size > MAX_BOX_IMAGE_MB * 1024 * 1024) return toast(t('That file is too large — max {0} MB', MAX_BOX_IMAGE_MB))
    const reader = new FileReader()
    reader.onload = () => { setImageDataUrl(reader.result); setImageName(file.name); setRemoveImage(false) }
    reader.readAsDataURL(file)
  }

  const confirmAmenity = () => {
    const v = amenityDraft.trim().slice(0, 30)
    if (v) setAmenities(a => [...a, v])
    setAmenityDraft(''); setAddingAmenity(false)
  }
  const removeAmenity = i => setAmenities(a => a.filter((_, j) => j !== i))

  const myColor = loaded ? (colorsEnabled ? (colors[myTheme] || null) : null) : cachedBoxColor(boxId, myTheme)
  useBoxAccent(myColor)

  if (!loaded) return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('About this box')}</h1>
    </div>
    <div className="muted small" style={{ margin: '0 2px' }}>{t('Loading…')}</div>
  </div>

  const hasCurrentImage = imageFile && !imageDataUrl && !removeImage
  const readOnly = !isOwner

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('About this box')}</h1>
    </div>
    {isOwner && (
      <div className="muted small" style={{ textAlign: 'center', margin: '-6px 0 14px', height: 16 }}>
        {saveState === 'saving' ? t('Saving…') : saveState === 'saved' ? t('Saved') : ''}
      </div>
    )}

    <div className="card">
      {readOnly ? (
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          {myColor && <span style={{ width: 10, height: 10, borderRadius: '50%', background: myColor, flexShrink: 0 }} />}
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
        </div>
      ) : <>
        <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Title')}</div>
        <TextField value={title} onChange={e => setTitle(e.target.value)} placeholder={t('e.g. CrossFit Sevilla')} />
        <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Cover image (optional)')}</div>
        <label className="doc-upload">
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickImage} />
          {hasCurrentImage
            ? <img src={boxImageUrl(boxId)} alt="" className="ico" style={{ objectFit: 'cover' }} />
            : <span className="ico"><Icon name={imageName ? 'checkCircle' : 'upload'} /></span>}
          <div>
            <div className="t">{imageName || (hasCurrentImage ? t('Current image') : t('Upload an image'))}</div>
            <div className="s">{imageName || hasCurrentImage ? t('Tap to change') : t('JPEG, PNG or WebP')}</div>
          </div>
        </label>
        {(imageFile && !removeImage) && (
          <Button variant="ghost" size="sm" style={{ marginTop: 6 }} onClick={() => { setRemoveImage(true); setImageDataUrl(''); setImageName('') }}>{t('Remove image')}</Button>
        )}
      </>}
    </div>

    <div className="card" style={{ marginTop: 10 }}>
      <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Location')}</div>
      {readOnly ? (
        location?.label ? <div className="box-loc"><Icon name="pin" className="icn" />{location.label}</div> : <p className="muted small" style={{ margin: 0 }}>{t('No location set.')}</p>
      ) : boxLocMode === 'off' ? (
        <TextField value={location?.label || ''} onChange={e => setLocation({ label: e.target.value })} placeholder={t('e.g. a street address')} />
      ) : (
        <LocationPicker value={location} onChange={setLocation} autoDetect={false} placeholder={t('Search a street address…')} biasFrom={user?.coachLocation} precise={boxLocMode === 'precise'} />
      )}
    </div>

    <div className="card" style={{ marginTop: 10 }}>
      <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Description (optional)')}</div>
      {readOnly ? (
        description ? <p className="sub" style={{ margin: 0 }}>{description}</p> : <p className="muted small" style={{ margin: 0 }}>{t('No description yet.')}</p>
      ) : (
        <textarea className="field area sm" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('Tell us more…')} />
      )}
    </div>

    {(!readOnly || hours || phone || link) && (
      <div className="card" style={{ marginTop: 10 }}>
        {readOnly ? <>
          {hours && <div className="row" style={{ gap: 8, marginBottom: 6 }}><Icon name="clock" className="icn" />{hours}</div>}
          {phone && <div className="row" style={{ gap: 8, marginBottom: 6 }}><Icon name="phone" className="icn" />{phone}</div>}
          {link && <div className="row" style={{ gap: 8 }}><Icon name="link" className="icn" />{link}</div>}
        </> : <>
          <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Hours (optional)')}</div>
          <TextField value={hours} onChange={e => setHours(e.target.value)} placeholder={t('e.g. Mon–Fri 6–21h, Sat 9–13h')} style={{ marginBottom: 10 }} />
          <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Phone (optional)')}</div>
          <TextField value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('e.g. +34 600 000 000')} style={{ marginBottom: 10 }} />
          <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Website or Instagram (optional)')}</div>
          <TextField value={link} onChange={e => setLink(e.target.value)} placeholder={t('e.g. @yourbox or a website')} />
        </>}
      </div>
    )}

    {(!readOnly || amenities.length > 0) && (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="muted small" style={{ margin: '0 0 10px' }}>{t('Amenities (optional)')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {amenities.map((a, i) => (
            <span key={i} className="tag acc" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {a}
              {!readOnly && <button onClick={() => removeAmenity(i)} aria-label={t('remove')} style={{ display: 'flex' }}><Icon name="xmark" style={{ fontSize: 11 }} /></button>}
            </span>
          ))}
          {!readOnly && (addingAmenity ? (
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              <TextField value={amenityDraft} onChange={e => setAmenityDraft(e.target.value)} placeholder={t('e.g. Showers')} autoFocus
                style={{ width: 130, padding: '6px 10px' }}
                onKeyDown={e => { if (e.key === 'Enter') confirmAmenity(); if (e.key === 'Escape') { setAddingAmenity(false); setAmenityDraft('') } }} />
              <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--green)' }} onClick={confirmAmenity} aria-label={t('Add')}><Icon name="check" /></button>
              <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => { setAddingAmenity(false); setAmenityDraft('') }} aria-label={t('Cancel')}><Icon name="xmark" /></button>
            </span>
          ) : (
            <button className="iconbtn" onClick={() => setAddingAmenity(true)} aria-label={t('Add amenity')}><Icon name="plus" /></button>
          ))}
        </div>
      </div>
    )}

    {!readOnly && (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.012em' }}>{t('Custom box color')}</div>
            <div className="muted small" style={{ marginTop: 2 }}>{t('Off uses the regular accent color everywhere for this box.')}</div>
          </div>
          <Switch checked={colorsEnabled} onChange={setColorsEnabled} />
        </div>
        {colorsEnabled && THEMES.map(th => {
          const c = colors[th.value] || CLASS_COLORS[0]
          return (
            <div key={th.value} style={{ marginTop: 16 }}>
              <div className="muted small" style={{ margin: '0 0 8px' }}>{t(th.label)}</div>
              <ColorPickerRow value={c} onChange={v => setColors(cs => ({ ...cs, [th.value]: v }))} />
            </div>
          )
        })}
      </div>
    )}
  </div>
}
