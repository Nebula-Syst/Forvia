import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import RankBadge from './RankBadge.jsx'

// Fetched fresh on mount rather than read off the store's cached `user` — XP changes
// from things (finishing a workout, checking off a task) that never re-run login/me,
// so the store's copy goes stale the moment any of that happens this session. Shared
// by Home and Progress — same badge, same tap target, opens the full /rank page.
export default function RankRow() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  useEffect(() => { api('/api/me').then(r => setMe(r.user)).catch(() => {}) }, [])
  if (!me) return null
  return <RankBadge level={me.rank.level} prestige={me.rank.prestige} size="lg" perks={me.perks} iconsOnly onClick={() => nav('/rank')} />
}
