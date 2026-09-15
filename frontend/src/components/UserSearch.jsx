import { useEffect, useRef, useState } from 'react'
import { userSearch } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Avatar from './Avatar.jsx'

// Finds a real account by @username — never by email or display name (impersonation-prone,
// and email is private). Picking a result calls onPick and clears the field; there's no way
// to "submit" a typed string that never matched a real account.
export default function UserSearch({ onPick, placeholder, exclude = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      userSearch(q).then(r => setResults(r.filter(u => !exclude.includes(u.id)))).catch(() => setResults([])).finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    const onDocClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = u => { onPick(u); setQuery(''); setResults([]); setOpen(false) }

  return (
    <div className="usr-picker" ref={boxRef}>
      <div className="usr-field">
        <span className="usr-at">@</span>
        <input className="usr-input" value={query} placeholder={placeholder || t('username')}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value.replace(/^@/, '')); setOpen(true) }} />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="usr-drop">
          {searching ? <div className="usr-empty">{t('Loading…')}</div>
            : results.length ? results.map(u => (
              <button type="button" key={u.id} className="usr-opt" onClick={() => pick(u)}>
                <Avatar name={u.name} avatarUrl={u.avatarUrl} size={28} />
                <span className="usr-opt-t"><b>{u.name}</b><span>@{u.username}</span></span>
              </button>
            )) : <div className="usr-empty">{t('No matches')}</div>}
        </div>
      )}
    </div>
  )
}
