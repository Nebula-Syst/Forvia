import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { EXDB, BODYPARTS, imgSrc } from '../../lib/exercises.js'
import { exerciseOverrides, adminExerciseOverrideSet } from '../../lib/api.js'
import { normalizeSearch } from '../../lib/format.js'
import { exerciseDetailSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { PillPicker } from '../../components/ui.jsx'

// Admin-only.
//
// The exercise catalogue (EXDB) is a static frontend bundle — the backend has no copy of it
// (api/server.js). What the backend DOES hold is a table of {id, lang, name} renames this page
// writes to; every client overlays them on top of the catalogue's own name at display time
// (see i18n-core.js's nameFor), ahead of translated name packs too. Clearing the field back to
// empty removes the override and reverts that exercise to its original name for that language.
//
// Renaming is per language because the catalogue itself carries two independent names per
// exercise once Spanish is loaded — the English original (ex.n) and the translated-pack name
// (names/es.js) — and "call it X" in English doesn't necessarily mean the same in Spanish.
// The language picker below the search box picks which one this page is currently editing.
const LANG_OPTIONS = [{ value: 'en', label: '🇬🇧 English' }, { value: 'es', label: '🇪🇸 Español' }]
const PAGE_SIZE = 10

// A photo grid, not a row list — with a real image per exercise and hundreds of entries,
// a flat list of text rows read as an endless scroll. The photo itself is what a scanning
// eye actually keys on, so it gets to lead; the name (still the editable bit) sits under it.
function ExCard({ ex, override, baseName, onSave }) {
  const current = override || baseName
  const [val, setVal] = useState(current)
  useEffect(() => { setVal(current) }, [current])
  const dirty = val.trim() !== current
  return <div className="excard">
    <div className="excard-media" onClick={() => exerciseDetailSheet(ex, { hideAddToPlan: true })}>
      {ex.img
        ? <img src={imgSrc(ex)} alt="" loading="lazy" decoding="async" />
        : <div className="thumb-x"><Icon name="dumbbell" /></div>}
      <span className="excard-bp">{ex.bp}</span>
    </div>
    <div className="excard-name">
      <input className="name-field capitalize" value={val} onChange={e => setVal(e.target.value)} />
      {dirty && <button className="iconbtn" onClick={() => onSave(val.trim())} aria-label={t('save')}><Icon name="check" /></button>}
      {!dirty && override && <button className="iconbtn" onClick={() => onSave('')} aria-label={t('revert to original name')}><Icon name="reset" /></button>}
    </div>
    {!dirty && override && <div className="ss capitalize" style={{ padding: '0 10px 8px' }}><span className="tag acc">{t('renamed')}</span></div>}
  </div>
}

export default function AdminExercises() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [overrides, setOverridesState] = useState(null) // flat [{id, lang, name}]
  const [esNames, setEsNames] = useState(null)
  const [esDict, setEsDict] = useState(null) // general UI strings pack — just need its body-part entries
  const [lang, setLang] = useState('en')
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { exerciseOverrides().then(list => setOverridesState(list || [])).catch(() => setOverridesState([])) }, [])
  // Loaded independently of the app's own language setting — this page can edit/filter by the
  // Spanish names without switching what language the rest of the admin UI (or the admin's own
  // app) is in. locales/es.js carries the body-part translations (see its "Exercise catalogue
  // category labels" section); names/es.js carries the per-exercise ones.
  useEffect(() => { import('../../names/es.js').then(m => setEsNames(m.default || {})).catch(() => setEsNames({})) }, [])
  useEffect(() => { import('../../locales/es.js').then(m => setEsDict(m.default || {})).catch(() => setEsDict({})) }, [])

  const baseNameOf = ex => (lang === 'es' ? (esNames && esNames[ex.id]) : null) || ex.n
  const bpLabel = b => (lang === 'es' ? (esDict && esDict[b]) : null) || b
  const bpOptions = [{ value: '', label: t('All body parts') },
    ...BODYPARTS.map(b => ({ value: b, label: bpLabel(b) }))]

  const ql = normalizeSearch(q.trim())
  const f = EXDB.filter(e => (!bp || e.bp === bp) &&
    (!ql || normalizeSearch(e.n).includes(ql) || normalizeSearch(baseNameOf(e)).includes(ql)))
  const totalPages = Math.max(1, Math.ceil(f.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages - 1)
  const pageItems = f.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE)

  const overrideMap = {}
  ;(overrides || []).forEach(o => { if (o.lang === lang) overrideMap[o.id] = o.name })
  const renamedCount = (overrides || []).filter(o => o.lang === lang).length

  const save = (id, name) => adminExerciseOverrideSet(id, lang, name)
    .then(list => { setOverridesState(list); toast(name ? t('Renamed') : t('Reverted to original name')) })
    .catch(e => toast(e.message))

  const ready = overrides !== null && esNames !== null && esDict !== null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Exercises')}</h1>
        <div className="sub">{ready ? t('{0} renamed of {1}', renamedCount, EXDB.length) : t('{0} total', EXDB.length)}</div></div>
    </div>

    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setPage(0) }} /></div>
    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      <PillPicker value={bp} options={bpOptions} onChange={v => { setBp(v); setPage(0) }} sheetTitle={t('Body part')} />
      <PillPicker value={lang} options={LANG_OPTIONS} onChange={setLang} sheetTitle={t('Editing language')} />
    </div>

    {ready && f.length > 0 && <div className="row between" style={{ marginBottom: 14 }}>
      <button className="iconbtn" disabled={curPage === 0} onClick={() => setPage(p => p - 1)} aria-label={t('Previous page')}><Icon name="chevronLeft" /></button>
      <div className="small muted">{t('Page {0} of {1}', curPage + 1, totalPages)}</div>
      <button className="iconbtn" disabled={curPage >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t('Next page')}><Icon name="chevronRight" /></button>
    </div>}

    {!ready && <div className="empty">{t('Loading…')}</div>}
    {ready && <div className="exgrid">
      {pageItems.map(e =>
        <ExCard key={e.id} ex={e} override={overrideMap[e.id]} baseName={baseNameOf(e)} onSave={name => save(e.id, name)} />)}
    </div>}
    {ready && f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
  </div>
}
