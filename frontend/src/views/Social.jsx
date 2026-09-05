import { useEffect, useRef, useState } from 'react'
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtDur, fmtVol } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { socialFollow, socialUnfollow, socialFeed, socialDiscover, socialReact, socialUser, socialUsers, socialFollowing, streakTiers as fetchStreakTiers } from '../lib/api.js'
import { tierFor, tierBySlug } from '../lib/rank.js'
import { FALLBACK_STREAK_TIERS } from '../lib/streak.js'
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
          <div className={'tt' + (p?.animatedName ? ' name-animated' : '')} style={{ fontWeight: 600, fontSize: 16 }}>
            {item.username ? '@' + item.username : item.name}
          </div>
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
//
// The backend still hands back the whole page in one call (FEED_LIMIT=50 — see
// api/server.js, a self-hosted instance's follow graph is small enough that this is
// cheap) — PAGE_SIZE below is purely how many of those already-fetched cards are ever
// mounted at once, revealed 10 at a time as the sentinel at the bottom scrolls into view.
// A skeleton card stands in for a beat on each reveal so a fast local reveal still reads
// as "loading" rather than a jump-cut, same as it would over a slower connection.
const PAGE_SIZE = 5
const REVEAL_DELAY_MS = 500

function FeedCardSkeleton() {
  return <div className="card feed-card" style={{ marginBottom: 18 }}>
    <div className="row" style={{ gap: 12 }}>
      <Skeleton circle width={46} height={46} />
      <div style={{ flex: 1 }}>
        <Skeleton width="50%" height={16} />
        <Skeleton width="35%" height={12} style={{ marginTop: 6 }} />
      </div>
    </div>
    <Skeleton height={14} style={{ marginTop: 14 }} />
    <Skeleton height={14} width="80%" />
  </div>
}

function PostList({ fetcher, emptyIcon, emptyText, withFollow }) {
  const [items, setItems] = useState(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const unit = useStore(s => s.S.unit)
  const toast = useUI(s => s.toast)
  const load = () => fetcher().then(list => { setItems(list); setShown(PAGE_SIZE) }).catch(e => toast(e.message || t('Could not load')))
  useEffect(() => { load() }, [])

  // IntersectionObserver on a sentinel div after the last rendered card — crossing into
  // view means "the person scrolled to the bottom", same trigger a real next-page fetch
  // would use, so swapping this for one later (once a follow graph is ever big enough to
  // need real pagination) only touches this callback, not the scroll-detection plumbing.
  //
  // One observer for the whole list's lifetime, not one per reveal: `hasMore` is true both
  // right before AND right after a reveal that doesn't reach the end (e.g. 5→10 of 13), so
  // a callback ref keyed on `hasMore`/`items` never re-fires between those two states —
  // React only re-invokes a ref callback when its *identity* changes, and neither dependency
  // actually changed value there. The first reveal's observer would disconnect itself and
  // nothing would ever replace it, silently capping the feed at PAGE_SIZE*2 forever. A ref
  // for live state (read fresh inside the callback) sidesteps needing the observer itself
  // to be recreated on every reveal.
  const sentinelElRef = useRef(null)
  const liveRef = useRef({ items, shown, loadingMore })
  liveRef.current = { items, shown, loadingMore }
  // A native IntersectionObserver only calls back when isIntersecting *changes* —
  // it does NOT re-fire just because the sentinel stays visible while content grows
  // around it. On a short viewport the sentinel can stay inside the trigger zone
  // across a whole reveal (still intersecting before and after), so the callback
  // never re-fires and the feed silently stalls after one page. Recreating the
  // observer on every `shown` change forces a fresh intersection check against
  // current layout, so it keeps chaining reveals until the sentinel truly leaves view.
  useEffect(() => {
    const node = sentinelElRef.current
    if (!node) return
    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      const { items, shown, loadingMore } = liveRef.current
      if (loadingMore || !items || shown >= items.length) return
      setLoadingMore(true)
      setTimeout(() => { setShown(s => Math.min(items.length, s + PAGE_SIZE)); setLoadingMore(false) }, REVEAL_DELAY_MS)
    }, { rootMargin: '200px' })
    io.observe(node)
    return () => io.disconnect()
  }, [items === null, shown, loadingMore])
  const hasMore = items && shown < items.length

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

  return <SkeletonTheme baseColor="var(--surface-2)" highlightColor="var(--glass-bg-2)">
    <div className="list">
      {items.slice(0, shown).map(item => <FeedCard key={item.uid + item.workout.id} item={item} onReact={react} onFollow={withFollow ? follow : null} unit={unit} />)}
      {loadingMore && <FeedCardSkeleton />}
      {hasMore && <div ref={sentinelElRef} style={{ height: 1 }} />}
    </div>
  </SkeletonTheme>
}

