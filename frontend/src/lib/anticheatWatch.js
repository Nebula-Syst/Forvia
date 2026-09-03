// Same idiom as lib/levelWatch.js's setLevelUpChecker: lets a non-component module (useStore's
// pushState, which can't import a component file without a circular/layering mess) ask the
// mounted CheatRevealTrigger to check right now, instead of waiting for its poll interval — the
// moment a workout save actually lands is exactly when scanForCheating (api/server.js) might
// have just flagged it, so that's worth an immediate check rather than however long is left on
// the poll.
let _checkNow = () => {}
export const setCheatRevealChecker = fn => { _checkNow = fn }
export const checkNowForCheatReveal = () => _checkNow()
