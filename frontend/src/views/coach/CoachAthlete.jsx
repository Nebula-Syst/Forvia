import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { coachAthleteWorkouts } from '../../lib/api.js'
import { fmtDate, fmtVol } from '../../lib/format.js'
import { EXIDX } from '../../lib/exercises.js'
import { t, nameFor } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'

const nameOfEntry = e => { const ex = EXIDX[e.id]; return ex ? nameFor(ex) : (e.target?.id || e.id) }

// A coach's view of one athlete's actual training — deliberately richer than the social feed
// (which strips weight/reps even for public profiles): real per-set numbers, because giving
// useful feedback needs them. GET /api/coach/athlete/workouts already gates this on an active
// box membership, re-checked fresh every request.
export default function CoachAthlete() {
  const { athleteId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [workouts, setWorkouts] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    coachAthleteWorkouts(athleteId).then(setWorkouts).catch(e => toast(e.message))
  }, [athleteId])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Athlete progress')}</h1>
        <div className="sub">{t('Last 90 days')}</div></div>
    </div>

    {!workouts ? <div className="muted">{t('Loading…')}</div> : !workouts.length ? (
      <div className="muted">{t('No workouts in this window.')}</div>
    ) : (
      <div className="lrow-list">
        {workouts.map(w => (
          <div key={w.id}>
            <button className="lrow tap" onClick={() => setOpen(open === w.id ? null : w.id)}>
              <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="dumbbell" /></span>
              <span className="lrow-m">
                <span className="lrow-t">{w.name}</span>
                <span className="lrow-s">{fmtDate(w.d)} · {fmtVol(w.vol)}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</span>
              </span>
              <Icon name={open === w.id ? 'chevronDown' : 'chevronRight'} className="lrow-c" />
            </button>
            {open === w.id && (
              <div style={{ padding: '4px 12px 14px 48px' }}>
                {w.entries.map(e => (
                  <div key={e.id} style={{ marginBottom: 10 }}>
                    <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>{nameOfEntry(e)}</div>
                    <div className="muted small">
                      {(e.sets || []).filter(s => s.done).map((s, i) => (
                        <span key={i} style={{ marginRight: 10 }}>{s.w ?? '—'}×{s.r ?? '—'}</span>
                      ))}
                    </div>
                    {e.notes && <div className="muted small" style={{ marginTop: 2, fontStyle: 'italic' }}>{e.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
}
