import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { TIERS, tierFor } from '../../lib/rank.js'
import { t } from '../../lib/i18n.js'
import { setBio, setBadges, setAvatar, removeAvatar, streakTiers as fetchStreakTiers } from '../../lib/api.js'
import { streakDays } from '../../lib/history.js'
import { tierForDays, FALLBACK_STREAK_TIERS } from '../../lib/streak.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import ImageCropper from '../../components/ImageCropper.jsx'
import ProfileBadge from '../../components/ProfileBadge.jsx'
import RankBadge from '../../components/RankBadge.jsx'
import { Section, Row } from '../../components/ui.jsx'

const MAX_AVATAR_MB = 6
const MAX_PRESTIGE_BADGE = 10 // caps at the art (see RankIcon.jsx's PrestigeIcon)

// One entry per rank tier, per prestige level and per streak-badge tier (any one actually
// reached is pickable, not just the current one) — more (real milestones) can join this
// list later without touching the slot/picker code below. Each kind shares one "family":
// only one badge per family may be shown across the 3 slots at a time (see familyOf/pick).
// Streak tiers are admin-configurable (server-fetched, see lib/streak.js) rather than a
// fixed list like TIERS, so this is built from whatever's loaded (falling back the same
// way the streak ring itself does before that fetch lands).
function buildBadgeTypes(streakTierList) {
  const streaks = (streakTierList && streakTierList.length ? streakTierList : FALLBACK_STREAK_TIERS)
  return [
    ...TIERS.map(t => ({ id: 'rank:' + t.slug, name: t.name, min: t.min })),
    ...Array.from({ length: MAX_PRESTIGE_BADGE }, (_, i) => i + 1).map(n => ({ id: 'prestige:' + n, min: n })),
    ...streaks.map((s, i) => ({ id: 'streak:' + s.id, name: s.name, min: s.days, artIdx: Math.min(10, i + 1) })),
  ]
}
const familyOf = id => id.startsWith('rank:') ? 'rank' : id.startsWith('prestige:') ? 'prestige' : id.startsWith('streak:') ? 'streak' : id

// The three families, each its own collapsible group — one flat 27-tile grid was a wall
// of mostly-locked art to scroll through for what's usually a two-tap pick. Closed by
// default; opening one doesn't close the others, so comparing e.g. two rank tiers side by
// side (open both) still works. The family that's actually equipped in this slot starts
// open, so the sheet doesn't hide your own current pick behind a collapsed group.
const BADGE_GROUPS = [
  { id: 'rank', label: 'Rank' },
  { id: 'prestige', label: 'Prestige' },
  { id: 'streak', label: 'Streak' },
]

