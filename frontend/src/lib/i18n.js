// Browser-only shell of the i18n module. The runtime-agnostic state and readers live
// in i18n-core.js (plain Node-loadable); this file adds the two pieces that genuinely need
// the browser: `setLang` (which lazy-loads locale packs via import.meta.glob) and the React
// subscription hook `useLang`.

import { useSyncExternalStore } from 'react'
import {
  LANGS, INSTR_LANGS, NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, instrFor, nameFor, getVersion, _setLangState, _setOverrides
} from './i18n-core.js'

export { LANGS, INSTR_LANGS, NAME_LANGS, DATE_LOCALES, getLang, dateLocale, t, instrFor, nameFor }

// Vite code-splits each locale pack into its own chunk via import.meta.glob; instructions and
// exercise names use the same mechanism in src/instr/ and src/names/. All three are lazy, so
// the production bundle ships English only.
const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const namePacks = import.meta.glob('../names/*.js')

// React subscription bookkeeping — kept here, not in core, so core has zero React coupling.
const subs = new Set()
const notify = () => { subs.forEach(f => f()) }

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === getLang() && getVersion() > 0) return
  let dict = {}, instr = null, names = null
  try {
    dict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
    instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default
    names = l === 'en' || !NAME_LANGS.includes(l) ? null : (await namePacks['../names/' + l + '.js']()).default
  } catch (e) { dict = {}; instr = null; names = null }
  _setLangState(l, dict, instr, names)
  notify()
}

// Fetched once at boot (useStore.js boot()) from GET /api/exercises/overrides and applied here
// so every already-mounted screen re-renders with the renamed exercises immediately, the same
// way switching language does.
export function setOverrides(list) {
  _setOverrides(list)
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getVersion)
}
