import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { tierFor } from '../../lib/rank.js'
import { t } from '../../lib/i18n.js'
import { setBio, setBadges, setAvatar, removeAvatar } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import Avatar from '../../components/Avatar.jsx'
import ProfileBadge from '../../components/ProfileBadge.jsx'
import RankBadge from '../../components/RankBadge.jsx'
import { Section, Row } from '../../components/ui.jsx'

const MAX_AVATAR_MB = 6

// The only two badge types that exist today — more (real milestones) can join this list
// later without touching the slot/picker code below.
const BADGE_TYPES = [
  { id: 'rank', name: 'Rank' },
  { id: 'prestige', name: 'Prestige' },
]

// The picker itself — opened as a bottom sheet, same idiom as every other "pick one of
// a few things" flow in the app (exercisePicker, dayAssignSheet, ...).
function BadgePickerSheet({ slot, slots, badgeAvailable, level, prestige, tier, toast, onPick, close }) {
  const pick = type => {
    if (!badgeAvailable(type.id)) { toast(t('Unlocks at Prestige {0}', 1)); return }
    const usedIn = slots.indexOf(type.id)
    if (usedIn !== -1 && usedIn !== slot) { toast(t('Already showing in another slot.')); return }
    onPick(slots[slot] === type.id ? null : type.id)
    close()
  }
  return <>
    <h3>{t('Choose a badge')}</h3>
    <div className="badges-grid">
      {BADGE_TYPES.map(b => {
        const available = badgeAvailable(b.id)
        const selected = slots[slot] === b.id
        return (
          <button key={b.id} className={'badge-pick' + (selected ? ' on' : '') + (!available ? ' locked' : '')}
            onClick={() => pick(b)} aria-label={t(b.name)}>
            {selected && <Icon name="check" className="badge-pick-check" />}
            {!available && <Icon name="lock" className="badge-pick-lock" />}
            <span className="badge-pick-ico">
              {b.id === 'rank'
                ? <ProfileBadge type="rank" level={level} tier={tier.name} size={30} />
                : <ProfileBadge type="prestige" prestige={Math.max(prestige, 1)} size={30} />}
            </span>
            <span className="badge-pick-label">{t(b.name)}</span>
          </button>
        )
      })}
    </div>
  </>
}

export default function SettingsProfile() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [bio, setBioV] = useState(user?.bio || '')
  const [bioOpen, setBioOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileRef = useRef(null)
  useEffect(() => { setBioV(user?.bio || '') }, [user?.id])

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
    setAvatarBusy(true)
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
      setUser(await setAvatar(dataUrl))
    } catch (err) { toast(err.message || t('Could not upload image')) }
    finally { setAvatarBusy(false) }
  }
  const onRemoveAvatar = async () => {
    setAvatarBusy(true)
    try { setUser(await removeAvatar()) } catch (err) { toast(err.message || t('Could not save')) }
    finally { setAvatarBusy(false) }
  }

  const perks = user.perks || {}
  const level = user.rank?.level || 1
  const prestige = user.rank?.prestige || 0
  const tier = tierFor(level)
  const badgeAvailable = id => id !== 'prestige' || prestige > 0

  const slots = [0, 1, 2].map(i => user.badges?.[i] || null)
  const assignSlot = async (slot, id) => {
    const next = [...slots]
    next[slot] = id
    try { setUser(await setBadges(next)) } catch (e) { toast(e.message || t('Could not save')) }
  }
  const openBadgePicker = slot => {
    openSheet(close => (
      <BadgePickerSheet slot={slot} slots={slots} badgeAvailable={badgeAvailable}
        level={level} prestige={prestige} tier={tier} toast={toast}
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
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <RankBadge level={level} prestige={prestige} size="sm" />
      </div>
      {perks.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {bio && <div className="ss profile-bio-text" style={{ marginTop: 6 }}>{bio}</div>}
      <div className="profile-badges">
        {slots.map((type, slot) => (
          <button key={slot} className={'badge-slot' + (type ? ' filled' : '')
            + (type === 'rank' && perks.animatedBadge ? ' pulse' : '')}
            onClick={() => openBadgePicker(slot)}
            aria-label={type ? t(BADGE_TYPES.find(b => b.id === type)?.name || type) : t('Empty badge slot')}>
            {type
              ? <ProfileBadge type={type} level={level} prestige={prestige} tier={tier.name} size={80} />
              : <Icon name="plus" />}
          </button>
        ))}
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
