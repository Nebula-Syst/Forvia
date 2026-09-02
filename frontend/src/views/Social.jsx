import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtDur, fmtVol } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { socialFollow, socialUnfollow, socialFeed, socialDiscover, socialReact, socialUser } from '../lib/api.js'
import { tierFor } from '../lib/rank.js'
import { feedPostSheet } from '../sheets.jsx'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import RankBadge from '../components/RankBadge.jsx'
import ProfileBadge from '../components/ProfileBadge.jsx'
import Avatar from '../components/Avatar.jsx'
import { Segmented } from '../components/ui.jsx'
import { nav } from '../lib/nav.js'
import { useParams } from 'react-router-dom'

function ExerciseRow({ id, sets, starred }) {
  const ex = EXIDX[id] || {}
  return <div className="row" style={{ gap: 10, padding: '5px 0' }}>
    <Thumb ex={ex} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div className="tt capitalize" style={{ fontSize: 14 }}>{ex ? nameFor(ex) : id}</div>
      <div className="ss">{t('{0} sets', sets)}</div>
    </div>
    {starred && <Icon name="trophy" style={{ color: 'var(--yellow)', fontSize: 15, flex: 'none' }} />}
  </div>
}

// Every card gets the same box — photos (if any), then a preview of what was trained,
// always in that order, so a post with no photos still looks and behaves like every
// other one instead of falling back to a plain list. Swipe/drag moves between pages;
// dots (only shown past one page) track scroll position, not the drag itself, so they
// stay right regardless of how the page changed. Touch and mouse both drag — mirrors
// the sheet's own swipe-to-dismiss in Modals.jsx, including "mouse drag for desktop
// testing/trackpads", since a plain overflow-x:auto div doesn't pan on mouse-drag alone.
// A drag that actually moved the strip swallows the click that follows, so it doesn't
// also open the full post.
function MediaStrip({ item, onOpen }) {
  const images = item.workout.images || []
  const exs = item.workout.exercises || []
  const [page, setPage] = useState(0)
  const ref = useRef(null)
  const drag = useRef({ active: false, startX: 0, startY: 0, startLeft: 0, lock: null, moved: false })
  const hasExPage = exs.length > 0
  const pageCount = images.length + (hasExPage ? 1 : 0)
  if (!pageCount) return null

  const onScroll = () => {
    const el = ref.current
    if (el && el.clientWidth) setPage(Math.round(el.scrollLeft / el.clientWidth))
  }
  const settle = () => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    el.scrollTo({ left: Math.round(el.scrollLeft / el.clientWidth) * el.clientWidth, behavior: 'smooth' })
  }
  const dragStart = (x, y) => { drag.current = { active: true, startX: x, startY: y, startLeft: ref.current.scrollLeft, lock: null, moved: false } }
  const dragMove = (x, y, e) => {
    const d = drag.current
    if (!d.active) return
    const dx = x - d.startX, dy = y - d.startY
    if (!d.lock && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) d.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (d.lock === 'x') {
      if (e) e.preventDefault()
      d.moved = true
      ref.current.scrollLeft = d.startLeft - dx
    }
  }
  const dragEnd = () => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    if (d.lock === 'x') settle()
  }

  const onTouchStart = e => dragStart(e.touches[0].clientX, e.touches[0].clientY)
  const onTouchMove = e => dragMove(e.touches[0].clientX, e.touches[0].clientY, e)
  const onMouseDown = e => { if (e.button === 0) dragStart(e.clientX, e.clientY) }
  const onMouseMove = e => dragMove(e.clientX, e.clientY)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('mouseup', dragEnd)
    return () => { el.removeEventListener('touchmove', onTouchMove); window.removeEventListener('mouseup', dragEnd) }
  }, [])

  const handleClick = () => { if (drag.current.moved) { drag.current.moved = false; return } onOpen() }
  const goTo = (i, e) => { e.stopPropagation(); const el = ref.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' }) }

  return <div className="feed-media" onClick={handleClick}>
    <div className="feed-media-scroll" ref={ref} onScroll={onScroll}
      onTouchStart={onTouchStart} onTouchEnd={dragEnd}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={dragEnd}>
      {images.map((url, i) => <img key={i} src={url} className="feed-media-img" loading="lazy" alt="" draggable={false} />)}
      {/* Capped to what the fixed-height box actually fits (4 rows) — the rest, if
          any, only ever show in the full post (click opens feedPostSheet). */}
      {hasExPage && <div className="feed-media-ex">
        {exs.slice(0, 4).map(e => <ExerciseRow key={e.id} id={e.id} sets={e.sets} starred={item.workout.prs.includes(e.id)} />)}
      </div>}
    </div>
    {page > 0 && <button className="feed-media-nav prev" onClick={e => goTo(page - 1, e)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>}
    {page < pageCount - 1 && <button className="feed-media-nav next" onClick={e => goTo(page + 1, e)} aria-label={t('Next')}><Icon name="chevronRight" /></button>}
    {pageCount > 1 && <div className="feed-media-dots">
      {Array.from({ length: pageCount }).map((_, i) => <span key={i} className={i === page ? 'on' : ''} />)}
    </div>}
  </div>
}

function FeedCard({ item, onReact, onFollow, unit, pinned }) {
  const open = () => feedPostSheet(item)
  const openProfile = () => nav('/social/u/' + item.uid)
  const p = item.perks

  return <div className="card feed-card" style={{ marginBottom: 18 }}>
    <MediaStrip item={item} onOpen={open} />
    {pinned && <div className="row accent small" style={{ gap: 5, marginBottom: 8 }}><Icon name="flag" style={{ fontSize: 13 }} />{t('Pinned')}</div>}
    <div className="row" style={{ gap: 12 }}>
      <Avatar name={item.name} avatarUrl={item.avatarUrl} perks={p} size={46} fontSize={17} onClick={openProfile} />
      <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={openProfile}>
        <div className="row" style={{ gap: 7 }}>
          <div className={'tt' + (p?.animatedName ? ' name-animated' : '')} style={{ fontWeight: 600, fontSize: 16 }}>{item.name}</div>
          {p?.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 15 }} />}
          {p?.veteranBadge && <span className="veteran-badge">{t('Veteran')}</span>}
          {item.level && <RankBadge level={item.level} prestige={item.prestige} perks={p} />}
        </div>
        <div className="ss">{fmtDate(item.workout.d, true)}</div>
      </div>
      {onFollow && !item.following && <button className="btn sm primary" onClick={() => onFollow(item)}>{t('Follow')}</button>}
    </div>
    <div className="tt" style={{ fontWeight: 700, fontSize: 20, marginTop: 12, cursor: 'pointer' }} onClick={open}>
      {item.workout.name || t('Freestyle')}
    </div>
    {item.workout.desc && <div className="ss" style={{ marginTop: 3, fontSize: 15 }}>{item.workout.desc}</div>}
    <div className="row" style={{ gap: 24, marginTop: 14 }}>
      <div><div className="dim small">{t('Duration')}</div><div style={{ fontWeight: 600, fontSize: 16 }}>{fmtDur(item.workout.end - item.workout.start)}</div></div>
      <div><div className="dim small">{t('Volume')}</div><div style={{ fontWeight: 600, fontSize: 16 }}>{fmtVol(item.workout.vol, unit)}</div></div>
      {item.workout.prs.length > 0 && <div><div className="dim small">{t('Records')}</div><div style={{ fontWeight: 600, fontSize: 16 }} className="row"><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{item.workout.prs.length}</div></div>}
    </div>
    <div className="divider" />
    <div className="row" style={{ gap: 20 }}>
      <button className="row" style={{ gap: 6, color: item.liked ? 'var(--red)' : 'var(--label-2)', fontSize: 15 }} onClick={() => onReact(item)}>
        <Icon name="heart" style={{ fontSize: 17, fill: item.liked ? 'currentColor' : 'none' }} />{item.likes || ''}
      </button>
      <button className="row" style={{ gap: 6, color: 'var(--label-2)', fontSize: 15 }} onClick={open} aria-label={t('Comments')}>
        <Icon name="comment" style={{ fontSize: 17 }} />{item.comments || ''}
      </button>
    </div>
  </div>
}

