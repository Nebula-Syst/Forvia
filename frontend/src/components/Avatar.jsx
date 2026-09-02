// Shared by SettingsProfile (own preview), Social's feed cards and public profile — one
// circle that shows an uploaded photo when there is one, initials otherwise. Frame classes
// (avatarFrame / legendFrame perks) apply the same either way.
export const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

export default function Avatar({ name, avatarUrl, perks, size = 52, fontSize, onClick, style, children }) {
  const frameClass = perks?.avatarFrame ? ' avatar-frame' : perks?.legendFrame ? ' avatar-frame-legend' : ''
  return (
    <span className={'avatar' + frameClass} onClick={onClick}
      style={{ width: size, height: size, fontSize: fontSize ?? Math.round(size * 0.34), cursor: onClick ? 'pointer' : undefined, ...style }}>
      {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initials(name)}
      {children}
    </span>
  )
}
