// Small flat cover illustrations for the mini-games catalog (GamesPicker.jsx) — swapped in for
// the generic gamepad icon so each tile reads as its own game at a glance. Inline SVG, not a
// bitmap: effectively free to ship (a few hundred bytes of markup, no HTTP request, crisp at any
// size). The mole is the vendored game's own artwork (whac-a-mole/game.js's moleSVG, see
// NOTICE.md) reproduced here unmodified; Snake/Labyrinth/Memory are this project's own small
// original drawings, not from the vendored games.
const COVERS = {
  snake: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1c3a24" />
      <path d="M14 30c0-6 6-6 6-12s-6-6-6-12" fill="none" stroke="#86e36b" strokeWidth="5" strokeLinecap="round" />
      <path d="M14 6c6 0 6 6 12 6s6-6 12-6" fill="none" stroke="#86e36b" strokeWidth="5" strokeLinecap="round" />
      <circle cx="38" cy="6" r="2.6" fill="#e36b5a" />
    </svg>
  ),
  labyrinth: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1e2a4a" />
      <g fill="none" stroke="#7fa3ff" strokeWidth="3.2" strokeLinecap="round">
        <path d="M11 11h14v9h-9" />
        <path d="M11 37V20" />
        <path d="M37 11v9h-9" />
        <path d="M37 37V27h-9v-4" />
        <path d="M19 37v-9h9" />
      </g>
      <circle cx="37" cy="37" r="2.6" fill="#e3c66b" />
    </svg>
  ),
  memory: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#2e1f3d" />
      <rect x="9" y="12" width="16" height="22" rx="3" fill="#6b4d8a" transform="rotate(-8 17 23)" />
      <rect x="23" y="12" width="16" height="22" rx="3" fill="#a384c9" transform="rotate(8 31 23)" />
      <path d="M31 17l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#fff5dc" transform="scale(.66) translate(16 11)" />
    </svg>
  ),
  'whac-a-mole': (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a2a16" />
      <ellipse cx="24" cy="38" rx="16" ry="5" fill="#2a1d10" />
      <g transform="translate(6 2) scale(.36)">
        <circle cx="19" cy="32" r="13" fill="#815637" /><circle cx="81" cy="32" r="13" fill="#815637" />
        <path d="M12 100V52a38 38 0 0 1 76 0v48" fill="#a77950" />
        <ellipse cx="50" cy="72" rx="28" ry="22" fill="#d5b48b" />
        <ellipse cx="36" cy="48" rx="4" ry="6" fill="#29261f" /><ellipse cx="64" cy="48" rx="4" ry="6" fill="#29261f" />
        <ellipse cx="50" cy="64" rx="9" ry="6" fill="#67412f" />
        <path d="M43 76q7 8 14 0" fill="none" stroke="#67412f" strokeWidth="3" strokeLinecap="round" />
        <path d="M46 78h8v7h-8z" fill="#fff5dc" />
      </g>
    </svg>
  ),
  // 2048's own tile colors (style/main.css) — same orange "high-value tile" look, not a drawing.
  '2048': (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#edc22e" />
      <text x="24" y="31" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="13" fill="#f9f6f2">2048</text>
    </svg>
  ),
}

// Everything past the hand-drawn batch above (e.g. the crisp-game-lib set) falls back to a
// plain tinted initial — still distinguishes each tile from its neighbors by letter and color
// without hand-illustrating dozens of one-off covers.
function FallbackCover({ label, tint }) {
  return <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
    <rect x="4" y="4" width="40" height="40" rx="10" style={{ fill: tint || '#333' }} fillOpacity=".3" />
    <text x="24" y="31" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="18" style={{ fill: tint || '#fff' }}>
      {(label || '?').charAt(0).toUpperCase()}
    </text>
  </svg>
}

export default function GameCover({ slug, label, tint, size = 44 }) {
  const svg = COVERS[slug]
  return <span style={{ width: size, height: size, borderRadius: size * 0.3, overflow: 'hidden', flex: 'none', display: 'block' }}>
    {svg || <FallbackCover label={label} tint={tint} />}
  </span>
}
