// Live-class (host-run synced clock + step-through WOD, CoachClasses.jsx/BoxClasses.jsx/
// LiveClass.jsx) is built, wired end-to-end and tested — paused pending a redesign pass the
// user wants to do properly, not a rollback. Flip back to true to resume with nothing to
// rebuild; the waitlist-offer system and the "class already started" booking guard are
// separate features and keep working regardless of this flag.
export const LIVE_CLASSES_ENABLED = false
