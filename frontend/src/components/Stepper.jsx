// Thin re-export, same reasoning as NumField.jsx: the real +/- control lives once
// in ui.jsx so its tap targets and repeat-press behavior stay identical everywhere
// it's used, and this file just keeps the older `components/Stepper.jsx` import path alive.
import { Stepper as SharedStepper } from './ui.jsx'

export default function Stepper(props) {
  return <SharedStepper {...props} />
}
