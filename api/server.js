/* forvia-api — email/password auth + per-user state storage for Forvia
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import webpush from 'web-push';
import { WebSocketServer } from 'ws';
import { ensureSchema, loadAll, saveAll, loadAllStates, saveState, deleteState, appendAudit, auditAll, auditDeleteIds, auditClearAll } from './db.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
// Same polarity/default as ALLOW_GUEST — off only when the operator explicitly says so, since a
// closed instance means every account after the first one is created by an admin instead (see
// POST /api/admin/user/create), not self-service registration.
const ALLOW_REGISTER = !/^(0|false|no|off)$/i.test(process.env.ALLOW_REGISTER || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
// Base64 inflates ~33%, so the ~6MB compressed-photo cap enforced in /api/social/upload
// already needs ~8MB of headroom on its own before the surrounding {"dataUrl":"data:...","}
// JSON wrapper adds its own few dozen bytes on top — cutting MAX_BODY exactly at 8MB let that
// wrapper push a maximum-size photo's body just past the limit, which read as the generic
// "body too large" 500 instead of this route's proper 413. Comfortable headroom fixes both.
const MAX_BODY = 9 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';
// The only cross-origin request this API answers: the "apply for the alpha" form on the
// landing page, a *different* origin from the app itself (forvia.fit vs app.forvia.fit) with
// no session to prove it's really that page — CORS is the whole guard, so it's an explicit
// allowlist, never a wildcard, and only the one route below sets these headers at all.
const LANDING_ORIGINS = (process.env.LANDING_ORIGINS || 'https://forvia.fit,https://www.forvia.fit').split(',').map(s => s.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !LANDING_ORIGINS.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// Loaded from Postgres once boot()/main() runs, at the bottom of this file — see db.js for
// why this stays one big in-memory object instead of being queried per-request. Same shape
// db.json's arrays always had: users, subs (push), invites, follows, reactions, comments
// (social), tasks/taskCompletions (daily-task catalog + awards), cheatPenalties (anti-cheat).
let db = { users: [], subs: [], invites: [], follows: [], reactions: [], comments: [], tasks: [], taskCompletions: [], cheatPenalties: [], importLevelCaps: [], alphaRequests: [], bugReports: [], exerciseOverrides: [], muscleGroups: [], streakTiers: [], coachRequests: [], boxes: [], boxMemberships: [], boxInvites: [], routineAssignments: [], wods: [], wodResults: [], boxRequests: [], boxStaff: [], classTypes: [], dayTemplates: [], weekTemplates: [], wodTemplates: [], classSessions: [], classBookings: [], classPenalties: [], liveClasses: [], publicFoods: [], boxPlans: [] };
// A user can hold several employee types at once (e.g. both founder and admin), not one
// flat role — employeeTypes is an array, filtered to the known set on every read so a
// stale/tampered value in db.json can never grant something that isn't in EMPLOYEE_TYPES.
const EMPLOYEE_TYPES = ['founder', 'admin'];
const employeeTypesOf = user => Array.isArray(user?.employeeTypes) ? user.employeeTypes.filter(t => EMPLOYEE_TYPES.includes(t)) : [];
const isAdmin = user => !!user && (employeeTypesOf(user).length > 0 || ADMIN_UIDS.includes(user.id));
// The shape sent to the client for "who am I" — never the password hash/salt, just enough to
// know what email to prefill when changing it.
// No badge preference saved yet → default to showing rank (and prestige, once there is
// any) in the first slots, matching what used to be shown unconditionally. Once someone
// saves *any* selection (including clearing every slot) that explicit array wins forever.
const defaultBadges = rank => ['rank', ...(rank.prestige > 0 ? ['prestige'] : [])];
const badgesFor = (user, rank) => Array.isArray(user.badges) ? user.badges : defaultBadges(rank);
// Mirrors frontend/src/lib/rank.js TIERS (slug + level floor only — names/colors/art are
// display-only and live purely on the client). Needed here just to validate a showcase
// badge pick of 'rank:<slug>' against the level actually reached.
const RANK_TIER_MINS = { iron: 1, bronze: 11, silver: 21, gold: 31, platinum: 41, diamond: 51, master: 61, champion: 71, elite: 81, legend: 91 };
// Mirrors frontend/src/lib/streak.js FALLBACK_STREAK_TIERS — what a fresh instance (no
// admin-authored streak tiers yet) shows/validates against, so a showcase badge pick of
// 'streak:fallback-N' isn't rejected just because nobody's edited the admin list.
const FALLBACK_STREAK_TIERS = [
  { id: 'fallback-1', days: 1 }, { id: 'fallback-2', days: 3 }, { id: 'fallback-3', days: 7 },
  { id: 'fallback-4', days: 14 }, { id: 'fallback-5', days: 21 }, { id: 'fallback-6', days: 30 },
  { id: 'fallback-7', days: 60 }, { id: 'fallback-8', days: 100 }, { id: 'fallback-9', days: 180 },
  { id: 'fallback-10', days: 365 },
];

// Same URL shape GET /api/uploads already serves workout photos through — an avatar is just
// another file in that user's uploads dir, so it inherits that route's visibility rule for
// free (owner, or a currently-public account) without a new endpoint.
const avatarUrlOf = user => user.avatarFile ? `/api/uploads?uid=${encodeURIComponent(user.id)}&file=${encodeURIComponent(user.avatarFile)}` : null;
const publicUser = user => {
  const rank = rankFor(user.id);
  return {
    id: user.id, name: user.name, admin: isAdmin(user), employeeTypes: employeeTypesOf(user),
    // A real human coach managing a roster of athletes — granted manually by an admin after
    // reviewing a coachRequests application (POST /api/coach/apply), never self-serve. Plain
    // boolean, not part of EMPLOYEE_TYPES: this is an athlete-facing capability, not a staff role.
    coach: !!user.coach,
    // Personal-training marketplace opt-in (Settings → coach dashboard) — off by default even
    // once approved as a coach, since box-coaching and taking on personal-training clients are
    // separate decisions a coach makes independently. hourlyRate is theirs to set regardless of
    // coachVisible so they can fill it in before flipping the switch on.
    coachVisible: !!user.coachVisible, hourlyRate: user.hourlyRate ?? null,
    // A real geocoded place ({label, lat, lon} — GET /api/geo/search or /reverse), never free
    // text, so a browsing athlete can trust it. Kept even while coachVisible is off so
    // switching visibility on/off never loses what they'd already picked.
    coachLocation: user.coachLocation || null,
    // firstName/lastName are the real source of truth once set (see POST /api/account/name) —
    // `name` is still what the rest of the app reads to display someone, kept in sync from
    // the two parts server-side so nothing else has to change. null on accounts that have
    // never saved a split, so the client knows to offer its one-time best-guess split rather
    // than silently re-splitting `name` on every load (that re-guess was the actual bug: a
    // compound given name like "Jose Maria" doesn't have a real first/last boundary a splitter
    // can find, so re-deriving it every time undid any correction the person had made).
    firstName: user.firstName ?? null, lastName: user.lastName ?? null,
    username: user.username || null,
    public: !!user.public, rank, perks: perksFor(user.id),
    bio: user.bio || '', avatarUrl: avatarUrlOf(user),
    badges: badgesFor(user, rank),
    pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
    email: user.email || null, emailVerified: !!user.emailVerified, phone: user.phone || null,
    created: user.created || null,
    // Streak days themselves are never stored — they're always recomputed client-side from
    // S.workouts (frontend lib/history.js streakDays), same reasoning as the "backend has no
    // copy of the exercise catalog" comment elsewhere: this backend has no copy of a user's
    // workout history to compute it from either. This admin nudge (POST /api/admin/user/streak,
    // same +/- pattern as level/prestige) is added on top of that real number, not instead of
    // it — for testing/demoing a streak badge without hand-crafting weeks of workout history.
    streakBonus: user.streakBonus || 0,
    // The Free/Pro split (SettingsSubscription.jsx) — no billing yet, so this is only ever
    // flipped by an admin (POST /api/admin/user/pro) for testing, same posture as adminXpAdjust
    // before a real mechanism existed. Gates: perksFor's maxPhotos below, coaching (POST
    // /api/coach/apply), and prestiging (POST /api/prestige). Custom foods/saved meals' 5-item
    // cap for Free is frontend-only (sheets.jsx) — they live in the trusted per-user state blob
    // synced via PUT /api/data, not a discrete create endpoint, so there's nowhere server-side
    // to check this without touching that hot path.
    pro: !!user.pro,
  };
};
// A user's social presence to OTHER users — never leaks the auth-only fields above.
// Perks ride along here too: they're cosmetic flair, meant to be seen by other people
// (a legend frame, an animated name) — nothing sensitive about them.
const socialUser = user => ({
  id: user.id, name: user.name, username: user.username || null, perks: perksFor(user.id),
  bio: user.bio || '', avatarUrl: avatarUrlOf(user), badges: badgesFor(user, rankFor(user.id)),
  pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
  // Not sensitive (unlike admin, which gates real backend privilege) — a box roster or
  // leaderboard can show a "Coach" badge next to the box owner's name for free.
  coach: !!user.coach,
  // Only meaningful alongside coach:true and only when the coach opted in — the marketplace
  // listing (GET /api/coaches/marketplace) is exactly socialUser() rows already filtered to
  // coachVisible, so this rides along for free instead of a marketplace-specific serializer.
  hourlyRate: user.coach && user.coachVisible ? (user.hourlyRate ?? null) : null,
  coachLocation: user.coach && user.coachVisible ? (user.coachLocation || null) : null,
});
// Shared by GET /api/social/comments and the POST /api/social/comment response, so the
// field list only lives in one place.
const publicComment = c => {
  const author = db.users.find(u => u.id === c.userId) || {};
  return { id: c.id, userId: c.userId, name: author.name || '?', username: author.username || null, text: c.text, created: c.created };
};
// Fire-and-forget, same as the old atomicWrite(dbFile,...) call it replaces: every one of the
// ~40 call sites below just does `saveDb();` with no await and no return value, so this stays
// safe to call bare — a failed write is logged, never thrown, never blocks the response.
//
// saveAll does DELETE FROM <table>; INSERT ... per collection, which is only safe run one at a
// time. Two overlapping calls (two requests mutating db close together — the normal case under
// any real traffic) each open their own transaction; if the first commits its INSERT while the
// second's DELETE is still blocked on the same rows, Postgres unblocks that DELETE against
// whatever's *now* there — but a DELETE's row-scan doesn't retroactively pick up rows another
// transaction inserted after that scan started, so it deletes nothing further, and the second
// call's own INSERT lands on top: every row now exists twice (issue: kv_users found duplicated
// in production — two live rows per account). saveChain below is the fix: every saveDb() call
// is appended to one standing promise, so saveAll never runs concurrently with itself, and
// db.js is left as-is — the same fire-and-forget call site every caller already uses just queues
// instead of racing.
let saveChain = Promise.resolve();
function saveDb() {
  saveChain = saveChain.then(() => saveAll(db)).catch(e => console.error('saveDb failed:', e.message));
}

// Per-user training state (routines, workouts, bodyweight...) — same in-memory-mirror pattern
// as `db` above, backed by the user_state table instead of state-<uid>.json.
const stateCache = new Map();
function readState(uid) { return stateCache.get(uid) || null; }
function writeState(uid, state) {
  stateCache.set(uid, state);
  saveState(uid, state).catch(e => console.error('saveState failed:', uid, e.message));
}
function removeState(uid) {
  stateCache.delete(uid);
  deleteState(uid).catch(e => console.error('deleteState failed:', uid, e.message));
}

// PUT /api/data otherwise replaces a user's whole state with whatever the pushing device has
// locally — fine for settings and anything only ever edited in one place at a time, but
// catastrophic for `workouts` specifically: a second device or tab that hasn't caught up on a
// workout logged elsewhere yet, syncing for any unrelated reason (even just being opened),
// would silently overwrite the server's copy and erase that workout for good — no version
// history, nothing to restore from (issue: a real workout vanished this way in production).
// Workouts merge instead: union by id with whatever the server already has, so a workout
// present on EITHER side survives a stale push. An *intentional* delete (sheets.jsx's "Delete
// workout") has to travel as a small tombstone list (deletedWorkoutIds) rather than by simply
// omitting the id from the push — omission is exactly what a stale device's push already looks
// like, so it's the one signal that can't tell the two apart. Tombstones merge the same way
// (union, newest `at` wins) and age out after TOMBSTONE_MAX_AGE_MS — long enough that no
// realistic offline gap outruns it, short enough the list never grows unbounded.
const TOMBSTONE_MAX_AGE_MS = 180 * 86400000;
// Shared by mergeWorkoutsInto and mergeFoodDiaryInto below: union two {id, at} tombstone lists,
// newest `at` wins per id, and anything older than TOMBSTONE_MAX_AGE_MS is dropped so the list
// never grows unbounded.
function mergeTombstones(a, b) {
  const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
  const byId = new Map();
  for (const t of [...(a || []), ...(b || [])]) {
    if (!t?.id || !((t.at || 0) >= cutoff)) continue;
    const cur = byId.get(t.id);
    if (!cur || (t.at || 0) > (cur.at || 0)) byId.set(t.id, t);
  }
  return byId;
}
// Returns whether this merge actually introduced a new imported workout (id prefix 'iw', same
// convention the anti-cheat overlap exemption uses) — the signal capImportLevelGain needs to
// know an import just landed, as opposed to a normal device sync of native workouts.
function mergeWorkoutsInto(uid, incoming) {
  const prev = readState(uid);
  const prevIds = new Set((prev?.workouts || []).map(w => w?.id).filter(Boolean));
  const tombById = mergeTombstones(prev?.deletedWorkoutIds, incoming.deletedWorkoutIds);
  const workoutById = new Map();
  for (const w of (prev?.workouts || [])) if (w?.id) workoutById.set(w.id, w);
  for (const w of (incoming.workouts || [])) if (w?.id) workoutById.set(w.id, w);
  for (const id of tombById.keys()) workoutById.delete(id);
  incoming.workouts = [...workoutById.values()];
  incoming.deletedWorkoutIds = [...tombById.values()];
  return incoming.workouts.some(w => !prevIds.has(w.id) && typeof w.id === 'string' && w.id.startsWith('iw'));
}
// Applies the fixed-XP-budget cap (see IMPORT_XP_BUDGET) against the level an import just
// produced. Called after the merged state is already written, so rankFor(uid) here reflects the
// real, anti-cheat-adjusted post-import total — the workouts themselves are never touched, only
// how many of the levels they're worth show up right away (same lever as a cheat penalty, via
// levelsDockedFor, but never marked as one: nothing here is flagged, appealable, or hidden).
function capImportLevelGain(uid, beforeLevel) {
  const allowedMaxLevel = Math.min(100, levelFromXp(LEVEL_CUM[beforeLevel - 1] + IMPORT_XP_BUDGET));
  const afterLevel = rankFor(uid).level;
  if (afterLevel <= allowedMaxLevel) return;
  db.importLevelCaps.push({
    id: crypto.randomBytes(8).toString('base64url'), userId: uid,
    levels: afterLevel - allowedMaxLevel, created: new Date().toISOString(),
  });
  saveDb();
}

// Same fix, same reasoning, for the nutrition diary (issue: a full week of logged food vanished
// this way in production — foodDiary had never gotten the merge-by-id treatment workouts got).
// foodDiary is date-keyed rather than one flat array, so the union-by-id merge runs once per day
// (the union of every day either side knows about) instead of once overall.
function mergeFoodDiaryInto(uid, incoming) {
  const prev = readState(uid);
  const tombById = mergeTombstones(prev?.deletedFoodEntryIds, incoming.deletedFoodEntryIds);
  const days = new Set([...Object.keys(prev?.foodDiary || {}), ...Object.keys(incoming.foodDiary || {})]);
  const merged = {};
  for (const day of days) {
    const byId = new Map();
    for (const it of (prev?.foodDiary?.[day] || [])) if (it?.id) byId.set(it.id, it);
    for (const it of (incoming.foodDiary?.[day] || [])) if (it?.id) byId.set(it.id, it);
    for (const id of tombById.keys()) byId.delete(id);
    merged[day] = [...byId.values()];
  }
  incoming.foodDiary = merged;
  incoming.deletedFoodEntryIds = [...tombById.values()];
}

/* ---------- workout photos ---------- */
// Stored on disk under DATA/uploads/<uid>/, served back through GET /api/uploads?uid&file —
// through the API rather than a static nginx mount, so the one visibility rule (owner or a
// currently-public account) applies without touching the web container at all.
const UPLOAD_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const uploadsDir = uid => path.join(DATA, 'uploads', uid.replace(/[^a-zA-Z0-9_-]/g, ''));
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Coach-application proof documents (a certification, an ID card) — same uploads dir as photos,
// but PDFs are a real, common case here (photos aren't), so this is its own mime map rather than
// widening UPLOAD_MIME (which every photo-upload call site assumes is images-only).
const DOCUMENT_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/* ---------- WebSocket (real-time push to an already-open app) ---------- */
// sendPush below reaches a closed app; this reaches an open one instantly, no polling involved.
// One WS server, attached to the exact same http.Server the REST API already listens on (no
// second port to expose or proxy) — auth reuses the same session cookie every HTTP route already
// trusts, checked once at the upgrade handshake (see main()'s `server.on('upgrade', ...)`).
// SameSite=Lax on that cookie (sessionCookie above) is what already keeps a cross-site page from
// riding along on fetch/XHR; the same protection covers this WS handshake for the same reason —
// no separate origin check needed, consistent with every POST route here trusting it too.
const wsByUser = new Map();   // userId -> Set<WebSocket>
function wsSend(userId, payload) {
  const set = wsByUser.get(userId);
  if (!set || !set.size) return;
  const body = JSON.stringify(payload);
  for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(body); }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
// Used to be gated on effectiveRoutineId (S.week/S.dayPlan) and skipped rest days; there's
// no weekly schedule left to consult (routines are picked freely each session), so this now
// just checks whether *anything* was logged today rather than whether something was "planned".
function reminderTick() {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    console.log('reminder firing', user.id);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: 'Workout reminder',
      body: "You haven't logged a workout today — let's go 💪",
      tag: 'day-reminder'
    });
  }
}
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
// Registered from main() below, once boot has loaded db/stateCache from Postgres.

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<sid>`, where `sid` is the id of one entry in that user's
// `sessions` array (see makeSession below) — the per-device session record that array entry
// represents is the sole source of truth for whether a cookie is still valid. Revoking one
// device (POST /api/account/sessions/revoke) removes just that entry; "sign out everywhere"
// (POST /api/logout/all) empties the whole array. There is no version-counter fallback — this
// replaced that mechanism outright, so every cookie issued before this change stops verifying
// (its payload has no matching session record) and everyone signs in again once.
function parseSessionCookie(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, sid] = payload.split(':');
  if (!uid || !sid || +exp < Date.now()) return null;
  return { uid, exp: +exp, sid };
}
function makeSession(user, req) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const sess = {
    id: crypto.randomBytes(9).toString('base64url'),
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ua: (req?.headers['user-agent'] || '').slice(0, 200),
  };
  if (!Array.isArray(user.sessions)) user.sessions = [];
  user.sessions.push(sess);
  saveDb();
  return sign(user.id + ':' + exp + ':' + sess.id);
}
function readSession(req) {
  const parsed = parseSessionCookie(req);
  if (!parsed) return null;
  const user = db.users.find(u => u.id === parsed.uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  if (!(user.sessions || []).find(s => s.id === parsed.sid)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  // Only the 403 is recorded: a 401 is any unauthenticated bot poking /api/admin/*, and
  // logging those would bury the events an operator actually wants to see.
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user, req) {
  return `gymsid=${makeSession(user, req)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- password login ---------- */
// scrypt, not bcrypt: Node ships it, so password login doesn't add a third dependency to a
// project that advertises having only two. 64-byte derived key, per-user random salt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const findByEmail = email => {
  const norm = String(email || '').trim().toLowerCase();
  return norm ? db.users.find(u => (u.email || '').toLowerCase() === norm) : null;
};

