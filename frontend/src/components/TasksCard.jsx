import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { tasksToday, completeTask } from '../lib/api.js'
import Icon from './Icon.jsx'

// The admin-authored catalog for today, always fetched fresh from GET /api/tasks/today —
// never hardcoded here. Shared by Home and the Level page so both show the exact same
// live state; completing one anywhere updates rank XP server-side immediately.
export default function TasksCard() {
  const [tasks, setTasks] = useState(null)
  const toast = useUI(s => s.toast)
  const load = () => tasksToday().then(setTasks).catch(() => setTasks([]))
  useEffect(() => { load() }, [])
  if (!tasks || !tasks.length) return null

  const check = async task => {
    setTasks(list => list.map(x => x.id === task.id ? { ...x, done: true } : x))
    try { await completeTask(task.id) }
    catch (e) { toast(e.message || t('Could not save')); setTasks(list => list.map(x => x.id === task.id ? { ...x, done: false } : x)) }
  }

  return <div className="card">
    <h2>{t("Today's tasks")}</h2>
    <div className="list">
      {tasks.map(task => (
        <div key={task.id} className="item" style={task.done ? { opacity: .55, cursor: 'default' } : undefined}
          onClick={() => !task.done && check(task)}>
          <span className="lrow-i" style={{ background: task.done ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={task.done ? 'check' : 'dot'} />
          </span>
          <div className="grow"><div className="tt">{task.name}</div>{task.desc && <div className="ss">{task.desc}</div>}</div>
          <span className="tag acc">+{task.points} XP</span>
        </div>
      ))}
    </div>
  </div>
}
