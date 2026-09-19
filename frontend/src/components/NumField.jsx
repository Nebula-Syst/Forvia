// Thin re-export: NumberField's real implementation lives in the shared control set
// (ui.jsx) so every numeric input in the app shares one focus/selection/validation
// behavior. This file only exists so older imports of `components/NumField.jsx`
// keep resolving without touching every call site.
import { NumberField } from './ui.jsx'

export default function NumField(props) {
  return <NumberField {...props} />
}
