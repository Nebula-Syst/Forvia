import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { adminTasks, adminTaskAdd, adminTaskRemove } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Admin-only. Deliberately English-only — it isn't part of the translated end-user surface.
//
// The daily-task catalog that drives the XP/level system (RankBadge.jsx) — name/description/
// points are admin-authored copy, but done/not-done is graded server-side (scanForTasks,
// called from PUT /api/data) against the day's real workout data per the criteria picked
// below. There's no "users self-check these" any more — this page is the only place a
// task's criteria is set.
export default function AdminTasks() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [tasks, setTasks] = useState(null)
  const [bodyParts, setBodyParts] = useState([])
  const [todayIds, setTodayIds] = useState([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [points, setPoints] = useState('10')
  const [critType, setCritType] = useState('finish_workout')
  const [critN, setCritN] = useState('3')
  const [critBp, setCritBp] = useState('')

  const load = () => adminTasks().then(d => { setTasks(d.tasks); setBodyParts(d.bodyParts || []); setTodayIds(d.todayIds || []) }).catch(() => {})
  useEffect(() => { load() }, [])

  const add = () => {
    const n = name.trim(), p = Math.round(+points)
    if (!n || !p || p < 1) return toast('Name and a positive point value are required')
    const criteria = { type: critType }
    if (critType === 'sets' || critType === 'minutes') {
      const num = Math.round(+critN)
      if (!num || num < 1) return toast('Enter a positive number for the criteria')
      criteria.n = num
    } else if (critType === 'body_part') {
      if (!critBp) return toast('Pick a body part')
      criteria.bp = critBp
    }
    adminTaskAdd(n, desc.trim(), p, criteria)
      .then(() => { setName(''); setDesc(''); setPoints('10'); toast('Task added'); load() })
      .catch(e => toast(e.message))
  }
  const remove = id => adminTaskRemove(id).then(() => { toast('Task removed'); load() }).catch(e => toast(e.message))

  const criteriaText = c => {
    if (!c) return 'legacy — never auto-completes'
    if (c.type === 'finish_workout') return 'Finish a workout'
    if (c.type === 'sets') return c.n + '+ sets'
    if (c.type === 'minutes') return c.n + '+ min'
    if (c.type === 'body_part') return 'Train ' + c.bp
    return c.type
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Daily tasks (XP)</h1>
        <div className="sub">Auto-completed server-side when a finished workout meets the criteria. Only 3 of {(tasks || []).length} rotate in on any given day.</div></div>
    </div>

    <div className="dtable-wrap">
      <table className="dtable">
        <thead><tr><th>Task</th><th>XP</th><th>Criteria</th><th>Description</th><th></th><th></th></tr></thead>
        <tbody>
          {(tasks || []).map(t => <tr key={t.id}>
            <td>{t.name}</td>
            <td className="dim-cell">+{t.points}</td>
            <td className="dim-cell">{criteriaText(t.criteria)}</td>
            <td className="dim-cell" style={{ whiteSpace: 'normal' }}>{t.desc || '—'}</td>
            <td>{todayIds.includes(t.id) && <span className="tag acc">Today</span>}</td>
            <td><button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 13, color: 'var(--red)' }} onClick={() => remove(t.id)} aria-label="remove"><Icon name="trash" /></button></td>
          </tr>)}
        </tbody>
      </table>
      {tasks && !tasks.length && <div className="dtable-empty">No tasks yet — add one below.</div>}
    </div>

    <div style={{ height: 14 }} />
    <div className="card">
      <h2 style={{ margin: '0 0 10px' }}>Add task</h2>
      <div style={{ display: 'grid', gap: 6 }}>
        <input className="input" placeholder="Task name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input" placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
        <input className="input" type="number" min="1" max="500" placeholder="Points" value={points} onChange={e => setPoints(e.target.value)} style={{ width: 100 }} />
        <select className="input" value={critType} onChange={e => setCritType(e.target.value)}>
          <option value="finish_workout">Finish a workout</option>
          <option value="sets">Log N sets</option>
          <option value="minutes">Train N minutes</option>
          <option value="body_part">Train a body part</option>
        </select>
        {(critType === 'sets' || critType === 'minutes') &&
          <input className="input" type="number" min="1" placeholder={critType === 'sets' ? 'Sets' : 'Minutes'} value={critN} onChange={e => setCritN(e.target.value)} style={{ width: 100 }} />}
        {critType === 'body_part' &&
          <select className="input" value={critBp} onChange={e => setCritBp(e.target.value)}>
            <option value="">Pick a body part…</option>
            {(bodyParts || []).map(bp => <option key={bp} value={bp}>{bp}</option>)}
          </select>}
        <Button variant="primary" size="sm" icon="plus" onClick={add}>Add task</Button>
      </div>
    </div>
  </div>
}
