import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { foodSearch, publicFoodSearch } from '../lib/api.js'
import { MEALS } from '../lib/nutrition.js'
import { lockedIds, logSavedMeal, saveMealTotals, FOOD_SOURCES } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Segmented } from '../components/ui.jsx'

// Was a bottom sheet stacked over NutritionLog.jsx's method-card menu — now its own full
// screen (real back-button history, a result can fill the whole viewport instead of a
// sheet's capped height). Picking a food navigates to NutritionFoodDetail.jsx instead of
// opening a second sheet on top of this one; a saved meal still logs straight away (it never
// had a quantity step — a meal's items are already in their saved amounts) and returns
// straight to the diary.
export default function NutritionFoodSearch() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [params, setParams] = useSearchParams()
  const dateIso = params.get('d') || todayISO()
  const mealKey = params.get('m') || MEALS[0].key
  const [q, setQ] = useState(params.get('q') || '')
  const [source, setSource] = useState('all')
  const [items, setItems] = useState(null)
  const [communityItems, setCommunityItems] = useState([])
  const [busy, setBusy] = useState(false)

  const customFoods = useStore(s => s.S.customFoods)
  const savedMeals = useStore(s => s.S.savedMeals)
  const pro = useStore(s => s.user?.pro)
  const lockedFoodIds = lockedIds(customFoods, pro)
  const lockedMealIds = lockedIds(savedMeals, pro)
  const myMatches = q.trim() ? customFoods.filter(f => f.name.toLowerCase().includes(q.trim().toLowerCase())) : []
  const mealMatches = q.trim() ? savedMeals.filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase())) : []

  // `q` rides along in the URL (?q=) so landing back here via the browser/back-button from
  // the detail view restores the query — a real navigation unmounts this screen, unlike the
  // old sheet, which just sat underneath untouched.
  useEffect(() => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (q.trim()) next.set('q', q); else next.delete('q')
      return next
    }, { replace: true })
    const query = q.trim()
    if (!query) { setItems(null); setCommunityItems([]); setBusy(false); return }
    setBusy(true)
    const h = setTimeout(() => {
      Promise.all([
        foodSearch(query).catch(() => { toast(t('Search unavailable — try again')); return [] }),
        publicFoodSearch(query).catch(() => []),
      ]).then(([off, community]) => { setItems(off); setCommunityItems(community) }).finally(() => setBusy(false))
    }, 350)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const showMine = source === 'all' || source === 'mine'
  const showCommunity = source === 'all' || source === 'community'
  const showOff = source === 'all' || source === 'off'
  const nothingShown = q.trim() && !busy && items
    && !(showMine && myMatches.length) && !mealMatches.length
    && !(showCommunity && communityItems.length) && !(showOff && items.length)

  const openDetail = (food, kind) => nav('/nutrition/food/' + dateIso + '/' + mealKey, { state: { food, kind } })
  const logMeal = m => {
    if (lockedMealIds.has(m.id)) return toast(t('This meal is locked — go Pro to use it again.'))
    logSavedMeal(dateIso, mealKey, m)
    nav('/nutrition/diary?d=' + dateIso, { replace: true })
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Search foods')}</h1></div>
    </div>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" autoFocus placeholder={t('Search foods…')} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div style={{ height: 10 }} />
    <Segmented options={FOOD_SOURCES()} value={source} onChange={setSource} />
    <div style={{ height: 10 }} />
    <div className="list">
      {showMine && myMatches.map(f => {
        const locked = lockedFoodIds.has(f.id)
        return <div key={f.id} className="item" style={locked ? { opacity: .5 } : undefined}
          onClick={() => { if (locked) return toast(t('This food is locked — go Pro to use it again.')); openDetail(f, 'custom') }}>
          <div className="thumb thumb-x"><Icon name="sparkles" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name={locked ? 'lock' : 'chevronRight'} className={locked ? undefined : 'chev'} style={locked ? { color: 'var(--label-3)' } : undefined} />
        </div>
      })}
      {mealMatches.map(m => {
        const locked = lockedMealIds.has(m.id)
        return <div key={m.id} className="item" style={locked ? { opacity: .5 } : undefined} onClick={() => logMeal(m)}>
          <div className="thumb thumb-x"><Icon name="clipboard" /></div>
          <div className="grow"><div className="tt">{m.name}</div><div className="ss">{t('{0} items · {1} kcal', m.items.length, saveMealTotals(m.items).kcal)}</div></div>
          <Icon name={locked ? 'lock' : 'chevronRight'} className={locked ? undefined : 'chev'} style={locked ? { color: 'var(--label-3)' } : undefined} />
        </div>
      })}
      {/* Forvia's own community food database — anonymised by the server, so this row never
          shows or knows who submitted it, same as anyone finding a food you shared. */}
      {showCommunity && communityItems.map(f => (
        <div key={f.id} className="item" onClick={() => openDetail(f, 'custom')}>
          <div className="thumb thumb-x"><Icon name="globe" /></div>
          <div className="grow"><div className="tt">{f.name}</div><div className="ss">{f.mode === 'weight' ? t('{0} kcal / 100g', f.kcal) : t('{0} kcal / unit', f.kcal)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
      {nothingShown
        ? <div className="empty">{t('No matches — try a different search or add it yourself.')}</div>
        : showOff && (items || []).map((food, i) => (
          <div key={food.code || i} className="item" onClick={() => openDetail(food, 'off')}>
            <div className="grow"><div className="tt">{food.name}</div><div className="ss">{t('{0} kcal / 100g', food.kcal100)}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
    </div>
  </div>
}