// Both tabs are "a feed of posts", just from a different guest list (who I follow vs
// public accounts I don't yet) — same fetch/react/render shape, so one component covers
// both. withFollow shows a Follow button on each card (Discover only: everything there
// is, by construction, someone not followed yet).
function PostList({ fetcher, emptyIcon, emptyText, withFollow }) {
  const [items, setItems] = useState(null)
  const unit = useStore(s => s.S.unit)
  const toast = useUI(s => s.toast)
  const load = () => fetcher().then(setItems).catch(e => toast(e.message || t('Could not load')))
  useEffect(() => { load() }, [])

  if (items === null) return null
  if (!items.length) return <div className="empty"><div className="ico"><Icon name={emptyIcon} /></div>{emptyText}</div>

  const react = async item => {
    setItems(list => list.map(i => i === item ? { ...i, liked: !i.liked, likes: i.likes + (i.liked ? -1 : 1) } : i))
    try { await socialReact(item.uid, item.workout.id) } catch (e) { toast(e.message || t('Could not save')); load() }
  }
  const follow = async item => {
    setItems(list => list.map(i => i.uid === item.uid ? { ...i, following: true } : i))
    try { await socialFollow(item.uid) } catch (e) { toast(e.message || t('Could not save')); load() }
  }

  return <div className="list">
    {items.map(item => <FeedCard key={item.uid + item.workout.id} item={item} onReact={react} onFollow={withFollow ? follow : null} unit={unit} />)}
  </div>
}

