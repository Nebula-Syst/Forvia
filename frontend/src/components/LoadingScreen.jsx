import LogoMark from './LogoMark.jsx'

// The app's one "this is loading" screen — big, centred mark on the real theme background
// (.boot-loading, index.css), used both for the cold-start boot check (App.jsx) and for the
// sign-in/create-account transition into the app (SignIn.jsx/CreateAccount.jsx), so entering the
// app after submitting credentials reads as a deliberate loading beat instead of the form
// snapping straight to Home.
export default function LoadingScreen() {
  return (
    <div className="boot-loading">
      <div className="entrance-beam" aria-hidden />
      <LogoMark size={180} />
    </div>
  )
}
