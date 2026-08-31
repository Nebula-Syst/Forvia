// Same indirection as levelWatch.js's setLevelUpChecker/checkNowForLevelUp — lets the
// finish-workout flow (a plain function, not a component) tell a mounted TasksCard to
// re-fetch right after the server has actually graded the day's tasks, without a circular
// import from sheets.jsx into the component.
let _refresh = () => {}
export const setTasksRefresher = fn => { _refresh = fn }
export const refreshTasksNow = () => _refresh()
