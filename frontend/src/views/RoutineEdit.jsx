import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr, isCardio } from '../lib/exercises.js'
import { t, nameFor } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, lastEntryFor, setLabel, modeOf, isBw, defaultConfig, freestyleConfig, pairAdjacent, unpairSuperset } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet, exerciseDetailSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, NumberField } from '../components/ui.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'

// One exercise's plan: same table look as the live workout (issue #64) — series/previous/
// weight/reps, no checkbox column since nothing here is "done" yet, just prepared. Every row
// is the same set repeated `e.sets` times (the routine has no per-row storage — see the scoped
// decision on issue #64), so every row's cell is bound to the same field and editing any one
// of them edits them all; the slot the checkbox used to fill instead removes that one row.
function RoutineExBlock({ e, S, onField, onAddSet, onRemoveSet, onMenu }) {
  const ex = exOr(e.id)
  const cardio = isCardio(ex.id)
  const mode = cardio ? 'cardio' : modeOf(e)
  const timed = mode === 'time'
  const bw = !cardio && isBw(e)
  const last = lastEntryFor(S, e.id)
  const prevAt = j => (last ? (last.sets[j] || last.sets[last.sets.length - 1]) : null)
  const loadCol = { f: 'weight', dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit), ghost: bw && !(e.weight > 0) }
  const repCol = { f: 'reps', dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', dec: false, hd: t('Seconds') }
      : loadCol
  const col2 = cardio ? { f: 'speed', dec: true, hd: t('Speed (km/h)') }
    : timed ? loadCol
      : repCol
  const n = Math.max(1, Math.round(e.sets) || 1)
  const cell = col => (
    <div className={'setcell ' + (col === col1 ? 'w' : 'r') + (col.ghost ? ' wghost' : '')}>
      {!col.ghost && <NumberField decimal={col.dec} value={e[col.f] ?? ''}
        onChange={v => onField(col.f, v)} className="setval" maxLength={6} />}
    </div>
  )
  return <>
    <div className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <button className="thumbbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex, { hideAddToPlan: true })}><Thumb ex={ex} /></button>
      <div className="grow" style={{ minWidth: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{nameFor(ex)}</div>
      <button className="iconbtn" style={{ flexShrink: 0 }} aria-label={t('More')} onClick={onMenu}><Icon name="dots" /></button>
    </div>
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      <div className="sethead">
        <span className="n-sp">{t('Sets')}</span>
        <span className="p-sp">{t('Previous')}</span>
        <span className={'w-sp' + (col1.ghost ? ' wghost' : '')}>{col1.hd}</span>
        <span className={'r-sp' + (col2.ghost ? ' wghost' : '')}>{col2.hd}</span>
        <span className="ck-sp" />
      </div>
      {Array.from({ length: n }).map((_, j) => {
        const prev = prevAt(j)
        return <div key={j} className="setrow">
          <div className="n-wrap"><div className="n">{j + 1}</div></div>
          <div className="prev">{prev ? setLabel(e.id, prev, last.target, { effort: false }) : '—'}</div>
          {cell(col1)}
          {cell(col2)}
          <button className="chk" aria-label={t('Remove set')} disabled={n <= 1} onClick={onRemoveSet}><Icon name="trash" /></button>
        </div>
      })}
      <div style={{ height: 8 }} />
    </div>
    <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
      <Button size="sm" variant="tinted" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
    </div>
  </>
}

// A real component (not a closure snapshot), same reasoning as Workout.jsx's ReorderSheet —
// it has to reflect its own edits live while it's still open.
function RoutineReorderSheet({ routineId }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === routineId)
  const list = r ? r.ex : []
  const move = (idx, dir) => update(s => {
    const arr = s.routines.find(x => x.id === routineId).ex
    const j = idx + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    cleanupSg(arr)
  })
  return <>
    <h3>{t('Reorder exercises')}</h3>
    <div className="list">
      {list.map((e, i) => (
        <div key={i} className="item">
          <div className="grow"><div className="tt capitalize">{nameFor(exOr(e.id))}</div></div>
          <button className="iconbtn" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><Icon name="arrowUp" /></button>
          <button className="iconbtn" disabled={i === list.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><Icon name="arrowDown" /></button>
        </div>
      ))}
    </div>
  </>
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  const pairAt = (first, second) => edit(x => x.splice(0, x.length, ...pairAdjacent(x, first, second)))
  const unpairAt = i => edit(x => x.splice(0, x.length, ...unpairSuperset(x, i)))
  const replaceExercise = (i, newEx) => edit(x => {
    const cur = x[i]
    x[i] = { id: newEx.id, sg: cur.sg, ...defaultConfig(newEx.id), sets: cur.sets }
  })

  const units = supersetUnits(r.ex)

  // The ⋮ menu on one exercise's own card — reorder/replace/pair/settings/remove, mirroring
  // the active workout's own exercise menu so the two feel like the same app.
  const openExerciseMenu = i => {
    const e = r.ex[i]
    if (!e) return
    const ex = exOr(e.id)
    const myUnit = units.find(u => u.includes(i)) || [i]
    const uIdx = units.indexOf(myUnit)
    const inSuperset = myUnit.length > 1
    const prevUnit = units[uIdx - 1], nextUnit = units[uIdx + 1]
    const prevEdge = myUnit[0], nextEdge = myUnit[myUnit.length - 1]
    const canPairPrev = prevUnit && prevUnit.length === 1
    const canPairNext = nextUnit && nextUnit.length === 1
    const addToSuperset = () => {
      if (canPairPrev && canPairNext) {
        useUI.getState().openSheet(close2 => (
          <>
            <h3>{t('Add to superset')}</h3>
            <div className="list">
              <div className="item" onClick={() => { close2(); pairAt(prevUnit[0], prevEdge) }}>
                <div className="grow"><div className="tt capitalize">{nameFor(exOr(r.ex[prevUnit[0]].id))}</div></div>
              </div>
              <div className="item" onClick={() => { close2(); pairAt(nextEdge, nextUnit[0]) }}>
                <div className="grow"><div className="tt capitalize">{nameFor(exOr(r.ex[nextUnit[0]].id))}</div></div>
              </div>
            </div>
          </>
        ))
      } else if (canPairPrev) pairAt(prevUnit[0], prevEdge)
      else pairAt(nextEdge, nextUnit[0])
    }
    const removeExercise = () => edit(x => { x.splice(i, 1); cleanupSg(x) })
    useUI.getState().openSheet(close => (
      <>
        <h3 className="capitalize">{nameFor(ex)}</h3>
        <div className="list">
          {r.ex.length > 1 && <div className="item" onClick={() => { close(); useUI.getState().openSheet(() => <RoutineReorderSheet routineId={id} />) }}>
            <span className="lrow-i"><Icon name="list" /></span>
            <div className="grow"><div className="tt">{t('Reorder exercises')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>}
          <div className="item" onClick={() => { close(); exercisePicker(newEx => replaceExercise(i, newEx)) }}>
            <span className="lrow-i"><Icon name="shuffle" /></span>
            <div className="grow"><div className="tt">{t('Replace exercise')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
          {(canPairPrev || canPairNext) && <div className="item" onClick={() => { close(); addToSuperset() }}>
            <span className="lrow-i"><Icon name="link" /></span>
            <div className="grow"><div className="tt">{t('Add to superset')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>}
          {inSuperset && <div className="item" onClick={() => { close(); unpairAt(i) }}>
            <span className="lrow-i"><Icon name="link" /></span>
            <div className="grow"><div className="tt">{t('Unpair')}</div></div>
          </div>}
          <div className="item" onClick={() => {
            close()
            exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), removeExercise, r)
          }}>
            <span className="lrow-i"><Icon name="gear" /></span>
            <div className="grow"><div className="tt">{t('Exercise settings')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
          <div className="item" onClick={() => { close(); removeExercise() }}>
            <span className="lrow-i"><Icon name="trash" /></span>
            <div className="grow"><div className="tt" style={{ color: 'var(--red)' }}>{t('Remove exercise')}</div></div>
          </div>
        </div>
      </>
    ))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    {r.ex.length ? units.map((u, ui) => {
      const ss = u.length > 1
      return <div key={u[0]} style={{ marginBottom: 18 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>{ss ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</div>
        {ss ? (
          <div className="ss-card">
            <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset')}</span>
              <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(u[0])}>{t('Unpair')}</Button>
            </div>
            {u.map((idx, k) => <div key={idx} className="ss-ex">
              {k > 0 && <div className="ss-amp">+</div>}
              <RoutineExBlock e={r.ex[idx]} S={S}
                onField={(f, v) => edit(x => { x[idx][f] = v })}
                onAddSet={() => edit(x => { x[idx].sets = (Math.round(x[idx].sets) || 1) + 1 })}
                onRemoveSet={() => edit(x => { x[idx].sets = Math.max(1, (Math.round(x[idx].sets) || 1) - 1) })}
                onMenu={() => openExerciseMenu(idx)} />
            </div>)}
          </div>
        ) : (
          <RoutineExBlock e={r.ex[u[0]]} S={S}
            onField={(f, v) => edit(x => { x[u[0]][f] = v })}
            onAddSet={() => edit(x => { x[u[0]].sets = (Math.round(x[u[0]].sets) || 1) + 1 })}
            onRemoveSet={() => edit(x => { x[u[0]].sets = Math.max(1, (Math.round(x[u[0]].sets) || 1) - 1) })}
            onMenu={() => openExerciseMenu(u[0])} />
        )}
      </div>
    }) : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div style={{ height: 4 }} />
    {/* Multi-pick, no per-exercise config sheet — same picker and the same "land with sensible
        defaults, tweak inline after" flow the active workout's own "Add exercise" uses (issue
        #64). Config carries over from the last time each one was actually trained where there
        is one, same as freestyleConfig already does for a live session. */}
    <Button variant="tinted" icon="plus" onClick={() => exercisePicker(list => {
      if (!list.length) return
      edit(x => { list.forEach(ex => { x.push({ id: ex.id, ...freestyleConfig(S, { id: ex.id, ...defaultConfig(ex.id) }) }) }) })
    }, { multi: true })}>{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {/* Every edit on this page already saves itself the instant it happens (same as the rest
        of the app) — this doesn't do anything the fields above haven't already done. It exists
        for the same reason a "Done" button does: a clear, deliberate way to say "I'm finished
        here" and head back, rather than the back-chevron in the header being the only exit. */}
    <Button variant="primary" icon="check" onClick={() => { useUI.getState().toast(t('Routine saved')); nav('/workout') }}>{t('Save routine')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
