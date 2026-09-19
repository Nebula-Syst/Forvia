import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { coachBox, coachBoxPlans, coachCreatePlan, coachUpdatePlan, coachDeletePlan, coachClassTypes } from '../../lib/api.js'
import { activeBoxColor } from '../../lib/format.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { confirmSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField, NumberField } from '../../components/ui.jsx'

const blankForm = { name: '', description: '', features: [], price: 0, monthlyLimit: null, classTypes: [] }

// Just the catalog: show what plans exist, create new ones, edit/delete existing ones. Assigning
// a plan to a specific member lives on the Athletes screen instead (CoachBoxAthletes.jsx) — same
// audience/job as anything else about "this athlete," not the plan catalog's own concern.
//
// The form itself is inline (not a sheet) — form on top, list below, one screen — and "what's
// included" is a chip list built the same way as a box's amenities (CoachBoxAbout.jsx), not a
// free-text textarea.
export default function CoachBoxPlans() {
  const { boxId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [box, setBox] = useState(null)
  const [plans, setPlans] = useState(null)
  const [allTypes, setAllTypes] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [featureDraft, setFeatureDraft] = useState('')
  const [addingFeature, setAddingFeature] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => {
    coachBox(boxId).then(r => { setBox(r.box); setCachedBoxColors(boxId, r.box.colors, r.box.colorsEnabled) }).catch(e => toast(e.message))
    coachBoxPlans(boxId).then(setPlans).catch(e => toast(e.message))
  }
  useEffect(() => { load(); coachClassTypes(boxId).then(setAllTypes).catch(() => setAllTypes([])) }, [boxId])

  const resetForm = () => { setEditingId(null); setForm(blankForm); setFeatureDraft(''); setAddingFeature(false) }
  const startEdit = p => {
    setEditingId(p.id)
    setForm({ name: p.name, description: p.description || '', features: p.features || [], price: p.price ?? 0, monthlyLimit: p.monthlyLimit ?? null, classTypes: p.classTypes || [] })
    setFeatureDraft(''); setAddingFeature(false)
  }

  const confirmFeature = () => {
    const v = featureDraft.trim().slice(0, 60)
    if (v) setForm(f => ({ ...f, features: [...f.features, v] }))
    setFeatureDraft(''); setAddingFeature(false)
  }
  const removeFeature = i => setForm(f => ({ ...f, features: f.features.filter((_, j) => j !== i) }))
  const toggleType = name => setForm(f => ({ ...f, classTypes: f.classTypes.includes(name) ? f.classTypes.filter(c => c !== name) : [...f.classTypes, name] }))

  const send = async () => {
    const n = form.name.trim()
    if (!n) return toast(t('Name required'))
    const fields = { name: n, description: form.description.trim(), features: form.features, price: form.price, monthlyLimit: form.monthlyLimit, classTypes: form.classTypes }
    setBusy(true)
    try {
      const req = editingId ? coachUpdatePlan(boxId, editingId, fields) : coachCreatePlan(boxId, fields)
      await req
      toast(editingId ? t('Plan updated') : t('Plan created'))
      resetForm()
      load()
    } catch (e) { toast(e.message || t('Could not save')) }
    finally { setBusy(false) }
  }

  const removePlan = p => confirmSheet({
    title: t('Delete plan?'),
    message: p.assignedCount > 0
      ? t('{0} member(s) are currently on this plan — they’ll fall back to no plan (unlimited classes).', p.assignedCount)
      : t('This can’t be undone.'),
    confirmText: t('Delete'),
    danger: true,
    onConfirm: () => coachDeletePlan(boxId, p.id).then(() => { if (editingId === p.id) resetForm(); toast(t('Removed')); load() }).catch(e => toast(e.message)),
  })

  useBoxAccent(box ? activeBoxColor(box, myTheme) : cachedBoxColor(boxId, myTheme))

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('Membership plans')}</h1>
    </div>

    {!box ? <div className="muted small" style={{ margin: '0 2px' }}>{t('Loading…')}</div> : <>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{editingId ? t('Edit plan') : t('New plan')}</h3>
          {editingId && <Button variant="ghost" size="sm" onClick={resetForm}>{t('Cancel')}</Button>}
        </div>

        <div className="muted small" style={{ margin: '0 0 6px' }}>{t('Name')}</div>
        <TextField value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('e.g. Unlimited')} />

        <div className="muted small" style={{ margin: '14px 0 6px' }}>{t('Description')}</div>
        <textarea className="field area sm" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={t('Tell members what this plan is for…')} />

        <div className="muted small" style={{ margin: '14px 0 10px' }}>{t('What’s included')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {form.features.map((feat, i) => (
            <span key={i} className="tag acc" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {feat}
              <button onClick={() => removeFeature(i)} aria-label={t('remove')} style={{ display: 'flex' }}><Icon name="xmark" style={{ fontSize: 11 }} /></button>
            </span>
          ))}
          {addingFeature ? (
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              <TextField value={featureDraft} onChange={e => setFeatureDraft(e.target.value)} placeholder={t('e.g. Unlimited classes')} autoFocus
                style={{ width: 160, padding: '6px 10px' }}
                onKeyDown={e => { if (e.key === 'Enter') confirmFeature(); if (e.key === 'Escape') { setAddingFeature(false); setFeatureDraft('') } }} />
              <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--green)' }} onClick={confirmFeature} aria-label={t('Add')}><Icon name="check" /></button>
              <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => { setAddingFeature(false); setFeatureDraft('') }} aria-label={t('Cancel')}><Icon name="xmark" /></button>
            </span>
          ) : (
            <button className="iconbtn" onClick={() => setAddingFeature(true)} aria-label={t('Add')}><Icon name="plus" /></button>
          )}
        </div>

        <div className="row" style={{ gap: 12, marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>{t('Price')}</div>
            <NumberField value={form.price} onChange={v => setForm(f => ({ ...f, price: v }))} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>{t('Classes per month')}</div>
            <NumberField value={form.monthlyLimit} onChange={v => setForm(f => ({ ...f, monthlyLimit: v }))} decimal={false} nullable placeholder={t('Unlimited')} />
          </div>
        </div>

        <div className="muted small" style={{ margin: '16px 0 6px' }}>{t('Class types')}</div>
        <div className="muted small" style={{ marginBottom: 8 }}>{t('Leave all off to allow every class type.')}</div>
        {!allTypes ? <div className="muted small">{t('Loading…')}</div> : !allTypes.length ? (
          <div className="muted small">{t('No class types yet.')}</div>
        ) : (
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {allTypes.map(ct => (
              <button key={ct.name} type="button" className={'chip' + (form.classTypes.includes(ct.name) ? ' on' : '')} onClick={() => toggleType(ct.name)}>{ct.name}</button>
            ))}
          </div>
        )}

        <Button variant="primary" style={{ marginTop: 16 }} onClick={send} disabled={busy}>{editingId ? t('Save changes') : t('Add plan')}</Button>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        {!plans?.length ? (
          <div className="empty" style={{ padding: '10px 0' }}>
            <div className="ico"><Icon name="list" /></div>
            {t('No plans yet — add one above.')}
          </div>
        ) : (
          <div className="staff-list">
            {plans.map(p => (
              <div key={p.id} className="lrow">
                <span className="lrow-m">
                  <span className="lrow-t">{p.name}</span>
                  <span className="lrow-s">{p.price} · {p.monthlyLimit == null ? t('Unlimited') : t('{0} classes/mo', p.monthlyLimit)}</span>
                </span>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7 }} onClick={() => startEdit(p)} aria-label={t('Edit')}><Icon name="pencil" /></button>
                <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--red)' }} onClick={() => removePlan(p)} aria-label={t('remove')}><Icon name="xmark" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>}
  </div>
}
