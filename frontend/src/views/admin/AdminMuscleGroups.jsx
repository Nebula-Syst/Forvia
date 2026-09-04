import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { EXDB, BODYPARTS, imgSrc } from '../../lib/exercises.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, PillPicker } from '../../components/ui.jsx'
import {
  adminMuscleGroups, adminMuscleGroupCreate, adminMuscleGroupRename,
  adminMuscleGroupRemove, adminMuscleGroupSetExercises
} from '../../lib/api.js'

const cap = s => s.replace(/\b\w/g, c => c.toUpperCase())

// Admin-only.
//
// Custom groupings of exercises the catalogue itself has no concept of (e.g. "Push day",
// "Weak points") — not the built-in body-part/muscle tags (see AdminExercises.jsx for those).
// A group's name is per language, same reasoning as exercise renames; which exercises belong
// to it is not, since membership doesn't change with the viewer's language.
const LANG_OPTIONS = [{ value: 'en', label: '🇬🇧 English' }, { value: 'es', label: '🇪🇸 Español' }]

// Same .excard shell as AdminExercises.jsx's photo cards — the media area is a 2×2 mosaic
// of the group's own member photos (its "cover") since a group isn't one exercise.
function GroupCard({ group, lang, onRename, onRemove, onManage }) {
  const current = (group.name && group.name[lang]) || ''
  const [val, setVal] = useState(current)
  useEffect(() => { setVal(current) }, [current])
  const dirty = val.trim() !== current
  const count = group.exerciseIds.length
  const photos = EXDB.filter(e => group.exerciseIds.includes(e.id) && e.img).slice(0, 4)
  return <div className="excard">
    <div className="excard-media" onClick={onManage}>
      {photos.length > 0
        ? <div className="groupcard-mosaic">
            {[0, 1, 2, 3].map(i => photos[i]
              ? <img key={i} src={imgSrc(photos[i])} alt="" loading="lazy" decoding="async" />
              : <div key={i} className="groupcard-mosaic-empty" />)}
          </div>
        : <div className="thumb-x"><Icon name="target" /></div>}
      <span className="excard-bp">{count === 1 ? t('{0} exercise', count) : t('{0} exercises', count)}</span>
    </div>
    <div className="excard-name">
      <input className="name-field" placeholder={lang === 'es' ? 'Nombre en español…' : 'Name…'} value={val} onChange={e => setVal(e.target.value)} />
      {dirty && <button className="iconbtn" onClick={() => onRename(val.trim())} aria-label={t('save')}><Icon name="check" /></button>}
    </div>
    <div className="row" style={{ gap: 8, padding: '0 10px 10px' }}>
      <Button size="sm" variant="tinted" onClick={onManage} style={{ flex: 1 }}>{t('Exercises')}</Button>
      <button className="iconbtn" onClick={onRemove} aria-label={t('delete')} style={{ color: 'var(--red)' }}><Icon name="trash" /></button>
    </div>
  </div>
}

export default function AdminMuscleGroups() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [groups, setGroups] = useState(null)
  const [esDict, setEsDict] = useState(null)
  const [lang, setLang] = useState('en')
  const [newName, setNewName] = useState('')
  const [seeding, setSeeding] = useState(false)

  useEffect(() => { adminMuscleGroups().then(setGroups).catch(() => setGroups([])) }, [])
  useEffect(() => { import('../../locales/es.js').then(m => setEsDict(m.default || {})).catch(() => setEsDict({})) }, [])

  const create = () => {
    const n = newName.trim()
    if (!n) return
    adminMuscleGroupCreate(lang, n).then(list => { setGroups(list); setNewName(''); toast(t('Group created')) }).catch(e => toast(e.message))
  }
  const rename = (id, name) => adminMuscleGroupRename(id, lang, name)
    .then(list => { setGroups(list); toast(name ? t('Renamed') : t('Name cleared')) }).catch(e => toast(e.message))
  const remove = id => adminMuscleGroupRemove(id).then(list => { setGroups(list); toast(t('Group deleted')) }).catch(e => toast(e.message))

  // One-off bootstrap: one group per built-in body part, pre-filled with its exercises, as an
  // editable starting point (rename/delete/add/remove like any other group afterward — this
  // doesn't link back to the body part in any way, it's just a convenient initial copy).
  // Safe to press again later: skips any body part that already has a same-named group, so it
  // only fills in gaps (e.g. a group you deleted, or a body part added since).
  const seedFromBodyParts = async () => {
    setSeeding(true)
    try {
      let list = groups
      const existingEn = new Set(list.map(g => (g.name?.en || '').toLowerCase()))
      let created = 0
      for (const bp of BODYPARTS) {
        const enName = cap(bp)
        if (existingEn.has(enName.toLowerCase())) continue
        list = await adminMuscleGroupCreate('en', enName)
        setGroups(list)
        const group = [...list].reverse().find(g => (g.name?.en || '') === enName && !g.name?.es)
        if (!group) continue
        const esName = (esDict && esDict[bp]) || enName
        list = await adminMuscleGroupRename(group.id, 'es', esName)
        setGroups(list)
        const ids = EXDB.filter(e => e.bp === bp).map(e => e.id)
        list = await adminMuscleGroupSetExercises(group.id, ids)
        setGroups(list)
        created++
      }
      toast(created ? t('{0} groups created', created) : t('Already up to date'))
    } catch (e) { toast(e.message) } finally { setSeeding(false) }
  }
  const manage = group => nav('/admin/muscle-groups/' + group.id)

  const ready = groups !== null && esDict !== null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Muscle groups')}</h1>
        <div className="sub">{ready ? (groups.length === 1 ? t('{0} group', groups.length) : t('{0} groups', groups.length)) : '…'}</div></div>
    </div>

    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      <PillPicker value={lang} options={LANG_OPTIONS} onChange={setLang} sheetTitle={t('Editing language')} />
      <Button variant="tinted" disabled={!ready || seeding} onClick={seedFromBodyParts} style={{ flex: 1 }}>
        {seeding ? t('Seeding…') : t('Seed from body parts')}
      </Button>
    </div>

    {!ready && <div className="empty">{t('Loading…')}</div>}
    {ready && groups.length > 0 && <div className="exgrid">
      {groups.map(g => <GroupCard key={g.id} group={g} lang={lang}
        onRename={name => rename(g.id, name)} onRemove={() => remove(g.id)} onManage={() => manage(g)} />)}
    </div>}
    {ready && groups.length === 0 && <div className="empty">{t('No groups yet — create one below.')}</div>}

    <div style={{ height: 14 }} />
    <div className="card">
      <h2 style={{ margin: '0 0 10px' }}>{t('New group')}</h2>
      <div style={{ display: 'grid', gap: 6 }}>
        <input className="input" placeholder={lang === 'es' ? 'Nombre en español…' : 'Name…'} value={newName} onChange={e => setNewName(e.target.value)} />
        <Button variant="primary" size="sm" icon="plus" onClick={create}>{t('Add group')}</Button>
      </div>
    </div>
  </div>
}