const FeedTab = () => <PostList fetcher={socialFeed} emptyIcon="heart"
  emptyText={t('No activity yet — follow someone in Discover to see their workouts here.')} />

// A small strip of one-tap follow suggestions above Discover's feed — the feed itself only
// shows people once they've posted something, so on a small/fresh instance it can stay empty
// a while even though there are plenty of public accounts to follow. Capped at 6 and randomized
// each mount so it doesn't always show the same handful.
function SuggestedPeople() {
  const [people, setPeople] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => {
    socialUsers().then(list => {
      const notFollowing = list.filter(u => !u.following)
      setPeople(notFollowing.sort(() => Math.random() - 0.5).slice(0, 6))
    }).catch(() => setPeople([]))
  }, [])

  const follow = async person => {
    setPeople(list => list.filter(p => p !== person))
    try { await socialFollow(person.id) } catch (e) { toast(e.message || t('Could not save')) }
  }

  if (!people || !people.length) return null
  return <div className="suggest-strip">
    {people.map(person => (
      <div key={person.id} className="suggest-card" onClick={() => nav('/social/u/' + person.id)}>
        <Avatar name={person.name} avatarUrl={person.avatarUrl} size={52} />
        <div className="tt capitalize" style={{ fontSize: 13.5, marginTop: 8 }}>{person.username ? '@' + person.username : person.name}</div>
        <button className="btn xs primary" style={{ width: '100%', marginTop: 8 }} onClick={ev => { ev.stopPropagation(); follow(person) }}>
          {t('Follow')}
        </button>
      </div>
    ))}
  </div>
}

const DiscoverTab = () => <>
  <SuggestedPeople />
  <PostList fetcher={socialDiscover} emptyIcon="magnifier" withFollow
    emptyText={t('Nobody on this instance has made their profile public yet.')} />
</>

