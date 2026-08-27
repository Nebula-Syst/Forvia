import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { tierFor } from '../../lib/rank.js'
import { t } from '../../lib/i18n.js'
import { setBio } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import RankIcon, { PrestigeIcon } from '../../components/RankIcon.jsx'
import { Section, Row } from '../../components/ui.jsx'

const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

// Perks that unlock with level/prestige — shown locked, not hidden, same idiom as the
// Level page's own roadmap, and each locked row links there to see the exact progress.
export default function SettingsProfile() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  const toast = useUI(s => s.toast)
  const [bio, setBioV] = useState(user?.bio || '')
  useEffect(() => { setBioV(user?.bio || '') }, [user?.id])

  if (!user) { nav('/settings'); return null }

  const saveBio = async () => {
    const v = bio.trim()
    setBioV(v)
    try { setUser(await setBio(v)) } catch (e) { toast(e.message || t('Could not save')) }
  }

  const perks = user.perks || {}
  const level = user.rank?.level || 1
  const prestige = user.rank?.prestige || 0
  const tier = tierFor(level)
  // Each tier spans exactly ten levels (rank.js) — what's worth showing at a glance is
  // how far through THIS tier you are, not the raw 1-100 number.
  const tierLevel = ((level - 1) % 10) + 1

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Profile')}</h1></div>
    </div>

    {/* Live preview — how this profile looks to other people right now, on Social. Reads
        the bio draft (not the saved value) so it updates as you type, before you tab away. */}
    <div className={'card' + (perks.borderBeam ? ' border-beam' : '')} style={{ textAlign: 'center', marginBottom: 16 }}>
      <span className={'avatar' + (perks.avatarFrame ? ' avatar-frame' : perks.legendFrame ? ' avatar-frame-legend' : '')}
        style={{ width: 64, height: 64, fontSize: 22, margin: '0 auto 10px' }}>{initials(user.name)}</span>
      <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
        <div className={'tt' + (perks.animatedName ? ' name-animated' : '')} style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
        {perks.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 16 }} />}
      </div>
      {perks.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {bio && <div className="ss" style={{ marginTop: 6 }}>{bio}</div>}
      <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 12 }}>
        <div className={'profile-preview-icon' + (perks.animatedBadge ? ' pulse' : '')}>
          <RankIcon tier={tier.name} size={92} />
          <span className="profile-preview-badge">{tierLevel}</span>
        </div>
        {prestige > 0 && (
          <div className="profile-preview-icon">
            <PrestigeIcon level={prestige} size={92} />
            <span className="profile-preview-badge">{prestige}</span>
          </div>
        )}
      </div>
    </div>

    <Section title={t('Bio')} footer={perks.bio ? null : t('Unlocks at {0} (Level {1})', 'Silver', 21)}>
      {perks.bio ? (
        <textarea className="input" value={bio} maxLength={140} rows={3} placeholder={t('Say something about yourself')}
          onChange={e => setBioV(e.target.value)} onBlur={saveBio} />
      ) : (
        <Row icon="lock" iconTint="var(--label-3)" title={t('Bio')} accessory="chevron" onClick={() => nav('/rank')} />
      )}
    </Section>
  </div>
}
