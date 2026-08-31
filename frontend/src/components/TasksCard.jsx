import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { tasksToday } from '../lib/api.js'
import { setTasksRefresher } from '../lib/tasksWatch.js'
import Icon from './Icon.jsx'

// What a pending task still needs — shown in place of the admin's own desc until it's done,
// so "how do I finish this" is never a mystery now that there's no button to just tap.
function criteriaLabel(c) {
  if (!c) return null
  switch (c.type) {
    case 'finish_workout': return t('Finish a workout today')
    case 'sets': return t('Log {0} sets today', c.n || 1)
    case 'minutes': return t('Train for {0} minutes today', c.n || 1)
    case 'body_part': return t('Train {0} today', t(c.bp))
    default: return null
  }
}

// The admin-authored catalog for today, always fetched fresh from GET /api/tasks/today —
// never hardcoded here. Shared by Home and the Level page so both show the exact same
// live state. Done/not-done is graded server-side against real workout data (scanForTasks,
// called from PUT /api/data) — there's nothing to tap here any more; finishing a workout
// that meets a task's criteria is what completes it, via refreshTasksNow() below.
export default function TasksCard() {
  const [tasks, setTasks] = useState(null)
  const load = () => tasksToday().then(setTasks).catch(() => setTasks([]))
  useEffect(() => {
    load()
    setTasksRefresher(load)
    return () => setTasksRefresher(() => {})
  }, [])
  if (!tasks || !tasks.length) return null

  return <div className="card">
    <h2>{t("Today's tasks")}</h2>
    <div className="list">
      {tasks.map(task => (
        <div key={task.id} className="item" style={task.done ? { opacity: .55, cursor: 'default' } : { cursor: 'default' }}>
          <span className="lrow-i" style={{ background: task.done ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={task.done ? 'check' : 'dot'} />
          </span>
          <div className="grow">
            <div className="tt">{task.name}</div>
            <div className="ss">{task.done ? (task.desc || t('Done')) : (criteriaLabel(task.criteria) || task.desc)}</div>
          </div>
          <span className="tag acc">+{task.points} XP</span>
        </div>
      ))}
    </div>
  </div>
}
