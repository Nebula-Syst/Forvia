// Class types are fully custom per box (a CrossFit box and a yoga studio want different icons
// and colors, not a shared fixed "discipline" enum) — a type carries its own `icon` and `color`
// directly, copied through onto every template/session created from it, so rendering anywhere
// in the app is just reading those two fields off the object with a sane fallback, no lookup
// table needed. This module only holds the picker's option lists — mirrors api/server.js's
// CLASS_ICONS exactly, so a value the server accepts always has a matching icon here.
export const CLASS_ICONS = [
  'barbell', 'dumbbell', 'figureRun', 'kettlebell', 'stretch', 'boxing', 'bike', 'swim',
  'pullup', 'machine', 'plate', 'figureStrength', 'legs', 'abs', 'arm', 'flame', 'target',
  'trophy', 'medal', 'heart', 'timer', 'sparkles',
]
// Same 8 named accents already offered for the user's own theme (lib/format.js ACCENTS) —
// reusing that palette keeps the app's color vocabulary in one place instead of an unbounded
// color picker.
export const CLASS_COLORS = ['#a3e635', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#ff453a', '#40c8e0', '#ffd60a']

export const typeIcon = obj => (obj && obj.icon) || 'sparkles'
export const typeColor = obj => (obj && obj.color) || '#a3e635'
