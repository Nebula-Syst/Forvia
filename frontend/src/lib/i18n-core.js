// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, getLang). Plain Node-loadable — the browser-only pieces (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

// Suspended, not dropped: the other 9 locale packs (de/fr/it/pt/pl/tr/ru/zh/ko/hi) still
// live in full at src/locales/_suspended/ — moved out of src/locales/ so check-locales.mjs
// and this module's import.meta.glob both stop seeing them, which is what actually stops
// every new string from having to be translated 11 ways. Move a file back into
// src/locales/ and re-add its entry here to reactivate it; nothing was deleted.
export const LANGS = {
  en: 'English', es: 'Español',
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
// Exercise *names* (src/names/*.js) are a separate pack from instructions (src/instr/*.js) —
// the catalogue's 1300+ names were translated after instructions already existed for all ten
// INSTR_LANGS, so this starts at just the active locale rather than assuming parity with that
// list. Add a language here once its names/<lang>.js exists.
export const NAME_LANGS = ['es']
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

let lang = 'en'                 // set only by _setLangState, called from i18n.js setLang
let dict = {}                   // current locale pack (empty = English fallback)
let instr = null                // { exId: [steps] } for the current language, null = English
let names = null                // { exId: 'name' } for the current language, null = English
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// Name for an exercise in the current language (English catalogue name as fallback) — the
// dataset's own `n` never gets mutated, so export/print/import and any code that still reads
// `ex.n` directly keeps seeing the pristine English catalogue untouched.
export const nameFor = ex => (names && names[ex.id]) || ex.n

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`/`instr`/`names` may all be null to reset to English.
export function _setLangState(newLang, newDict, newInstr, newNames) {
  lang = LANGS[newLang] ? newLang : 'en'
  dict = lang === 'en' ? {} : (newDict || {})
  instr = lang === 'en' || !INSTR_LANGS.includes(lang) ? null : (newInstr || null)
  names = lang === 'en' || !NAME_LANGS.includes(lang) ? null : (newNames || null)
  version++
  return version
}
