import Icon from './Icon.jsx'
import LogoMark from './LogoMark.jsx'

// Shared top block for Login.jsx, SignIn.jsx, CreateAccount.jsx (App.jsx's own boot screen has
// its own, bigger, centred treatment now — .boot-loading, index.css). The mark sits at one fixed
// offset from the top (not vertically centred in whatever's left of the screen, which is what
// made it land at a different Y on each of these — they don't all have the same amount of
// content below it) so it never jumps when one screen swaps for another. `still` is Login.jsx's
// own case: it always arrives right after the boot screen already played the draw-in, so its own
// mark starts solid instead of replaying the same animation a second time in a row (which read as
// the animation glitching, not as a flourish). SignIn/CreateAccount keep the draw-in — reached by
// an actual button press to a genuinely new screen, not a repeat of what was just shown a moment
// ago. No beam/glow decoration here any more (dropped — read as a distracting colour wash rather
// than a flourish); just the plain mark.
export default function EntranceHeader({ title, onBack, brand, still }) {
  return (
    <div className="entrance-hdr">
      {onBack && <button className="iconbtn entrance-hdr-back" onClick={onBack} aria-label="Volver"><Icon name="chevronLeft" /></button>}
      <div className="login-mark">
        <LogoMark size={56} still={still} />
      </div>
      {title && <h1 className={'entrance-hdr-title' + (brand ? ' brand' : '')}>{title}</h1>}
    </div>
  )
}
