// Forvia's brand mark, as inline SVG — vectorized (potrace) from the source artwork so it never
// needs a raster asset or a light/dark PNG swap: the "ink" group uses currentColor (white on the
// dark theme, near-black on light, same as any other themed icon), the bar/accent group stays
// the brand's fixed lime. Two render modes:
//   - animate (default): draws itself in as a wireframe outline, shape by shape, then resolves
//     to the solid mark (see index.css's .lm-shape rules) — App.jsx's boot screen, and
//     SignIn/CreateAccount, reached by an actual button press to a genuinely new screen.
//   - still: solid from the first frame, no motion — Login.jsx's own mark, specifically because
//     it's reached right after the boot screen already just played this same draw-in a moment
//     earlier; replaying it there read as the animation glitching/restarting, not as a flourish.
// pathLength="1" on every path lets the dash animation stay independent of this group's own
// scale/flip transform (baked in below, straight from potrace's output).
const LIME_PATHS = [
  { d: 'M447 1974 c-4 -4 -7 -198 -7 -431 l0 -424 108 3 107 3 0 425 0 425 -101 3 c-55 1 -103 0 -107 -4z', delay: 0 },
  { d: 'M2520 1550 l0 -430 105 0 105 0 0 430 0 430 -105 0 -105 0 0 -430z', delay: 0 },
  { d: 'M217 1804 c-4 -4 -7 -124 -7 -266 l0 -258 100 0 100 0 -2 263 -3 262 -90 3 c-50 1 -94 0 -98 -4z', delay: 130 },
  { d: 'M2770 1545 l0 -265 100 0 100 0 -2 263 -3 262 -97 3 -98 3 0 -266z', delay: 130 },
  { d: 'M1220 1252 c-96 -92 -238 -226 -315 -299 l-140 -132 215 -1 215 0 310 286 c171 157 317 292 325 300 12 12 -16 14 -210 14 l-225 -1 -175 -167z', delay: 350 },
]
const INK_PATHS = [
  { d: 'M1130 2024 l-360 -357 0 -143 0 -144 48 0 47 1 338 334 339 335 416 0 417 0 158 158 c86 86 157 161 157 165 0 4 -270 7 -600 7 l-600 0 -360 -356z', delay: 570 },
  { d: 'M1377 1672 c-75 -75 -137 -139 -137 -142 0 -3 187 -6 416 -7 l417 -2 66 62 c126 117 221 212 221 219 0 5 -190 8 -423 8 l-422 0 -138 -138z', delay: 830 },
]

export default function LogoMark({ size = 64, className = '', still = false }) {
  return (
    <svg viewBox="0 0 320 313" className={'logo-mark-svg' + (still ? '' : ' draw') + (className ? ' ' + className : '')}
      style={{ height: size, width: 'auto' }} aria-hidden focusable="false">
      <g transform="translate(0,313) scale(0.1,-0.1)">
        <g className="lm-lime">
          {LIME_PATHS.map((p, i) => <path key={i} className="lm-shape" pathLength="1" style={{ '--dd': p.delay + 'ms' }} d={p.d} />)}
        </g>
        <g className="lm-ink">
          {INK_PATHS.map((p, i) => <path key={i} className="lm-shape" pathLength="1" style={{ '--dd': p.delay + 'ms' }} d={p.d} />)}
        </g>
      </g>
    </svg>
  )
}
