import Icon from './Icon.jsx'
import LogoMark from './LogoMark.jsx'

// Shared top block for every pre-auth screen — App.jsx's boot flash, Login.jsx, SignIn.jsx,
// CreateAccount.jsx. The mark sits at one fixed offset from the top (not vertically centred in
// whatever's left of the screen, which is what made it land at a different Y on each of these —
// they don't all have the same amount of content below it) so it never jumps when one screen
// swaps for another. `still` is Login.jsx's own case: it always arrives right after the boot
// screen already played the draw-in, so its own mark starts solid instead of replaying the same
// animation a second time in a row (which read as the animation glitching, not as a flourish).
// SignIn/CreateAccount keep the draw-in — reached by an actual button press to a genuinely new
// screen, not a repeat of what was just shown a moment ago.
//
// Visual direction picked from the 3-way mockup (design canvas, "B — Athletic"): a diagonal
// beam echoing the logo's own parallelogram accent instead of a generic radial glow, and a
// glow riding directly on the mark. `brand` is Login.jsx's own splash treatment (bigger,
// uppercase "FORVIA") — SignIn/CreateAccount keep a plain page-title weight for their title
// instead, since "INICIAR SESIÓN" shouted in caps reads as an error state, not a page name.
export default function EntranceHeader({ title, onBack, brand, still }) {
  return (
    <div className="entrance-hdr">
      <div className="entrance-beam" aria-hidden />
      {onBack && <button className="iconbtn entrance-hdr-back" onClick={onBack} aria-label="Volver"><Icon name="chevronLeft" /></button>}
      <div className="login-mark">
        <LogoMark size={56} still={still} />
      </div>
      {title && <h1 className={'entrance-hdr-title' + (brand ? ' brand' : '')}>{title}</h1>}
    </div>
  )
}