const FeedTab = () => <PostList fetcher={socialFeed} emptyIcon="heart"
  emptyText={t('No activity yet — follow someone in Discover to see their workouts here.')} />
const DiscoverTab = () => <PostList fetcher={socialDiscover} emptyIcon="magnifier" withFollow
  emptyText={t('Nobody on this instance has made their profile public yet.')} />

// One public profile — reached by tapping a name on any post. Same follow toggle as
// Discover, and the same feed card for their posts, so there's nothing new to render,
// just a header (avatar, stats, follow button) on top of it.
export function UserProfile() {
  const { uid } = useParams()
  const [data, setData] = useState(null)
  const unit = useStore(s => s.S.unit)
  const toast = useUI(s => s.toast)

  useEffect(() => {
    setData(null)
    socialUser(uid).then(setData).catch(() => setData(false))
  }, [uid])

  if (data === null) return null
  if (!data) return <div className="narrow social-narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/social')} aria-label={t('Previous')}><Icon name="chevronLeft" /></button></div>
    <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t("This profile isn't available.")}</div>
  </div>

  const toggleFollow = async () => {
    setData(d => ({ ...d, isFollowing: !d.isFollowing }))
    try { await (data.isFollowing ? socialUnfollow(uid) : socialFollow(uid)) }
    catch (e) { toast(e.message || t('Could not save')); setData(d => ({ ...d, isFollowing: !d.isFollowing })) }
  }
  const react = async item => {
    setData(d => ({ ...d, items: d.items.map(i => i === item ? { ...i, liked: !i.liked, likes: i.likes + (i.liked ? -1 : 1) } : i) }))
    try { await socialReact(item.uid, item.workout.id) } catch (e) { toast(e.message || t('Could not save')) }
  }

  const pinnedIds = new Set(data.user.pinnedWorkoutIds || [])
  return <div className="narrow social-narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/social')} aria-label={t('Previous')}><Icon name="chevronLeft" /></button></div>
    <div className={'card' + (data.perks?.borderBeam ? ' border-beam' : '')} style={{ textAlign: 'center' }}>
      <Avatar name={data.user.name} avatarUrl={data.user.avatarUrl} perks={data.perks} size={64} fontSize={22} style={{ margin: '0 auto 10px' }} />
      <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
        <div className={'tt' + (data.perks?.animatedName ? ' name-animated' : '')} style={{ fontWeight: 700, fontSize: 18 }}>{data.user.name}</div>
        {data.perks?.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 16 }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <RankBadge level={data.level} prestige={data.prestige} size="sm" />
      </div>
      {data.perks?.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {data.user.bio && <div className="ss profile-bio-text" style={{ marginTop: 6 }}>{data.user.bio}</div>}
      <div className="profile-badges">
        {(data.user.badges || []).map((type, slot) => type && (
          <span key={slot} className={'badge-slot filled' + (type === 'rank' && data.perks?.animatedBadge ? ' pulse' : '')}>
            <ProfileBadge type={type} level={data.level} prestige={data.prestige} tier={tierFor(data.level).name} size={80} />
          </span>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 14 }}>
        <div><div style={{ fontWeight: 700 }}>{data.workouts}</div><div className="dim small">{t('Workouts')}</div></div>
        <div><div style={{ fontWeight: 700 }}>{data.followers}</div><div className="dim small">{t('Followers')}</div></div>
        <div><div style={{ fontWeight: 700 }}>{data.following}</div><div className="dim small">{t('Following')}</div></div>
      </div>
      <button className={'btn sm' + (data.isFollowing ? '' : ' primary')} style={{ width: '100%', marginTop: 14 }} onClick={toggleFollow}>
        {data.isFollowing ? t('Following') : t('Follow')}
      </button>
    </div>
    <div style={{ height: 14 }} />
    {data.items.length
      ? <div className="list">{data.items.map(item => <FeedCard key={item.workout.id} item={item} onReact={react} unit={unit} pinned={pinnedIds.has(item.workout.id)} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No public workouts yet.')}</div>}
  </div>
}

export default function Social() {
  const [tab, setTab] = useState('feed')
  const user = useStore(s => s.user)

  return <div>
    <div className="hdr"><div><h1>{t('Social')}</h1><div className="sub">{t('See what people you follow are training')}</div></div></div>
    {!user ? (
      <div className="narrow"><div className="card small muted">{t('Sign in to follow people and see their activity — guest profiles stay local to this device.')}</div></div>
    ) : <div className="narrow social-narrow">
      <Segmented className="seg-range" value={tab} onChange={setTab}
        options={[{ value: 'feed', label: t('For you') }, { value: 'discover', label: t('Discover') }]} />
      <div style={{ height: 14 }} />
      {tab === 'feed' && <FeedTab />}
      {tab === 'discover' && <DiscoverTab />}
    </div>}
  </div>
}