// One public profile — reached by tapping a name on any post. Same follow toggle as
// Discover, and the same feed card for their posts, so there's nothing new to render,
// just a header (avatar, stats, follow button) on top of it.
export function UserProfile() {
  const { uid } = useParams()
  const [data, setData] = useState(null)
  const [streakTierList, setStreakTierList] = useState(null)
  const unit = useStore(s => s.S.unit)
  const me = useStore(s => s.user)
  const isMe = me && me.id === uid
  const toast = useUI(s => s.toast)

  useEffect(() => {
    setData(null)
    socialUser(uid).then(setData).catch(() => setData(false))
  }, [uid])
  useEffect(() => { fetchStreakTiers().then(setStreakTierList).catch(() => setStreakTierList([])) }, [])

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
        <div className={'tt' + (data.perks?.animatedName ? ' name-animated' : '')} style={{ fontWeight: 700, fontSize: 18 }}>
          {data.user.username ? '@' + data.user.username : data.user.name}
        </div>
        {data.perks?.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 16 }} />}
      </div>
      {/* The real name still shows, just demoted to a subtitle, once a username is set —
          the handle is the public identity from here down (feed, comments), but knowing
          who's actually behind "@josem" is still useful on their own profile page. */}
      {data.user.username && <div className="dim small">{data.user.name}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <RankBadge level={data.level} prestige={data.prestige} size="sm" />
      </div>
      {data.perks?.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {data.user.bio && <div className="ss profile-bio-text" style={{ marginTop: 6 }}>{data.user.bio}</div>}
      <div className="profile-badges">
        {(data.user.badges || []).map((type, slot) => {
          if (!type) return null
          const isRank = type.startsWith('rank:'), isPrestige = type.startsWith('prestige:'), isStreak = type.startsWith('streak:')
          const streakList = streakTierList && streakTierList.length ? streakTierList : FALLBACK_STREAK_TIERS
          const streakArtIdx = isStreak ? Math.min(10, Math.max(0, streakList.findIndex(s => 'streak:' + s.id === type)) + 1) : null
          return (
            <span key={slot} className={'badge-slot filled' + ((isRank || isPrestige || isStreak) && data.perks?.animatedBadge ? ' pulse' : '')}>
              <ProfileBadge type={isPrestige ? 'prestige' : isStreak ? 'streak' : isRank ? 'rank' : type}
                prestige={isPrestige ? Number(type.slice(9)) : data.prestige}
                streakTier={streakArtIdx}
                tier={isRank ? tierBySlug(type.slice(5)).name : tierFor(data.level).name} size={80} />
            </span>
          )
        })}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 14 }}>
        <div><div style={{ fontWeight: 700 }}>{data.workouts}</div><div className="dim small">{t('Workouts')}</div></div>
        <div><div style={{ fontWeight: 700 }}>{data.followers}</div><div className="dim small">{t('Followers')}</div></div>
        <div><div style={{ fontWeight: 700 }}>{data.following}</div><div className="dim small">{t('Following')}</div></div>
      </div>
      {!isMe && <button className={'btn sm' + (data.isFollowing ? '' : ' primary')} style={{ width: '100%', marginTop: 14 }} onClick={toggleFollow}>
        {data.isFollowing ? t('Following') : t('Follow')}
      </button>}
    </div>
    <div style={{ height: 14 }} />
    {data.items.length
      ? <div className="list">{data.items.map(item => <FeedCard key={item.workout.id} item={item} onReact={react} unit={unit} pinned={pinnedIds.has(item.workout.id)} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No public workouts yet.')}</div>}
  </div>
}

// One row per person — same shape used by both the search sheet (all public users, with a
// follow toggle) and the friends sheet (who I already follow, with their streak instead).
function PersonRow({ person, right, onOpen }) {
  return <div className="lrow tap" onClick={onOpen}>
    <Avatar name={person.name} avatarUrl={person.avatarUrl} size={40} style={{ flex: 'none' }} />
    <span className="lrow-m">
      <span className="lrow-t">{person.username ? '@' + person.username : person.name}</span>
      {person.username && <span className="lrow-s">{person.name}</span>}
    </span>
    {right}
  </div>
}

// Every public account, filtered client-side as you type — the instance is small enough
// (self-hosted, not a public network) that shipping the whole list once and filtering in the
// browser is simpler than a server-side search endpoint, and just as fast in practice.
function SearchSheet({ close }) {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { socialUsers().then(setUsers).catch(() => setUsers([])) }, [])

  const toggleFollow = async person => {
    setUsers(list => list.map(u => u === person ? { ...u, following: !u.following } : u))
    try { await (person.following ? socialUnfollow(person.id) : socialFollow(person.id)) }
    catch (e) { toast(e.message || t('Could not save')); setUsers(list => list.map(u => u === person ? { ...u, following: !u.following } : u)) }
  }

  const needle = q.trim().toLowerCase()
  const results = !users ? null : !needle ? users : users.filter(u =>
    (u.name || '').toLowerCase().includes(needle) || (u.username || '').toLowerCase().includes(needle))

  return <>
    <h3>{t('Search people')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" autoFocus placeholder={t('Search by name or username')} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div style={{ height: 8 }} />
    {results === null ? null : results.length === 0
      ? <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No matches.')}</div>
      : <div className="sect-b">{results.map(person => (
        <PersonRow key={person.id} person={person} onOpen={() => { close(); nav('/social/u/' + person.id) }}
          right={<button className={'btn xs' + (person.following ? '' : ' primary')} onClick={ev => { ev.stopPropagation(); toggleFollow(person) }}>
            {person.following ? t('Following') : t('Follow')}
          </button>} />
      ))}</div>}
    <div style={{ height: 8 }} />
  </>
}
const openSearchSheet = () => useUI.getState().openSheet(close => <SearchSheet close={close} />)

// Who I follow — tap through to their profile, same as any name elsewhere in Social.
function FriendsSheet({ close }) {
  const [following, setFollowing] = useState(null)
  useEffect(() => { socialFollowing().then(setFollowing).catch(() => setFollowing([])) }, [])

  return <>
    <h3>{t('Friends')}</h3>
    {following === null ? null : following.length === 0
      ? <div className="empty"><div className="ico"><Icon name="heart" /></div>{t("You're not following anyone yet — search for people to follow them.")}</div>
      : <div className="sect-b">{following.map(person => (
        <PersonRow key={person.id} person={person} onOpen={() => { close(); nav('/social/u/' + person.id) }}
          right={<span className="dim small row" style={{ gap: 4 }}><Icon name="flame" style={{ fontSize: 13 }} />{person.streak || 0}</span>} />
      ))}</div>}
    <div style={{ height: 8 }} />
  </>
}
const openFriendsSheet = () => useUI.getState().openSheet(close => <FriendsSheet close={close} />)

export default function Social() {
  const [tab, setTab] = useState('feed')
  const user = useStore(s => s.user)

  return <div>
    {!user ? (
      <div className="narrow"><div className="card small muted">{t('Sign in to follow people and see their activity — guest profiles stay local to this device.')}</div></div>
    ) : <div className="narrow social-narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={openSearchSheet} aria-label={t('Search people')}><Icon name="magnifier" /></button>
        <div className="row" style={{ gap: 8 }}>
          <button className="iconbtn" onClick={openFriendsSheet} aria-label={t('Friends')}><Icon name="list" /></button>
          <button className="iconbtn" onClick={() => nav('/social/u/' + user.id)} aria-label={t('My profile')}><Icon name="personCircle" /></button>
        </div>
      </div>
      <Segmented className="seg-range" value={tab} onChange={setTab}
        options={[{ value: 'feed', label: t('For you') }, { value: 'discover', label: t('Discover') }]} />
      <div style={{ height: 14 }} />
      {tab === 'feed' && <FeedTab />}
      {tab === 'discover' && <DiscoverTab />}
    </div>}
  </div>
}
