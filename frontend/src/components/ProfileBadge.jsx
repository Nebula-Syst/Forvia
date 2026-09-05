import RankIcon, { PrestigeIcon } from './RankIcon.jsx'
import StreakIcon from './StreakIcon.jsx'

// The three badge types today: your rank tier, your prestige medal and your streak badge —
// same bare-art idiom for all three, just picked by `type` instead of always showing every
// one. More types (real milestones) can slot in here later without touching the slot/picker
// plumbing in SettingsProfile.jsx or Social.jsx.
export default function ProfileBadge({ type, level, prestige, tier, streakTier, size = 84 }) {
  if (type === 'rank') return <RankIcon tier={tier} size={size} />
  if (type === 'prestige' && prestige > 0) return <PrestigeIcon level={prestige} size={size} />
  if (type === 'streak') return <StreakIcon tier={streakTier} size={size} />
  return null
}
