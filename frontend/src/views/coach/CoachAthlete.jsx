import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { coachAthleteWorkouts, coachAthleteProfile, coachBox, coachBoxPlans, streakTiers as fetchStreakTiers } from '../../lib/api.js'
import { activeBoxColor, fmtDate, fmtVol } from '../../lib/format.js'
import { useBoxAccent } from '../../lib/useBoxAccent.js'
import { cachedBoxColor, setCachedBoxColors } from '../../lib/boxCache.js'
import { assignPlanSheet } from '../../sheets.jsx'
import { EXIDX } from '../../lib/exercises.js'
import { t, nameFor } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import ProfileHeaderCard from '../../components/ProfileHeaderCard.jsx'

const nameOfEntry = e => { const ex = EXIDX[e.id]; return ex ? nameFor(ex) : (e.target?.id || e.id) }

// A coach's view of one athlete: the same identity card as their public profile (badges and
// all — see ProfileHeaderCard), their plan status for this box, and their actual training log
// (real per-set numbers, deliberately richer than the social feed, which strips those even for
// public profiles — giving useful feedback needs them). GET /api/coach/athlete/* gates every
// piece of this on an active box membership, re-checked fresh every request.
export default function CoachAthlete() {
  const { boxId, athleteId } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const myTheme = useStore(s => s.S.theme) || 'dark'
  const [box, setBox] = useState(null)
  const [plans, setPlans] = useState(null)
  const [profile, setProfile] = useState(null)
  const [streakTierList, setStreakTierList] = useState(null)
  const [workouts, setWorkouts] = useState(null)
  const [open, setOpen] = useState(null)

  const load = () => {
    coachBox(boxId).then(r => { setBox(r.box); setCachedBoxColors(boxId, r.box.colors, r.box.colorsEnabled) }).catch(e => toast(e.message))
    coachBoxPlans(boxId).then(setPlans).catch(e => toast(e.message))
    coachAthleteProfile(boxId, athleteId).then(setProfile).catch(e => toast(e.message))
  }
  useEffect(() => { load() }, [boxId, athleteId])
  useEffect(() => { coachAthleteWorkouts(athleteId).then(setWorkouts).catch(e => toast(e.message)) }, [athleteId])
  useEffect(() => { fetchStreakTiers().then(setStreakTierList).catch(() => setStreakTierList([])) }, [])

  useBoxAccent(box ? activeBoxColor(box, myTheme) : cachedBoxColor(boxId, myTheme))

  const prCount = workouts ? workouts.reduce((n, w) => n + (w.prs?.length || 0), 0) : 0
  const plan = profile?.plan
  const planStatusPill = plan?.expired ? { label: t('Expired'), style: { background: 'color-mix(in srgb, var(--red) 18%, transparent)', color: 'var(--red)' } }
    : plan?.inGrace ? { label: t('Renew soon'), style: { background: 'color-mix(in srgb, var(--orange) 18%, transparent)', color: 'var(--orange)' } }
    : plan ? { label: t('Up to date'), style: { background: 'var(--acc-soft)', color: 'var(--acc)' } } : null
  const planSubtitle = !plan ? null
    : plan.monthlyLimit != null ? t('{0} of {1} classes this month', plan.usedThisMonth, plan.monthlyLimit)
    : plan.classTypes ? t('Only: {0}', plan.classTypes.join(', ')) : t('Unlimited')

  return <div className="narrow">
    <div className="hdr hdr-center">
      <button className="iconbtn" onClick={() => nav('/coach/box/' + boxId + '/athletes')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1 className="hdr-sub" style={{ margin: 0 }}>{t('Athlete')}</h1>
    </div>

    {!profile ? <div className="muted small">{t('Loading…')}</div> : <>
      <ProfileHeaderCard user={profile.user} level={profile.level} prestige={profile.prestige} perks={profile.perks} streakTierList={streakTierList} />

      <div className="card" style={{ marginTop: 10 }}>
        <button className="row" style={{ alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
          onClick={() => box && assignPlanSheet(box, { id: athleteId, name: profile.user.name }, plans || [], plan?.id || null, load)}>
          <span className="flat-badge" style={{ '--tint': 'var(--acc)', width: 34, height: 34, borderRadius: 10 }}><Icon name="list" /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{plan ? plan.name : t('No plan')}</div>
            {planSubtitle && <div className="muted small" style={{ marginTop: 1 }}>{planSubtitle}</div>}
          </span>
          {planStatusPill && <span className="tag" style={planStatusPill.style}>{planStatusPill.label}</span>}
        </button>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="coach-stats">
          <div className="coach-stat"><div className="n">{workouts?.length ?? '—'}</div><div className="l">{t('Workouts')}</div></div>
          <div className="coach-vsep" />
          <div className="coach-stat"><div className="n">{profile.thisWeek ?? 0}</div><div className="l">{t('This week')}</div></div>
          <div className="coach-vsep" />
          <div className="coach-stat"><div className="n">{prCount}</div><div className="l">{t('PRs')}</div></div>
        </div>
      </div>

      <div style={{ height: 14 }} />
      {!workouts ? <div className="muted small">{t('Loading…')}</div> : !workouts.length ? (
        <div className="muted small">{t('No workouts in this window.')}</div>
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
    </>}
  </div>
}
