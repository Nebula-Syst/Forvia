import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import StreakIcon from '../../components/StreakIcon.jsx'
import { Button } from '../../components/ui.jsx'
import { FALLBACK_STREAK_TIERS } from '../../lib/streak.js'
import {
  streakTiers, adminStreakTierAdd, adminStreakTierUpdate, adminStreakTierRemove
} from '../../lib/api.js'

// Admin-only. The day thresholds behind the streak badge next to Rank/Prestige (Home,
// via RankRow) and the "Streak" tab on /rank — see lib/streak.js's tierForDays for how a
// day count resolves to one of these. Purely cosmetic today: no perk is attached to any
// of them yet (unlike RANK_PERKS/PRESTIGE_PERKS in Rank.jsx, which are real gameplay
// unlocks) — that's deliberate, not a bug, until/unless one gets added later. The art
// only covers 10 steps (public/streak/1..10.svg); past the 10th configured tier, StreakIcon
// clamps to the last one, same as PrestigeIcon does past prestige 10.
function TierRow({ tier, idx, onSave, onRemove }) {
  const [name, setName] = useState(tier.name)
  const [days, setDays] = useState(String(tier.days))
  useEffect(() => { setName(tier.name); setDays(String(tier.days)) }, [tier.name, tier.days])
  const dirty = name.trim() !== tier.name || Number(days) !== tier.days
  return <div className="item">
    <StreakIcon tier={idx + 1} size={44} />
    <div className="grow" style={{ display: 'grid', gap: 4 }}>
      <input className="name-field" value={name} onChange={e => setName(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <input className="input" type="number" min="1" value={days} onChange={e => setDays(e.target.value)} style={{ width: 90, padding: '6px 10px' }} />
        <span className="dim small">{t('days')}</span>
      </div>
    </div>
    {dirty && <button className="iconbtn" onClick={() => onSave(name.trim(), Math.round(+days))} aria-label={t('save')}><Icon name="check" /></button>}
    <button className="iconbtn" onClick={onRemove} aria-label={t('delete')} style={{ color: 'var(--red)' }}><Icon name="trash" /></button>
  </div>
}

export default function AdminStreaks() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [tiers, setTiers] = useState(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState('')
  const [seeding, setSeeding] = useState(false)

  const load = () => streakTiers().then(setTiers).catch(() => setTiers([]))
  useEffect(() => { load() }, [])

  const add = () => {
    const n = name.trim(), d = Math.round(+days)
    if (!n || !d || d < 1) return toast(t('Name and a positive day count are required'))
    adminStreakTierAdd(n, d).then(list => { setTiers(list); setName(''); setDays(''); toast(t('Tier added')) }).catch(e => toast(e.message))
  }
  const save = (tier, name, days) => adminStreakTierUpdate(tier.id, name, days)
    .then(list => { setTiers(list); toast(t('Saved')) }).catch(e => toast(e.message))
  const remove = tier => adminStreakTierRemove(tier.id).then(list => { setTiers(list); toast(t('Tier deleted')) }).catch(e => toast(e.message))

  const seedDefaults = async () => {
    setSeeding(true)
    try {
      let list = tiers || []
      const existing = new Set(list.map(x => x.name.toLowerCase()))
      let created = 0
      for (const d of FALLBACK_STREAK_TIERS) {
        if (existing.has(d.name.toLowerCase())) continue
        list = await adminStreakTierAdd(d.name, d.days)
        setTiers(list)
        created++
      }
      toast(created ? t('{0} tiers created', created) : t('Already up to date'))
    } catch (e) { toast(e.message) } finally { setSeeding(false) }
  }

  const ready = tiers !== null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Streak tiers')}</h1>
        <div className="sub">{ready ? t('{0} tiers', tiers.length) : '…'}</div></div>
    </div>

    <Button variant="tinted" disabled={!ready || seeding} onClick={seedDefaults} style={{ width: '100%', marginBottom: 12 }}>
      {seeding ? t('Seeding…') : t('Seed defaults')}
    </Button>

    <div className="list">
      {!ready && <div className="empty">{t('Loading…')}</div>}
      {ready && tiers.map((tr, i) => <TierRow key={tr.id} tier={tr} idx={i}
        onSave={(n, d) => save(tr, n, d)} onRemove={() => remove(tr)} />)}
      {ready && tiers.length === 0 && <div className="empty">{t('No tiers yet — add one below.')}</div>}
    </div>

    <div style={{ height: 14 }} />
    <div className="card">
      <h2 style={{ margin: '0 0 10px' }}>{t('New tier')}</h2>
      <div style={{ display: 'grid', gap: 6 }}>
        <input className="input" placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} />
        <input className="input" type="number" min="1" placeholder={t('Days')} value={days} onChange={e => setDays(e.target.value)} style={{ width: 120 }} />
        <Button variant="primary" size="sm" icon="plus" onClick={add}>{t('Add tier')}</Button>
      </div>
    </div>
  </div>
}
