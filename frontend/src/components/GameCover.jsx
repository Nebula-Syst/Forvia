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
  // The crisp-game-lib batch — one small original drawing per game, not from the vendored games
  // (which draw everything on a tiny pixel canvas, nothing reusable as a tile-sized icon).
  attackchain: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a1f1f" />
      <g fill="none" stroke="#e8846b" strokeWidth="4" strokeLinecap="round">
        <circle cx="16" cy="16" r="6" /><circle cx="32" cy="24" r="6" /><circle cx="16" cy="32" r="6" />
      </g>
    </svg>
  ),
  cardq: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3d1f33" />
      <rect x="15" y="10" width="18" height="28" rx="3" fill="#f2a8d9" transform="rotate(-6 24 24)" />
      <text x="24" y="31" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="15" fill="#3d1f33" transform="rotate(-6 24 24)">?</text>
    </svg>
  ),
  chargebeam: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17233f" />
      <path d="M26 6 14 26h8l-4 16 18-22h-9z" fill="#6fb8ff" />
    </svg>
  ),
  cleanrobo: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#123632" />
      <circle cx="24" cy="26" r="13" fill="#5fd6c4" />
      <circle cx="19" cy="24" r="2.4" fill="#123632" /><circle cx="29" cy="24" r="2.4" fill="#123632" />
      <rect x="20" y="10" width="8" height="5" rx="2" fill="#5fd6c4" />
    </svg>
  ),
  clockturret: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#241f3d" />
      <circle cx="22" cy="26" r="11" fill="none" stroke="#a79bf2" strokeWidth="3" />
      <path d="M22 19v8l6 4" fill="none" stroke="#a79bf2" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 12l8 6" stroke="#e8846b" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ),
  dango: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3d2a1f" />
      <path d="M16 36V10" stroke="#8a6a4a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="14" r="6.5" fill="#f2c9b2" /><circle cx="16" cy="24" r="6.5" fill="#f2a8b2" /><circle cx="16" cy="34" r="6.5" fill="#b2e0a8" />
    </svg>
  ),
  flipo: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1f1433" />
      <path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke="#c9a3ff" strokeWidth="4" strokeLinecap="round" />
      <path d="M8 10v7h7" fill="none" stroke="#c9a3ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  footlaser: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a1f24" />
      <ellipse cx="18" cy="30" rx="7" ry="10" fill="#e8846b" />
      <path d="M24 20 40 8" stroke="#ffd65f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  growth: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17331f" />
      <path d="M24 38V18" stroke="#7fd65f" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 22c0-7 8-9 8-9s0 8-8 9Z" fill="#7fd65f" />
      <path d="M24 28c0-6-8-7-8-7s0 7 8 7Z" fill="#a3e635" />
    </svg>
  ),
  invincibleman: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a2a0f" />
      <path d="M24 8 34 13v10c0 9-6 14-10 16-4-2-10-7-10-16V13Z" fill="#ffc24a" />
      <circle cx="24" cy="23" r="4" fill="#3a2a0f" />
    </svg>
  ),
  magnetblocks: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17233f" />
      <path d="M16 10v14a8 8 0 0 0 16 0V10" fill="none" stroke="#e8564a" strokeWidth="5" />
      <rect x="12" y="6" width="8" height="7" fill="#e8564a" /><rect x="28" y="6" width="8" height="7" fill="#6fb8ff" />
    </svg>
  ),
  marusansi: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1f2e3d" />
      <circle cx="17" cy="19" r="7" fill="none" stroke="#6fb8ff" strokeWidth="3.5" />
      <path d="M32 14 40 30h-16Z" fill="none" stroke="#ffc24a" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  ),
  meteoplanet: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1f1433" />
      <circle cx="20" cy="28" r="10" fill="#c9a3ff" />
      <ellipse cx="20" cy="28" rx="16" ry="4" fill="none" stroke="#f2e4ff" strokeWidth="2" />
      <circle cx="36" cy="12" r="3" fill="#ffd65f" />
    </svg>
  ),
  pakupaku: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#241f3d" />
      <path d="M24 10a14 14 0 1 0 12.1 21L24 24Z" fill="#ffd65f" />
    </svg>
  ),
  paintball: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#1f1433" />
      <path d="M24 10c6 6 12 12 12 19a12 12 0 0 1-24 0c0-7 6-13 12-19Z" fill="#f2669b" />
      <circle cx="12" cy="36" r="3" fill="#f2669b" /><circle cx="38" cy="14" r="2.4" fill="#f2669b" />
    </svg>
  ),
  pillars3d: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#241f3d" />
      <rect x="11" y="16" width="7" height="22" rx="1.5" fill="#a79bf2" />
      <rect x="21" y="10" width="7" height="28" rx="1.5" fill="#c9bbff" />
      <rect x="31" y="20" width="7" height="18" rx="1.5" fill="#8a7acc" />
    </svg>
  ),
  pinclimb: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17331f" />
      <path d="M24 8a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5Z" fill="#f2e4d8" />
      <rect x="20" y="26" width="8" height="12" rx="2" fill="#f2e4d8" />
      <circle cx="17" cy="20" r="2" fill="#7fd65f" /><circle cx="31" cy="30" r="2" fill="#7fd65f" />
    </svg>
  ),
  rbdrive: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a1f1f" />
      <rect x="15" y="10" width="18" height="28" rx="7" fill="#e8846b" />
      <rect x="18" y="16" width="12" height="7" rx="2" fill="#3a1f1f" />
    </svg>
  ),
  ringblast: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a2a0f" />
      <circle cx="24" cy="24" r="14" fill="none" stroke="#ffc24a" strokeWidth="3" />
      <circle cx="24" cy="24" r="7" fill="#ffc24a" />
    </svg>
  ),
  rollhold: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17233f" />
      <circle cx="22" cy="26" r="9" fill="#6fb8ff" />
      <path d="M31 17a14 14 0 0 1 6 6" fill="none" stroke="#c9e4ff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  shiny: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a2a0f" />
      <path d="M24 8l3.5 10.5L38 22l-10.5 3.5L24 36l-3.5-10.5L10 22l10.5-3.5Z" fill="#ffd65f" />
    </svg>
  ),
  skygolf: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17233f" />
      <circle cx="18" cy="16" r="6" fill="#f2e4ff" />
      <path d="M32 12v24" stroke="#7fd65f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 12l9 4-9 4Z" fill="#e8564a" />
    </svg>
  ),
  survivor: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17331f" />
      <circle cx="20" cy="14" r="5" fill="#f2c9a3" />
      <path d="M20 19v12M14 24l6-2 6 2M15 38l5-7 5 7" fill="none" stroke="#f2c9a3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 10h10v8l-10-3Z" fill="#e8564a" />
    </svg>
  ),
  thunder: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#241f3d" />
      <ellipse cx="22" cy="16" rx="12" ry="7" fill="#c9bbff" />
      <path d="M24 22 14 34h8l-4 10 16-16h-9Z" fill="#ffd65f" />
    </svg>
  ),
  timbertest: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#3a2a0f" />
      <rect x="20" y="16" width="8" height="22" fill="#c98f4a" />
      <circle cx="24" cy="12" r="7" fill="#e8c24a" />
      <path d="M10 18l9 4" stroke="#8a8a8a" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ),
  up1way: (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#17331f" />
      <path d="M24 38V12" stroke="#7fd65f" strokeWidth="4" strokeLinecap="round" />
      <path d="M15 21l9-9 9 9" fill="none" stroke="#7fd65f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
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