// The picker itself — opened as a bottom sheet, same idiom as every other "pick one of
// a few things" flow in the app (exercisePicker, glyphPicker, ...).
function BadgePickerSheet({ slot, slots, badgeTypes, badgeAvailable, toast, onPick, close }) {
  const current = slots[slot] ? familyOf(slots[slot]) : null
  const [open, setOpen] = useState(() => Object.fromEntries(BADGE_GROUPS.map(g => [g.id, g.id === current])))
  const toggle = fam => setOpen(o => ({ ...o, [fam]: !o[fam] }))
  const pick = type => {
    if (!badgeAvailable(type.id)) {
      const msg = type.id.startsWith('prestige:') ? t('Unlocks at Prestige {0}', type.min)
        : type.id.startsWith('streak:') ? t('Reach a {0}-day streak to unlock', type.min)
          : t('Reach level {0} to unlock', type.min)
      toast(msg)
      return
    }
    const fam = familyOf(type.id)
    const usedIn = slots.findIndex((s, i) => s && familyOf(s) === fam && i !== slot)
    if (usedIn !== -1) { toast(t('Already showing in another slot.')); return }
    onPick(slots[slot] === type.id ? null : type.id)
    close()
  }
  const labelOf = b => b.id.startsWith('rank:') ? b.name : b.id.startsWith('streak:') ? b.name : t('Prestige {0}', b.min)
  return <>
    <h3>{t('Choose a badge')}</h3>
    {BADGE_GROUPS.map(g => {
      const items = badgeTypes.filter(b => familyOf(b.id) === g.id)
      const equipped = items.find(b => b.id === slots[slot])
      return (
        <div key={g.id} className="badge-group">
          <button className="badge-group-hdr" onClick={() => toggle(g.id)}>
            <span className="badge-group-title">{t(g.label)}</span>
            {equipped && <span className="dim small">{labelOf(equipped)}</span>}
            <Icon name="chevronDown" className={'lrow-c' + (open[g.id] ? ' rot' : '')} />
          </button>
          {open[g.id] && (
            <div className="badges-grid">
              {items.map(b => {
                const available = badgeAvailable(b.id)
                const selected = slots[slot] === b.id
                return (
                  <button key={b.id} className={'badge-pick' + (selected ? ' on' : '') + (!available ? ' locked' : '')}
                    onClick={() => pick(b)} aria-label={labelOf(b)}>
                    {selected && <Icon name="check" className="badge-pick-check" />}
                    {!available && <Icon name="lock" className="badge-pick-lock" />}
                    <span className="badge-pick-ico">
                      {b.id.startsWith('rank:')
                        ? <ProfileBadge type="rank" tier={b.name} size={30} />
                        : b.id.startsWith('streak:')
                          ? <ProfileBadge type="streak" streakTier={b.artIdx} size={30} />
                          : <ProfileBadge type="prestige" prestige={b.min} size={30} />}
                    </span>
                    <span className="badge-pick-label">{labelOf(b)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    })}
  </>
}

export default function SettingsProfile() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [bio, setBioV] = useState(user?.bio || '')
  const [bioOpen, setBioOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [tiers, setTiers] = useState(null)
  const fileRef = useRef(null)
  useEffect(() => { setBioV(user?.bio || '') }, [user?.id])
  useEffect(() => { fetchStreakTiers().then(setTiers).catch(() => setTiers([])) }, [])

  if (!user) { nav('/settings'); return null }

  const saveBio = async () => {
    const v = bio.trim()
    setBioV(v)
    try { setUser(await setBio(v)) } catch (e) { toast(e.message || t('Could not save')) }
  }

  const pickAvatar = () => fileRef.current?.click()
  const onAvatarChange = async e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_AVATAR_MB * 1024 * 1024) { toast(t('{0} is too large — max {1} MB', f.name, MAX_AVATAR_MB)); return }
    // Crop/zoom first — a phone photo is rarely already a clean square of just your face —
    // then upload the cropped square, not the original file.
    openSheet(close => (
      <ImageCropper file={f} onCancel={close} onDone={async dataUrl => {
        close()
        setAvatarBusy(true)
        try { setUser(await setAvatar(dataUrl)) }
        catch (err) { toast(err.message || t('Could not upload image')) }
        finally { setAvatarBusy(false) }
      }} />
    ), { kind: 'center' })
  }
  const onRemoveAvatar = async () => {
    setAvatarBusy(true)
    try { setUser(await removeAvatar()) } catch (err) { toast(err.message || t('Could not save')) }
    finally { setAvatarBusy(false) }
  }

  const perks = user.perks || {}
  const level = user.rank?.level || 1
  const prestige = user.rank?.prestige || 0
  const streak = Math.max(0, streakDays(S) + (user?.streakBonus || 0))
  const effStreak = S.workouts.length > 0 ? streak : 0
  const streakTier = tiers ? tierForDays(streak, tiers) : null
  const tier = tierFor(level)
  const badgeTypes = buildBadgeTypes(tiers)
  const badgeAvailable = id => {
    if (id === 'prestige') return prestige > 0
    if (id.startsWith('prestige:')) return prestige >= Number(id.slice(9))
    if (id.startsWith('streak:')) return effStreak >= (badgeTypes.find(b => b.id === id)?.min ?? Infinity)
    return level >= (badgeTypes.find(b => b.id === id)?.min || Infinity)
  }
  // Legacy accounts stored the plain strings 'rank'/'prestige' for the (only ever
  // current-value) badge — map those to this account's own id so they still match their
  // family/selection correctly. A legacy 'prestige' with no prestige yet just clears.
  const badgeIdOf = id => {
    if (id === 'rank') return 'rank:' + tier.slug
    if (id === 'prestige') return prestige > 0 ? 'prestige:' + Math.min(prestige, MAX_PRESTIGE_BADGE) : null
    return id
  }

  const slots = [0, 1, 2].map(i => badgeIdOf(user.badges?.[i] || null))
  const assignSlot = async (slot, id) => {
    const next = [...slots]
    next[slot] = id
    try { setUser(await setBadges(next)) } catch (e) { toast(e.message || t('Could not save')) }
  }
  const openBadgePicker = slot => {
    openSheet(close => (
      <BadgePickerSheet slot={slot} slots={slots} badgeTypes={badgeTypes} badgeAvailable={badgeAvailable} toast={toast}
        onPick={id => assignSlot(slot, id)} close={close} />
    ))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Profile')}</h1></div>
    </div>

    {/* Live preview — how this profile looks to other people right now, on Social. Reads
        the bio draft (not the saved value) so it updates as you type, before you tab away.
        The small level/prestige pill is always there, independent of the badge slots
        below it — those are optional showcase picks, this is just the plain fact of
        where you are. */}
    <div className={'card' + (perks.borderBeam ? ' border-beam' : '')} style={{ textAlign: 'center', marginBottom: 16 }}>
      <div style={{ position: 'relative', width: 64, margin: '0 auto 10px' }}>
        <Avatar name={user.name} avatarUrl={user.avatarUrl} perks={perks} size={64} fontSize={22}
          onClick={avatarBusy ? undefined : pickAvatar} style={{ opacity: avatarBusy ? .5 : 1 }} />
        <button className="iconbtn" onClick={pickAvatar} disabled={avatarBusy} aria-label={t('Change photo')}
          style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: '50%', fontSize: 12, background: 'var(--acc)', color: 'var(--on-acc)' }}>
          <Icon name="pencil" />
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onAvatarChange} />
      </div>
      {user.avatarUrl && <button className="dim small" style={{ background: 'none', border: 'none', padding: 0, marginBottom: 10, textDecoration: 'underline', cursor: 'pointer' }}
        onClick={onRemoveAvatar} disabled={avatarBusy}>{t('Remove photo')}</button>}
      <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
        <div className={'tt' + (perks.animatedName ? ' name-animated' : '')} style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
        {perks.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 16 }} />}
      </div>
      {/* Same public identity shown on the Social profile (Social.jsx) — the handle other
          accounts actually see, right under the real name here so it's obvious the two
          are linked without having to open Account settings to check. */}
      {user.username && <div className="dim small">{'@' + user.username}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <RankBadge level={level} prestige={prestige} streak={effStreak} streakTier={streakTier?.artIdx || 1} size="sm" />
      </div>
      {perks.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {bio && <div className="ss profile-bio-text" style={{ marginTop: 6 }}>{bio}</div>}
      <div className="profile-badges">
        {slots.map((type, slot) => {
          const badgeTier = type?.startsWith('rank:') ? TIERS.find(t => t.slug === type.slice(5)) : null
          const badgePrestige = type?.startsWith('prestige:') ? Number(type.slice(9)) : null
          const badgeStreak = type?.startsWith('streak:') ? badgeTypes.find(b => b.id === type) : null
          const filled = badgeTier || badgePrestige || badgeStreak
          return (
            <button key={slot} className={'badge-slot' + (type ? ' filled' : '')
              + (filled && perks.animatedBadge ? ' pulse' : '')}
              onClick={() => openBadgePicker(slot)}
              aria-label={badgeTier ? badgeTier.name : badgePrestige ? t('Prestige {0}', badgePrestige) : badgeStreak ? badgeStreak.name : t('Empty badge slot')}>
              {badgeTier
                ? <ProfileBadge type="rank" tier={badgeTier.name} size={80} />
                : badgePrestige
                  ? <ProfileBadge type="prestige" prestige={badgePrestige} size={80} />
                  : badgeStreak
                    ? <ProfileBadge type="streak" streakTier={badgeStreak.artIdx} size={80} />
                    : <Icon name="plus" />}
            </button>
          )
        })}
      </div>
    </div>

    <Section title={t('Bio')}>
      <Row icon="pencil" iconTint="var(--indigo)" title={t('Biography')}
        onClick={() => setBioOpen(o => !o)}>
        <Icon name="chevronDown" className={'lrow-c' + (bioOpen ? ' rot' : '')} />
      </Row>
      {bioOpen && (
        <div className="bio-field" style={{ margin: '2px 2px 14px' }}>
          <textarea className="input" value={bio} maxLength={140} rows={3} placeholder={t('Say something about yourself')}
            autoFocus onChange={e => setBioV(e.target.value)} onBlur={saveBio} />
          <span className="bio-count">{bio.length}/140</span>
        </div>
      )}
    </Section>
  </div>
}
