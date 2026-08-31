// A ring only ever encodes a real fraction — at pct=1 it's purely a colored frame around
// an icon, never a fabricated "progress toward an undefined goal" (a plain count has no
// goal to be a fraction of).
export default function Ring({ size, stroke, pct, color, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(1, pct)))
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--glass-border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  )
}
