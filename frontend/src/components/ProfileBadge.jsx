import RankIcon, { PrestigeIcon } from './RankIcon.jsx'

// The only two badge types today: your rank tier and your prestige medal — the same art
// and number-chip idiom either way, just picked by `type` instead of always both showing.
// More types (real milestones) can slot in here later without touching the slot/picker
// plumbing in SettingsProfile.jsx or Social.jsx.
export default function ProfileBadge({ type, level, prestige, tier, size = 84 }) {
  if (type === 'rank') return <>
    <RankIcon tier={tier} size={size} />
    <span className="profile-preview-badge">{level}</span>
  </>
  if (type === 'prestige' && prestige > 0) return <>
    <PrestigeIcon level={prestige} size={size} />
    <span className="profile-preview-badge">{prestige}</span>
  </>
  return null
}
