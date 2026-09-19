import { t } from '../lib/i18n.js'
import { tierFor, tierBySlug } from '../lib/rank.js'
import { FALLBACK_STREAK_TIERS } from '../lib/streak.js'
import Icon from './Icon.jsx'
import RankBadge from './RankBadge.jsx'
import ProfileBadge from './ProfileBadge.jsx'
import Avatar from './Avatar.jsx'

// The avatar/name/rank/badges block of a user's profile — pulled out of Social.jsx's
// UserProfile (the public "@handle" card) so CoachAthlete.jsx can show the same card, badges
// and all, for an athlete regardless of whether their profile is public (a coach's view is
// authorized through the box relationship, not the public-profile privacy gate). Callers that
// want extra rows under the badges (Social's workouts/followers/follow button) pass them as
// children rather than this component growing a prop per caller's own footer.
export default function ProfileHeaderCard({ user, level, prestige, perks, streakTierList, children }) {
  return (
    <div className={'card' + (perks?.borderBeam ? ' border-beam' : '')} style={{ textAlign: 'center' }}>
      <Avatar name={user.name} avatarUrl={user.avatarUrl} perks={perks} size={64} fontSize={22} style={{ margin: '0 auto 10px' }} />
      <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
        <div className={'tt' + (perks?.animatedName ? ' name-animated' : '')} style={{ fontWeight: 700, fontSize: 18 }}>
          {user.username ? '@' + user.username : user.name}
        </div>
        {perks?.crownBadge && <Icon name="crown" style={{ color: 'var(--gold, var(--yellow))', fontSize: 16 }} />}
      </div>
      {/* The real name still shows, just demoted to a subtitle, once a username is set. */}
      {user.username && <div className="dim small">{user.name}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <RankBadge level={level} prestige={prestige} size="sm" />
      </div>
      {perks?.veteranBadge && <span className="veteran-badge" style={{ marginTop: 4 }}>{t('Veteran')}</span>}
      {user.bio && <div className="ss profile-bio-text" style={{ marginTop: 6 }}>{user.bio}</div>}
      <div className="profile-badges">
        {(user.badges || []).map((type, slot) => {
          if (!type) return null
          const isRank = type.startsWith('rank:'), isPrestige = type.startsWith('prestige:'), isStreak = type.startsWith('streak:')
          const sList = streakTierList && streakTierList.length ? streakTierList : FALLBACK_STREAK_TIERS
          const streakArtIdx = isStreak ? Math.min(10, Math.max(0, sList.findIndex(s => 'streak:' + s.id === type)) + 1) : null
          return (
            <span key={slot} className={'badge-slot filled' + ((isRank || isPrestige || isStreak) && perks?.animatedBadge ? ' pulse' : '')}>
              <ProfileBadge type={isPrestige ? 'prestige' : isStreak ? 'streak' : isRank ? 'rank' : type}
                prestige={isPrestige ? Number(type.slice(9)) : prestige}
                streakTier={streakArtIdx}
                tier={isRank ? tierBySlug(type.slice(5)).name : tierFor(level).name} size={80} />
            </span>
          )
        })}
      </div>
      {children}
    </div>
  )
}
