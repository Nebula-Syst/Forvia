// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
// `opts` forwards straight to react-router's own navigate(to, opts) — e.g. { state } to hand
// data over to the next screen (NutritionFoodDetail reads a scanned food this way), or
// { replace } to not leave a dead entry in history.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
export const nav = (to, opts) => _nav(to, opts)
