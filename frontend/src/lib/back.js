// Android system back (the gesture and the hardware/nav button are the same event).
//
// Capacitor's BridgeActivity does not handle back at all — without a JS listener the
// activity simply finishes, so a back swipe quit the app from anywhere, whatever the
// WebView history said. That made the sheet history entries from #63 dead weight in the
// packaged app: they only ever worked in a browser tab, where the browser walks history
// itself.
//
// Once a `backButton` listener exists, the plugin stops falling through to finish() —
// back can then ONLY leave the app through App.exitApp(), which is why the last step is
// an explicit press-again-to-exit rather than a silent no-op.
import { useUI } from '../store/useUI.js'
import { t } from './i18n.js'

// How long a first back press stays armed as "press again to exit" (the toast shows 2.2s).
export const EXIT_WINDOW = 2000

// What a back press means, given what is on screen. Pure, so the table below is testable.
export function decideBack({ top, canGoBack, exitArmed }) {
  if (top) return top.locked ? 'ignore' : 'sheet'   // a locked sheet swallows back on purpose
  if (canGoBack) return 'history'                   // a page/tab we pushed ourselves
  return exitArmed ? 'exit' : 'arm-exit'
}

export function makeBackHandler({ getSheets, closeSheet, toast, goBack, exit, now = Date.now }) {
  let armedAt = -Infinity
  return (ev = {}) => {
    const sheets = getSheets()
    const action = decideBack({
      top: sheets[sheets.length - 1],
      canGoBack: !!ev.canGoBack,
      exitArmed: now() - armedAt < EXIT_WINDOW,
    })
    if (action !== 'arm-exit') armedAt = -Infinity
    if (action === 'sheet') closeSheet(sheets[sheets.length - 1].id)
    else if (action === 'history') goBack()
    else if (action === 'arm-exit') { armedAt = now(); toast(t('Press back again to exit')) }
    else if (action === 'exit') exit()
    return action
  }
}

// Registers the listener for the native shell. forvia-mobile is a thin WebView pointed at
// this same live site (no bundled build, no build-time flag — see its README), so whether
// we're inside it is a runtime check, not the old MOBILE build flag from before the shell
// was rebuilt. A plain browser tab or PWA never has window.Capacitor, so this stays a no-op
// there and the browser keeps walking its own history as usual.
export async function initBackButton() {
  if (!window.Capacitor?.isNativePlatform?.()) return () => {}
  try {
    const { App } = await import('@capacitor/app')
    const handler = makeBackHandler({
      getSheets: () => useUI.getState().sheets,
      closeSheet: id => useUI.getState().closeSheet(id),
      toast: msg => useUI.getState().toast(msg),
      goBack: () => window.history.back(),
      exit: () => App.exitApp(),
    })
    const sub = await App.addListener('backButton', handler)
    return () => sub.remove()
  } catch (e) {
    return () => {}   // plugin not registered on the native side (cap sync pending) — leave back alone
  }
}
