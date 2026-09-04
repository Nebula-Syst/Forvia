import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { EXDB, imgSrc } from '../../lib/exercises.js'
import { normalizeSearch } from '../../lib/format.js'
import { exerciseDetailSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { PillPicker } from '../../components/ui.jsx'
import { adminMuscleGroups, adminMuscleGroupAddExercise, adminMuscleGroupRemoveExercise } from '../../lib/api.js'

// Admin-only. Full page instead of a sheet (was AdminMuscleGroups.jsx's "Exercises" button
// opening ExercisePickerSheet) — a group's member list plus search-to-add didn't fit a bottom
// sheet comfortably once groups got large, so this is /admin/muscle-groups/:id instead.
const LANG_OPTIONS = [{ value: 'en', label: '🇬🇧 English' }, { value: 'es', label: '🇪🇸 Español' }]
const PAGE_SIZE = 10

// Same .exgrid/.excard photo cards as AdminExercises.jsx, not .item rows — a name isn't
// editable here (that's the other page's job), so the card just carries the photo, name and
// one action: remove from this group (members), or add to it (search results).
function ExCard({ ex, name, icon, label, onAction }) {
  return <div className="excard">
    <div className="excard-media" onClick={() => exerciseDetailSheet(ex, { hideAddToPlan: true })}>
      {ex.img
        ? <img src={imgSrc(ex)} alt="" loading="lazy" decoding="async" />
        : <div className="thumb-x"><Icon name="dumbbell" /></div>}
      <span className="excard-bp">{ex.bp}</span>
    </div>
    <div className="excard-name">
      <div className="tt capitalize" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <button className="iconbtn" onClick={onAction} aria-label={label}><Icon name={icon} /></button>
    </div>
  </div>
}

export default function AdminMuscleGroupExercises() {
  const nav = useNavigate()
  const { id } = useParams()
  const toast = useUI(s => s.toast)
  const [groups, setGroups] = useState(null)
  const [esNames, setEsNames] = useState(null)
  const [lang, setLang] = useState('en')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { adminMuscleGroups().then(setGroups).catch(() => setGroups([])) }, [])
  useEffect(() => { import('../../names/es.js').then(m => setEsNames(m.default || {})).catch(() => setEsNames({})) }, [])

  const ready = groups !== null && esNames !== null
  const group = ready ? groups.find(g => g.id === id) : null

  const baseNameOf = ex => (lang === 'es' ? (esNames && esNames[ex.id]) : null) || ex.n
  const members = group ? EXDB.filter(e => group.exerciseIds.includes(e.id)) : []
  const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages - 1)
  const pageMembers = members.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE)
  const ql = normalizeSearch(q.trim())
  const results = group && ql
    ? EXDB.filter(e => !group.exerciseIds.includes(e.id) &&
        (normalizeSearch(e.n).includes(ql) || normalizeSearch(baseNameOf(e)).includes(ql))).slice(0, 40)
    : []

  const add = exId => adminMuscleGroupAddExercise(id, exId).then(setGroups).catch(e => toast(e.message))
  const remove = exId => adminMuscleGroupRemoveExercise(id, exId).then(setGroups).catch(e => toast(e.message))

  if (ready && !group) {
    return <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/admin/muscle-groups')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
        <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Group')}</h1></div>
      </div>
      <div className="empty">{t('This group no longer exists.')}</div>
    </div>
  }

  const groupName = group?.name && (group.name[lang] || group.name.en || group.name.es)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin/muscle-groups')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{groupName || t('Group')}</h1>
        <div className="sub">{ready ? (members.length === 1 ? t('{0} exercise', members.length) : t('{0} exercises', members.length)) : t('Loading…')}</div></div>
    </div>

    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      <PillPicker value={lang} options={LANG_OPTIONS} onChange={setLang} sheetTitle={t('Editing language')} />
    </div>

    {ready && members.length > 0 && <div className="row between" style={{ marginBottom: 12 }}>
      <button className="iconbtn" disabled={curPage === 0} onClick={() => setPage(p => p - 1)} aria-label={t('Previous page')}><Icon name="chevronLeft" /></button>
      <div className="small muted">{t('Page {0} of {1}', curPage + 1, totalPages)}</div>
      <button className="iconbtn" disabled={curPage >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t('Next page')}><Icon name="chevronRight" /></button>
    </div>}
    {!ready && <div className="empty">{t('Loading…')}</div>}
    {ready && members.length > 0 && <div className="exgrid">
      {pageMembers.map(e => <ExCard key={e.id} ex={e} name={baseNameOf(e)} icon="xmark" label={t('remove')} onAction={() => remove(e.id)} />)}
    </div>}
    {ready && members.length === 0 && <div className="empty">{t('No exercises yet — search below to add some.')}</div>}

    <div style={{ height: 14 }} />
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search exercises to add…')} value={q} onChange={e => setQ(e.target.value)} /></div>
    {results.length > 0 && <div className="exgrid">
      {results.map(e => <ExCard key={e.id} ex={e} name={baseNameOf(e)} icon="plus" label={t('add')} onAction={() => add(e.id)} />)}
    </div>}
    {ql && results.length === 0 && <div className="empty">{t('No match')}</div>}
  </div>
}
