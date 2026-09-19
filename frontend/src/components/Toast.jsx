import { useUI } from '../store/useUI.js'

// A single, always-mounted toast slot — cheaper than mounting/unmounting per message,
// and it means the CSS transition on `.show` always has something to animate from.
export default function Toast() {
  const message = useUI(state => state.toastMsg)
  const visible = Boolean(message)
  return <div id="toast" className={visible ? 'show' : ''}>{message}</div>
}