/* ---------- outbound email (account email verification only) ---------- */
// Hand-rolled SMTP client, not a dependency — same call as scrypt over bcrypt above: this
// project ships with exactly one dependency (web-push), and a plain SMTP conversation
// (EHLO/[STARTTLS]/AUTH LOGIN/MAIL FROM/RCPT TO/DATA) is a small, well-documented protocol
// that doesn't earn adding nodemailer just to send one kind of message. Best-effort: every
// caller treats a false return as "couldn't send" and tells the user, never as a hard error.
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = +(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = /^(1|true|yes|on)$/i.test(process.env.SMTP_SECURE || '') || SMTP_PORT === 465;
const ORIGIN_HOST = (() => { try { return new URL(ORIGIN).hostname; } catch { return 'localhost'; } })();
const SMTP_FROM = process.env.SMTP_FROM || `Forvia <no-reply@${ORIGIN_HOST}>`;
const SMTP_CONFIGURED = !!SMTP_HOST;

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = d => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) { cleanup(); resolve(buf); }
    };
    const onErr = e => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error('connection closed')); };
    function cleanup() { socket.removeListener('data', onData); socket.removeListener('error', onErr); socket.removeListener('close', onClose); }
    socket.on('data', onData);
    socket.once('error', onErr);
    socket.once('close', onClose);
  });
}
async function smtpCmd(socket, line) {
  if (line != null) socket.write(line + '\r\n');
  const r = await smtpRead(socket);
  if (!/^2/.test(r) && !/^3/.test(r)) throw new Error('SMTP ' + r.trim().split('\r\n').pop());
  return r;
}
async function connectPlain() {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: SMTP_HOST, port: SMTP_PORT });
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
}
async function upgradeTls(socket, servername) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket, host: SMTP_HOST, servername }, () => resolve(s));
    s.once('error', reject);
  });
}
async function sendMail({ to, subject, text }) {
  if (!SMTP_CONFIGURED) return false;
  let socket = null;
  try {
    socket = SMTP_SECURE ? await upgradeTls(await connectPlain(), SMTP_HOST) : await connectPlain();
    await smtpRead(socket);   // 220 greeting
    let r = await smtpCmd(socket, `EHLO ${ORIGIN_HOST}`);
    if (!SMTP_SECURE && /STARTTLS/i.test(r)) {
      await smtpCmd(socket, 'STARTTLS');
      socket = await upgradeTls(socket, SMTP_HOST);
      await smtpCmd(socket, `EHLO ${ORIGIN_HOST}`);
    }
    if (SMTP_USER) {
      await smtpCmd(socket, 'AUTH LOGIN');
      await smtpCmd(socket, Buffer.from(SMTP_USER).toString('base64'));
      await smtpCmd(socket, Buffer.from(SMTP_PASS).toString('base64'));
    }
    const fromAddr = (SMTP_FROM.match(/<([^>]+)>/) || [, SMTP_FROM])[1];
    await smtpCmd(socket, `MAIL FROM:<${fromAddr}>`);
    await smtpCmd(socket, `RCPT TO:<${to}>`);
    await smtpCmd(socket, 'DATA');
    const body = [`From: ${SMTP_FROM}`, `To: ${to}`, `Subject: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', text, '.'].join('\r\n');
    await smtpCmd(socket, body);
    await smtpCmd(socket, 'QUIT').catch(() => {});
    socket.end();
    return true;
  } catch (e) {
    console.error('sendMail failed:', e.message);
    try { socket && socket.destroy(); } catch {}
    return false;
  }
}

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- audit log ---------- */
// Who signed in, who tried and failed, and what an admin changed. One JSON object per line in
// ./data/audit.log, appended and never rewritten in place. It deliberately does not live in
// db.json: that file is rewritten whole on every save, and the login/register handshakes are
// unauthenticated and unthrottled by design (see SECURITY.md), so an audit trail in there would
// turn one bogus request into a full db.json rewrite. A line torn by a crash costs one event and
// is dropped on read.
//
// On by default. It records strictly less than the instance already holds — every account is in
// db.json and every workout is in state-<uid>.json, both readable by any admin — and a security
// feature that ships switched off protects nobody. IP addresses are the exception: off unless you
// ask for them, because they are the one field here that says where somebody physically is.
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);     // 0 = no count cap
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);     // 0 = no age cap
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
let auditSeq = 0;      // never reset, not even by a clear — a wiped log leaves a visible id gap
let auditCount = 0;
let auditCache = [];   // in-memory mirror of the audit_log table, same pattern as db/stateCache

// Which header holds the caller depends on what is in front of the API. CF-Connecting-IP comes
// first because a Cloudflare tunnel does NOT forward the client in X-Forwarded-For — that header
// then only carries the tunnel's own container, which looks like a valid answer and isn't. After
// that, the first entry of X-Forwarded-For is the client and everything behind it is our own hops.
// All three are only as trustworthy as the proxy in front: it has to overwrite them rather than
// pass a client-supplied one through. In 'net' mode only the network survives — enough to tell
// one source from another, not enough to point at a person.
function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const raw = String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;    // never store a header verbatim
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}

// Retention is a cap, not an archive: age first, then the newest AUDIT_MAX of what's left.
function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}
// Called from main() at boot (seeds auditCache/auditSeq/auditCount from Postgres) and hourly
// after that, same cadence the old file-compaction pass ran on.
function pruneAudit() {
  const keep = auditKeep(auditCache);
  auditCount = keep.length;
  if (keep.length === auditCache.length) return;
  const keepIds = new Set(keep.map(r => r.id));
  const dropIds = auditCache.filter(r => !keepIds.has(r.id)).map(r => r.id);
  auditCache = keep;
  auditDeleteIds(dropIds).catch(e => console.error('audit prune failed:', e.message));
}

// Never throws: a log that can't be written must not break signing in. The Postgres write is
// fire-and-forget (see saveDb above) — auditCache itself is updated synchronously first, so a
// GET /api/admin/audit right after this always sees the new row regardless of write timing.
function audit(req, ev, f = {}) {
  if (!AUDIT_ON) return;
  const rec = { id: ++auditSeq, ts: Date.now(), ev, ok: f.ok !== false };
  if (f.user) { rec.uid = f.user.id; rec.name = String(f.user.name || '').slice(0, 40); }
  else {
    if (f.uid) rec.uid = f.uid;
    if (f.name) rec.name = String(f.name).slice(0, 40);
  }
  if (f.target) { rec.tgt = f.target.id; rec.tname = String(f.target.name || '').slice(0, 40); }
  if (f.msg) rec.msg = String(f.msg).slice(0, 120);
  const ip = clientIp(req);
  if (ip) rec.ip = ip;
  auditCache.push(rec);
  auditCount++;
  appendAudit(rec).catch(e => console.error('audit write failed:', e.message));
  // Amortized: a 5000-event cap prunes once per ~1250 events.
  if (AUDIT_MAX && auditCount > AUDIT_MAX * 1.25) pruneAudit();
}

/* ---------- social (opt-in: follow, feed, reactions, comments, leaderboard) ---------- */
// weekKey/streakWeeks are ports of frontend/src/lib/format.js + history.js's exact algorithm
// (ISO week number) — kept in sync by hand since the backend doesn't share code with the
// frontend bundle. If that frontend logic ever changes, mirror the change here too.
function weekKeyOf(iso) {
  const dt = new Date(iso + 'T12:00:00');
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day + 3);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return dt.getFullYear() + '-' + week;
}
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function streakWeeksOf(workouts) {
  if (!workouts.length) return 0;
  const weeks = new Set(workouts.map(w => weekKeyOf(w.d)));
  let streak = 0;
  const cur = new Date();
  for (let i = 0; i < 520; i++) {
    if (weeks.has(weekKeyOf(isoOf(cur)))) streak++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}
function statsFor(uid) {
  const S = readState(uid) || {};
  const workouts = S.workouts || [];
  const thisWeek = workouts.filter(w => weekKeyOf(w.d) === weekKeyOf(isoOf(new Date()))).length;
  return { streak: streakWeeksOf(workouts), thisWeek };
}
// Day-count streak (consecutive calendar days with a logged workout, counting back from
// today) plus the admin bonus on top — mirrors frontend/src/lib/history.js streakDays(S)
// exactly, since that's what the streak-badge day thresholds are checked against (both in
// the UI and here, validating a showcase badge pick of 'streak:<tierId>').
function currentStreakDays(uid) {
  const workouts = (readState(uid) || {}).workouts || [];
  let streak = 0;
  if (workouts.length) {
    const days = new Set(workouts.map(w => w.d));
    const cur = new Date();
    let gap = 0;
    for (let i = 0; i < 3650; i++) {
      if (days.has(isoOf(cur))) { streak++; gap = 0; }
      else if (i > 0) { gap++; if (gap > 3) break; }
      cur.setDate(cur.getDate() - 1);
    }
  }
  const user = db.users.find(u => u.id === uid);
  return Math.max(0, streak + (user?.streakBonus || 0));
}

/* ---------- rank / level ---------- */
// XP needed to go from level n to n+1 grows quadratically — brisk early (a solid first
// week already levels you up a few times) and a genuine grind near the cap: level 98→99
// costs ~2200 XP, roughly 2-3 months for someone training consistently and clearing a
// few tasks a day. 100 levels total, no reset — tune XP_FOR_LEVEL/the per-action XP
// below if that pace ends up feeling off in practice.
const XP_FOR_LEVEL = n => 80 + Math.round(0.22 * n * n);
const LEVEL_CUM = [0];   // LEVEL_CUM[L] = total XP to *reach* level L+1; LEVEL_CUM[0] = level 1's floor
for (let n = 1; n <= 100; n++) LEVEL_CUM.push(LEVEL_CUM[n - 1] + XP_FOR_LEVEL(n));
// A CSV import can bring in months of real history in one save, which would otherwise level an
// account up far more than any single normal training session could. Cap it with a *fixed* XP
// budget — however much it costs to climb from level 20 to 50 on the curve above — granted no
// matter where the account currently sits. Because the curve is quadratic, that same budget
// plays out as the full 30-level jump only when starting low; someone already at level 70 buys
// far fewer levels with it, since level 70+ costs so much more per level. No separate per-level
// case needed — it falls out of reusing the real curve instead of a flat level-count cap.
const IMPORT_XP_BUDGET = LEVEL_CUM[50 - 1] - LEVEL_CUM[20 - 1];
function levelFromXp(xp) {
  let lvl = 1;
  for (let L = 2; L <= 100; L++) { if (xp >= LEVEL_CUM[L - 1]) lvl = L; else break; }
  return lvl;
}
const PR_XP = 15, GOAL_XP = 150;
// A workout's XP scales with what was actually done, not just that it happened — sets and
// exercises are the load-independent baseline (rewards showing up and covering the body, and
// keeps a bodyweight-only session from scoring near zero just because it has no weight to its
// name), volume is the intensity layer on top. sqrt on volume, not linear: 4x the volume is 2x
// the XP, so one monster deadlift set can't dwarf the rest of a balanced session, and there's
// no reward for inflating a single number over training more. Constants are tuned so a
// solid, unremarkable session (~4 exercises, ~12 sets, moderate load) lands close to the old
// flat 25 XP/workout the level curve (XP_FOR_LEVEL below) was paced around — a token
// single-set "workout" now earns much less, a genuinely big or heavy one notably more.
const XP_PER_SET = 1, XP_PER_EXERCISE = 2, XP_PER_SQRT_1000_VOL = 2;
function workoutXp(w) {
  const entries = w?.entries || [];
  let sets = 0;
  const exercises = new Set();
  entries.forEach(e => {
    const done = (e.sets || []).filter(s => s?.done).length;
    if (done > 0) exercises.add(e.id);
    sets += done;
  });
  // Prefer the volume already stored on the finished workout (workoutVolume(), computed
  // client-side the same way prs is below) — recomputing here is just the fallback for a
  // record from before `vol` was persisted.
  const vol = typeof w?.vol === 'number' ? w.vol
    : entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (s?.done ? (s.w || 0) * (s.r || 0) : 0), 0), 0);
  const volumeXp = Math.round(XP_PER_SQRT_1000_VOL * Math.sqrt(Math.max(0, vol) / 1000));
  return sets * XP_PER_SET + exercises.size * XP_PER_EXERCISE + volumeXp;
}
// --- anti-cheat -----------------------------------------------------------------------
// Rank perks now include a real payoff (subscriptionDiscount, Prestige 5/10), so a
// fabricated workout isn't just a harmless vanity number any more — it's worth actually
// defending against, not merely nudging (setLooksOff, frontend/src/lib/history.js, is the
// same idea but a dismissible UI hint; a client can just not show it). This runs
// server-side, on the data actually being written, where a client can't opt out.
const CHEAT_MAX_WEIGHT = { kg: 500, lb: 1100 };   // beyond any recorded human lift, any exercise
const CHEAT_MAX_REPS = 100;                       // in one set, regardless of exercise
const CHEAT_MAX_DURATION_MS = 8 * 3600 * 1000;    // longer than this in one sitting isn't training
const CHEAT_MAX_LEVELS = 5;                       // hardest a single workout can ever dock

// The detection table — this is the thing to extend when a new cheat pattern turns up, not
// scanForCheating below. Each row's check(w, ctx) returns a severity RATIO: how far past its
// own threshold this workout is (1.0 = right at the line, 20 = 20x over), or 0/falsy if this
// row doesn't apply. severityTier() turns that ratio into a 1-5 level docking, so grading a new
// rule is just "how far past the limit is bad" — no separate penalty math to write. `ctx` is
// built once per workout (computeCtx below) with the facts most rules need, so a new row
// usually only needs to read from it, not recompute anything.
//
// No pace-of-sets rule on purpose: a short real session (or a quick admin/QA pass through the
// app) looks identical to it — "N sets in not much wall-clock time" — and there's no threshold
// that catches fabricated speed without also catching an ordinary quick workout.
const CHEAT_RULES = [
  { id: 'weight', label: 'Weight beyond any recorded human lift', check: (w, ctx) => ctx.maxWeight / ctx.maxWeightAllowed },
  { id: 'reps', label: 'More reps in one set than physically possible', check: (w, ctx) => ctx.maxReps / CHEAT_MAX_REPS },
  { id: 'prs', label: 'More new records claimed than exercises actually trained', check: (w, ctx) => ctx.exCount > 0 ? (w.prs?.length || 0) / ctx.exCount : ((w.prs?.length || 0) > 0 ? CHEAT_MAX_LEVELS : 0) },
  { id: 'timing', label: 'Missing or nonsensical start/end time', check: (w, ctx) => ctx.badTiming ? CHEAT_MAX_LEVELS : 0 },
  { id: 'duration', label: 'Session longer than a real workout', check: (w, ctx) => ctx.badTiming ? 0 : ctx.durationMs / CHEAT_MAX_DURATION_MS },
  { id: 'overlap', label: 'Overlaps another logged session for the same account', check: (w, ctx) => ctx.overlapsAnother ? 3 : 0 },
];
// Ratio → levels docked. Deliberately generous — 1.0-1.2x over a limit is "worth a second
// look" (tier 1), not "definitely cheating" (tier 5 needs a full order of magnitude over).
// A genuine elite lift, a long honest session, or a real string of PRs must never clear even
// tier 1 — every CHEAT_* threshold above already has that headroom built in.
function severityTier(ratio) {
  if (!(ratio > 1)) return 0;
  if (ratio >= 20) return 5;
  if (ratio >= 5) return 4;
  if (ratio >= 2) return 3;
  if (ratio >= 1.2) return 2;
  return 1;
}
function cheatCtxFor(w, unit, allWorkouts) {
  const entries = w?.entries || [];
  let sets = 0, maxWeight = 0, maxReps = 0;
  const exSeen = new Set();
  entries.forEach(e => (e.sets || []).forEach(s => {
    if (!s?.done) return;
    sets++;
    exSeen.add(e.id);
    maxWeight = Math.max(maxWeight, Number(s.w) || 0);
    maxReps = Math.max(maxReps, Number(s.r) || 0);
  }));
  const start = Number(w?.start), end = Number(w?.end);
  const durationMs = end - start;
  const badTiming = !(start > 0) || !(end > 0) || durationMs <= 0;
  // Two overlapping entries are only a cheating signal between two *live-logged* sessions —
  // impossible to have honestly trained both at once. An imported workout (frontend/src/lib/
  // import-csv.js's buildWorkoutsFromByDate, hence the 'iw' id prefix) overlapping a native one
  // is the expected, harmless shape of the exact same real session tracked in both apps during
  // a switch-over, not fabrication — real incident: importing a history that overlapped
  // already-logged days got both copies flagged and docked levels for it.
  const isImported = id => typeof id === 'string' && id.startsWith('iw');
  const overlapsAnother = !badTiming && !isImported(w?.id) && allWorkouts.some(o => o !== w && o.id !== w.id && !isImported(o.id) && Number(o.start) > 0 && Number(o.end) > 0 && start < Number(o.end) && Number(o.start) < end);
  return { sets, exCount: exSeen.size, maxWeight, maxReps, maxWeightAllowed: CHEAT_MAX_WEIGHT[unit] || CHEAT_MAX_WEIGHT.kg, start, end, durationMs, badTiming, overlapsAnother };
}
// Every rule's finding for one workout, worst-first. A workout's overall penalty is its single
// worst finding, not the sum of all of them — five mild oddities together aren't the same
// judgment as one blatant one, and summing would make stacking unrelated near-misses punish
// harder than a lone unmistakable violation.
function cheatFindingsFor(w, unit, allWorkouts) {
  const ctx = cheatCtxFor(w, unit, allWorkouts);
  return CHEAT_RULES
    .map(rule => ({ id: rule.id, label: rule.label, ratio: rule.check(w, ctx) || 0 }))
    .filter(f => f.ratio > 1)
    .map(f => ({ ...f, levels: severityTier(f.ratio) }))
    .sort((a, b) => b.levels - a.levels);
}
// Scans everything currently stored (cheap at self-hosted scale, and it means a workout
// logged before this existed still gets caught on the next save) but only ever penalizes a
// given workoutId once. Called from PUT /api/data, BEFORE the write it's scoring — a flagged
// workout is pulled out of `state.workouts` entirely (its only copy becomes the one embedded
// in the penalty row below) rather than left sitting in plain view with just a level docked
// against it: xpFor/feedItemsFor/history/social all read state.workouts, so removing it from
// there is what actually blocks and hides it everywhere at once, not a filter that has to be
// remembered in every place that reads workouts. Overturning (POST /api/admin/anticheat/review)
// puts it back; upholding leaves it out for good. A penalty row is therefore also the ONLY
// durable copy of a workout while it's pending or upheld — real data, never discarded, same
// spirit as the workout-merge fix above (issue: a flagged, later-overturned workout vanished
// from production because nothing kept a copy of it once it left state.workouts).
function scanForCheating(req, user, state) {
  const workouts = state.workouts || [];
  const unit = state.unit || 'kg';
  const today = isoOf(new Date());
  const penaltyByWorkoutId = new Map(db.cheatPenalties.filter(c => c.userId === user.id).map(c => [c.workoutId, c]));
  let flaggedMsgs = [];
  const keep = [];
  workouts.forEach(w => {
    if (!w?.id) { keep.push(w); return; }
    const existing = penaltyByWorkoutId.get(w.id);
    if (existing) {
      // Already ruled on. Overturned = fully cleared, belongs back in normal history (a client
      // that still has its own old copy locally and pushes it again just lands here). Anything
      // still pending or upheld must stay excluded even if a stale device pushes its own copy —
      // that push is exactly what "not reviewed yet" looks like from here, not new information.
      if (existing.status === 'overturned') keep.push(w);
      return;
    }
    const findings = cheatFindingsFor(w, unit, workouts);
    if (!findings.length) { keep.push(w); return; }
    const levels = Math.min(CHEAT_MAX_LEVELS, findings[0].levels);
    // Snapshotted once, right before this penalty lands — not recomputed later — so the
    // reveal's countdown always starts from exactly where the account really stood the moment
    // it got caught, not wherever XP happens to sit whenever the animation finally plays.
    const before = rankFor(user.id);
    db.cheatPenalties.push({
      id: crypto.randomBytes(8).toString('base64url'), userId: user.id, workoutId: w.id, workout: w, unit,
      findings, levels, date: today, created: new Date().toISOString(),
      status: 'active',   // 'active' | 'appealed' | 'upheld' | 'overturned'
      appeal: null,        // { message, created } once the account holder disputes it
      seen: false,          // flips true once the "caught you" reveal has actually played
      beforeLevel: before.level, beforeXpInLevel: before.xpInLevel, beforeXpForLevel: before.xpForLevel,
    });
    flaggedMsgs.push(w.id + ':' + findings.map(f => f.id).join(',') + '=' + levels + 'lvl');
    // Not pushed to `keep` — excluded from this save, its only surviving copy is the row above.
  });
  state.workouts = keep;
  if (flaggedMsgs.length) {
    saveDb();
    audit(req, 'anticheat.flag', { user, msg: flaggedMsgs.join(' | ').slice(0, 120) });
    // WS reaches an open app instantly (CheatRevealTrigger listens for this exact type — see
    // frontend/src/lib/ws.js); push (below) reaches a closed one. Both fire the same moment.
    wsSend(user.id, { type: 'anticheat:flagged' });
    sendPush(user.id, {
      title: '⚠️ Workout flagged',
      body: flaggedMsgs.length === 1 ? 'A recent workout was flagged for review — see Penalties in Settings.' : `${flaggedMsgs.length} recent workouts were flagged for review — see Penalties in Settings.`,
      tag: 'anticheat-flag',
    });
  }
}

// A task's catalog entry is still admin-authored text (name/desc/points), but whether it's
// DONE is never self-reported any more — it's graded against the day's real workout data,
// same trust model as CHEAT_RULES above. bp is one of the ten raw EXDB body-part keys; the
// backend has no copy of the exercise catalog, so entries carry their own bp at finish time
// (see finish-workout.js's bpFor) rather than the server resolving id → body part itself.
const TASK_CRITERIA_TYPES = ['finish_workout', 'sets', 'minutes', 'body_part'];
const TASK_BODY_PARTS = ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist'];
function taskCriteriaMet(criteria, dayWorkouts) {
  if (!criteria || !TASK_CRITERIA_TYPES.includes(criteria.type)) return false;
  switch (criteria.type) {
    case 'finish_workout':
      return true; // dayWorkouts is already non-empty by the time this is checked
    case 'sets': {
      const sets = dayWorkouts.reduce((n, w) => n + (w.entries || []).reduce((m, e) => m + (e.sets || []).filter(s => s?.done).length, 0), 0);
      return sets >= Math.max(1, +criteria.n || 1);
    }
    case 'minutes': {
      const ms = dayWorkouts.reduce((n, w) => {
        const start = Number(w.start), end = Number(w.end);
        return n + (start > 0 && end > start ? end - start : 0);
      }, 0);
      return ms >= Math.max(1, +criteria.n || 1) * 60000;
    }
    case 'body_part':
      return dayWorkouts.some(w => (w.entries || []).some(e => e.bp === criteria.bp && (e.sets || []).some(s => s?.done)));
    default:
      return false;
  }
}
// The catalog can hold as many tasks as an admin adds, but only DAILY_TASKS_LIMIT are ever
// live on a given day — same rotating set for every account, deterministic from the date
// alone, so it's stable across requests within the day and identical for everyone (no
// per-user random state to store). A task not in today's rotation is invisible AND
// uncompletable today — scanForTasks below filters through this too, so "only 3 a day" is
// a real cap, not just what the list happens to show.
const DAILY_TASKS_LIMIT = 3;
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed || 1;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function tasksForToday() {
  const today = isoOf(new Date());
  return seededShuffle(db.tasks, hashStr(today)).slice(0, DAILY_TASKS_LIMIT);
}

// Mirrors scanForCheating: scans what's already stored, dedupes on (userId, taskId, date) via
// db.taskCompletions itself, called from PUT /api/data right after the write.
function scanForTasks(req, user, state) {
  const todaysTasks = tasksForToday();
  if (!todaysTasks.length) return;
  const today = isoOf(new Date());
  const dayWorkouts = (state.workouts || []).filter(w => w?.d === today);
  if (!dayWorkouts.length) return;
  const already = new Set(db.taskCompletions.filter(c => c.userId === user.id && c.date === today).map(c => c.taskId));
  const awarded = [];
  todaysTasks.forEach(task => {
    if (already.has(task.id) || !taskCriteriaMet(task.criteria, dayWorkouts)) return;
    db.taskCompletions.push({ id: crypto.randomBytes(8).toString('base64url'), userId: user.id, taskId: task.id, points: task.points, date: today, created: new Date().toISOString() });
    awarded.push(task.name);
  });
  if (awarded.length) {
    saveDb();
    audit(req, 'task.auto_complete', { user, msg: awarded.join(', ').slice(0, 120) });
  }
}
// Streak bonus is a Pro perk (SettingsSubscription.jsx) and a real XP multiplier, not just a
// badge — it reuses the exact same tier ladder as the streak badges (FALLBACK_STREAK_TIERS /
// db.streakTiers) rather than a second, invisible scale, so the bonus tracks milestones the
// user already sees. Scaled PROPORTIONALLY across however many tiers actually exist — reaching
// the top tier ("Inmortal", 365 days by default) always lands on exactly STREAK_XP_MAX_MULTIPLIER
// (×3), never more, even if an admin adds/removes tiers later (a flat +20%-per-tier would have
// overshot ×3 with an 11th tier, or undershot it with fewer than 10). A Free account always
// gets 1 (no bonus, no matter the streak).
const STREAK_XP_MAX_MULTIPLIER = 3;
function streakXpMultiplier(uid) {
  const user = db.users.find(u => u.id === uid);
  if (!user?.pro) return 1;
  const days = currentStreakDays(uid);
  const tiers = (db.streakTiers.length ? db.streakTiers : FALLBACK_STREAK_TIERS).slice().sort((a, b) => a.days - b.days);
  if (!tiers.length) return 1;
  let idx = -1;
  for (let i = 0; i < tiers.length; i++) { if (days >= tiers[i].days) idx = i; else break; }
  if (idx === -1) return 1;
  return 1 + ((idx + 1) / tiers.length) * (STREAK_XP_MAX_MULTIPLIER - 1);
}
// Deliberately computed fresh from what's already stored (workout count, PRs, the
// bodyweight-goal check Home.jsx itself uses) rather than kept as a mutable counter —
// same reasoning as statsFor/feedItemsFor: nothing to desync, nothing to migrate.
// Only task completions and cheat penalties are their own stored fact, since those are real
// one-time server-side actions (a claim; a ruling), not re-derivable from workout history.
// Raw, un-docked total — anti-cheat penalties are applied in rankFor below, against the
// level actually on screen, not against a number nobody's account is ever measured by.
//
// The streak multiplier only scales the training-derived part (workouts + their PRs) — not
// the goal bonus, task points, or an admin's manual XP adjust, none of which are "keep training
// consistently" in the way a workout or a PR is. Recomputed fresh every call just like the
// multiplier itself, so losing a streak (or Pro) is reflected on the very next read, same as
// everything else in this function.
function xpFor(uid) {
  const S = readState(uid);
  const workouts = S?.workouts || [];
  const mult = streakXpMultiplier(uid);
  let xp = Math.round(workouts.reduce((n, w) => n + workoutXp(w), 0) * mult);
  xp += Math.round(workouts.reduce((n, w) => n + (w.prs?.length || 0), 0) * PR_XP * mult);
  const bw = S?.bodyweight?.length ? S.bodyweight[S.bodyweight.length - 1] : null;
  if (S?.targetW && bw && Math.abs(S.targetW - bw.w) < 0.05) xp += GOAL_XP;
  xp += db.taskCompletions.filter(c => c.userId === uid).reduce((n, c) => n + c.points, 0);
  // The one thing here that isn't derived from something the user actually did — an admin
  // nudge (POST /api/admin/user/level), on top of everything earned normally rather than
  // replacing it. Can go negative (docking XP), same as a cheat penalty already can.
  const user = db.users.find(u => u.id === uid);
  xp += user?.adminXpAdjust || 0;
  return Math.max(0, xp);
}
// One full 1→100 climb's worth of XP. Crossing it does NOT roll over on its own — prestige is
// a confirmed action (POST /api/prestige), not automatic math, so it's tracked with two real
// stored fields rather than something purely derived like the rest of this file:
// prestigeConfirmed (the count, for display) and prestigeBaselineXp (the totalXp snapshot the
// current cycle counts up from). Confirming re-snapshots the baseline to totalXp *at that
// moment* — not baseline + CYCLE_XP — so any XP earned past the cap is spent on the prestige,
// not carried into the new cycle; the new cycle always starts at exactly level 1, 0 XP, however
// far past the cap you'd let it run. Level caps at 100 (Legend, ring full) once a whole cycle
// has been earned past that baseline — readyToPrestige flips on, and stays on, until claimed.
const CYCLE_XP = LEVEL_CUM[100];
// The art (RankIcon.jsx's PrestigeIcon) and the badge picker (SettingsProfile.jsx) both
// already clamp display at prestige 10 — there's no 11th tier of art to show. Enforcing the
// same cap here means a level-100 account past it simply never goes readyToPrestige again,
// rather than confirming into a prestige number nothing can ever render.
const MAX_PRESTIGE = 10;
// Shared by rankFor and the admin level-nudge route: how many levels sit docked against an
// account's raw, live-computed level. Two independent sources so far — active/upheld cheat
// penalties (see scanForCheating) and import level caps (see capImportLevelGain) — both apply
// the same way: the underlying XP/workouts are untouched, only the displayed level moves.
function levelsDockedFor(uid) {
  const cheat = db.cheatPenalties.filter(c => c.userId === uid && c.status !== 'overturned').reduce((n, c) => n + c.levels, 0);
  const importCap = db.importLevelCaps.filter(c => c.userId === uid).reduce((n, c) => n + c.levels, 0);
  return cheat + importCap;
}
function rankFor(uid) {
  const totalXp = xpFor(uid);
  const user = db.users.find(u => u.id === uid);
  const prestige = user?.prestigeConfirmed || 0;
  const baseline = user?.prestigeBaselineXp || 0;
  const xpInCycle = Math.max(0, totalXp - baseline);
  const rawLevel = xpInCycle >= CYCLE_XP ? 100 : levelFromXp(xpInCycle);

  // A penalty docks LEVELS, not a flat XP number, so "5 levels" means the same thing whether
  // it lands on someone at level 3 or level 80 — applied against the level actually on screen
  // (this cycle's, post-prestige-baseline), clamped at 1: someone already at the floor has
  // nothing further to fall, no matter how many levels a penalty claims. Upheld penalties don't
  // compound with themselves on every later save because this reads the level fresh each time,
  // never a number an earlier penalty already reduced. Overturned penalties are excluded.
  // Docking a level off the cap costs readyToPrestige too — a flagged account isn't "ready"
  // just because the raw XP behind that cap was still there.
  const levelsDocked = levelsDockedFor(uid);
  const level = Math.max(1, rawLevel - levelsDocked);
  const readyToPrestige = level === 100 && prestige < MAX_PRESTIGE;
  // Docked accounts always sit at the exact floor of their level (the fractional progress
  // within it is part of what got taken) — otherwise, the real xpInCycle position stands.
  const xp = levelsDocked > 0 ? LEVEL_CUM[level - 1] : (readyToPrestige ? LEVEL_CUM[100] : xpInCycle);

  const floor = LEVEL_CUM[level - 1], ceil = LEVEL_CUM[level] ?? floor;
  return { level, prestige, xp, xpInLevel: xp - floor, xpForLevel: ceil - floor, totalXp, readyToPrestige };
}
// One-time migration for penalties created before beforeLevel/beforeXpInLevel/beforeXpForLevel
// existed (see scanForCheating above): replays each user's penalties in creation order,
// recomputing what rankFor would have returned with only the earlier ones already applied —
// the same snapshot a freshly-created penalty gets live, just reconstructed after the fact.
// Called from main() below, once db is loaded from Postgres — was a top-level IIFE back when
// db.json was read synchronously at require-time; now it just has to run after loadAll().
function backfillCheatPenaltySnapshots() {
  const original = db.cheatPenalties;
  const missing = original.filter(p => p.beforeLevel === undefined);
  if (!missing.length) return;
  const byUser = new Map();
  for (const p of missing) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, []);
    byUser.get(p.userId).push(p);
  }
  for (const [uid, list] of byUser) {
    list.sort((a, b) => new Date(a.created) - new Date(b.created));
    for (const p of list) {
      const appliedIds = new Set(original.filter(c => c.userId === uid && new Date(c.created) < new Date(p.created)).map(c => c.id));
      db.cheatPenalties = original.filter(c => c.userId !== uid || appliedIds.has(c.id));
      const before = rankFor(uid);
      p.beforeLevel = before.level;
      p.beforeXpInLevel = before.xpInLevel;
      p.beforeXpForLevel = before.xpForLevel;
    }
  }
  db.cheatPenalties = original;
  saveDb();
  console.log(`[anticheat] backfilled beforeLevel snapshot for ${missing.length} legacy penalt${missing.length === 1 ? 'y' : 'ies'}`);
}
// Perks per rank tier / prestige level — computed fresh from rankFor, same "nothing to
// desync" reasoning as the rest of this section. Rank perks use `level` directly, so
// they reset along with the tier display whenever a prestige rolls level back to 1;
// prestige perks use `prestige`, which only ever grows, so they're permanent.
//
// Most decorative flair (crown, avatar frame, animated name, badge pulse, border-beam,
// veteran badge) was pulled for the alpha launch — unpolished, going back in progressively
// later, not gone for good. Bio is ungated in the meantime (was Silver/level 21) so a
// fresh alpha account isn't staring at a locked field on day one. The Prestige-8 exclusive
// theme (appTheme) stayed real — it's a genuine reward, not launch-blocking polish.
function perksFor(uid) {
  const { level, prestige } = rankFor(uid);
  // A Free account never unlocks past the 1-photo floor no matter how high they rank —
  // photo slots earned by leveling only actually pay off once on Pro.
  const pro = !!db.users.find(u => u.id === uid)?.pro;
  return {
    pinFavoritePR: level >= 11,   // Bronze
    bio: true,
    maxPhotos: !pro ? 1 : (prestige >= 6 ? 8 : (level >= 51 ? 6 : 4)),   // Diamond / Prestige 6
    pinnedMax: (level >= 61 ? 1 : 0) + (level >= 81 ? 1 : 0) + (prestige >= 3 ? 1 : 0),   // Master + Elite + Prestige 3
    subscriptionDiscount: prestige >= 10 ? 50 : (prestige >= 5 ? 25 : 0),
    // For display only (Rank.jsx) — xpFor is where this actually applies to XP.
    streakXpBonusPct: Math.round((streakXpMultiplier(uid) - 1) * 100),
    appTheme: prestige >= 8,   // Prestige 8 — exclusive app-wide color theme
  };
}
// Re-checked on every read, never cached from follow time — a user going private must
// disappear from everyone's feed/leaderboard/discovery on their very next request.
const isPublic = uid => { const u = db.users.find(x => x.id === uid); return !!u && !!u.public && !u.disabled; };
const followingOf = uid => db.follows.filter(f => f.followerId === uid).map(f => f.followeeId).filter(isPublic);

/* ---------- coach + box ---------- */
// Same discipline as isPublic() above: re-derived fresh on every call, never cached from
// join/box-creation time. A coach losing a box, or an athlete leaving one, must lose/gain
// visibility on the very next request — not retroactively enforced against a stale check.
const isCoachOfBox = (coachId, boxId) => {
  const box = db.boxes.find(b => b.id === boxId);
  return !!box && box.coachId === coachId;
};
const isMemberOfBox = (userId, boxId) => db.boxMemberships.some(m => m.userId === userId && m.boxId === boxId);
// "Staff" — a coach's helpers for one specific box (WOD, routines, roster), added by @username
// search (see GET /api/users/search) rather than the manual coach-application review: helping
// run a box day-to-day doesn't need the marketplace-eligibility bar a full coach clears. Never
// implies coach:true, and never grants the box-admin actions below that stay owner-only
// (inviting/removing members, requesting/renaming the box, managing staff itself).
const isStaffOfBox = (userId, boxId) => db.boxStaff.some(s => s.boxId === boxId && s.userId === userId);
const canManageBox = (userId, boxId) => isCoachOfBox(userId, boxId) || isStaffOfBox(userId, boxId);
const canViewAthlete = (userId, athleteUid) => {
  const myBoxIds = new Set(db.boxes.filter(b => b.coachId === userId).map(b => b.id)
    .concat(db.boxStaff.filter(s => s.userId === userId).map(s => s.boxId)));
  return db.boxMemberships.some(m => m.userId === athleteUid && myBoxIds.has(m.boxId));
};
// Membership plans: a plan choice is an attribute of the existing membership relationship (the
// boxMemberships row), not a new one — one plan per (boxId, userId) at a time, stored as a
// nullable planId right on that row. A booking counts against a plan's monthly limit once it's
// actually claimed a seat ('booked') or burned one by not showing ('no-show') — waitlist/offered
// rows haven't consumed anything yet, and a cancelled 'booked' row frees its slot back (it's
// simply no longer in this set once its status changes).
const LIMIT_STATUSES = new Set(['booked', 'no-show']);
function monthlyClassUsage(boxId, userId, monthKey) {
  return db.classBookings.filter(b => {
    if (b.athleteId !== userId || !LIMIT_STATUSES.has(b.status)) return false;
    const session = db.classSessions.find(s => s.id === b.sessionId);
    return !!session && session.boxId === boxId && session.date.slice(0, 7) === monthKey;
  }).length;
}
// A plan is a monthly subscription in real life — the coach collects payment in person (in-app
// payment is a future feature; when it lands, it should renew the same planAssignedAt field
// instead of needing a new mechanism). Each athlete gets their own 30-day cycle starting the
// moment a plan is (re)assigned to them (coach.box.member.plan below), not a shared calendar
// month — reassigning the same plan again (after collecting a new payment) is how it renews.
// Past the 30 days there's a further 5-day grace window (still fully usable, including an
// unlimited plan) before access actually cuts off — a real subscription going a day or two
// unpaid shouldn't lock someone out overnight.
const PLAN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const PLAN_GRACE_MS = 5 * 24 * 60 * 60 * 1000;
// null means "nothing to enforce or show" — either no plan assigned (defaults to unlimited/any
// type, so shipping this never locks out an existing member) or a plan that's unlimited,
// unrestricted, and neither expired nor in its grace window. A plan can be unlimited but still
// type-restricted (e.g. "Founder Unlimited CrossFit") or vice versa, so the two checks are
// independent, not one "has a plan?" gate — expiry is a third, separate axis that overrides both
// once the cycle (plus grace) is up.
function athletePlanInfo(boxId, userId) {
  const membership = db.boxMemberships.find(m => m.boxId === boxId && m.userId === userId);
  if (!membership?.planId) return null;
  const plan = db.boxPlans.find(p => p.id === membership.planId);
  if (!plan) return null;
  const dueAt = membership.planAssignedAt ? new Date(new Date(membership.planAssignedAt).getTime() + PLAN_PERIOD_MS) : null;
  const graceUntil = dueAt ? new Date(dueAt.getTime() + PLAN_GRACE_MS) : null;
  const now = Date.now();
  const expired = !!graceUntil && now >= graceUntil.getTime();
  const inGrace = !expired && !!dueAt && now >= dueAt.getTime();
  const classTypes = plan.classTypes?.length ? plan.classTypes : null;
  if (plan.monthlyLimit == null && !classTypes && !expired && !inGrace) return null;
  const usedThisMonth = plan.monthlyLimit == null ? 0 : monthlyClassUsage(boxId, userId, isoOf(new Date()).slice(0, 7));
  return {
    id: plan.id, name: plan.name, monthlyLimit: plan.monthlyLimit, usedThisMonth,
    remaining: plan.monthlyLimit == null ? null : Math.max(0, plan.monthlyLimit - usedThisMonth),
    classTypes, expired, inGrace,
    graceDaysLeft: inGrace ? Math.max(0, Math.ceil((graceUntil.getTime() - now) / 86400000)) : null,
  };
}
// Guard for /api/coach/* — resolves the caller and 401/403s if they aren't an approved coach.
function requireCoach(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!user.coach) { audit(req, 'coach.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
// Not real pagination — the frontend fetches this whole list in one call and reveals it
// 5 cards at a time as you scroll (Social.jsx PAGE_SIZE), so FEED_LIMIT only exists as a
// sanity ceiling against a pathological follow graph, not a page size. A self-hosted
// instance's follow graph within the FEED_DAYS window is small enough that returning
// everything in it is cheap.
const FEED_LIMIT = 500;
const FEED_DAYS = 30;
// Shared by /api/social/feed (uids = who I follow) and /api/social/discover (uids =
// public accounts I don't follow yet) — same shape either way, just a different guest list.
function feedItemsFor(uids, me) {
  const cutoff = Date.now() - FEED_DAYS * 86400000;
  let items = [];
  for (const uid of uids) {
    const u = db.users.find(x => x.id === uid);
    const S = readState(uid);
    const { level, prestige } = rankFor(uid);
    const perks = perksFor(uid);
    for (const w of (S?.workouts || [])) {
      if ((w.end || w.start || 0) < cutoff) continue;
      const reactions = db.reactions.filter(r => r.targetUid === uid && r.workoutId === w.id);
      const comments = db.comments.filter(c => c.targetUid === uid && c.workoutId === w.id);
      items.push({
        uid, name: u.name, username: u.username || null, avatarUrl: avatarUrlOf(u), level, prestige, perks,
        workout: {
          id: w.id, d: w.d, start: w.start, end: w.end, name: w.name, prs: w.prs || [],
          desc: w.desc || '', images: w.images || [], vol: w.vol || 0,
          exercises: (w.entries || []).map(e => ({ id: e.id, sets: (e.sets || []).filter(s => s.done).length })).filter(e => e.sets > 0),
        },
        likes: reactions.length,
        liked: reactions.some(r => r.userId === me.id),
        comments: comments.length
      });
    }
  }
  items.sort((a, b) => (b.workout.end || b.workout.start || 0) - (a.workout.end || a.workout.start || 0));
  return items.slice(0, FEED_LIMIT);
}

// Beyond the 4 headline macros, Open Food Facts' `nutriments` blob usually carries a handful
// more per-100g values — only included when actually present (undefined, not 0, for a
// product that genuinely doesn't report one) so sheets.jsx's "see all nutrients" detail only
// renders rows it actually has data for.
function extraNutriments(n) {
  const out = {};
  if (n['saturated-fat_100g'] != null) out.satFat100 = Math.round(n['saturated-fat_100g'] * 10) / 10;
  if (n['sugars_100g'] != null) out.sugars100 = Math.round(n['sugars_100g'] * 10) / 10;
  if (n['fiber_100g'] != null) out.fiber100 = Math.round(n['fiber_100g'] * 10) / 10;
  if (n['salt_100g'] != null) out.salt100 = Math.round(n['salt_100g'] * 10) / 10;
  return out;
}

/* ---------- routes ---------- */
// Geocoding proxy helpers (see the 'GET /api/geo/*' routes below for why this exists) —
// module scope like extraNutriments() above, since routes is a plain object literal and
// can't hold statement-level declarations of its own.
const GEO_UA = 'Forvia (self-hosted gym tracker) - github.com/Nebula-Syst/Forvia';
// Builds "Street 12, City, Country" when Photon's match is street/house-level (has
// street/housenumber), falling back to the old "City, Country" shape for a city-level match —
// a box's real-world address needs the street, a coach's own general location doesn't need
// more than the city, and this one function serves both without a second endpoint. `name` is
// Photon's primary label for whatever layer matched (a street's own name, a POI's name, or —
// for a city-level result — the city itself), so it only gets used as the locality when there
// is no separate street to show.
const placeLabelFrom = p => {
  if (!p) return null;
  const street = p.housenumber && p.street ? `${p.street} ${p.housenumber}` : p.street || null;
  const locality = street ? (p.city || p.district) : (p.city || p.name);
  return [street, locality, p.country].filter(Boolean).join(', ') || null;
};
// Haversine distance in km — used to keep the marketplace to coaches actually near the
// browsing athlete's search location (GET /api/coaches/marketplace's lat/lon params).
function kmBetween(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const MARKETPLACE_RADIUS_KM = 50;
// A cancellation inside this window before class start counts as "late" for reporting
// purposes (Phase 5) — no automatic consequence yet, just a recorded classPenalties row.
const LATE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;
// A waitlist offer (POST /api/box/classes/cancel) only holds exclusive priority for this long —
// after that it opens up to the whole remaining queue, first "book" tap wins. Checked by a sweep
// (waitlistOfferTick, registered in main()) rather than a per-offer setTimeout: a sweep re-checks
// real elapsed time against `offeredAt` on every tick, so a stale offer self-heals within one
// tick even across a server restart, instead of silently losing its timer.
const WAITLIST_OFFER_WINDOW_MS = 5 * 60 * 1000;
function waitlistOfferTick() {
  let dirty = false;
  for (const b of db.classBookings) {
    if (b.status !== 'offered' || Date.now() - Date.parse(b.offeredAt) < WAITLIST_OFFER_WINDOW_MS) continue;
    b.status = 'waitlist';
    dirty = true;
    const session = db.classSessions.find(s => s.id === b.sessionId);
    if (!session) continue;
    for (const w of db.classBookings.filter(x => x.sessionId === session.id && x.status === 'waitlist')) {
      sendPush(w.athleteId, { title: 'A spot is open', body: 'First to book gets it — ' + session.name + ' · ' + session.date + ' ' + session.startTime });
      wsSend(w.athleteId, { type: 'class:promoted', sessionId: session.id, name: session.name, date: session.date, startTime: session.startTime });
    }
  }
  if (dirty) saveDb();
}
// Live class clock: elapsed time is a pure function of a single anchor timestamp + the
// accumulated time banked before the current run segment, never a server-side ticking loop —
// every device (host and viewers alike) derives the same round/phase/remaining from this one
// number, so pause/resume/reset only ever need to broadcast once, not on every tick.
const liveElapsedMs = row => row.status === 'running'
  ? row.pausedElapsedMs + (Date.now() - Date.parse(row.phaseStartedAt))
  : row.pausedElapsedMs;
// Reaches whoever is actually in the class right now: booked athletes plus the host (which may
// not be the session's assigned coachId — any staff/owner can start hosting a class they're
// covering). Same wsSend used for the waitlist-promotion nudge.
const broadcastLive = (session, hostId, payload) => {
  const targets = new Set(db.classBookings.filter(b => b.sessionId === session.id && b.status === 'booked').map(b => b.athleteId));
  if (hostId) targets.add(hostId);
  for (const uid of targets) wsSend(uid, payload);
};
// Class types are fully custom per box (a CrossFit box and a yoga studio want different icons
// and colors) rather than a fixed discipline enum — icon is still a closed set (only these
// render anything in the frontend's icon component) but color is any hex the coach picks.
const CLASS_ICONS = new Set([
  'barbell', 'dumbbell', 'figureRun', 'kettlebell', 'stretch', 'boxing', 'bike', 'swim',
  'pullup', 'machine', 'plate', 'figureStrength', 'legs', 'abs', 'arm', 'flame', 'target',
  'trophy', 'medal', 'heart', 'timer', 'sparkles',
]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Photon's `lang` param only accepts exactly these four values — anything else (a Spanish
// browser sending "es", which real testing missed since curl sends no Accept-Language at all
// and defaults past this) gets a flat 400 from Photon, which silently became "no results" and
// "auto-detect never works" once caught by this file's own try/catch. Omitting the param
// entirely (Photon's own default) still returns each place's local-language name — confirmed
// fine — so anything unsupported just skips the param rather than guessing a mapping.
const PHOTON_LANGS = new Set(['de', 'en', 'fr']);
const photonLang = req => { const l = (req.headers['accept-language'] || '').slice(0, 2).toLowerCase(); return PHOTON_LANGS.has(l) ? l : null; };

// Google Geocoding API — opt-in, self-hosted-admin-provided key (see .env.example). Photon runs
// on OpenStreetMap data alone, which has real, unfixable gaps for exact house numbers on
// ordinary residential streets, especially in small towns — confirmed by hand, an address that
// Google Maps resolves fine can come back with nothing usable from Photon because the house was
// simply never mapped in OSM. Only worth the (paid, metered) API call for a "precise" search —
// a box's real street address — never for a general "what city are you in" one, so this is
// gated per-request by the `precise` flag, not turned on globally just because a key exists.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
// How a box's location field behaves, self-hoster's choice (see .env.example):
//   off     — plain manual text, no geocoding at all: whatever the coach types is saved as-is,
//             no lat/lon. Right for an instance with no geocoder set up yet, or one that would
//             rather not depend on any third-party lookup for this field.
//   search  — the default: Photon/OSM real-place search, free, no key needed. Has real gaps for
//             exact house numbers on smaller streets (see GOOGLE_MAPS_API_KEY above).
//   precise — also merges in Google's Geocoding API. Silently behaves like `search` if
//             GOOGLE_MAPS_API_KEY isn't actually set, rather than erroring — somebody can flip
//             this on ahead of adding the key with no visible effect until they do.
const BOX_LOCATION_MODE = /^(off|precise)$/i.test(process.env.BOX_LOCATION_MODE || '') ? process.env.BOX_LOCATION_MODE.toLowerCase() : 'search';
async function googleGeocode(q, bias) {
  const params = { address: q, key: GOOGLE_MAPS_API_KEY };
  // Geocoding API's only real relevance lever is a viewport to bias toward — a generous ~1°
  // box (roughly 100km) centered on the caller's known point, not a hard filter (Google can
  // still return matches outside it, just ranks inside-the-box ones first).
  if (bias) {
    const { lat, lon } = bias;
    params.bounds = `${lat - 0.5},${lon - 0.5}|${lat + 0.5},${lon + 0.5}`;
  }
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams(params);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await r.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error('google geocode: ' + data.status + (data.error_message ? ' - ' + data.error_message : ''));
  }
  return (data.results || [])
    .map(r => ({ label: r.formatted_address, lat: r.geometry?.location?.lat, lon: r.geometry?.location?.lng }))
    .filter(p => p.label && isFinite(p.lat) && isFinite(p.lon));
}

// Shared by every "real place, never free text" field (a coach's own location, a box's
// location): must be {label, lat, lon} shaped exactly like a GET /api/geo/search or /reverse
// result. Returns null for an absent/falsy raw value; throws a string error message for a
// present-but-malformed one, which callers turn into a 400.
function parseLocation(raw) {
  if (!raw) return null;
  const label = String(raw.label || '').trim().slice(0, 120);
  const lat = Number(raw.lat), lon = Number(raw.lon);
  if (!label || !isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('invalid location');
  }
  return { label, lat, lon };
}

// Shared by the class-occurrence WOD route and the WOD template routes just below it — see
// the frontend's lib/wod.js for why this is free text plus a small set of line->exercise
// links rather than a structured sets/reps object. A link's `line` is an index into
// `text.split('\n')`; a stale index (the coach deleted lines client-side before the request
// landed) is dropped rather than stored, so a viewer never sees a link pointing at nothing.
// A WOD is { lines: [{ segments: [{t:'text', v} | {t:'ex', id, label}] }] } — see
// frontend/src/lib/wod.js. `budget` caps total text+label characters across the whole WOD
// (same 4000-char ceiling the old flat-text shape had), not just each field in isolation.
function sanitizeWod(raw) {
  let budget = 4000;
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).slice(0, 200).map(line => {
    const type = ['title', 'subtitle', 'note', 'divider'].includes(line?.type) ? line.type : 'text';
    // A divider is a bare rule — nothing to link an exercise to, so it never carries segments.
    if (type === 'divider') return { type, segments: [] };
    return {
      type,
      segments: (Array.isArray(line?.segments) ? line.segments : []).slice(0, 100).map(seg => {
        if (budget <= 0) return null;
        if (seg?.t === 'ex') {
          const id = String(seg?.id || '').slice(0, 60);
          if (!id) return null;
          const label = String(seg?.label || '').slice(0, budget);
          budget -= label.length;
          return { t: 'ex', id, label };
        }
        const v = String(seg?.v || '').slice(0, budget);
        budget -= v.length;
        return v ? { t: 'text', v } : null;
      }).filter(Boolean),
    };
  });
  return { lines };
}

const wodExerciseCount = wod => (wod?.lines || []).reduce((n, l) => n + (l.segments || []).filter(s => s.t === 'ex').length, 0);
const wodIsEmpty = wod => !(wod?.lines || []).some(l => (l.segments || []).some(s => (s.t === 'ex' ? s.label : s.v || '').trim()));

const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, allow_register: ALLOW_REGISTER, box_location_mode: BOX_LOCATION_MODE }),

  // Public, no auth: admin-authored exercise renames (see the "exercise name overrides"
  // section below for how they're written). The catalogue itself lives only in the frontend
  // bundle — this is the only exercise-related state the backend holds — so every client,
  // signed in or guest, needs this to overlay renames onto the names it already has.
  'GET /api/exercises/overrides': async (req, res) => json(res, 200, { overrides: db.exerciseOverrides }),

  // Public, no auth: admin-configured streak-badge thresholds (day count -> tier name),
  // sorted ascending — every client needs these to know which badge a given streak earns
  // (see frontend lib/streak.js tierForDays). No perks are attached to these tiers yet
  // (see the "no upgrade yet" note on the admin write routes below) — cosmetic only for now.
  'GET /api/streak-tiers': async (req, res) => {
    const sorted = [...db.streakTiers].sort((a, b) => a.days - b.days);
    json(res, 200, { tiers: sorted });
  },

  /* ---------- nutrition: food search (Open Food Facts proxy) ---------- */
  // Open Food Facts (openfoodfacts.org, ODbL) is the one real food database Forvia's diary
  // logs against — same reasoning as the exercise catalogue's own third-party source (see
  // NOTICE.md): a real product database is millions of entries, far too big to bundle, so
  // the frontend never calls it directly — this is a thin, signed-in-only proxy instead
  // (keeps the integration swappable later without touching the client, and matches how
  // every other outbound call in this file — SMTP, web push — stays server-side). Per-100g
  // macros come back as-is; the frontend scales them by whatever quantity gets logged.
  'GET /api/nutrition/search': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
    if (!q) return json(res, 200, { items: [] });
    try {
      // search-a-licious (Open Food Facts' current Elasticsearch-backed search, replacing
      // the legacy cgi/search.pl and api/v2/search — both returned 503s against the main
      // world.openfoodfacts.org app server as of this writing, this one lives on its own
      // subdomain and answered fine) — same fields as the barcode lookup below except
      // `brands` comes back as an array here, not a comma string.
      const url = 'https://search.openfoodfacts.org/search?' + new URLSearchParams({
        q, page_size: '20', fields: 'code,product_name,brands,nutriments',
      });
      const r = await fetch(url, { headers: { 'User-Agent': 'Forvia (self-hosted gym tracker) - github.com/Nebula-Syst/Forvia' }, signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      const items = (data.hits || [])
        .filter(p => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] != null)
        .map(p => ({
          code: p.code || null,
          name: p.product_name + (p.brands && p.brands[0] ? ' — ' + p.brands[0].trim() : ''),
          kcal100: Math.round(p.nutriments['energy-kcal_100g'] || 0),
          carbs100: Math.round(p.nutriments['carbohydrates_100g'] || 0),
          fat100: Math.round(p.nutriments['fat_100g'] || 0),
          protein100: Math.round(p.nutriments['proteins_100g'] || 0),
          ...extraNutriments(p.nutriments),
        }))
        .slice(0, 20);
      json(res, 200, { items });
    } catch (e) {
      json(res, 200, { items: [], error: 'search unavailable' });
    }
  },

  // Same proxy, one product by barcode — the frontend's barcode scanner (a browser
  // BarcodeDetector where available) only ever hands this a decoded digit string.
  'GET /api/nutrition/barcode': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const code = (new URL(req.url, 'http://x').searchParams.get('code') || '').replace(/\D/g, '');
    if (!code) return json(res, 400, { error: 'code required' });
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?` + new URLSearchParams({ fields: 'code,product_name,brands,nutriments' });
      const r = await fetch(url, { headers: { 'User-Agent': 'Forvia (self-hosted gym tracker) - github.com/Nebula-Syst/Forvia' }, signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      const p = data.product;
      if (data.status !== 1 || !p || !p.nutriments || p.nutriments['energy-kcal_100g'] == null) return json(res, 404, { error: 'not found' });
      json(res, 200, {
        item: {
          code,
          name: (p.product_name || code) + (p.brands ? ' — ' + p.brands.split(',')[0].trim() : ''),
          kcal100: Math.round(p.nutriments['energy-kcal_100g'] || 0),
          carbs100: Math.round(p.nutriments['carbohydrates_100g'] || 0),
          fat100: Math.round(p.nutriments['fat_100g'] || 0),
          protein100: Math.round(p.nutriments['proteins_100g'] || 0),
          ...extraNutriments(p.nutriments),
        },
      });
    } catch (e) {
      json(res, 502, { error: 'lookup unavailable' });
    }
  },

  /* ---------- nutrition: community food database ---------- */
  // Forvia's own crowd-sourced food catalogue, separate from Open Food Facts above — a place
  // for foods that database doesn't have (home-cooked dishes, regional products) without
  // every user retyping the same macros from scratch. A submission is either private (stays
  // local to the submitter — see the frontend's own S.customFoods, this route is never
  // called for those) or public; there is no third state. A public one is searchable by
  // anyone, but always anonymised — ownerId/created never leave this route, by construction,
  // not by the client choosing not to render them.
  'POST /api/nutrition/foods': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 80);
    const mode = body.mode === 'unit' ? 'unit' : 'weight';
    const num = v => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0 };
    if (!name) return json(res, 400, { error: 'name required' });
    const food = {
      id: crypto.randomBytes(8).toString('base64url'),
      ownerId: user.id, name, mode,
      kcal: num(body.kcal), carbs: num(body.carbs), fat: num(body.fat), protein: num(body.protein),
      created: new Date().toISOString(),
    };
    db.publicFoods.push(food);
    saveDb();
    json(res, 200, { ok: true, id: food.id });
  },

  // Case-insensitive substring match on name, newest first — same 20-result cap as the Open
  // Food Facts proxy above so a food search never has to think about which source a result
  // came from. ownerId/created are dropped here, not just left unrendered client-side.
  'GET /api/nutrition/foods/search': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return json(res, 200, { items: [] });
    const items = db.publicFoods
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(-20).reverse()
      .map(({ id, name, mode, kcal, carbs, fat, protein }) => ({ id, name, mode, kcal, carbs, fat, protein }));
    json(res, 200, { items });
  },

  /* ---------- geocoding (location picker — Komoot Photon proxy) ---------- */
  // A coach's public location (Coach dashboard's marketplace section) has to be a real,
  // geocoded place, never free text — an athlete browsing the marketplace should be able to
  // trust it, not read whatever string someone typed. Photon (photon.komoot.io, built on
  // OpenStreetMap/Nominatim data by Komoot, ODbL) is the one real, keyless geocoder that's
  // actually built for search-as-you-type: plain Nominatim /search does token/word matching,
  // not prefix matching, so a partial word like "barcel" returns unrelated places named
  // "Barcel" instead of "Barcelona" — confirmed by hand, this is exactly why the search read
  // as broken. Photon indexes prefixes and ranks by place importance instead, so partial
  // queries actually surface the right city. Same proxying posture as the Open Food Facts
  // proxy above: server-side only, so the integration stays swappable.
  'GET /api/geo/search': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const sp = new URL(req.url, 'http://x').searchParams;
    const q = (sp.get('q') || '').trim();
    if (q.length < 2) return json(res, 200, { places: [] });
    try {
      const params = { q, limit: '8' };
      // Optional "search near here" bias (Photon ranks by global place importance otherwise,
      // which buries small-town streets under unrelated same-named places worldwide — a real
      // address search without this found nothing usable for a house on an ordinary street in
      // a small town, confirmed by hand). The caller supplies the point — the coach's own
      // known location for a box address, say — never the athlete's live GPS here (this route
      // never touches navigator.geolocation itself).
      const biasLat = Number(sp.get('lat')), biasLon = Number(sp.get('lon'));
      const hasBias = isFinite(biasLat) && isFinite(biasLon);
      if (hasBias) { params.lat = String(biasLat); params.lon = String(biasLon); }
      const lang = photonLang(req); if (lang) params.lang = lang;
      const url = 'https://photon.komoot.io/api/?' + new URLSearchParams(params);
      const r = await fetch(url, { headers: { 'User-Agent': GEO_UA }, signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      let places = (data.features || [])
        .map(f => ({ label: placeLabelFrom(f.properties), lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] }))
        .filter(p => p.label && isFinite(p.lat) && isFinite(p.lon));
      // `precise=1` (an exact street address, not a general "what city" search) also queries
      // Google's Geocoding API when the instance has a key configured — its commercially
      // licensed address data covers real houses OSM/Photon simply never had mapped. Google's
      // results lead (better source for exactly this case) with Photon's filling in behind.
      if (sp.get('precise') === '1' && GOOGLE_MAPS_API_KEY) {
        try {
          const googlePlaces = await googleGeocode(q, hasBias ? { lat: biasLat, lon: biasLon } : null);
          places = [...googlePlaces, ...places];
        } catch (e) { console.error('geo/search google failed:', e.message); }
      }
      const seen = new Set();
      // Photon (and, when merged in, Google) can each return the same place more than once —
      // de-dupe by label across both sources.
      places = places.filter(p => { const k = p.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      json(res, 200, { places: places.slice(0, 6) });
    } catch (e) { console.error('geo/search failed:', e.message); json(res, 200, { places: [], error: 'search unavailable' }); }
  },
  'GET /api/geo/reverse': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json(res, 400, { error: 'lat/lon required' });
    try {
      const rparams = { lat: String(lat), lon: String(lon) };
      const rlang = photonLang(req); if (rlang) rparams.lang = rlang;
      const url = 'https://photon.komoot.io/reverse?' + new URLSearchParams(rparams);
      const r = await fetch(url, { headers: { 'User-Agent': GEO_UA }, signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      const label = placeLabelFrom(data.features?.[0]?.properties);
      if (!label) return json(res, 404, { error: 'not found' });
      json(res, 200, { place: { label, lat, lon } });
    } catch (e) { console.error('geo/reverse failed:', e.message); json(res, 502, { error: 'reverse geocoding unavailable' }); }
  },

  /* ---------- alpha waitlist (public, cross-origin from the landing page) ---------- */
  // Preflight for the one browser-originated cross-origin POST this API answers.
  'OPTIONS /api/alpha/apply': async (req, res) => { res.writeHead(204, corsHeaders(req)); res.end(); },
  // No session, no auth — this is the landing page's "request access" form. Re-submitting the
  // same email updates the existing request instead of piling up duplicates, so someone fixing
  // a typo or adding a note doesn't need the admin to sort through repeats. Dismissed requests
  // are left alone (a defence against them just resubmitting through a "dismiss" — they'd need
  // a *new* email, not just a resend of a rejected one).
  'POST /api/alpha/apply': async (req, res) => {
    const headers = corsHeaders(req);
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const message = String(body.message || '').trim().slice(0, 500);
    if (!name) return json(res, 400, { error: 'name required' }, headers);
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email address' }, headers);
    const existing = db.alphaRequests.find(r => r.email === email && r.status !== 'dismissed');
    if (existing) { existing.name = name; existing.message = message; existing.updated = new Date().toISOString(); }
    else db.alphaRequests.push({ id: crypto.randomBytes(8).toString('base64url'), name, email, message, status: 'pending', created: new Date().toISOString() });
    saveDb();
    audit(req, 'alpha.apply', { name, msg: email });
    json(res, 200, { ok: true }, headers);
  },

  /* ---------- coach application (a logged-in user applying to become a coach) ---------- */
  // Unlike alpha/apply this requires a session — coach status attaches to an existing account,
  // it isn't a new-signup gate. Re-submitting while pending/approved updates the existing
  // request instead of piling up duplicates, same idea as alpha/apply's email-keyed dedup.
  // The caller's own current application, if any — lets the frontend gate the form (never
  // even show it while a request is pending) instead of relying only on the POST rejecting
  // a second submit after the fact.
  'GET /api/coach/apply/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const pending = db.coachRequests.some(r => r.userId === user.id && r.status === 'pending');
    json(res, 200, { pending });
  },
  'POST /api/coach/apply': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (user.coach) return json(res, 400, { error: 'already a coach' });
    // Becoming a coach is a Pro perk — a Free account can still browse/apply to join a box as
    // an athlete, just not run one. Already-approved coaches predating this gate keep working
    // regardless of their own pro flag; this only blocks new applications.
    if (!user.pro) return json(res, 403, { error: 'A Pro subscription is required to apply as a coach' });
    // Once a request is pending, block a second one outright rather than silently merging —
    // the frontend already hides the form in this state; this is the backstop for a stale
    // tab, a second device, or a double-tapped submit landing as two in-flight requests.
    const existing = db.coachRequests.find(r => r.userId === user.id && r.status !== 'dismissed');
    if (existing?.status === 'pending') return json(res, 400, { error: 'you already have a pending coach application' });
    const body = await readBody(req);
    const experience = String(body.experience || '').trim().slice(0, 500);
    const certifications = String(body.certifications || '').trim().slice(0, 500);
    const message = String(body.message || '').trim().slice(0, 500);
    if (!experience) return json(res, 400, { error: 'tell us about your coaching experience' });
    // Proof document (a certification, an ID) — required; a data: URL same shape as
    // social/upload's own photo body, just with a document-specific mime set (PDFs included).
    const raw = String(body.documentDataUrl || '');
    const m = raw ? /^data:(application\/pdf|image\/jpeg|image\/png);base64,([a-zA-Z0-9+/=]+)$/.exec(raw) : null;
    if (raw && !m) return json(res, 400, { error: 'unsupported document format — PDF, JPEG or PNG only' });
    if (!m) return json(res, 400, { error: 'attach a document proving you’re a trainer/coach' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_DOCUMENT_BYTES) return json(res, 413, { error: 'document too large' });
    const file = 'coachdoc-' + crypto.randomBytes(10).toString('base64url') + '.' + DOCUMENT_MIME[m[1]];
    fs.mkdirSync(uploadsDir(user.id), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(user.id), file), buf);
    const row = { id: crypto.randomBytes(8).toString('base64url'), userId: user.id, experience, certifications, message, status: 'pending', created: new Date().toISOString(), documentFile: file };
    db.coachRequests.push(row);
    saveDb();
    audit(req, 'coach.apply', { user });
    json(res, 200, { ok: true });
  },

  /* ---------- personal-training marketplace (coach visibility + rate) ---------- */
  // A coach's box (roster, WOD, leaderboard) and their personal-training listing are two
  // independent things — someone can run a box without ever appearing here, or vice versa
  // once boxes stop being the only reason to be a coach. Off by default even once approved:
  // this is a second, deliberate opt-in, not implied by coach:true.
  'POST /api/coach/visibility': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const rate = body.hourlyRate === null || body.hourlyRate === undefined || body.hourlyRate === ''
      ? null : Math.max(0, Math.round(Number(body.hourlyRate) * 100) / 100);
    if (rate !== null && !isFinite(rate)) return json(res, 400, { error: 'invalid rate' });
    if (body.visible && rate === null) return json(res, 400, { error: 'set an hourly rate before listing yourself' });
    let location;
    try { location = parseLocation(body.location); } catch { return json(res, 400, { error: 'invalid location' }); }
    coach.coachVisible = !!body.visible;
    coach.hourlyRate = rate;
    coach.coachLocation = location;
    saveDb();
    audit(req, 'coach.visibility.set', { user: coach, msg: (coach.coachVisible ? 'visible' : 'hidden') + ':' + rate });
    json(res, 200, { user: publicUser(coach) });
  },

  // Any signed-in user browsing for a personal trainer — socialUser() rows, same redaction as
  // every other cross-user listing in the app (no auth-only fields), filtered to coaches who
  // opted in and aren't disabled.
  // ?lat&lon: the browsing athlete's own search location (LocationPicker on the marketplace
  // screen — never their saved profile location, this is just "search near here" for this
  // one request). When given, coaches without a location, or farther than
  // MARKETPLACE_RADIUS_KM away, are left out entirely rather than merely sorted last — "no te
  // salgan demasiado lejos a no ser que cambies la loc" — and each row carries its own
  // distanceKm so the card can show it. With no lat/lon (detection hasn't resolved yet, or
  // was denied) the listing falls back to unfiltered, as before.
  'GET /api/coaches/marketplace': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    const hasOrigin = isFinite(lat) && isFinite(lon);
    let coaches = db.users.filter(u => u.coach && u.coachVisible && !u.disabled).map(socialUser);
    if (hasOrigin) {
      coaches = coaches
        .filter(c => c.coachLocation)
        .map(c => ({ ...c, distanceKm: Math.round(kmBetween(lat, lon, c.coachLocation.lat, c.coachLocation.lon)) }))
        .filter(c => c.distanceKm <= MARKETPLACE_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }
    json(res, 200, { coaches, radiusKm: hasOrigin ? MARKETPLACE_RADIUS_KM : null });
  },

  /* ---------- bug reports (alpha issue tracker) ---------- */
  // Deliberately minimal: one free-text field, no severity/category picker — this is alpha,
  // the point is a low-friction "something's wrong, here it is" that an admin triages by eye
  // (GET /api/admin/bugs), not a real issue tracker. Works signed in or as a guest — a guest
  // has no server session at all (see .env's ALLOW_GUEST note), so there's nothing to attach
  // the report to beyond whatever they typed; it's recorded as Anonymous rather than dropped.
  'POST /api/bugs': async (req, res) => {
    const user = readSession(req);
    const body = await readBody(req);
    const message = String(body.message || '').trim().slice(0, 1000);
    if (!message) return json(res, 400, { error: 'describe what went wrong' });
    const page = String(body.page || '').trim().slice(0, 200);
    db.bugReports.push({
      id: crypto.randomBytes(8).toString('base64url'),
      userId: user ? user.id : null,
      name: user ? user.name : null,
      email: user ? user.email : null,
      message,
      page,
      status: 'open',
      created: new Date().toISOString(),
    });
    saveDb();
    audit(req, 'bug.report', user ? { user, msg: message.slice(0, 80) } : { name: 'Anonymous', msg: message.slice(0, 80) });
    json(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user) });
  },

  // The account holder's own "upgrade mastery" action — level 100 caps and waits (rankFor's
  // readyToPrestige) rather than rolling over by itself, so this is the only thing that ever
  // bumps prestigeConfirmed. Re-checks readiness server-side (never trust a stale client flag);
  // if a second cycle is already sitting there too, rankFor flips readyToPrestige straight back
  // on for the next call, so repeated clicks walk through pending cycles one at a time.
  'POST /api/prestige': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Prestige itself is a Pro perk — a Free account still climbs to level 100 and sits
    // readyToPrestige (nothing about leveling changes), it just can't cash that in without Pro.
    if (!user.pro) return json(res, 403, { error: 'A Pro subscription is required to prestige' });
    const rank = rankFor(user.id);
    if (!rank.readyToPrestige) return json(res, 400, { error: 'not ready to prestige' });
    user.prestigeConfirmed = rank.prestige + 1;
    user.prestigeBaselineXp = rank.totalXp;   // spends whatever was earned, surplus included
    saveDb();
    audit(req, 'prestige.confirm', { user, msg: 'prestige ' + user.prestigeConfirmed });
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/register': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email address' });
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    if (findByEmail(email)) return json(res, 409, { error: 'an account already exists for that email' });
    // A valid, unused invite code is a door of its own — it lets someone in even while
    // ALLOW_REGISTER is off, same as it always has under INVITE_ONLY. One code, one account:
    // usedBy is set the moment it's spent, so a second attempt with the same code fails here.
    const code = String(body.code || '').trim().toUpperCase();
    const invite = code ? db.invites.find(i => i.code === code && !i.usedBy && !i.revoked) : null;
    if (!ALLOW_REGISTER && !invite) return json(res, 403, { error: 'registration is closed on this instance — a valid invite code is required' });
    if (INVITE_ONLY && !invite) {
      audit(req, 'auth.register.denied', { ok: false, name, msg: 'invite-rejected' });
      return json(res, 403, { error: 'a valid invite code is required' });
    }
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, email, created: new Date().toISOString() };
    user.pwd = hashPassword(password);
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    saveDb();
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    // Best-effort, same as changing your email later from Settings — a fresh account isn't
    // blocked on this, it just starts out unverified if no SMTP is configured.
    if (SMTP_CONFIGURED) {
      user.emailVerifyToken = { token: crypto.randomBytes(24).toString('base64url'), expires: Date.now() + 86400000 };
      saveDb();
      await sendMail({
        to: email, subject: 'Verify your email — Forvia',
        text: `Confirm this is your email address for your Forvia account (${name}):\n\n${ORIGIN}/api/account/verify-email?token=${user.emailVerifyToken.token}\n\nIf you didn't request this, you can ignore this message — nothing changes until the link above is opened.`,
      });
    }
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user, req) });
  },

  'POST /api/login': async (req, res) => {
    const body = await readBody(req);
    const user = findByEmail(body.email);
    // Same generic error either way — knowing an email is registered would let an attacker
    // enumerate accounts.
    const fail = msg => { audit(req, 'auth.login.fail', { ok: false, uid: user?.id, msg }); return json(res, 401, { error: 'incorrect email or password' }) }
    if (!user || !verifyPassword(String(body.password || ''), user.pwd.salt, user.pwd.hash)) return fail(user ? 'bad-password' : 'unknown-email');
    if (user.disabled) { audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' }); return json(res, 403, { error: 'this account has been disabled' }) }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user, req) });
  },

  // Account info — one route per field (same convention as the /api/social/* setters):
  // each call touches exactly one thing on the signed-in account and returns the fresh
  // publicUser() so the frontend never has to guess what changed.
  'POST /api/account/name': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    // firstName/lastName (both optional strings) is the real path now — they're stored as
    // their own fields and `name` is just their join, so a compound given name never gets
    // re-split by guesswork on a later load. `name` alone is kept working for any caller
    // that still only sends that (there are none left in this app today, but it costs
    // nothing to keep accepting it and it's a cheap way to not paint a future caller into
    // this same corner).
    let name;
    if (body.firstName != null || body.lastName != null) {
      const firstName = String(body.firstName || '').trim().slice(0, 40);
      const lastName = String(body.lastName || '').trim().slice(0, 40);
      name = `${firstName} ${lastName}`.trim().slice(0, 60);
      if (!name) return json(res, 400, { error: 'name required' });
      user.firstName = firstName;
      user.lastName = lastName;
    } else {
      name = String(body.name || '').trim().slice(0, 60);
      if (!name) return json(res, 400, { error: 'name required' });
    }
    user.name = name;
    saveDb();
    audit(req, 'account.name.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  // The public handle — shown instead of (or alongside) the real name anywhere someone is
  // identified to other accounts (Social feed, public profile). Unlike name, this has to be
  // unique instance-wide, same shape of check as email above. Lowercase-normalized so
  // "JoseM" and "josem" can't both be claimed and then read as different people.
  'POST /api/account/username': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    if (!username) {
      // Clearing it back out is allowed — the public profile falls back to the real name.
      delete user.username;
      saveDb();
      audit(req, 'account.username.set', { user, msg: '(cleared)' });
      return json(res, 200, { user: publicUser(user) });
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return json(res, 400, { error: 'usernames are 3-20 characters: letters, numbers, underscore only' });
    }
    if (username !== user.username) {
      const other = db.users.find(u => u.username === username);
      if (other && other.id !== user.id) return json(res, 409, { error: 'that username is already taken' });
    }
    user.username = username;
    saveDb();
    audit(req, 'account.username.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/account/phone': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const phone = String(body.phone || '').trim().slice(0, 24);
    if (phone && !/^[+\d][\d\s()-]{3,23}$/.test(phone)) return json(res, 400, { error: 'that doesn\'t look like a phone number' });
    user.phone = phone || null;
    saveDb();
    audit(req, 'account.phone.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  // Up to 3 showcase badges, chosen from whatever's actually earned right now — re-checked
  // here rather than trusted from the client, same as every other perk gate in this file.
  // A milestone you later fall below (there aren't any that can regress today, but a future
  // one might) simply can't be re-selected; already-saved picks aren't retroactively pulled.
  // Only two badge types exist today — your rank tier and your prestige medal, the two
  // things that used to be shown unconditionally above this. They're not "earned or not"
  // like a real achievement would be: rank always qualifies, prestige only once you have
  // any. `picked` is positional (index = slot), nulls are empty slots, not compacted away
  // — otherwise a badge placed in slot 3 alone would silently jump to slot 1 on reload.
  'POST /api/account/badges': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const picked = (Array.isArray(body.badges) ? body.badges : []).slice(0, 3);
    const rank = rankFor(user.id);
    // 'rank:<slug>' for any tier actually reached, 'prestige:<n>' for any prestige level
    // actually reached, 'streak:<tierId>' for any streak-badge tier actually reached (not
    // just the current one in any case) — plus the legacy bare 'rank'/'prestige' (always
    // resolves to whichever is current, see badgesFor/ProfileBadge on the client) so old
    // saved picks keep working untouched.
    const unlockedRankIds = Object.entries(RANK_TIER_MINS).filter(([, min]) => rank.level >= min).map(([slug]) => 'rank:' + slug);
    const unlockedPrestigeIds = Array.from({ length: Math.min(rank.prestige, 10) }, (_, i) => 'prestige:' + (i + 1));
    const streakDaysNow = currentStreakDays(user.id);
    const streakTierList = db.streakTiers.length ? db.streakTiers : FALLBACK_STREAK_TIERS;
    const unlockedStreakIds = streakTierList.filter(s => streakDaysNow >= s.days).map(s => 'streak:' + s.id);
    const allowed = new Set(['rank', ...unlockedRankIds, ...(rank.prestige > 0 ? ['prestige'] : []), ...unlockedPrestigeIds, ...unlockedStreakIds]);
    const filled = picked.filter(Boolean);
    const familyOf = id => id === 'rank' || id.startsWith('rank:') ? 'rank'
      : id === 'prestige' || id.startsWith('prestige:') ? 'prestige'
        : id.startsWith('streak:') ? 'streak' : id;
    const families = filled.map(familyOf);
    if (filled.some(id => !allowed.has(id)) || new Set(filled).size !== filled.length || new Set(families).size !== families.length) {
      return json(res, 400, { error: 'invalid badge selection' });
    }
    while (picked.length < 3) picked.push(null);
    user.badges = picked;
    saveDb();
    audit(req, 'account.badges.set', { user, msg: filled.join(',') || 'none' });
    json(res, 200, { user: publicUser(user) });
  },

  // A profile picture — same upload shape as POST /api/social/upload (data: URL, capped at
  // MAX_IMAGE_BYTES, written under this user's own uploads dir). Unlike workout photos, an
  // avatar replaces itself: the previous file is deleted right after the new one is written
  // and the user record is saved, so a crash between those two steps leaves an orphaned file
  // rather than a broken reference — the safer order.
  'POST /api/account/avatar': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
    if (!m) return json(res, 400, { error: 'unsupported image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return json(res, 413, { error: 'image too large' });
    const ext = UPLOAD_MIME[m[1]];
    const file = crypto.randomBytes(10).toString('base64url') + '.' + ext;
    fs.mkdirSync(uploadsDir(user.id), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(user.id), file), buf);
    const old = user.avatarFile;
    user.avatarFile = file;
    saveDb();
    if (old) { try { fs.unlinkSync(path.join(uploadsDir(user.id), old)); } catch {} }
    audit(req, 'account.avatar.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/account/avatar/remove': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (user.avatarFile) {
      const old = user.avatarFile;
      user.avatarFile = null;
      saveDb();
      try { fs.unlinkSync(path.join(uploadsDir(user.id), old)); } catch {}
      audit(req, 'account.avatar.remove', { user });
    }
    json(res, 200, { user: publicUser(user) });
  },

  // Password only. No "remove" route: with password as the only way in, deleting it would
  // lock the account out — this only ever replaces it.
  'POST /api/account/password': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const password = String(body.password || '');
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    if (!verifyPassword(String(body.currentPassword || ''), user.pwd.salt, user.pwd.hash)) {
      audit(req, 'account.password.fail', { user, msg: 'bad-current-password' });
      return json(res, 401, { error: 'your current password is incorrect' });
    }
    user.pwd = { ...user.pwd, ...hashPassword(password) };
    saveDb();
    audit(req, 'account.password.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  // Email is the login identifier now, so — unlike the old username route — this can't be
  // cleared to blank, and it has to stay unique. Changing it fires a verification link the
  // same way registration does; best-effort, same reasoning as before: if this instance has
  // no SMTP_HOST configured, the address is still saved (unverified) so it's there once an
  // admin sets one up, and `mailConfigured:false` tells the frontend not to promise a mail
  // that can't be sent.
  'POST /api/account/email': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    if (!email) return json(res, 400, { error: 'email required' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email address' });
    if (email === user.email) return json(res, 200, { user: publicUser(user), mailSent: false, mailConfigured: SMTP_CONFIGURED });
    const other = findByEmail(email);
    if (other && other.id !== user.id) return json(res, 409, { error: 'that email is already in use' });
    user.email = email;
    user.emailVerified = false;
    delete user.emailVerifyToken;
    user.emailVerifyToken = { token: crypto.randomBytes(24).toString('base64url'), expires: Date.now() + 86400000 };
    saveDb();
    audit(req, 'account.email.set', { user });
    const mailSent = SMTP_CONFIGURED && await sendMail({
      to: email, subject: 'Verify your email — Forvia',
      text: `Confirm this is your email address for your Forvia account (${user.name}):\n\n${ORIGIN}/api/account/verify-email?token=${user.emailVerifyToken.token}\n\nIf you didn't request this, you can ignore this message — nothing changes until the link above is opened.`,
    });
    json(res, 200, { user: publicUser(user), mailSent, mailConfigured: SMTP_CONFIGURED });
  },

  'POST /api/account/email/resend': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!user.email) return json(res, 400, { error: 'no email on file' });
    if (user.emailVerified) return json(res, 400, { error: 'already verified' });
    user.emailVerifyToken = { token: crypto.randomBytes(24).toString('base64url'), expires: Date.now() + 86400000 };
    saveDb();
    const mailSent = SMTP_CONFIGURED && await sendMail({
      to: user.email, subject: 'Verify your email — Forvia',
      text: `Confirm this is your email address for your Forvia account (${user.name}):\n\n${ORIGIN}/api/account/verify-email?token=${user.emailVerifyToken.token}\n\nIf you didn't request this, you can ignore this message — nothing changes until the link above is opened.`,
    });
    json(res, 200, { mailSent, mailConfigured: SMTP_CONFIGURED });
  },

  // Opened from the email link, not the app — no session, matched by token alone. Answers
  // with a tiny standalone HTML page since whatever mail client opened it isn't running the SPA.
  'GET /api/account/verify-email': async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const token = q.get('token') || '';
    const user = db.users.find(u => u.emailVerifyToken?.token === token && u.emailVerifyToken.expires > Date.now());
    // Plain English, not run through the app's frontend i18n: this page is rendered by the
    // API itself for whatever mail client opened the link, outside the SPA entirely.
    const page = ok => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forvia</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b1710;color:#eafff0;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
div{max-width:360px}h1{font-size:20px;margin:0 0 8px}p{color:#9db8a8;line-height:1.5}</style></head>
<body><div><h1>${ok ? '✓ Email verified' : 'Link expired or invalid'}</h1>
<p>${ok ? 'You can close this tab and go back to Forvia.' : 'Ask Forvia to send you a new verification link and try again.'}</p></div></body></html>`;
    if (!user) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page(false)); }
    user.emailVerified = true;
    delete user.emailVerifyToken;
    saveDb();
    audit(req, 'account.email.verified', { user });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(true));
  },

  // Permanent, self-serve, password-gated. Removes the account, its workout history, uploaded
  // photos, and every trace of it in the social graph (follows both directions, reactions,
  // comments, task completions) — nothing left referencing an id that no longer resolves.
  'POST /api/account/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!verifyPassword(String(body.password || ''), user.pwd.salt, user.pwd.hash)) {
      audit(req, 'account.delete.fail', { user, msg: 'bad-password' });
      return json(res, 401, { error: 'incorrect password' });
    }
    audit(req, 'account.delete', { user });
    const id = user.id;
    db.users = db.users.filter(u => u.id !== id);
    db.subs = db.subs.filter(s => s.userId !== id);
    db.follows = db.follows.filter(f => f.followerId !== id && f.followeeId !== id);
    db.reactions = db.reactions.filter(r => r.userId !== id);
    db.comments = db.comments.filter(c => c.userId !== id);
    db.taskCompletions = db.taskCompletions.filter(c => c.userId !== id);
    saveDb();
    removeState(id);
    try { fs.rmSync(uploadsDir(id), { recursive: true, force: true }); } catch {}
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // Reads the session so the sign-out can be recorded, and now also removes this one device's
  // session record — a stolen cookie from before a normal sign-out no longer keeps working
  // until expiry. A logout with no valid cookie is a no-op and isn't worth an entry.
  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) {
      const parsed = parseSessionCookie(req);
      if (parsed) {
        user.sessions = (user.sessions || []).filter(s => s.id !== parsed.sid);
        saveDb();
      }
      audit(req, 'auth.logout', { user });
    }
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // "Sign out everywhere" — empties this user's session list, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sessions = [];
    saveDb();
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // Per-device session list for Settings → Account. Touches only the CURRENT request's own
  // session record (lastSeenAt) — not on every authenticated route, to avoid a saveDb() write
  // per API call. Never returns the signed cookie token itself, only record metadata.
  'GET /api/account/sessions': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const parsed = parseSessionCookie(req);
    const sessions = user.sessions || [];
    const mine = parsed ? sessions.find(s => s.id === parsed.sid) : null;
    if (mine) { mine.lastSeenAt = new Date().toISOString(); saveDb(); }
    const list = sessions
      .map(s => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ua: s.ua || '', current: !!parsed && s.id === parsed.sid }))
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    json(res, 200, { sessions: list });
  },

  // Revoke one device's session. If it's the caller's own current session, also clear their
  // cookie so this device signs out immediately too (same as POST /api/logout).
  'POST /api/account/sessions/revoke': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) return json(res, 400, { error: 'id required' });
    const sessions = user.sessions || [];
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) return json(res, 404, { error: 'session not found' });
    sessions.splice(idx, 1);
    saveDb();
    audit(req, 'account.sessions.revoke', { user });
    const parsed = parseSessionCookie(req);
    if (parsed && parsed.sid === id) return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    json(res, 200, { ok: true });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { state: readState(user.id) });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    const beforeLevel = rankFor(user.id).level;
    const importedNewWorkouts = mergeWorkoutsInto(user.id, body.state);
    mergeFoodDiaryInto(user.id, body.state);
    scanForCheating(req, user, body.state);
    writeState(user.id, body.state);
    if (importedNewWorkouts) capImportLevelGain(user.id, beforeLevel);
    scanForTasks(req, user, body.state);
    // workouts/deletedWorkoutIds and foodDiary/deletedFoodEntryIds go back in the response too —
    // the merges above can add something this exact push didn't know about (logged from another
    // device meanwhile), and without handing that back, this device wouldn't see it until its
    // next full reload.
    json(res, 200, {
      ok: true, ts: body.state._ts || null,
      workouts: body.state.workouts, deletedWorkoutIds: body.state.deletedWorkoutIds,
      foodDiary: body.state.foodDiary, deletedFoodEntryIds: body.state.deletedFoodEntryIds,
    });
  },

  // Algorithmic calls are wrong sometimes — a heavy-but-real PR, a session that ran past
  // midnight and looks like it overlaps another. This is the account holder's own review
  // request on a penalty already on their account (see /api/admin/anticheat/review for the
  // admin side that actually rules on it); it doesn't lift the penalty by itself.
  'GET /api/anticheat/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const mine = db.cheatPenalties.filter(c => c.userId === user.id)
      .map(c => ({
        id: c.id, workoutId: c.workoutId, findings: c.findings, levels: c.levels, status: c.status, appeal: c.appeal, date: c.date, seen: c.seen !== false,
        beforeLevel: c.beforeLevel, beforeXpInLevel: c.beforeXpInLevel, beforeXpForLevel: c.beforeXpForLevel,
        // The account holder's own copy of what got hidden — scanForCheating pulled it out of
        // their normal history the moment it was flagged, so without this they'd have no way to
        // check their own numbers before appealing.
        workout: c.workout || null, unit: c.unit || null, reviewNote: c.reviewNote || null,
      }));
    json(res, 200, { penalties: mine });
  },
  // The one-time "we caught you" reveal calls this right after it plays, so it never plays
  // twice for the same penalty (a re-render, a reload mid-animation, a second device).
  'POST /api/anticheat/ack': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = db.cheatPenalties.find(x => x.id === body.id && x.userId === user.id);
    if (!c) return json(res, 404, { error: 'no such penalty' });
    c.seen = true;
    saveDb();
    json(res, 200, { ok: true });
  },
  'POST /api/anticheat/appeal': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = db.cheatPenalties.find(x => x.id === body.id && x.userId === user.id);
    if (!c) return json(res, 404, { error: 'no such penalty' });
    // Only a fresh, never-touched penalty can be appealed. Once it's under review it can't be
    // appealed again on top (there's already one pending), and once an admin has actually ruled
    // — upheld or overturned, either way — that ruling is final, not just the overturn case.
    if (c.status !== 'active') return json(res, 400, { error: 'not appealable' });
    const message = String(body.message || '').trim().slice(0, 500);
    if (!message) return json(res, 400, { error: 'message required' });
    c.status = 'appealed';
    c.appeal = { message, created: new Date().toISOString() };
    saveDb();
    audit(req, 'anticheat.appeal', { user, msg: c.workoutId });
    json(res, 200, { ok: true });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'Forvia', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, email: u.email || null, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), employeeTypes: employeeTypesOf(u), invitedBy: u.invitedBy || null,
        pro: !!u.pro,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  // Everything about one account, for the admin drill-down — publicUser() already carries
  // name/email/phone/bio/avatarUrl/rank/perks/badges, so this only adds the fields that are
  // admin-only (created, disabled, invitedBy, the raw XP adjustment) plus their training data.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: {
        ...publicUser(u),
        created: u.created || null, disabled: !!u.disabled, invitedBy: u.invitedBy || null,
        adminXpAdjust: u.adminXpAdjust || 0,
      },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse(),   // newest first for display
      // The three Free-tier counts (5 each — sheets.jsx's customFoodDefSheet/saveMealSheet/
      // createMealSheet/customExSheet) — shown so an admin can see how close someone actually
      // is to the cap they're asking about, not just flip their Pro flag blind.
      customFoodsCount: (S.customFoods || []).length,
      savedMealsCount: (S.savedMeals || []).length,
      customExCount: (S.customEx || []).length,
    });
  },

  // Nudge a level up or down without inventing fake workouts — adjusts the same admin-only XP
  // offset xpFor() already adds in, snapped to exactly the target level's floor so the result
  // reads cleanly (no half-earned sliver of the level either side of the move).
  'POST /api/admin/user/level': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const delta = body.delta === -1 ? -1 : 1;
    const before = rankFor(u.id);
    const targetLevel = Math.max(1, Math.min(100, before.level + delta));
    if (targetLevel === before.level) return json(res, 400, { error: 'already at the limit' });
    // The *displayed* level is rawLevel minus any active cheat-penalty docking (see rankFor) —
    // moving the number the admin actually sees by one means moving the underlying raw level
    // by one, docking included, not landing the raw level itself on the target.
    const levelsDocked = levelsDockedFor(u.id);
    const targetRawLevel = Math.max(1, Math.min(100, targetLevel + levelsDocked));
    // rankFor's xpInCycle is xpFor(uid) - baseline; landing exactly on the target level's
    // floor means: adjust so that (currentTotalXp + newAdjust - oldAdjust) - baseline == floor.
    const floor = LEVEL_CUM[targetRawLevel - 1];
    const baseline = u.prestigeBaselineXp || 0;
    const xpWithoutAdjust = before.totalXp - (u.adminXpAdjust || 0);
    u.adminXpAdjust = floor + baseline - xpWithoutAdjust;
    saveDb();
    audit(req, 'admin.user.level', { user: admin, target: u, msg: `${before.level} -> ${targetLevel}` });
    // Same real-time path as the anti-cheat events (wsSend, see above) — an admin nudge is
    // exactly the "arrives from outside this session" case that's worth pushing live rather
    // than waiting for LevelUpRevealTrigger's own poll to notice on its own.
    wsSend(u.id, { type: 'rank:changed' });
    json(res, 200, { rank: rankFor(u.id) });
  },

  // Same relationship to POST /api/prestige that the level nudge above has to earning XP
  // normally — a direct admin correction, not a reimplementation (issue: an admin trying the
  // real "Upgrade mastery" button got the expected "not ready to prestige" 400, since it only
  // ever fires at level 100; this is the deliberate bypass for testing/correcting the count
  // directly). Going up mirrors the real confirm exactly — spend everything earned so far into
  // the new cycle, landing at level 1 of it, same as clicking "Upgrade mastery" at level 100
  // does. Going down just decrements the count; there's no stored history of the previous
  // cycle's baseline to restore exactly, so whatever XP has been earned since simply carries
  // into the now-lower cycle as-is — fine for a correction tool, not meant to invert every
  // possible prior state.
  'POST /api/admin/user/prestige': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const delta = body.delta === -1 ? -1 : 1;
    const current = u.prestigeConfirmed || 0;
    const target = Math.max(0, Math.min(MAX_PRESTIGE, current + delta));
    if (target === current) return json(res, 400, { error: 'already at the limit' });
    if (delta === 1) u.prestigeBaselineXp = rankFor(u.id).totalXp;
    u.prestigeConfirmed = target;
    saveDb();
    audit(req, 'admin.user.prestige', { user: admin, target: u, msg: `${current} -> ${target}` });
    wsSend(u.id, { type: 'rank:changed' });
    json(res, 200, { rank: rankFor(u.id) });
  },

  'POST /api/admin/user/streak': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const delta = body.delta === -1 ? -1 : 1;
    u.streakBonus = (u.streakBonus || 0) + delta;
    saveDb();
    audit(req, 'admin.user.streak', { user: admin, target: u, msg: `bonus -> ${u.streakBonus}` });
    wsSend(u.id, { type: 'rank:changed' });
    json(res, 200, { streakBonus: u.streakBonus });
  },

  // No billing exists yet (SettingsSubscription.jsx is catalog-only) — this is the only way
  // an account becomes Pro for now, same "admin nudge, real mechanism later" posture as
  // adminXpAdjust/streakBonus above.
  'POST /api/admin/user/pro': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    u.pro = !u.pro;
    saveDb();
    audit(req, 'admin.user.pro', { user: admin, target: u, msg: String(u.pro) });
    json(res, 200, { pro: u.pro });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    audit(req, u.disabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u });
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  // A user can hold several employee types at once (founder, admin) — this replaces the
  // whole set rather than toggling one, so the client always sends the full list it wants.
  'POST /api/admin/user/employee-types': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const types = Array.isArray(body.employeeTypes) ? body.employeeTypes : [];
    const invalid = types.some(t => !EMPLOYEE_TYPES.includes(t));
    if (invalid) return json(res, 400, { error: 'unknown employee type' });
    u.employeeTypes = [...new Set(types)];
    saveDb();
    audit(req, 'admin.user.employee_types', { user: admin, target: u, msg: u.employeeTypes.join(',') || '(none)' });
    json(res, 200, { ok: true, id: u.id, employeeTypes: u.employeeTypes });
  },

  // The one door left once ALLOW_REGISTER is off: same validation as POST /api/register, but
  // admin-gated instead of ALLOW_REGISTER/invite-gated, and it never signs the new account in.
  'POST /api/admin/user/create': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email address' });
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    if (findByEmail(email)) return json(res, 409, { error: 'an account already exists for that email' });
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, email, created: new Date().toISOString() };
    user.pwd = hashPassword(password);
    db.users.push(user);
    saveDb();
    audit(req, 'admin.user.create', { user: admin, target: user });
    json(res, 200, { user: publicUser(user) });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register tells a caller whether a code is good, so
    // the code itself has to be the thing that isn't worth guessing. Codes already in db.json keep
    // working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    audit(req, 'admin.invite.create', { user: admin, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
    json(res, 200, { ok: true });
  },

  /* ---------- alpha waitlist (admin side) ---------- */
  'GET /api/admin/alpha': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { requests: [...db.alphaRequests].reverse() });
  },
  // Generates a real single-use invite code (same table, same rules as Users → Invite codes)
  // tied to this request, but doesn't send anything itself — there's no SMTP-independent way
  // to know the admin actually wants to reach out today, so this just hands back the code and
  // a mailto: link's worth of information for them to send by hand.
  'POST /api/admin/alpha/invite': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.alphaRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    let code;
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: 'alpha: ' + reqRow.email, createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    reqRow.status = 'invited';
    reqRow.invitedAt = new Date().toISOString();
    reqRow.inviteCode = code;
    saveDb();
    audit(req, 'admin.alpha.invite', { user: admin, msg: reqRow.email });
    json(res, 200, { invite, request: reqRow });
  },
  'POST /api/admin/alpha/dismiss': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.alphaRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    reqRow.status = 'dismissed';
    saveDb();
    audit(req, 'admin.alpha.dismiss', { user: admin, msg: reqRow.email });
    json(res, 200, { ok: true });
  },

  /* ---------- coach applications (admin side) ---------- */
  'GET /api/admin/coach-requests': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // Joined in for display — the row itself only stores userId, unlike alphaRequests which
    // has no matching account yet to look name/email up from.
    const requests = [...db.coachRequests].reverse().map(r => {
      const u = db.users.find(x => x.id === r.userId);
      return { ...r, name: u?.name || null, email: u?.email || null };
    });
    json(res, 200, { requests });
  },
  // Serves the applicant's proof document to an admin reviewing the request — narrowly scoped
  // to coach-request documents rather than widening GET /api/uploads' own visibility rule
  // (owner-or-public) to admins, which would hand admins every private workout photo too.
  'GET /api/admin/coach-requests/document': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const reqRow = db.coachRequests.find(r => r.id === (q.get('id') || ''));
    if (!reqRow || !reqRow.documentFile) return json(res, 404, { error: 'not found' });
    const ext = reqRow.documentFile.slice(reqRow.documentFile.lastIndexOf('.') + 1);
    const mime = Object.entries(DOCUMENT_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
    fs.readFile(path.join(uploadsDir(reqRow.userId), reqRow.documentFile), (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=0' });
      res.end(buf);
    });
  },
  'POST /api/admin/coach-requests/approve': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.coachRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    const applicant = db.users.find(u => u.id === reqRow.userId);
    if (!applicant) return json(res, 404, { error: 'applicant account no longer exists' });
    reqRow.status = 'approved';
    reqRow.reviewedBy = admin.id;
    reqRow.reviewedAt = new Date().toISOString();
    applicant.coach = true;
    saveDb();
    audit(req, 'admin.coach.approve', { user: admin, target: applicant });
    // Same real-time path as rank:changed/anticheat:* — an already-open session picks up the
    // new coach flag immediately (Settings.jsx's card swap) instead of waiting for whatever
    // unrelated action next happens to call refreshUser().
    wsSend(applicant.id, { type: 'coach:approved' });
    json(res, 200, { ok: true });
  },
  'POST /api/admin/coach-requests/dismiss': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.coachRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    reqRow.status = 'dismissed';
    saveDb();
    audit(req, 'admin.coach.dismiss', { user: admin, msg: reqRow.userId });
    json(res, 200, { ok: true });
  },

  /* ---------- box requests (admin side) ---------- */
  'GET /api/admin/box-requests': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const requests = [...db.boxRequests].reverse().map(r => {
      const u = db.users.find(x => x.id === r.coachId);
      return { ...r, coachName: u?.name || null, coachEmail: u?.email || null };
    });
    json(res, 200, { requests });
  },
  // Serves a pending request's cover image for admin preview — same narrow-scope reasoning as
  // GET /api/admin/coach-requests/document (a dedicated route rather than widening
  // GET /api/uploads' visibility rule to admins).
  'GET /api/admin/box-requests/image': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const reqRow = db.boxRequests.find(r => r.id === (q.get('id') || ''));
    if (!reqRow || !reqRow.imageFile) return json(res, 404, { error: 'not found' });
    const ext = reqRow.imageFile.slice(reqRow.imageFile.lastIndexOf('.') + 1);
    const mime = Object.entries(UPLOAD_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
    fs.readFile(path.join(uploadsDir(reqRow.coachId), reqRow.imageFile), (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=0' });
      res.end(buf);
    });
  },
  // Approval is what actually creates the box — the image file was already written to the
  // coach's own uploads dir at request time, so this just references the same filename rather
  // than copying it.
  'POST /api/admin/box-requests/approve': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.boxRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    if (reqRow.status !== 'pending') return json(res, 400, { error: 'already reviewed' });
    reqRow.status = 'approved';
    reqRow.reviewedBy = admin.id;
    reqRow.reviewedAt = new Date().toISOString();
    const box = {
      id: crypto.randomBytes(8).toString('base64url'), coachId: reqRow.coachId,
      title: reqRow.title, description: reqRow.description, imageFile: reqRow.imageFile || null,
      location: reqRow.location || null, created: new Date().toISOString(),
    };
    db.boxes.push(box);
    saveDb();
    audit(req, 'admin.box.approve', { user: admin, msg: reqRow.title });
    wsSend(reqRow.coachId, { type: 'box:reviewed' });
    json(res, 200, { ok: true, box });
  },
  'POST /api/admin/box-requests/dismiss': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const reqRow = db.boxRequests.find(r => r.id === body.id);
    if (!reqRow) return json(res, 404, { error: 'no such request' });
    reqRow.status = 'dismissed';
    saveDb();
    audit(req, 'admin.box.dismiss', { user: admin, msg: reqRow.title });
    wsSend(reqRow.coachId, { type: 'box:reviewed' });
    json(res, 200, { ok: true });
  },

  /* ---------- bug reports (admin side) ---------- */
  'GET /api/admin/bugs': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { reports: [...db.bugReports].reverse() });
  },
  'POST /api/admin/bugs/resolve': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const row = db.bugReports.find(r => r.id === body.id);
    if (!row) return json(res, 404, { error: 'no such report' });
    row.status = row.status === 'resolved' ? 'open' : 'resolved';
    saveDb();
    audit(req, 'admin.bug.resolve', { user: admin, msg: row.status + ': ' + row.message.slice(0, 60) });
    json(res, 200, { report: row });
  },
  'POST /api/admin/bugs/delete': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const row = db.bugReports.find(r => r.id === body.id);
    if (!row) return json(res, 404, { error: 'no such report' });
    db.bugReports = db.bugReports.filter(r => r.id !== body.id);
    saveDb();
    audit(req, 'admin.bug.delete', { user: admin, msg: row.message.slice(0, 60) });
    json(res, 200, { ok: true });
  },

  /* ---------- activity log ---------- */
  // Newest first, paged by id. Not by offset: the log grows at the front of this view, so an
  // offset cursor would repeat a row whenever an event lands between two pages; and not by
  // timestamp, because two events can share a millisecond. auditKeep() runs on read as well as
  // on the hourly compaction, so nothing past its retention is ever served.
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditCache).slice().reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
    else if (cat) rows = rows.filter(r => String(r.ev).startsWith(cat + '.'));
    const page = rows.filter(r => r.id < before).slice(0, limit);
    json(res, 200, {
      events: page,
      total: rows.length,
      nextBefore: page.length === limit ? page[page.length - 1].id : null,
      enabled: AUDIT_ON, ip_mode: AUDIT_IP,
      retention: { max: AUDIT_MAX, days: AUDIT_DAYS },
      now: Date.now()
    });
  },

  // Deleting the log is itself logged, and auditSeq is not reset — so a clear always leaves a
  // visible gap in the ids and can't be used to quietly erase a trace. There is no export route:
  // ./data/audit.log already is the export, in a format jq reads directly.
  'POST /api/admin/audit/clear': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    auditCache = [];
    auditCount = 0;
    // Awaited (unlike every other write in this file) so the clear-event record appended by
    // audit() just below can never race a slower fire-and-forget DELETE and get wiped with it.
    try { await auditClearAll(); } catch (e) { console.error('audit clear failed:', e.message); }
    audit(req, 'admin.audit.clear', { user: admin });
    json(res, 200, { ok: true });
  },

  /* ---------- anti-cheat review ---------- */
  // Every algorithmic penalty on every account, newest first — appealed ones are what an
  // operator actually needs to act on, but upheld/overturned stay listed too so a ruling is
  // never silently unrecoverable from the UI.
  'GET /api/admin/anticheat': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = [...db.cheatPenalties].reverse().map(c => ({ ...c, userName: (db.users.find(u => u.id === c.userId) || {}).name || null }));
    json(res, 200, { penalties: rows });
  },
  // The actual ruling on a review request. Upholding just records that a human looked and
  // agreed — the workout (scanForCheating pulled it out of state.workouts when it was first
  // flagged; see there) stays out for good, its only copy still the one on this row. Overturning
  // puts it back where it came from: state.workouts, counted in xpFor() again on the very next
  // read, visible in history/feed again — not just a status flip, since nothing else still holds
  // a copy to restore. Either way the account holder's appeal message stays on the record — and
  // now so does the admin's own: a decision with no reason attached to it isn't really a review,
  // just a status flip, and the account holder is the one left wondering why either way.
  'POST /api/admin/anticheat/review': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const c = db.cheatPenalties.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'no such penalty' });
    if (!['uphold', 'overturn'].includes(body.decision)) return json(res, 400, { error: 'invalid decision' });
    const reviewNote = String(body.reviewNote || '').trim().slice(0, 500);
    if (!reviewNote) return json(res, 400, { error: 'explain the decision' });
    c.status = body.decision === 'overturn' ? 'overturned' : 'upheld';
    c.reviewedBy = admin.id;
    c.reviewedAt = new Date().toISOString();
    c.reviewNote = reviewNote;
    if (c.status === 'overturned' && c.workout) {
      const S = readState(c.userId);
      if (S && !(S.workouts || []).some(w => w.id === c.workout.id)) {
        S.workouts = [...(S.workouts || []), c.workout];
        writeState(c.userId, S);
        const target = db.users.find(u => u.id === c.userId);
        // Same-day-only by design (see scanForTasks) — catches the day's task credit if the
        // review happens to land the same day the workout did; otherwise this is a no-op, same
        // as logging a real workout late in the day already is.
        if (target) scanForTasks(req, target, S);
      }
    }
    saveDb();
    audit(req, 'admin.anticheat.review', { user: admin, msg: c.workoutId + ':' + c.status });
    // Same reasoning as the flag push above: the account holder has no other way to find out a
    // verdict landed except reopening Penalties themselves, possibly days later. Fires the
    // instant the ruling is made, whether or not they ever actually appealed it.
    wsSend(c.userId, { type: 'anticheat:reviewed', status: c.status, levels: c.levels, reviewNote: c.reviewNote });
    sendPush(c.userId, c.status === 'overturned'
      ? { title: '✅ Appeal accepted', body: 'A flagged workout was cleared and is back on your account.', tag: 'anticheat-review' }
      : { title: 'Penalty reviewed', body: 'A flagged workout was reviewed and the penalty stands.', tag: 'anticheat-review' });
    json(res, 200, { ok: true, status: c.status });
  },

  /* ---------- daily tasks (XP) ---------- */
  // The catalog's copy (name/description/points) is admin-authored, but whether a task is
  // DONE is graded server-side by scanForTasks against real workout data — there's no
  // "mark complete" route any more, on purpose (see taskCriteriaMet above). GET /api/admin/tasks
  // returns the whole catalog either way — only GET /api/tasks/today caps it to
  // DAILY_TASKS_LIMIT, so an admin can stock up a big catalog and let it rotate.
  'GET /api/admin/tasks': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    json(res, 200, { tasks: db.tasks, bodyParts: TASK_BODY_PARTS, todayIds: tasksForToday().map(t => t.id) });
  },
  'POST /api/admin/tasks': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const desc = String(body.desc || '').trim().slice(0, 200);
    const points = Math.max(1, Math.min(500, Math.round(+body.points || 0)));
    const c = body.criteria || {};
    const type = TASK_CRITERIA_TYPES.includes(c.type) ? c.type : null;
    if (!name || !points || !type) return json(res, 400, { error: 'name, points and a valid criteria type are required' });
    let criteria;
    if (type === 'sets' || type === 'minutes') {
      const n = Math.max(1, Math.round(+c.n || 0));
      if (!n) return json(res, 400, { error: 'criteria.n must be a positive number' });
      criteria = { type, n };
    } else if (type === 'body_part') {
      if (!TASK_BODY_PARTS.includes(c.bp)) return json(res, 400, { error: 'criteria.bp must be a valid body part' });
      criteria = { type, bp: c.bp };
    } else {
      criteria = { type };
    }
    const task = { id: crypto.randomBytes(6).toString('base64url'), name, desc, points, criteria, created: new Date().toISOString() };
    db.tasks.push(task);
    saveDb();
    audit(req, 'admin.task.add', { user: admin, msg: name });
    json(res, 200, { task });
  },
  'POST /api/admin/tasks/remove': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const task = db.tasks.find(t => t.id === body.id);
    db.tasks = db.tasks.filter(t => t.id !== body.id);
    saveDb();
    audit(req, 'admin.task.remove', { user: admin, msg: task?.name || body.id });
    json(res, 200, { ok: true });
  },

  /* ---------- exercise name overrides ---------- */
  // The exercise catalogue (id, name, muscles, images…) lives only in the frontend bundle —
  // this backend has no copy of it (see the "backend has no copy of the exercise catalog"
  // comment above). All this route owns is a table of {id, lang, name} renames — one per
  // (exercise, language) pair, since the catalogue itself carries an English name plus a
  // separate translated-name pack per language (src/names/*.js), and admin renames overlay
  // each independently. The id is never validated against anything, because this backend has
  // no catalogue to validate it against — the frontend is the source of truth for which ids
  // exist. Every client overlays these on top of the catalogue's own names at display time,
  // ahead of the translated pack too (see i18n-core.js's nameFor). An empty name removes the
  // override for that (id, lang) pair and reverts to the catalogue/translation's own name.
  'POST /api/admin/exercises/override': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const lang = String(body.lang || 'en').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 80);
    if (!id) return json(res, 400, { error: 'id is required' });
    if (!/^[a-z]{2}$/.test(lang)) return json(res, 400, { error: 'lang must be a 2-letter code' });
    db.exerciseOverrides = db.exerciseOverrides.filter(o => !(o.id === id && o.lang === lang));
    if (name) db.exerciseOverrides.push({ id, lang, name });
    saveDb();
    audit(req, 'admin.exercise.rename', { user: admin, msg: `${id} [${lang}]` + (name ? ' → ' + name : ' (reverted)') });
    json(res, 200, { overrides: db.exerciseOverrides });
  },

  /* ---------- streak tiers (admin-configurable badge thresholds) ---------- */
  // Purely a name + day-count today, no gameplay effect (unlike RANK_PERKS/PRESTIGE_PERKS
  // in Rank.jsx, which are real) — the badge is cosmetic until/unless perks get attached
  // later. Thresholds are deliberately admin-editable rather than hardcoded because the
  // starting set (1/3/7/14/21/30/60/100/180/365 days) is meant to get harder over time
  // without a code change.
  'POST /api/admin/streak-tiers': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const days = Math.max(1, Math.round(+body.days || 0));
    if (!name || !days) return json(res, 400, { error: 'name and a positive day count are required' });
    const tier = { id: crypto.randomBytes(9).toString('base64url'), name, days };
    db.streakTiers.push(tier);
    saveDb();
    audit(req, 'admin.streakTier.add', { user: admin, msg: `${name} (${days}d)` });
    json(res, 200, { tiers: [...db.streakTiers].sort((a, b) => a.days - b.days) });
  },
  'POST /api/admin/streak-tiers/update': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const tier = db.streakTiers.find(x => x.id === body.id);
    if (!tier) return json(res, 404, { error: 'tier not found' });
    const name = String(body.name || '').trim().slice(0, 40);
    const days = Math.max(1, Math.round(+body.days || 0));
    if (!name || !days) return json(res, 400, { error: 'name and a positive day count are required' });
    tier.name = name; tier.days = days;
    saveDb();
    audit(req, 'admin.streakTier.update', { user: admin, msg: `${tier.id} -> ${name} (${days}d)` });
    json(res, 200, { tiers: [...db.streakTiers].sort((a, b) => a.days - b.days) });
  },
  'POST /api/admin/streak-tiers/remove': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const tier = db.streakTiers.find(x => x.id === body.id);
    db.streakTiers = db.streakTiers.filter(x => x.id !== body.id);
    saveDb();
    audit(req, 'admin.streakTier.remove', { user: admin, msg: tier ? tier.name : body.id });
    json(res, 200, { tiers: [...db.streakTiers].sort((a, b) => a.days - b.days) });
  },

  /* ---------- custom muscle groups ---------- */
  // Admin-defined groupings of exercises, independent of the catalogue's own body-part/muscle
  // tags — e.g. a "Push day" or "Weak points" group. A group's name is per language, same
  // reasoning as exercise renames (see above); membership (exerciseIds) is not, since which
  // exercises belong in a group doesn't change with the viewer's language. Exercise ids are
  // never validated against a catalogue this backend doesn't have — same as everywhere else.
  'GET /api/admin/muscle-groups': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { groups: db.muscleGroups });
  },
  'POST /api/admin/muscle-groups': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const lang = String(body.lang || 'en').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name is required' });
    if (!/^[a-z]{2}$/.test(lang)) return json(res, 400, { error: 'lang must be a 2-letter code' });
    const group = { id: crypto.randomBytes(9).toString('base64url'), name: { [lang]: name }, exerciseIds: [], created: new Date().toISOString() };
    db.muscleGroups.push(group);
    saveDb();
    audit(req, 'admin.muscleGroup.create', { user: admin, msg: `${group.id} [${lang}] ${name}` });
    json(res, 200, { groups: db.muscleGroups });
  },
  'POST /api/admin/muscle-groups/rename': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const lang = String(body.lang || 'en').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 60);
    if (!/^[a-z]{2}$/.test(lang)) return json(res, 400, { error: 'lang must be a 2-letter code' });
    const group = db.muscleGroups.find(g => g.id === id);
    if (!group) return json(res, 404, { error: 'group not found' });
    if (name) group.name = { ...group.name, [lang]: name };
    else { group.name = { ...group.name }; delete group.name[lang]; }
    saveDb();
    audit(req, 'admin.muscleGroup.rename', { user: admin, msg: `${id} [${lang}] → ${name || '(cleared)'}` });
    json(res, 200, { groups: db.muscleGroups });
  },
  'POST /api/admin/muscle-groups/remove': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const group = db.muscleGroups.find(g => g.id === body.id);
    db.muscleGroups = db.muscleGroups.filter(g => g.id !== body.id);
    saveDb();
    audit(req, 'admin.muscleGroup.remove', { user: admin, msg: group ? (Object.values(group.name)[0] || group.id) : body.id });
    json(res, 200, { groups: db.muscleGroups });
  },
  'POST /api/admin/muscle-groups/add-exercise': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const group = db.muscleGroups.find(g => g.id === body.id);
    if (!group) return json(res, 404, { error: 'group not found' });
    const exId = String(body.exerciseId || '').trim();
    if (!exId) return json(res, 400, { error: 'exerciseId is required' });
    if (!group.exerciseIds.includes(exId)) group.exerciseIds.push(exId);
    saveDb();
    audit(req, 'admin.muscleGroup.addExercise', { user: admin, msg: `${exId} → ${group.id}` });
    json(res, 200, { groups: db.muscleGroups });
  },
  'POST /api/admin/muscle-groups/remove-exercise': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const group = db.muscleGroups.find(g => g.id === body.id);
    if (!group) return json(res, 404, { error: 'group not found' });
    const exId = String(body.exerciseId || '').trim();
    group.exerciseIds = group.exerciseIds.filter(x => x !== exId);
    saveDb();
    audit(req, 'admin.muscleGroup.removeExercise', { user: admin, msg: `${exId} ✕ ${group.id}` });
    json(res, 200, { groups: db.muscleGroups });
  },
  // Bulk replace — same idea as add/remove-exercise but for a whole set at once, so seeding a
  // group from a body part (AdminMuscleGroups.jsx "Seed from body parts") is one request per
  // group instead of one per exercise.
  'POST /api/admin/muscle-groups/set-exercises': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const group = db.muscleGroups.find(g => g.id === body.id);
    if (!group) return json(res, 404, { error: 'group not found' });
    const ids = Array.isArray(body.exerciseIds) ? body.exerciseIds : [];
    group.exerciseIds = [...new Set(ids.map(String))];
    saveDb();
    audit(req, 'admin.muscleGroup.setExercises', { user: admin, msg: `${group.id}: ${group.exerciseIds.length} exercises` });
    json(res, 200, { groups: db.muscleGroups });
  },

  // Today's catalog for the signed-in user, with per-task completion state. Completions
  // are per calendar day (server-local date), so the checklist clears itself overnight
  // with no cron job — "today" is just a different string tomorrow. done is only ever
  // set by scanForTasks (called from PUT /api/data) — this route is read-only.
  'GET /api/tasks/today': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const today = isoOf(new Date());
    const done = new Set(db.taskCompletions.filter(c => c.userId === me.id && c.date === today).map(c => c.taskId));
    json(res, 200, { tasks: tasksForToday().map(t => ({ ...t, done: done.has(t.id) })) });
  },

  /* ---------- social ---------- */
  'POST /api/social/public': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    user.public = !!body.public;
    saveDb();
    audit(req, 'social.public.set', { user, msg: user.public ? 'on' : 'off' });
    json(res, 200, { user: publicUser(user) });
  },

  // Rank/prestige perk unlocks below — each is a single field, its own route, gated by
  // perksFor(), same shape as /api/social/public above.
  'POST /api/social/bio': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!perksFor(user.id).bio) return json(res, 403, { error: 'not unlocked yet' });
    const body = await readBody(req);
    user.bio = String(body.bio || '').trim().slice(0, 140);
    saveDb();
    audit(req, 'social.bio.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  // Pinning: workoutId must be one of the caller's own workouts, and the total pinned
  // count can't exceed perksFor().pinnedMax (Diamond tier + Prestige 3, additive).
  'POST /api/social/pin': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const perks = perksFor(user.id);
    if (perks.pinnedMax < 1) return json(res, 403, { error: 'not unlocked yet' });
    const body = await readBody(req);
    const workoutId = String(body.workoutId || '');
    const mine = (readState(user.id)?.workouts || []).some(w => w.id === workoutId);
    if (!mine) return json(res, 404, { error: 'no such workout' });
    user.pinnedWorkoutIds = user.pinnedWorkoutIds || [];
    if (!user.pinnedWorkoutIds.includes(workoutId)) {
      if (user.pinnedWorkoutIds.length >= perks.pinnedMax) return json(res, 403, { error: 'pin limit reached' });
      user.pinnedWorkoutIds.push(workoutId);
      saveDb();
      audit(req, 'social.pin', { user, msg: workoutId });
    }
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/social/unpin': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const before = (user.pinnedWorkoutIds || []).length;
    user.pinnedWorkoutIds = (user.pinnedWorkoutIds || []).filter(id => id !== body.workoutId);
    if (user.pinnedWorkoutIds.length !== before) {
      saveDb();
      audit(req, 'social.unpin', { user, msg: body.workoutId });
    }
    json(res, 200, { user: publicUser(user) });
  },

  // One pinned PR, separate from pinned workouts — the earliest perk (Bronze), so it
  // doesn't share the Diamond/Prestige-3 pin budget.
  'POST /api/social/pin-pr': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!perksFor(user.id).pinFavoritePR) return json(res, 403, { error: 'not unlocked yet' });
    const body = await readBody(req);
    const workoutId = String(body.workoutId || ''), exerciseId = String(body.exerciseId || '');
    if (!workoutId || !exerciseId) { user.pinnedPR = null; }
    else {
      const w = (readState(user.id)?.workouts || []).find(x => x.id === workoutId);
      if (!w) return json(res, 404, { error: 'no such workout' });
      user.pinnedPR = { workoutId, exerciseId };
    }
    saveDb();
    audit(req, 'social.pinPR.set', { user });
    json(res, 200, { user: publicUser(user) });
  },

  // Accounts you can find and follow — everyone who opted into "Public profile", minus yourself.
  'GET /api/social/users': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const following = new Set(db.follows.filter(f => f.followerId === me.id).map(f => f.followeeId));
    const users = db.users.filter(u => u.public && !u.disabled && u.id !== me.id)
      .map(u => ({ ...socialUser(u), following: following.has(u.id) }));
    json(res, 200, { users });
  },

  'POST /api/social/follow': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const target = db.users.find(u => u.id === body.userId);
    if (!target || !target.public || target.disabled) return json(res, 404, { error: 'no such public profile' });
    if (target.id === me.id) return json(res, 400, { error: "can't follow yourself" });
    if (!db.follows.some(f => f.followerId === me.id && f.followeeId === target.id)) {
      db.follows.push({ followerId: me.id, followeeId: target.id, created: new Date().toISOString() });
      saveDb();
      audit(req, 'social.follow', { user: me, target });
    }
    json(res, 200, { ok: true });
  },

  'POST /api/social/unfollow': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const before = db.follows.length;
    db.follows = db.follows.filter(f => !(f.followerId === me.id && f.followeeId === body.userId));
    if (db.follows.length !== before) {
      saveDb();
      const target = db.users.find(u => u.id === body.userId);
      audit(req, 'social.unfollow', { user: me, target });
    }
    json(res, 200, { ok: true });
  },

  // Who I follow that's still public right now, each with their current streak — the same
  // number Home/Stats show them, computed the same way, just server-side.
  'GET /api/social/following': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const following = followingOf(me.id).map(uid => {
      const u = db.users.find(x => x.id === uid);
      return { ...socialUser(u), ...statsFor(uid) };
    });
    json(res, 200, { following });
  },

  'GET /api/social/leaderboard': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const ids = [me.id, ...followingOf(me.id)];
    const rows = ids.map(uid => {
      const u = db.users.find(x => x.id === uid);
      return { ...socialUser(u), me: uid === me.id, ...statsFor(uid) };
    }).sort((a, b) => b.streak - a.streak || b.thisWeek - a.thisWeek);
    json(res, 200, { leaderboard: rows });
  },

  // Recent workouts from everyone I follow who's still public, newest first, capped both by
  // age and count so this stays cheap however long someone's been using the instance.
  // "For you" — who you follow, plus your own workouts. Your own posts don't depend on your
  // account being public (that rule is about who ELSE can see you); it's just your feed.
  'GET /api/social/feed': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { items: feedItemsFor([me.id, ...followingOf(me.id)], me) });
  },

  // Discover's own feed: recent posts from public accounts I *don't* follow yet — same
  // shape as /api/social/feed, so the client renders both with the same feed card.
  'GET /api/social/discover': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const following = new Set(db.follows.filter(f => f.followerId === me.id).map(f => f.followeeId));
    const uids = db.users.filter(u => u.public && !u.disabled && u.id !== me.id && !following.has(u.id)).map(u => u.id);
    json(res, 200, { items: feedItemsFor(uids, me) });
  },

  // A single public profile — tapping a name in the feed lands here. 404s the instant
  // the account isn't public any more, same rule as everywhere else in Social — except
  // your own profile, which you can always view (Social's "My profile" button) regardless
  // of your own public/private setting.
  'GET /api/social/user': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const uid = q.get('uid') || '';
    const u = db.users.find(x => x.id === uid);
    if (!u || u.disabled || (!u.public && uid !== me.id)) return json(res, 404, { error: 'not found' });
    // Pinned posts (Diamond tier / Prestige 3) surface first on the profile — everywhere
    // else (the regular feed) stays purely chronological.
    const pinned = new Set(u.pinnedWorkoutIds || []);
    const items = feedItemsFor([uid], me).sort((a, b) => pinned.has(b.workout.id) - pinned.has(a.workout.id));
    json(res, 200, {
      user: socialUser(u),
      ...rankFor(uid),
      perks: perksFor(uid),
      workouts: readState(uid)?.workouts?.length || 0,
      followers: db.follows.filter(f => f.followeeId === uid).length,
      following: db.follows.filter(f => f.followerId === uid).length,
      isFollowing: db.follows.some(f => f.followerId === me.id && f.followeeId === uid),
      items,
    });
  },

  // My own header-card numbers for the Social right rail — workouts is mine regardless of
  // public/private (it's a fact about me, not something I'm broadcasting), followers/following
  // count the raw graph, not filtered to who's currently public (unlike the feed itself).
  'GET /api/social/me': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const S = readState(me.id);
    json(res, 200, {
      workouts: S?.workouts?.length || 0,
      followers: db.follows.filter(f => f.followeeId === me.id).length,
      following: db.follows.filter(f => f.followerId === me.id).length,
    });
  },

  // A workout photo. Body is a data: URL (no multipart parser in this vanilla server, and
  // base64-in-JSON matches how every other route already reads its body) capped well under
  // MAX_BODY once base64's ~33% inflation is priced in.
  'POST /api/social/upload': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
    if (!m) return json(res, 400, { error: 'unsupported image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return json(res, 413, { error: 'image too large' });
    const ext = UPLOAD_MIME[m[1]];
    const file = crypto.randomBytes(10).toString('base64url') + '.' + ext;
    fs.mkdirSync(uploadsDir(me.id), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(me.id), file), buf);
    json(res, 200, { url: `/api/uploads?uid=${encodeURIComponent(me.id)}&file=${encodeURIComponent(file)}` });
  },

  // Own photo, or a currently-public account's — same visibility rule the rest of Social
  // uses, so a photo can't be scraped once its owner has gone private.
  'GET /api/uploads': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const uid = q.get('uid') || '', file = q.get('file') || '';
    if (uid !== me.id && !isPublic(uid)) return json(res, 404, { error: 'not found' });
    if (!/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(file)) return json(res, 404, { error: 'not found' });
    const ext = file.slice(file.lastIndexOf('.') + 1);
    const mime = Object.entries(UPLOAD_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
    fs.readFile(path.join(uploadsDir(uid), file), (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
      res.end(buf);
    });
  },

  'POST /api/social/react': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const targetUid = String(body.targetUid || ''), workoutId = String(body.workoutId || '');
    if (!isPublic(targetUid)) return json(res, 404, { error: 'not visible' });
    const i = db.reactions.findIndex(r => r.userId === me.id && r.targetUid === targetUid && r.workoutId === workoutId);
    let liked;
    if (i >= 0) { db.reactions.splice(i, 1); liked = false; }
    else { db.reactions.push({ userId: me.id, targetUid, workoutId, created: new Date().toISOString() }); liked = true; }
    saveDb();
    audit(req, 'social.react', { user: me, msg: (liked ? 'like' : 'unlike') + ':' + workoutId });
    json(res, 200, { liked });
  },

  'GET /api/social/comments': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const targetUid = q.get('targetUid') || '', workoutId = q.get('workoutId') || '';
    const rows = db.comments.filter(c => c.targetUid === targetUid && c.workoutId === workoutId).map(publicComment);
    json(res, 200, { comments: rows });
  },

  'POST /api/social/comment': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const targetUid = String(body.targetUid || ''), workoutId = String(body.workoutId || '');
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) return json(res, 400, { error: 'comment required' });
    if (!isPublic(targetUid)) return json(res, 404, { error: 'not visible' });
    const c = { id: crypto.randomBytes(8).toString('base64url'), userId: me.id, targetUid, workoutId, text, created: new Date().toISOString() };
    db.comments.push(c);
    saveDb();
    audit(req, 'social.comment.add', { user: me, msg: workoutId });
    json(res, 200, { comment: publicComment(c) });
  },

  // Deletable by whoever wrote it, whoever's workout it's on, or an instance admin — a union,
  // not a single owner, so someone can moderate their own activity even if they didn't write it.
  'POST /api/social/comment/remove': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = db.comments.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'no such comment' });
    const allowed = c.userId === me.id || c.targetUid === me.id || isAdmin(me);
    if (!allowed) return json(res, 403, { error: 'not yours to remove' });
    db.comments = db.comments.filter(x => x.id !== c.id);
    saveDb();
    audit(req, 'social.comment.remove', { user: me, msg: c.id });
    json(res, 200, { ok: true });
  },

  /* ---------- coach + box (WODbuster-style: a coach's roster of athletes) ---------- */
  // A coach no longer creates a box directly — they request one (title, description, an
  // optional cover image) and an admin reviews it, same shape as becoming a coach in the
  // first place. A coach can hold several boxes, so this never dedupes against an existing
  // request the way coach/apply does — each submission is its own row.
  'POST /api/coach/box-request': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 60);
    const description = String(body.description || '').trim().slice(0, 500);
    if (!title) return json(res, 400, { error: 'title required' });
    // A box is a physical place athletes show up to — unlike a coach's own marketplace
    // location (optional, only matters if they opt into being found), this is required so
    // there's ever an answer to "where is this box". In `off` mode (BOX_LOCATION_MODE) it's
    // just whatever text the coach typed, no geocoding involved — no lat/lon to validate or
    // to later show a distance/map with, but still a real answer to "where is it".
    let location;
    if (BOX_LOCATION_MODE === 'off') {
      const label = String((body.location && body.location.label) || body.location || '').trim().slice(0, 200);
      location = label ? { label, lat: null, lon: null } : null;
    } else {
      try { location = parseLocation(body.location); } catch { return json(res, 400, { error: 'invalid location' }); }
    }
    if (!location) return json(res, 400, { error: 'location required' });
    const row = { id: crypto.randomBytes(8).toString('base64url'), coachId: coach.id, title, description, location, status: 'pending', created: new Date().toISOString() };
    const raw = String(body.imageDataUrl || '');
    const m = raw ? /^data:(image\/jpeg|image\/png|image\/webp);base64,([a-zA-Z0-9+/=]+)$/.exec(raw) : null;
    if (raw && !m) return json(res, 400, { error: 'unsupported image format — JPEG, PNG or WebP only' });
    if (m) {
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_IMAGE_BYTES) return json(res, 413, { error: 'image too large' });
      const file = 'boxreq-' + crypto.randomBytes(10).toString('base64url') + '.' + UPLOAD_MIME[m[1]];
      fs.mkdirSync(uploadsDir(coach.id), { recursive: true });
      fs.writeFileSync(path.join(uploadsDir(coach.id), file), buf);
      row.imageFile = file;
    }
    db.boxRequests.push(row);
    saveDb();
    audit(req, 'coach.box.request', { user: coach, msg: title });
    json(res, 200, { request: row });
  },

  // The coach's own view of what they've asked for — pending/approved/dismissed, so "how many
  // boxes do I already have, and what's still waiting on review" is answerable from one call.
  'GET /api/coach/box-requests': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const requests = db.boxRequests.filter(r => r.coachId === coach.id).sort((a, b) => new Date(b.created) - new Date(a.created));
    json(res, 200, { requests });
  },

  'GET /api/coach/boxes': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const boxes = db.boxes.filter(b => b.coachId === coach.id).map(b => ({
      ...b, members: db.boxMemberships.filter(m => m.boxId === b.id).length,
    }));
    json(res, 200, { boxes });
  },

  'GET /api/coach/box': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const box = db.boxes.find(b => b.id === (q.get('boxId') || ''));
    if (!box || !canManageBox(me.id, box.id)) return json(res, 404, { error: 'not found' });
    json(res, 200, { box, isOwner: box.coachId === me.id });
  },

  // Editing an existing box's own fields — owner-only (staff help run it day-to-day, but
  // renaming/relocating/rebranding the box itself is a box-admin action, same split as
  // member-removal and invite management). Same validation as filing the original box request:
  // title/description trimmed, location required and shaped per BOX_LOCATION_MODE, image
  // optional (data URL, JPEG/PNG/WebP, size-capped) and only touched if one is actually sent —
  // omitting imageDataUrl keeps the current cover, sending `removeImage: true` clears it.
  'POST /api/coach/box/update': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    const box = db.boxes.find(b => b.id === boxId);
    if (!box || box.coachId !== coach.id) return json(res, 404, { error: 'not found' });
    const title = String(body.title || '').trim().slice(0, 60);
    const description = String(body.description || '').trim().slice(0, 500);
    if (!title) return json(res, 400, { error: 'title required' });
    let location;
    if (BOX_LOCATION_MODE === 'off') {
      const label = String((body.location && body.location.label) || body.location || '').trim().slice(0, 200);
      location = label ? { label, lat: null, lon: null } : null;
    } else {
      try { location = parseLocation(body.location); } catch { return json(res, 400, { error: 'invalid location' }); }
    }
    if (!location) return json(res, 400, { error: 'location required' });
    box.title = title;
    box.description = description;
    box.location = location;
    box.hours = String(body.hours || '').trim().slice(0, 120);
    box.phone = String(body.phone || '').trim().slice(0, 30);
    box.link = String(body.link || '').trim().slice(0, 200);
    // Free-form, coach-authored — not a fixed picklist, so no server-side allow-set to check
    // against, just the same shape/length caps every other short-text list in this file uses.
    box.amenities = Array.isArray(body.amenities) ? body.amenities.map(a => String(a || '').trim().slice(0, 30)).filter(Boolean).slice(0, 20) : [];
    // One color per *viewer's* theme (dark/light/prestige, or whatever themes exist later) —
    // not one fixed color — so a coach can pick something that reads well against both a light
    // and a dark background instead of one hex silently vanishing depending who's looking. Keyed
    // by theme value, any subset (missing keys just fall back client-side); not restricted to
    // the swatch palette, since the picker's "custom" swatch opens a native color input.
    if (body.colors && typeof body.colors === 'object') {
      const colors = {};
      for (const [k, v] of Object.entries(body.colors)) {
        const key = String(k || '').slice(0, 20);
        if (key && HEX_COLOR_RE.test(v || '')) colors[key] = v;
      }
      box.colors = colors;
    }
    // Undefined/missing reads as enabled client-side (existing boxes that set colors before this
    // toggle existed keep working) — this only ever stores an explicit true/false once a coach
    // actually touches the switch, letting them keep their chosen colors saved (never wiped)
    // while suppressing them everywhere without re-picking anything.
    if (body.colorsEnabled !== undefined) box.colorsEnabled = !!body.colorsEnabled;
    if (body.removeImage) {
      box.imageFile = null;
    } else {
      const raw = String(body.imageDataUrl || '');
      const m = raw ? /^data:(image\/jpeg|image\/png|image\/webp);base64,([a-zA-Z0-9+/=]+)$/.exec(raw) : null;
      if (raw && !m) return json(res, 400, { error: 'unsupported image format — JPEG, PNG or WebP only' });
      if (m) {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_IMAGE_BYTES) return json(res, 413, { error: 'image too large' });
        const file = 'box-' + crypto.randomBytes(10).toString('base64url') + '.' + UPLOAD_MIME[m[1]];
        fs.mkdirSync(uploadsDir(coach.id), { recursive: true });
        fs.writeFileSync(path.join(uploadsDir(coach.id), file), buf);
        box.imageFile = file;
      }
    }
    saveDb();
    audit(req, 'coach.box.update', { user: coach, msg: title });
    json(res, 200, { box });
  },

  // A box's cover image, visible to its own coach and current members (not the public —
  // there's no "browse boxes" surface yet, only the personal-training marketplace above).
  'GET /api/box/image': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const box = db.boxes.find(b => b.id === (q.get('boxId') || ''));
    if (!box || !box.imageFile) return json(res, 404, { error: 'not found' });
    if (!canManageBox(me.id, box.id) && !isMemberOfBox(me.id, box.id)) return json(res, 404, { error: 'not found' });
    const ext = box.imageFile.slice(box.imageFile.lastIndexOf('.') + 1);
    const mime = Object.entries(UPLOAD_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
    fs.readFile(path.join(uploadsDir(box.coachId), box.imageFile), (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
      res.end(buf);
    });
  },

  // Athlete roster — stats reused wholesale from the existing social/leaderboard machinery
  // (statsFor, currentStreakDays) rather than a third independent implementation.
  'GET /api/coach/box/roster': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const roster = db.boxMemberships.filter(m => m.boxId === boxId).map(m => {
      const u = db.users.find(x => x.id === m.userId);
      if (!u) return null;
      const info = athletePlanInfo(boxId, m.userId);
      return { ...socialUser(u), joined: m.joined, planId: m.planId || null, planExpired: !!info?.expired, planInGrace: !!info?.inGrace, streakDays: currentStreakDays(u.id), ...statsFor(u.id) };
    }).filter(Boolean);
    json(res, 200, { roster });
  },

  // Adding a member directly by @username — same UserSearch picker as "add staff", for a coach
  // who already knows the person's handle rather than sharing the invite link. Owner-only, same
  // posture as the invite link itself (isStaffOfBox's own comment: inviting/removing members
  // stays owner-only even though staff can manage the day-to-day roster).
  'POST /api/coach/box/member/add': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    const target = db.users.find(u => u.id === body.userId);
    if (!target || target.disabled) return json(res, 404, { error: 'user not found' });
    if (isMemberOfBox(target.id, boxId)) return json(res, 400, { error: 'already a member' });
    db.boxMemberships.push({ id: crypto.randomBytes(8).toString('base64url'), boxId, userId: target.id, joined: new Date().toISOString() });
    saveDb();
    audit(req, 'coach.box.member.add', { user: coach, msg: target.id });
    json(res, 200, { ok: true });
  },

  // Search real accounts by @username, for the "add staff" picker — never by email/display
  // name (impersonation-prone, and email is private). Staff need not be approved marketplace
  // coaches themselves (day-to-day box help shouldn't require clearing that bar), so this is
  // open to any signed-in user's search, not gated behind requireCoach.
  'GET /api/users/search': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const raw = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().replace(/^@/, '').toLowerCase();
    if (raw.length < 2) return json(res, 200, { users: [] });
    const users = db.users
      .filter(u => !u.disabled && u.username && u.username.toLowerCase().includes(raw))
      .slice(0, 8)
      .map(socialUser);
    json(res, 200, { users });
  },

  'GET /api/coach/box/staff': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const staff = db.boxStaff.filter(s => s.boxId === boxId).map(s => {
      const u = db.users.find(x => x.id === s.userId);
      return u ? { ...socialUser(u), added: s.added } : null;
    }).filter(Boolean);
    json(res, 200, { staff });
  },

  // Owner-only — adding/removing staff is itself a box-admin action, not a staff privilege.
  'POST /api/coach/box/staff/add': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    const target = db.users.find(u => u.id === body.userId);
    if (!target || target.disabled) return json(res, 404, { error: 'user not found' });
    const box = db.boxes.find(b => b.id === boxId);
    if (box.coachId === target.id) return json(res, 400, { error: 'already the box coach' });
    if (db.boxStaff.some(s => s.boxId === boxId && s.userId === target.id)) return json(res, 400, { error: 'already staff' });
    db.boxStaff.push({ id: crypto.randomBytes(8).toString('base64url'), boxId, userId: target.id, added: new Date().toISOString(), addedBy: coach.id });
    saveDb();
    audit(req, 'coach.box.staff.add', { user: coach, msg: target.id });
    json(res, 200, { ok: true });
  },

  'POST /api/coach/box/staff/remove': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.boxStaff.length;
    db.boxStaff = db.boxStaff.filter(s => !(s.boxId === boxId && s.userId === body.userId));
    if (db.boxStaff.length === before) return json(res, 404, { error: 'not staff' });
    saveDb();
    audit(req, 'coach.box.staff.remove', { user: coach, msg: body.userId });
    json(res, 200, { ok: true });
  },

  'POST /api/coach/box/member/remove': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.boxMemberships.length;
    db.boxMemberships = db.boxMemberships.filter(m => !(m.boxId === boxId && m.userId === body.athleteId));
    if (db.boxMemberships.length === before) return json(res, 404, { error: 'not a member' });
    saveDb();
    audit(req, 'coach.box.member.remove', { user: coach, msg: body.athleteId });
    json(res, 200, { ok: true });
  },

  // A box invite is a standing join link for a whole roster, not a single-use account invite —
  // usedBy/usedAt are just "who most recently redeemed it" telemetry; only revoked blocks
  // redemption (POST /api/box/join below never sets usedBy to gate reuse).
  'POST /api/coach/box/invite': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    let code;
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.boxInvites.some(i => i.code === code));
    const invite = { code, boxId, createdBy: coach.id, created: new Date().toISOString() };
    db.boxInvites.push(invite);
    saveDb();
    audit(req, 'coach.invite.create', { user: coach, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/coach/box/invite/revoke': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isCoachOfBox(coach.id, boxId)) return json(res, 404, { error: 'not found' });
    const inv = db.boxInvites.find(i => i.code === String(body.code || '').toUpperCase() && i.boxId === boxId);
    if (!inv) return json(res, 404, { error: 'no such code' });
    inv.revoked = true;
    saveDb();
    audit(req, 'coach.invite.revoke', { user: coach, msg: inv.code });
    json(res, 200, { ok: true });
  },

  'POST /api/box/join': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const invite = db.boxInvites.find(i => i.code === code && !i.revoked);
    if (!invite) return json(res, 404, { error: 'invalid or revoked code' });
    const box = db.boxes.find(b => b.id === invite.boxId);
    if (!box) return json(res, 404, { error: 'box no longer exists' });
    if (!isMemberOfBox(me.id, box.id)) {
      db.boxMemberships.push({ id: crypto.randomBytes(8).toString('base64url'), boxId: box.id, userId: me.id, joined: new Date().toISOString() });
    }
    invite.usedBy = me.id;
    invite.usedAt = new Date().toISOString();
    saveDb();
    audit(req, 'coach.box.join', { user: me, msg: box.id });
    json(res, 200, { box });
  },

  // Cheap "am I in a box" check for the athlete-side UI — no store slice needed for this.
  'GET /api/athlete/boxes': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxes = db.boxMemberships.filter(m => m.userId === me.id).map(m => {
      const box = db.boxes.find(b => b.id === m.boxId);
      if (!box) return null;
      const coach = db.users.find(u => u.id === box.coachId);
      return { ...box, coachName: coach?.name || null, role: 'member', plan: athletePlanInfo(box.id, me.id) };
    }).filter(Boolean);
    // Boxes I help staff — a distinct role tag so the client can route these to the coach-side
    // box view (CoachBox.jsx) instead of the athlete WOD/leaderboard views.
    const staffBoxes = db.boxStaff.filter(s => s.userId === me.id).map(s => {
      const box = db.boxes.find(b => b.id === s.boxId);
      if (!box) return null;
      const coach = db.users.find(u => u.id === box.coachId);
      return { ...box, coachName: coach?.name || null, role: 'staff' };
    }).filter(Boolean);
    // Boxes I own — an owner isn't automatically a "member" (no boxMemberships row) but should
    // still see their own box's classes to book into, same as staff can.
    const ownedBoxes = db.boxes.filter(b => b.coachId === me.id).map(box => ({ ...box, coachName: me.name || null, role: 'owner' }));
    json(res, 200, { boxes: [...boxes, ...staffBoxes, ...ownedBoxes] });
  },

  // A coach's view of one athlete's actual training — deliberately richer than the social
  // feed's trimmed shape (feedItemsFor strips weight/reps even for consenting public profiles,
  // because that's a peer-to-peer surface). A coach giving real feedback needs the real numbers,
  // so this returns full entries (target/plan/each set's weight+reps+done) via its own
  // serializer, kept entirely separate so the social feed's privacy contract is untouched.
  'GET /api/coach/athlete/workouts': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const athleteId = q.get('athleteId') || '';
    if (!canViewAthlete(me.id, athleteId)) return json(res, 404, { error: 'not found' });
    const days = Math.min(Math.max(parseInt(q.get('days') || '90', 10) || 90, 1), 365);
    const cutoff = Date.now() - days * 86400000;
    const workouts = (readState(athleteId)?.workouts || [])
      .filter(w => (w.end || w.start || 0) >= cutoff)
      .sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))
      .map(w => ({
        id: w.id, d: w.d, start: w.start, end: w.end, name: w.name, vol: w.vol || 0, prs: w.prs || [],
        entries: (w.entries || []).map(e => ({ id: e.id, target: e.target || null, sets: e.sets || [], notes: e.notes || null })),
      }));
    json(res, 200, { workouts });
  },

  // A coach's view of an athlete's identity card — the same badges/rank/perks shown on their
  // public profile (GET /api/social/user), but authorized through the box relationship instead
  // of that route's public/isFollowing gate, since a coach needs this regardless of whether the
  // athlete has gone public. Box-scoped (unlike /coach/athlete/workouts above) because the plan
  // status riding along here only makes sense for one specific box.
  'GET /api/coach/athlete/profile': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const boxId = q.get('boxId') || '';
    const athleteId = q.get('athleteId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const membership = db.boxMemberships.find(m => m.boxId === boxId && m.userId === athleteId);
    const u = db.users.find(x => x.id === athleteId);
    if (!membership || !u) return json(res, 404, { error: 'not found' });
    const plan = membership.planId ? db.boxPlans.find(p => p.id === membership.planId) : null;
    const info = athletePlanInfo(boxId, athleteId);
    json(res, 200, {
      user: socialUser(u),
      ...rankFor(athleteId),
      perks: perksFor(athleteId),
      streakDays: currentStreakDays(athleteId),
      ...statsFor(athleteId),
      joined: membership.joined,
      plan: plan ? {
        id: plan.id, name: plan.name, monthlyLimit: plan.monthlyLimit,
        usedThisMonth: info?.usedThisMonth ?? 0, remaining: info?.remaining ?? null,
        classTypes: plan.classTypes?.length ? plan.classTypes : null,
        expired: !!info?.expired, inGrace: !!info?.inGrace, graceDaysLeft: info?.graceDaysLeft ?? null,
      } : null,
    });
  },

  /* ---------- routine assignment ---------- */
  // The coach picks/edits a routine client-side ({id,name,emoji,ex:[...]}, same shape
  // RoutineEdit.jsx already produces) and hands it here; the server stamps a fresh id so every
  // athlete who applies it ends up with an independently-editable copy, never a shared id.
  // athleteId: null means "whole box," resolved against CURRENT membership at read time below —
  // never fanned out / snapshotted at assign time.
  'POST /api/coach/box/assign-routine': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const routine = body.routine;
    if (!routine || typeof routine !== 'object' || !routine.name) return json(res, 400, { error: 'routine required' });
    const athleteId = body.athleteId ? String(body.athleteId) : null;
    if (athleteId && !isMemberOfBox(athleteId, boxId)) return json(res, 404, { error: 'not a member of this box' });
    const assignment = {
      id: crypto.randomBytes(8).toString('base64url'),
      boxId, coachId: me.id, athleteId,
      routine: { ...routine, id: crypto.randomBytes(8).toString('base64url') },
      created: new Date().toISOString(), appliedBy: {},
    };
    db.routineAssignments.push(assignment);
    saveDb();
    audit(req, 'coach.routine.assign', { user: me, msg: (athleteId || 'whole box') + ':' + routine.name });
    json(res, 200, { assignment });
  },

  // Assignments that currently apply to me (direct, or whole-box while I'm still a member)
  // and that I haven't applied yet.
  'GET /api/athlete/routine-assignments': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const myBoxIds = new Set(db.boxMemberships.filter(m => m.userId === me.id).map(m => m.boxId));
    const assignments = db.routineAssignments
      .filter(a => (a.athleteId === me.id || (a.athleteId === null && myBoxIds.has(a.boxId))) && !a.appliedBy?.[me.id])
      .map(a => {
        const coach = db.users.find(u => u.id === a.coachId);
        const box = db.boxes.find(b => b.id === a.boxId);
        return { id: a.id, routine: a.routine, created: a.created, coachName: coach?.name || null, boxName: box?.name || null };
      });
    json(res, 200, { assignments });
  },

  // Marks the assignment "seen/applied" server-side so it stops showing as pending — the
  // actual copy into the athlete's own S.routines happens client-side via the normal
  // PUT /api/data sync path, not here (per-user training state is that endpoint's concern).
  'POST /api/athlete/routine-assignments/apply': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const a = db.routineAssignments.find(x => x.id === body.id);
    if (!a) return json(res, 404, { error: 'no such assignment' });
    a.appliedBy = a.appliedBy || {};
    a.appliedBy[me.id] = new Date().toISOString();
    saveDb();
    audit(req, 'coach.routine.applied', { user: me, msg: a.routine?.name || a.id });
    json(res, 200, { ok: true });
  },

  /* ---------- WOD of the day + box leaderboard (WODbuster-style) ---------- */
  // One WOD per box per day — re-submitting the same date edits it in place rather than
  // erroring, same low-friction "edit by re-submitting" idiom as alpha/apply's dedup.
  'POST /api/coach/box/wod': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const date = String(body.date || '').trim();
    const name = String(body.name || '').trim().slice(0, 80);
    const scoringType = ['time', 'reps', 'weight', 'rounds'].includes(body.scoringType) ? body.scoringType : 'reps';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'date required (YYYY-MM-DD)' });
    if (!name) return json(res, 400, { error: 'name required' });
    const description = String(body.description || '').trim().slice(0, 1000);
    let wod = db.wods.find(w => w.boxId === boxId && w.date === date);
    if (wod) { wod.name = name; wod.description = description; wod.scoringType = scoringType; }
    else { wod = { id: crypto.randomBytes(8).toString('base64url'), boxId, date, name, description, scoringType, created: new Date().toISOString(), createdBy: me.id }; db.wods.push(wod); }
    saveDb();
    audit(req, 'coach.wod.create', { user: me, msg: date + ':' + name });
    json(res, 200, { wod });
  },

  'GET /api/box/wod': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const boxId = q.get('boxId') || '';
    const box = db.boxes.find(b => b.id === boxId);
    if (!box || !(canManageBox(me.id, boxId) || isMemberOfBox(me.id, boxId))) return json(res, 404, { error: 'not found' });
    const date = q.get('date') || isoOf(new Date());
    const wod = db.wods.find(w => w.boxId === boxId && w.date === date) || null;
    const myResult = wod ? db.wodResults.find(r => r.wodId === wod.id && r.athleteId === me.id) || null : null;
    json(res, 200, { wod, myResult });
  },

  'POST /api/box/wod/result': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!isMemberOfBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const wod = db.wods.find(w => w.id === body.wodId && w.boxId === boxId);
    if (!wod) return json(res, 404, { error: 'no such wod' });
    const value = Number(body.value);
    if (!isFinite(value) || value < 0) return json(res, 400, { error: 'a valid result value is required' });
    let row = db.wodResults.find(r => r.wodId === wod.id && r.athleteId === me.id);
    if (row) row.value = value;
    else { row = { id: crypto.randomBytes(8).toString('base64url'), wodId: wod.id, athleteId: me.id, value, loggedAt: new Date().toISOString() }; db.wodResults.push(row); }
    row.loggedAt = new Date().toISOString();
    saveDb();
    audit(req, 'coach.wod.result', { user: me, msg: wod.id + ':' + value });
    json(res, 200, { result: row });
  },

  // Visible to the coach AND any current member — WODbuster leaderboards are whole-box, not
  // coach-only. Roster is CURRENT boxMemberships (not a follow graph), same structural shape
  // as the (otherwise dead) GET /api/social/leaderboard: roster → per-user stat → sort → flat
  // unpaginated array.
  'GET /api/coach/box/leaderboard': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const boxId = q.get('boxId') || '';
    const box = db.boxes.find(b => b.id === boxId);
    if (!box || !(canManageBox(me.id, boxId) || isMemberOfBox(me.id, boxId))) return json(res, 404, { error: 'not found' });
    const date = q.get('date') || isoOf(new Date());
    const wod = db.wods.find(w => w.boxId === boxId && w.date === date) || null;
    const memberIds = db.boxMemberships.filter(m => m.boxId === boxId).map(m => m.userId);
    const ascending = wod?.scoringType === 'time';
    const rows = memberIds.map(uid => {
      const u = db.users.find(x => x.id === uid);
      if (!u) return null;
      const result = wod ? db.wodResults.find(r => r.wodId === wod.id && r.athleteId === uid) : null;
      return { ...socialUser(u), value: result ? result.value : null };
    }).filter(Boolean).sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return ascending ? a.value - b.value : b.value - a.value;
    });
    json(res, 200, { wod, leaderboard: rows });
  },

  /* ---------- classes & schedule (WODbuster-style) ---------- */
  // A class type is a fully custom, per-box preset (name, icon, color, room, duration,
  // capacity) with no schedule attached — "CrossFit, 60min, cap 12" in whatever icon/color the
  // coach picks, not a fixed discipline enum (a yoga studio and a CrossFit box want different
  // visual vocabularies). A coach picks one when adding a class straight to a real date (below)
  // — it's just a preset that prefills the fields, never referenced by id afterwards, so
  // deleting or editing a type never changes a class already created from it.
  'POST /api/coach/box/class-types': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    const durationMin = Math.max(5, Math.min(360, Math.round(Number(body.durationMin)) || 60));
    const capacity = Math.max(1, Math.min(500, Math.round(Number(body.capacity)) || 12));
    const icon = CLASS_ICONS.has(body.icon) ? body.icon : 'sparkles';
    const color = HEX_COLOR_RE.test(body.color || '') ? body.color : '#a3e635';
    const room = String(body.room || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const type = { id: crypto.randomBytes(8).toString('base64url'), boxId, name, icon, color, durationMin, capacity, room, created: new Date().toISOString() };
    db.classTypes.push(type);
    saveDb();
    audit(req, 'coach.class.type.create', { user: me, msg: name });
    json(res, 200, { type });
  },

  'GET /api/coach/box/class-types': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const types = db.classTypes.filter(t => t.boxId === boxId).sort((a, b) => a.created.localeCompare(b.created));
    json(res, 200, { types });
  },

  // Only affects future placements — a type carries no reference back from any template or
  // session already built from it (see the note above), so editing one is always safe.
  'POST /api/coach/box/class-types/update': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const type = db.classTypes.find(t => t.id === body.id && t.boxId === boxId);
    if (!type) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name required' });
    type.name = name;
    type.durationMin = Math.max(5, Math.min(360, Math.round(Number(body.durationMin)) || 60));
    type.capacity = Math.max(1, Math.min(500, Math.round(Number(body.capacity)) || 12));
    type.icon = CLASS_ICONS.has(body.icon) ? body.icon : type.icon;
    type.color = HEX_COLOR_RE.test(body.color || '') ? body.color : type.color;
    type.room = String(body.room || '').trim().slice(0, 40);
    saveDb();
    audit(req, 'coach.class.type.update', { user: me, msg: type.id });
    json(res, 200, { type });
  },

  'POST /api/coach/box/class-types/delete': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.classTypes.length;
    db.classTypes = db.classTypes.filter(t => !(t.id === body.id && t.boxId === boxId));
    if (db.classTypes.length === before) return json(res, 404, { error: 'not found' });
    saveDb();
    audit(req, 'coach.class.type.delete', { user: me, msg: body.id });
    json(res, 200, { ok: true });
  },

  // Membership plans: name/description/feature list/price are display-only — Forvia never
  // processes real payments (a self-hoster wires their own billing elsewhere), so `price` here
  // is just a number shown on the plan card, not anything that charges a card. `monthlyLimit`
  // is the one field with real teeth (see athletePlanInfo/the booking route below); null means
  // unlimited.
  'GET /api/coach/box/plans': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const plans = db.boxPlans.filter(p => p.boxId === boxId).sort((a, b) => a.created.localeCompare(b.created)).map(p => ({
      ...p, assignedCount: db.boxMemberships.filter(m => m.boxId === boxId && m.planId === p.id).length,
    }));
    json(res, 200, { plans });
  },

  'POST /api/coach/box/plans': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name required' });
    const description = String(body.description || '').trim().slice(0, 300);
    const features = Array.isArray(body.features) ? body.features.map(f => String(f || '').trim().slice(0, 140)).filter(Boolean).slice(0, 12) : [];
    const price = Math.max(0, Number(body.price) || 0);
    const monthlyLimit = body.monthlyLimit == null ? null : Math.max(0, Math.round(Number(body.monthlyLimit)) || 0);
    // Which class types this plan covers, by name (classSessions never keep a reference back to
    // the classTypes row they were created from — see class-types' own delete comment — so name
    // is the only stable thing to match against). Empty/omitted = every type, unrestricted.
    const classTypes = Array.isArray(body.classTypes) ? body.classTypes.map(c => String(c || '').trim()).filter(Boolean).slice(0, 30) : [];
    const plan = { id: crypto.randomBytes(8).toString('base64url'), boxId, name, description, features, price, monthlyLimit, classTypes, created: new Date().toISOString() };
    db.boxPlans.push(plan);
    saveDb();
    audit(req, 'coach.box.plan.create', { user: me, msg: name });
    json(res, 200, { plan });
  },

  'POST /api/coach/box/plans/update': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const plan = db.boxPlans.find(p => p.id === body.id && p.boxId === boxId);
    if (!plan) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name required' });
    plan.name = name;
    plan.description = String(body.description || '').trim().slice(0, 300);
    plan.features = Array.isArray(body.features) ? body.features.map(f => String(f || '').trim().slice(0, 140)).filter(Boolean).slice(0, 12) : [];
    plan.price = Math.max(0, Number(body.price) || 0);
    plan.monthlyLimit = body.monthlyLimit == null ? null : Math.max(0, Math.round(Number(body.monthlyLimit)) || 0);
    plan.classTypes = Array.isArray(body.classTypes) ? body.classTypes.map(c => String(c || '').trim()).filter(Boolean).slice(0, 30) : [];
    saveDb();
    audit(req, 'coach.box.plan.update', { user: me, msg: plan.id });
    json(res, 200, { plan });
  },

  // Deleting a plan someone's still assigned to is allowed — same no-back-reference-guard
  // posture as class-types deletion above — it just falls back to "no plan" (unlimited, see
  // athletePlanInfo) for anyone who was on it, rather than leaving a dangling planId around.
  'POST /api/coach/box/plans/delete': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.boxPlans.length;
    db.boxPlans = db.boxPlans.filter(p => !(p.id === body.id && p.boxId === boxId));
    if (db.boxPlans.length === before) return json(res, 404, { error: 'not found' });
    db.boxMemberships.forEach(m => { if (m.boxId === boxId && m.planId === body.id) m.planId = null; });
    saveDb();
    audit(req, 'coach.box.plan.delete', { user: me, msg: body.id });
    json(res, 200, { ok: true });
  },

  // Assigning is just setting a field on the existing membership row — planId nullable so this
  // doubles as "unassign" (body.planId omitted/null).
  'POST /api/coach/box/member/plan': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const membership = db.boxMemberships.find(m => m.boxId === boxId && m.userId === body.athleteId);
    if (!membership) return json(res, 404, { error: 'not a member' });
    let planId = null;
    if (body.planId) {
      const plan = db.boxPlans.find(p => p.id === body.planId && p.boxId === boxId);
      if (!plan) return json(res, 400, { error: 'no such plan' });
      planId = plan.id;
    }
    membership.planId = planId;
    // Re-picking the same plan is how a coach renews it after collecting the next payment in
    // person — always restart the 30-day cycle here, even if planId didn't actually change.
    membership.planAssignedAt = planId ? new Date().toISOString() : null;
    saveDb();
    audit(req, 'coach.box.member.plan', { user: me, msg: body.athleteId + ':' + (planId || 'none') });
    json(res, 200, { ok: true });
  },

  // A class is added straight to a real calendar date — never an implicit "every week
  // forever" recurrence. If a coach wants a day or a week to repeat, they save it as a
  // template (below) and apply it to another date/week on purpose; nothing repeats on its
  // own. Same canManageBox gate as everything else a box's day-to-day running needs.
  'POST /api/coach/box/classes/create': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const date = String(body.date || '');
    const startTime = String(body.startTime || '');
    const name = String(body.name || '').trim().slice(0, 60);
    const durationMin = Math.max(5, Math.min(360, Math.round(Number(body.durationMin)) || 60));
    const capacity = Math.max(1, Math.min(500, Math.round(Number(body.capacity)) || 12));
    const icon = CLASS_ICONS.has(body.icon) ? body.icon : 'sparkles';
    const color = HEX_COLOR_RE.test(body.color || '') ? body.color : '#a3e635';
    const room = String(body.room || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'invalid date' });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return json(res, 400, { error: 'invalid start time (HH:MM)' });
    const session = {
      id: crypto.randomBytes(8).toString('base64url'), boxId, date, startTime, name, durationMin, capacity, icon, color, room,
      wod: { lines: [] }, coachId: db.boxes.find(b => b.id === boxId)?.coachId || null, created: new Date().toISOString(),
    };
    db.classSessions.push(session);
    saveDb();
    audit(req, 'coach.class.create', { user: me, msg: date + ' ' + startTime });
    json(res, 200, { session });
  },

  // Removing a class also drops its bookings — the class stops existing, there is nothing
  // left to hold a spot in.
  'POST /api/coach/box/classes/remove': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.classSessions.length;
    db.classSessions = db.classSessions.filter(s => !(s.id === body.id && s.boxId === boxId));
    if (db.classSessions.length === before) return json(res, 404, { error: 'not found' });
    db.classBookings = db.classBookings.filter(b => b.sessionId !== body.id);
    saveDb();
    audit(req, 'coach.class.remove', { user: me, msg: body.id });
    json(res, 200, { ok: true });
  },

  // The WOD for one specific occurrence ("today's CrossFit WOD") — deliberately NOT part of
  // a class type or a day/week template, since the schedule slot can repeat while the actual
  // workout content is different every time. Free text, exactly like a real whiteboard (a
  // WOD's notation — EMOM minutes with several movements packed into one, a rep ladder
  // shared across two exercises, a percentage of a benchmark lift — varies far too much to
  // force into a structured sets/reps shape), plus a small set of manual links from a line
  // number to a real exercise (see frontend lib/wod.js) so a viewer can still tap through to
  // a movement's gif without the coach having to fill out a form for each one. The exercise
  // catalog itself lives only in the frontend (see exercises-data.js), so the backend just
  // stores whatever the trusted coach client sends, capped and sanitized.
  'POST /api/coach/box/classes/wod': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const session = db.classSessions.find(s => s.id === body.sessionId && s.boxId === boxId);
    if (!session) return json(res, 404, { error: 'not found' });
    const wod = sanitizeWod(body.wod);
    session.wod = wod;
    saveDb();
    audit(req, 'coach.class.wod', { user: me, msg: session.id + ':' + wodExerciseCount(wod) });
    json(res, 200, { wod });
  },

  // A day template is a named snapshot of everything scheduled on one real date — "save this
  // Monday" so it can be reapplied to any other date later without re-adding every hour by
  // hand. A week template is the same idea for 7 consecutive dates at once (e.g. switching to
  // a "summer" week). Both denormalize each slot's fields and never carry exercises (those
  // stay per-occurrence, see above) — applying a template always REPLACES whatever the target
  // date(s) already had, a deliberate "load this" action, not a merge.
  'POST /api/coach/box/day-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    const date = String(body.date || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'invalid date' });
    const slots = db.classSessions.filter(s => s.boxId === boxId && s.date === date)
      .map(s => ({ startTime: s.startTime, name: s.name, icon: s.icon, color: s.color, room: s.room, durationMin: s.durationMin, capacity: s.capacity }));
    if (!slots.length) return json(res, 400, { error: 'nothing to save on this day' });
    const dt = { id: crypto.randomBytes(8).toString('base64url'), boxId, name, slots, created: new Date().toISOString() };
    db.dayTemplates.push(dt);
    saveDb();
    audit(req, 'coach.class.daytemplate.create', { user: me, msg: name });
    json(res, 200, { template: dt });
  },

  'GET /api/coach/box/day-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const templates = db.dayTemplates.filter(t => t.boxId === boxId).sort((a, b) => a.created.localeCompare(b.created));
    json(res, 200, { templates });
  },

  'POST /api/coach/box/day-templates/apply': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const dt = db.dayTemplates.find(t => t.id === body.id && t.boxId === boxId);
    if (!dt) return json(res, 404, { error: 'not found' });
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'invalid date' });
    const removedIds = db.classSessions.filter(s => s.boxId === boxId && s.date === date).map(s => s.id);
    db.classSessions = db.classSessions.filter(s => !(s.boxId === boxId && s.date === date));
    db.classBookings = db.classBookings.filter(b => !removedIds.includes(b.sessionId));
    const coachId = db.boxes.find(b => b.id === boxId)?.coachId || null;
    for (const s of dt.slots) {
      db.classSessions.push({ id: crypto.randomBytes(8).toString('base64url'), boxId, date, startTime: s.startTime, name: s.name, icon: s.icon, color: s.color, room: s.room, durationMin: s.durationMin, capacity: s.capacity, wod: { lines: [] }, coachId, created: new Date().toISOString() });
    }
    saveDb();
    audit(req, 'coach.class.daytemplate.apply', { user: me, msg: dt.id + ':' + date });
    json(res, 200, { count: dt.slots.length });
  },

  'POST /api/coach/box/day-templates/delete': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.dayTemplates.length;
    db.dayTemplates = db.dayTemplates.filter(t => !(t.id === body.id && t.boxId === boxId));
    if (db.dayTemplates.length === before) return json(res, 404, { error: 'not found' });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/coach/box/week-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    const weekStart = String(body.weekStart || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json(res, 400, { error: 'invalid week start' });
    const days = [];
    let any = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + 'T00:00:00'); d.setDate(d.getDate() + i);
      const date = isoOf(d);
      const slots = db.classSessions.filter(s => s.boxId === boxId && s.date === date)
        .map(s => ({ startTime: s.startTime, name: s.name, icon: s.icon, color: s.color, room: s.room, durationMin: s.durationMin, capacity: s.capacity }));
      if (slots.length) any = true;
      days.push(slots);
    }
    if (!any) return json(res, 400, { error: 'nothing to save this week' });
    const wt = { id: crypto.randomBytes(8).toString('base64url'), boxId, name, days, created: new Date().toISOString() };
    db.weekTemplates.push(wt);
    saveDb();
    audit(req, 'coach.class.weektemplate.create', { user: me, msg: name });
    json(res, 200, { template: wt });
  },

  'GET /api/coach/box/week-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const templates = db.weekTemplates.filter(t => t.boxId === boxId).sort((a, b) => a.created.localeCompare(b.created));
    json(res, 200, { templates });
  },

  // Replaces the target 7 dates (weekStart..weekStart+6) with the saved snapshot — switching
  // to a different named week wholesale, not merging on top of whatever's there.
  'POST /api/coach/box/week-templates/apply': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const wt = db.weekTemplates.find(t => t.id === body.id && t.boxId === boxId);
    if (!wt) return json(res, 404, { error: 'not found' });
    const weekStart = String(body.weekStart || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json(res, 400, { error: 'invalid week start' });
    const coachId = db.boxes.find(b => b.id === boxId)?.coachId || null;
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + 'T00:00:00'); d.setDate(d.getDate() + i);
      const date = isoOf(d);
      const removedIds = db.classSessions.filter(s => s.boxId === boxId && s.date === date).map(s => s.id);
      db.classSessions = db.classSessions.filter(s => !(s.boxId === boxId && s.date === date));
      db.classBookings = db.classBookings.filter(b => !removedIds.includes(b.sessionId));
      for (const s of (wt.days[i] || [])) {
        db.classSessions.push({ id: crypto.randomBytes(8).toString('base64url'), boxId, date, startTime: s.startTime, name: s.name, icon: s.icon, color: s.color, room: s.room, durationMin: s.durationMin, capacity: s.capacity, wod: { lines: [] }, coachId, created: new Date().toISOString() });
        count++;
      }
    }
    saveDb();
    audit(req, 'coach.class.weektemplate.apply', { user: me, msg: wt.id + ':' + count });
    json(res, 200, { count });
  },

  'POST /api/coach/box/week-templates/delete': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.weekTemplates.length;
    db.weekTemplates = db.weekTemplates.filter(t => !(t.id === body.id && t.boxId === boxId));
    if (db.weekTemplates.length === before) return json(res, 404, { error: 'not found' });
    saveDb();
    json(res, 200, { ok: true });
  },

  // A WOD template is a reusable named WOD (a benchmark like "Fran", or just one the coach
  // expects to reuse), independent of any date — separate from day/week templates, which
  // only ever carry the schedule shape (time/type/room), never the workout content.
  'POST /api/coach/box/wod-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name required' });
    const wod = sanitizeWod(body.wod);
    if (wodIsEmpty(wod)) return json(res, 400, { error: 'nothing to save' });
    const template = { id: crypto.randomBytes(8).toString('base64url'), boxId, name, wod, created: new Date().toISOString() };
    db.wodTemplates.push(template);
    saveDb();
    audit(req, 'coach.wodtemplate.create', { user: me, msg: name });
    json(res, 200, { template });
  },

  'GET /api/coach/box/wod-templates': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const boxId = new URL(req.url, 'http://x').searchParams.get('boxId') || '';
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const templates = db.wodTemplates.filter(t => t.boxId === boxId).sort((a, b) => a.created.localeCompare(b.created));
    json(res, 200, { templates });
  },

  'POST /api/coach/box/wod-templates/apply': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const template = db.wodTemplates.find(t => t.id === body.id && t.boxId === boxId);
    if (!template) return json(res, 404, { error: 'not found' });
    const session = db.classSessions.find(s => s.id === body.sessionId && s.boxId === boxId);
    if (!session) return json(res, 404, { error: 'session not found' });
    session.wod = template.wod;
    saveDb();
    audit(req, 'coach.wodtemplate.apply', { user: me, msg: template.id + ':' + session.id });
    json(res, 200, { wod: session.wod });
  },

  'POST /api/coach/box/wod-templates/delete': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const boxId = String(body.boxId || '');
    if (!canManageBox(me.id, boxId)) return json(res, 404, { error: 'not found' });
    const before = db.wodTemplates.length;
    db.wodTemplates = db.wodTemplates.filter(t => !(t.id === body.id && t.boxId === boxId));
    if (db.wodTemplates.length === before) return json(res, 404, { error: 'not found' });
    saveDb();
    json(res, 200, { ok: true });
  },

  // Athlete-visible schedule — member, staff or owner. Each session carries the caller's own
  // booking status and a booked count so the UI can show "8/12" and grey out a full class
  // without a second round trip.
  'GET /api/box/classes': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const boxId = q.get('boxId') || '';
    if (!(canManageBox(me.id, boxId) || isMemberOfBox(me.id, boxId))) return json(res, 404, { error: 'not found' });
    const from = q.get('from') || isoOf(new Date());
    const to = q.get('to') || from;
    const sessions = db.classSessions
      .filter(s => s.boxId === boxId && s.date >= from && s.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map(s => {
        const bookings = db.classBookings.filter(b => b.sessionId === s.id);
        const bookedRows = bookings.filter(b => b.status === 'booked');
        const mine = bookings.find(b => b.athleteId === me.id && (b.status === 'booked' || b.status === 'waitlist' || b.status === 'offered'));
        // Booked athletes only (never waitlist) — this is what fills the "seat grid" in the UI,
        // same names any box member already sees on the leaderboard/roster, nothing new exposed.
        const attendees = bookedRows.map(b => {
          const u = db.users.find(x => x.id === b.athleteId);
          return u ? { id: u.id, name: u.name, avatarUrl: avatarUrlOf(u) } : null;
        }).filter(Boolean);
        const live = db.liveClasses.find(l => l.sessionId === s.id) || null;
        return { ...s, booked: bookedRows.length, attendees, myStatus: mine ? mine.status : null, live };
      });
    // Box colors too — an athlete can't reach GET /api/coach/box (owner/staff only), so this is
    // the one athlete-accessible route BoxClasses.jsx has to hang its per-box accent theming off.
    // Gated by colorsEnabled here (not client-side) since an athlete never sees the raw toggle.
    const box = db.boxes.find(b => b.id === boxId);
    const boxColors = box && box.colorsEnabled !== false ? (box.colors || {}) : {};
    json(res, 200, { sessions, myPlan: athletePlanInfo(boxId, me.id), boxColors });
  },

  // Books into the class if there's room, otherwise onto the waitlist — never rejected outright
  // for a full class, matching WODbuster's "waitlist, not a dead end" behavior.
  'POST /api/box/classes/book': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const session = db.classSessions.find(s => s.id === body.sessionId);
    // A coach or staff member can book into a class at their own box too — not just members.
    if (!session || !(isMemberOfBox(me.id, session.boxId) || canManageBox(me.id, session.boxId))) return json(res, 404, { error: 'not found' });
    if (new Date(session.date + 'T' + session.startTime + ':00') <= new Date()) return json(res, 400, { error: 'this class has already started' });
    // A waitlisted or offered athlete has a row already — booking again claims that same row
    // (an 'offered' row has priority for 5 minutes; once that lapses — see waitlistOfferTick
    // below — anyone still 'waitlist' can claim the same way, first tap wins). Only an already
    // fully 'booked' row blocks a duplicate booking.
    const existing = db.classBookings.find(b => b.sessionId === session.id && b.athleteId === me.id && (b.status === 'booked' || b.status === 'waitlist' || b.status === 'offered'));
    if (existing && existing.status === 'booked') return json(res, 400, { error: 'already booked' });
    const info = athletePlanInfo(session.boxId, me.id);
    // An expired plan blocks everything — same reasoning as the type-restriction check right
    // below (waiting doesn't help either), checked first since it overrides both other checks.
    if (info?.expired) {
      return json(res, 400, { error: 'Your plan has expired — ask your coach to renew it' });
    }
    // A type restriction blocks even joining the waitlist — unlike the monthly limit below,
    // there's no scenario where waiting helps, the class is simply never covered by the plan.
    if (info?.classTypes && !info.classTypes.includes(session.name)) {
      return json(res, 400, { error: 'Your plan doesn’t include this class type' });
    }
    const bookedCount = db.classBookings.filter(b => b.sessionId === session.id && b.status === 'booked').length;
    // Only a real "booked" claim is gated by the plan's monthly limit — someone at their limit
    // can still join the waitlist for a full class (that hasn't consumed a slot yet either), in
    // case the limit or their usage changes before a spot actually opens up for them. remaining
    // is null for an unlimited plan (even one that's still type-restricted above) — checked
    // explicitly rather than `<= 0`, since `null <= 0` is true in JS and would wrongly block it.
    const wouldBook = bookedCount < session.capacity;
    if (wouldBook && info && info.remaining != null && info.remaining <= 0) {
      return json(res, 400, { error: 'You’ve reached your plan’s monthly class limit' });
    }
    const status = wouldBook ? 'booked' : 'waitlist';
    let row;
    if (existing) { existing.status = status; row = existing; }
    else { row = { id: crypto.randomBytes(8).toString('base64url'), sessionId: session.id, athleteId: me.id, status, bookedAt: new Date().toISOString() }; db.classBookings.push(row); }
    saveDb();
    audit(req, 'box.class.book', { user: me, msg: session.id + ':' + status });
    json(res, 200, { booking: row });
  },

  // Cancelling offers the freed spot to the earliest-queued waitlist row rather than booking
  // them in automatically — someone who's been waiting may no longer be able to make it by the
  // time a spot opens, so this only notifies (push + wsSend) and waits for them to tap "book"
  // themselves; POST /api/box/classes/book claims an 'offered' row instead of erroring on it.
  'POST /api/box/classes/cancel': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const session = db.classSessions.find(s => s.id === body.sessionId);
    if (!session) return json(res, 404, { error: 'not found' });
    const mine = db.classBookings.find(b => b.sessionId === session.id && b.athleteId === me.id && (b.status === 'booked' || b.status === 'waitlist' || b.status === 'offered'));
    if (!mine) return json(res, 404, { error: 'not booked' });
    const wasBooked = mine.status === 'booked';
    mine.status = 'cancelled';
    // A cancellation inside the window before class start counts as "late" — recorded for the
    // coach to see (Phase 5's reporting), no automatic consequence yet.
    const startsAt = new Date(session.date + 'T' + session.startTime + ':00');
    if (wasBooked && (startsAt - Date.now()) < LATE_CANCEL_WINDOW_MS) {
      db.classPenalties.push({ id: crypto.randomBytes(8).toString('base64url'), boxId: session.boxId, athleteId: me.id, kind: 'late-cancel', sessionId: session.id, created: new Date().toISOString() });
    }
    let promoted = null;
    if (wasBooked) {
      promoted = db.classBookings.filter(b => b.sessionId === session.id && b.status === 'waitlist').sort((a, b) => a.bookedAt.localeCompare(b.bookedAt))[0] || null;
      if (promoted) {
        promoted.status = 'offered';
        promoted.offeredAt = new Date().toISOString();
        // wsSend reaches the app if it's open right now (App.jsx listens for 'class:promoted');
        // sendPush covers the same event for a closed app. Same pair used for coach:approved etc.
        sendPush(promoted.athleteId, { title: 'A spot opened up', body: 'Open the app to reserve it — ' + session.name + ' · ' + session.date + ' ' + session.startTime });
        wsSend(promoted.athleteId, { type: 'class:promoted', sessionId: session.id, name: session.name, date: session.date, startTime: session.startTime });
      }
    }
    saveDb();
    audit(req, 'box.class.cancel', { user: me, msg: session.id });
    json(res, 200, { ok: true });
  },

  // Owner/staff view of one session's roster (booked + waitlist) — the base for attendance.
  'GET /api/coach/box/classes/roster': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const session = db.classSessions.find(s => s.id === (new URL(req.url, 'http://x').searchParams.get('sessionId') || ''));
    if (!session || !canManageBox(me.id, session.boxId)) return json(res, 404, { error: 'not found' });
    const rows = db.classBookings
      .filter(b => b.sessionId === session.id && (b.status === 'booked' || b.status === 'waitlist' || b.status === 'offered' || b.status === 'attended' || b.status === 'no-show'))
      .sort((a, b) => (a.status === 'waitlist' || a.status === 'offered') - (b.status === 'waitlist' || b.status === 'offered') || a.bookedAt.localeCompare(b.bookedAt))
      .map(b => {
        const u = db.users.find(x => x.id === b.athleteId);
        return u ? { ...socialUser(u), status: b.status, bookingId: b.id } : null;
      }).filter(Boolean);
    json(res, 200, { session, roster: rows });
  },

  // Marking a no-show logs a class penalty (same reporting-only reasoning as a late cancel).
  'POST /api/coach/box/classes/attendance': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const booking = db.classBookings.find(b => b.id === body.bookingId);
    if (!booking) return json(res, 404, { error: 'not found' });
    const session = db.classSessions.find(s => s.id === booking.sessionId);
    if (!session || !canManageBox(me.id, session.boxId)) return json(res, 404, { error: 'not found' });
    const status = ['attended', 'no-show'].includes(body.status) ? body.status : null;
    if (!status) return json(res, 400, { error: 'invalid status' });
    booking.status = status;
    if (status === 'no-show') {
      db.classPenalties.push({ id: crypto.randomBytes(8).toString('base64url'), boxId: session.boxId, athleteId: booking.athleteId, kind: 'no-show', sessionId: session.id, created: new Date().toISOString() });
    }
    saveDb();
    audit(req, 'coach.class.attendance', { user: me, msg: booking.id + ':' + status });
    json(res, 200, { ok: true });
  },

  // Starts a host-run live session for a class: one shared clock (For Time / AMRAP / EMOM /
  // Tabata) plus a manually-advanced "current exercise" pointer, both broadcast to whoever's
  // booked — see liveElapsedMs/broadcastLive above for why there's no ticking loop involved.
  'POST /api/coach/box/classes/live/start': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const session = db.classSessions.find(s => s.id === body.sessionId);
    if (!session || !canManageBox(me.id, session.boxId)) return json(res, 404, { error: 'not found' });
    const timerType = ['fortime', 'amrap', 'emom', 'tabata'].includes(body.timerType) ? body.timerType : null;
    if (!timerType) return json(res, 400, { error: 'invalid timer type' });
    const num = (v, def, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def; };
    const params =
      timerType === 'amrap' ? { durationSec: num(body.durationSec, 600, 7200) } :
      timerType === 'emom' ? { roundSec: num(body.roundSec, 60, 900), rounds: body.rounds ? num(body.rounds, 10, 200) : null } :
      timerType === 'tabata' ? { workSec: num(body.workSec, 20, 900), restSec: num(body.restSec, 10, 900), rounds: num(body.rounds, 8, 100) } :
      {};
    db.liveClasses = db.liveClasses.filter(l => l.sessionId !== session.id);
    const row = {
      id: crypto.randomBytes(8).toString('base64url'), boxId: session.boxId, sessionId: session.id, hostId: me.id,
      timerType, params, status: 'running', phaseStartedAt: new Date().toISOString(), pausedElapsedMs: 0,
      currentExerciseIndex: 0, created: new Date().toISOString(), updated: new Date().toISOString(),
    };
    db.liveClasses.push(row);
    saveDb();
    audit(req, 'coach.class.live.start', { user: me, msg: session.id });
    broadcastLive(session, me.id, { type: 'live:update', sessionId: session.id, live: row });
    json(res, 200, { live: row });
  },

  // Pause/resume/reset the shared clock, step the current-exercise pointer, or end the class —
  // any staff/owner of the box can drive it, not just whoever tapped "Start" (so a class doesn't
  // get stuck live if the original host's phone dies).
  'POST /api/coach/box/classes/live/control': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const session = db.classSessions.find(s => s.id === body.sessionId);
    if (!session || !canManageBox(me.id, session.boxId)) return json(res, 404, { error: 'not found' });
    const row = db.liveClasses.find(l => l.sessionId === session.id);
    if (!row) return json(res, 404, { error: 'not live' });
    const maxEx = wodExerciseCount(session.wod);
    switch (body.action) {
      case 'pause':
        if (row.status === 'running') { row.pausedElapsedMs = liveElapsedMs(row); row.status = 'paused'; row.phaseStartedAt = null; }
        break;
      case 'resume':
        if (row.status === 'paused') { row.status = 'running'; row.phaseStartedAt = new Date().toISOString(); }
        break;
      case 'reset':
        row.pausedElapsedMs = 0; row.status = 'running'; row.phaseStartedAt = new Date().toISOString(); row.currentExerciseIndex = 0;
        break;
      case 'next-exercise':
        row.currentExerciseIndex = Math.min(row.currentExerciseIndex + 1, Math.max(maxEx - 1, 0));
        break;
      case 'prev-exercise':
        row.currentExerciseIndex = Math.max(row.currentExerciseIndex - 1, 0);
        break;
      case 'end':
        db.liveClasses = db.liveClasses.filter(l => l.id !== row.id);
        saveDb();
        audit(req, 'coach.class.live.end', { user: me, msg: session.id });
        broadcastLive(session, row.hostId, { type: 'live:update', sessionId: session.id, live: null });
        return json(res, 200, { live: null });
      default:
        return json(res, 400, { error: 'invalid action' });
    }
    row.updated = new Date().toISOString();
    saveDb();
    broadcastLive(session, row.hostId, { type: 'live:update', sessionId: session.id, live: row });
    json(res, 200, { live: row });
  },

  // Snapshot for a fresh page load / reconnect — the WS push only carries deltas from the
  // moment it's sent, so anyone opening the live view mid-class needs this to catch up.
  'GET /api/box/classes/live': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const sessionId = new URL(req.url, 'http://x').searchParams.get('sessionId') || '';
    const session = db.classSessions.find(s => s.id === sessionId);
    if (!session || !(isMemberOfBox(me.id, session.boxId) || canManageBox(me.id, session.boxId))) return json(res, 404, { error: 'not found' });
    const row = db.liveClasses.find(l => l.sessionId === sessionId) || null;
    json(res, 200, { live: row });
  },
};

/* ---------- boot ---------- */
// Nothing above this point talks to Postgres — db/stateCache/auditCache are just declared, and
// the HTTP server doesn't start listening until they're actually populated, so no request can
// ever observe an empty in-memory mirror.
async function main() {
  await ensureSchema();
  db = await loadAll();
  for (const [uid, state] of await loadAllStates()) stateCache.set(uid, state);
  if (AUDIT_ON) {
    auditCache = await auditAll();
    auditSeq = auditCache.length ? auditCache[auditCache.length - 1].id : 0;
    auditCount = auditCache.length;
    pruneAudit();                                // prune on boot, mirrors the old file-compaction pass
    setInterval(pruneAudit, 3600000).unref();    // honour AUDIT_DAYS on an idle instance too
  }
  backfillCheatPenaltySnapshots();
  setInterval(reminderTick, 10000).unref();
  setInterval(waitlistOfferTick, 30000).unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = req.method + ' ' + url.pathname;
    const handler = routes[key];
    if (!handler) return json(res, 404, { error: 'not found' });
    try { await handler(req, res); }
    catch (e) {
      console.error(key, e);
      if (!res.headersSent) json(res, 500, { error: 'server error' });
    }
  });

  // Same session cookie, same rules as every HTTP route: no valid session, no connection —
  // checked once here rather than trusting anything the client claims after the handshake.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/ws') { socket.destroy(); return; }
    const user = readSession(req);
    if (!user) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      let set = wsByUser.get(user.id);
      if (!set) { set = new Set(); wsByUser.set(user.id, set); }
      set.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => {
        set.delete(ws);
        if (!set.size) wsByUser.delete(user.id);
      });
      ws.on('error', () => {});   // 'close' always follows; nothing extra to do here
    });
  });
  // A dead connection (network dropped, laptop closed) never fires 'close' on its own — nothing
  // tells the server, so it would just sit in wsByUser forever. Pinged every 25s instead: no pong
  // since the last ping means it's actually gone, so it's torn down; short enough that a reverse
  // proxy in front of this (a Cloudflare tunnel, in this project's own case) never sees the
  // connection idle long enough to kill it for us first.
  setInterval(() => {
    for (const set of wsByUser.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 25000).unref();

  server.listen(PORT, () => console.log(`gym-api on :${PORT} (origin=${ORIGIN})`));
}
main().catch(e => { console.error('boot failed:', e); process.exit(1); });
