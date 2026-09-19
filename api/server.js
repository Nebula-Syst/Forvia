/* Forvia — level/XP/prestige/streaks, nutrition's own external-facing routes, the social feed,
   and the whole coach/box system. This is Nebula Systems' own original work, split out from what
   used to be one server.js so it can carry its own license — none of it is a continuation of
   openGym (see NOTICE.md). Auth, sessions, account management, and workout/routine/bodyweight/
   nutrition-diary SYNC all live in the sibling `forvia-core` service instead (still AGPL, still
   genuinely openGym-derived) — this service never touches Postgres for any of that; it talks to
   forvia-core over a small internal API instead (shared-secret protected, never exposed
   publicly), described in the "talking to forvia-core" section below.
   No framework, JSON-file storage, signed session cookies. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ensureSchema, loadAll, saveAll, appendAudit, auditAll, auditDeleteIds } from './db.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
// Mirrors the same-named constant on forvia-core's side — this service issues no cookies and
// terminates no TLS itself, but a couple of routes (box location, coach documents) still need to
// know the deployment's own posture (search-vs-precise geocoding).
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const BOX_LOCATION_MODE = /^(off|precise)$/i.test(process.env.BOX_LOCATION_MODE || '') ? process.env.BOX_LOCATION_MODE.toLowerCase() : 'search';
// Base64 inflates ~33%, so the ~6MB compressed-photo cap enforced on a social photo upload
// already needs ~8MB of headroom on its own before the surrounding {"dataUrl":"data:...","}
// JSON wrapper adds its own few dozen bytes on top — cutting MAX_BODY exactly at 8MB let that
// wrapper push a maximum-size photo's body just past the limit, which read as the generic
// "body too large" 500 instead of this route's proper 413. Comfortable headroom fixes both.
const MAX_BODY = 9 * 1024 * 1024;

fs.mkdirSync(DATA, { recursive: true });

/* ---------- db ---------- */
// Loaded from Postgres once boot()/main() runs, at the bottom of this file — a SUBSET of the
// original db.json shape, disjoint from forvia-core's own (see db.js's own comment for exactly
// which collections this service owns). Deliberately does NOT include `users` or `subs`: those
// stay physically owned by forvia-core (see "talking to forvia-core" below for why, and how this
// service still reads/writes the handful of fields on `users` it needs).
let db = {
  follows: [], reactions: [], comments: [], tasks: [], taskCompletions: [], cheatPenalties: [],
  importLevelCaps: [], streakTiers: [], coachRequests: [], boxes: [], boxMemberships: [],
  boxInvites: [], routineAssignments: [], wods: [], wodResults: [], boxRequests: [], boxStaff: [],
  classTypes: [], dayTemplates: [], weekTemplates: [], wodTemplates: [], classSessions: [],
  classBookings: [], classPenalties: [], liveClasses: [], publicFoods: [], boxPlans: [],
  // NOT one of this service's own COLLECTIONS (see db.js) — refreshUsersMirror() below is what
  // actually keeps this populated. Declared here (rather than left to spring into existence on
  // the first successful refresh) so a request arriving before that first refresh finishes finds
  // an empty mirror instead of a crash on `db.users.find`.
  users: [],
};
// A LOCAL MIRROR of forvia-core's `users` table — not this service's own data, but the fields on
// it (coach/coachVisible/hourlyRate/coachLocation/pro/prestigeConfirmed/prestigeBaselineXp/
// adminXpAdjust/streakBonus/badges/public/bio/pinnedWorkoutIds/pinnedPR/employeeTypes/admin
// eligibility/etc.) are read on nearly every route in this file, and a network round trip per
// field read is not viable. Populated wholesale at boot (GET /internal/users) and refreshed on
// the same cadence after that (see refreshUsersMirror in "boot" below) — kept optimistically
// fresh in between by patchUser() below for THIS service's own writes, and by a one-off fetch
// (fetchAndCacheUser) the moment a brand-new account's session is resolved before the next
// periodic refresh has had a chance to pick it up. A periodic full refresh REPLACES this array
// wholesale, which is also what makes an account disabled or deleted on forvia-core's side
// (never a message that reaches this service any other way) eventually disappear from here too.
const EMPLOYEE_TYPES = ['founder', 'admin'];
const employeeTypesOf = user => Array.isArray(user?.employeeTypes) ? user.employeeTypes.filter(t => EMPLOYEE_TYPES.includes(t)) : [];
const isAdmin = user => !!user && (employeeTypesOf(user).length > 0 || ADMIN_UIDS.includes(user.id));
const avatarUrlOf = user => user.avatarFile ? `/api/uploads?uid=${encodeURIComponent(user.id)}&file=${encodeURIComponent(user.avatarFile)}` : null;

// Fire-and-forget, same pattern (and same reason — see forvia-core's own db.js/saveDb comment on
// the duplicated-rows incident) as every other service in this project: saveAll does DELETE FROM
// <table>; INSERT ... per collection, only safe run one at a time, so every saveDb() call is
// appended to one standing promise instead of racing a concurrent one.
let saveChain = Promise.resolve();
function saveDb() {
  saveChain = saveChain.then(() => saveAll(db)).catch(e => console.error('saveDb failed:', e.message));
}

/* ---------- talking to forvia-core ---------- */
// forvia-core owns `users`, `subs`, and user_state (workouts/routines/bodyweight/nutrition-diary)
// — everything below is how this service reads and writes into those without a second copy of
// that data, and how forvia-core reaches back in here for the one thing it can no longer compute
// itself (anti-cheat/task-grading against a freshly-synced state).
const CORE_URL = process.env.CORE_URL || 'http://core-api:3000';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
if (!INTERNAL_SECRET) console.error('WARNING: INTERNAL_SECRET is not set — /internal/* is unprotected');
function requireInternal(req, res) {
  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    json(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}
// Every route in this file still calls readSession(req) exactly like it always did — synchronous,
// no await, ~110 call sites unchanged. The actual cookie -> user resolution happens ONCE per
// request, up front, in main()'s dispatcher (already async): it resolves the raw Cookie header
// against forvia-core's own POST /internal/session (briefly cached — see resolveSession below),
// then hangs the LOCAL mirror's user object for that id on the request. readSession just reads
// that back. Only the id from forvia-core's answer is ever used — every field a route here
// actually reads/writes lives on the local users mirror instead, never on forvia-core's own
// (identity-only) response shape.
function readSession(req) {
  return req.__user || null;
}
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
// Guard for /api/coach/* — resolves the caller and 401/403s if they aren't an approved coach.
function requireCoach(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!user.coach) { audit(req, 'coach.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
const sessionCache = new Map();   // raw Cookie header string -> { uid: string|null, exp: number }
const SESSION_CACHE_MS = 30000;
async function resolveSession(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie) return null;
  const cached = sessionCache.get(cookie);
  if (cached && cached.exp > Date.now()) return cached.uid;
  let uid = null;
  try {
    const r = await fetch(`${CORE_URL}/internal/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
      body: JSON.stringify({ cookie }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    uid = data.user?.id || null;
  } catch (e) { console.error('resolveSession failed:', e.message); }
  sessionCache.set(cookie, { uid, exp: Date.now() + SESSION_CACHE_MS });
  return uid;
}
// A cookie that resolved to a real uid, but that uid isn't in the local mirror yet — a brand new
// account, signed in within the last few seconds, ahead of the next periodic refreshUsersMirror
// (see "boot" below). Fetched once and pushed into the mirror so this (and every following)
// request for that account works immediately rather than waiting out the refresh interval.
async function fetchAndCacheUser(uid) {
  try {
    const r = await fetch(`${CORE_URL}/internal/user?uid=${encodeURIComponent(uid)}`, {
      headers: { 'X-Internal-Secret': INTERNAL_SECRET }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const { user } = await r.json();
    if (user) db.users.push(user);
    return user || null;
  } catch (e) { console.error('fetchAndCacheUser failed:', uid, e.message); return null; }
}
// This service's only write path onto forvia-core's `users` row: updates the local mirror
// immediately (so the very next line of the SAME request already sees the new value — every
// existing call site here used to just mutate the object directly and keep going) and pushes the
// real write to forvia-core in the background. Fire-and-forget on purpose, same posture as
// saveDb() itself: a request must never block on, or fail because of, a slow/unreachable sibling
// service. patchChain (mirrors saveChain) only keeps this service's own outgoing patches from
// reordering against each other over the wire — it does nothing to protect against forvia-core's
// own periodic mirror refresh landing in between a patch being applied locally and that patch's
// own network call actually completing, which can very briefly show the old value again until the
// next successful refresh picks up what was actually persisted. Same eventual-consistency
// tradeoff this whole project already accepts everywhere else a write is fire-and-forget.
let patchChain = Promise.resolve();
function patchUser(uid, patch) {
  const u = db.users.find(x => x.id === uid);
  if (u) Object.assign(u, patch);
  patchChain = patchChain.then(() => fetch(`${CORE_URL}/internal/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
    body: JSON.stringify({ uid, patch }),
  })).catch(e => console.error('patchUser failed:', uid, e.message));
}
// A web push only forvia-core can actually send (it owns the VAPID keys and db.subs) — on behalf
// of a Nebula feature (an anti-cheat ruling, a waitlist spot opening up). Fire-and-forget, same
// as forvia-core's own sendPush already is; it no-ops safely if the user has no subscription.
function notifyCorePush(uid, payload) {
  fetch(`${CORE_URL}/internal/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
    body: JSON.stringify({ uid, payload }),
  }).catch(e => console.error('notifyCorePush failed:', e.message));
}
// Per-user training state (routines, workouts, bodyweight, nutrition diary) — a READ mirror of
// forvia-core's own user_state table, same in-memory-Map shape forvia-core itself uses. Populated
// wholesale at boot (GET /internal/states) and kept fresh from exactly two places after that: the
// synchronous /internal/scan-data call below (forvia-core's PUT /api/data hands this service the
// freshly-merged state on every sync, and this is the one place that state ever changes for a
// live account) and writeState() just below (this service's own one write path back — putting an
// overturned anti-cheat penalty's workout back where it came from). No periodic refresh needed:
// unlike `users`, nothing on forvia-core's side ever changes user_state without going through one
// of those two paths.
const stateCache = new Map();
function readState(uid) { return stateCache.get(uid) || null; }
// This service's only write path onto forvia-core's user_state — updates the local mirror
// immediately, same "keep going against the fresh value" reasoning as patchUser above, and pushes
// the real write to forvia-core in the background. The one existing call site (POST /api/admin/
// anticheat/review, putting an overturned workout back) already just calls this and moves on, so
// it needs no change at all.
function writeState(uid, state) {
  stateCache.set(uid, state);
  fetch(`${CORE_URL}/internal/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
    body: JSON.stringify({ uid, state }),
  }).catch(e => console.error('writeState (push to core) failed:', uid, e.message));
}
async function refreshUsersMirror() {
  try {
    const r = await fetch(`${CORE_URL}/internal/users`, { headers: { 'X-Internal-Secret': INTERNAL_SECRET }, signal: AbortSignal.timeout(10000) });
    const { users } = await r.json();
    if (Array.isArray(users)) db.users = users;
  } catch (e) { console.error('refreshUsersMirror failed:', e.message); }
}
async function loadStateMirror() {
  try {
    const r = await fetch(`${CORE_URL}/internal/states`, { headers: { 'X-Internal-Secret': INTERNAL_SECRET }, signal: AbortSignal.timeout(20000) });
    const { states } = await r.json();
    for (const [uid, state] of Object.entries(states || {})) stateCache.set(uid, state);
  } catch (e) { console.error('loadStateMirror failed:', e.message); }
}

/* ---------- workout photos / social photos / box images / coach documents ---------- */
// Same per-account upload directory forvia-core's avatars live in, on a Docker volume shared
// between both containers — a social photo, a box image, or a coach's application document is
// just another file in that same directory, so this service inherits forvia-core's GET
// /api/uploads visibility rule for free without a second endpoint or a file-transfer API between
// the two services.
const UPLOAD_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const uploadsDir = uid => path.join(DATA, 'uploads', uid.replace(/[^a-zA-Z0-9_-]/g, ''));
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Coach-application proof documents (a certification, an ID card) — PDFs are a real, common case
// here (photos aren't), so this is its own mime map rather than widening UPLOAD_MIME (which every
// photo-upload call site assumes is images-only).
const DOCUMENT_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/* ---------- WebSocket (real-time push to an already-open app) ---------- */
// notifyCorePush above reaches a closed app; this reaches an open one instantly, no polling
// involved. One WS server, attached to this service's own http.Server — auth reuses the same
// session-resolution path every HTTP route already goes through (see main()'s upgrade handler
// below), not a second cookie check.
const wsByUser = new Map();   // userId -> Set<WebSocket>
function wsSend(userId, payload) {
  const set = wsByUser.get(userId);
  if (!set || !set.size) return;
  const body = JSON.stringify(payload);
  for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(body); }
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

/* ---------- audit log ---------- */
// Same file/table-backed audit trail as forvia-core's own — a separate log, not a shared one
// (each service owns its own audit_log table in the same Postgres instance, same "disjoint
// kv_* tables" pattern as everything else split between the two), since the events worth
// recording here (admin nudges, anti-cheat rulings, coach approvals) are this service's own.
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
let auditSeq = 0;
let auditCount = 0;
let auditCache = [];
function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const raw = String(req.headers?.['cf-connecting-ip'] || '').trim()
    || String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers?.['x-real-ip'] || '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}
function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}
function pruneAudit() {
  const keep = auditKeep(auditCache);
  auditCount = keep.length;
  if (keep.length === auditCache.length) return;
  const keepIds = new Set(keep.map(r => r.id));
  const dropIds = auditCache.filter(r => !keepIds.has(r.id)).map(r => r.id);
  auditCache = keep;
  auditDeleteIds(dropIds).catch(e => console.error('audit prune failed:', e.message));
}
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
const CHEAT_MAX_WEIGHT = { kg: 500, lb: 1100 };
const CHEAT_MAX_REPS = 100;
const CHEAT_MAX_DURATION_MS = 8 * 3600 * 1000;
const CHEAT_MAX_LEVELS = 5;
const CHEAT_RULES = [
  { id: 'weight', label: 'Weight beyond any recorded human lift', check: (w, ctx) => ctx.maxWeight / ctx.maxWeightAllowed },
  { id: 'reps', label: 'More reps in one set than physically possible', check: (w, ctx) => ctx.maxReps / CHEAT_MAX_REPS },
  { id: 'prs', label: 'More new records claimed than exercises actually trained', check: (w, ctx) => ctx.exCount > 0 ? (w.prs?.length || 0) / ctx.exCount : ((w.prs?.length || 0) > 0 ? CHEAT_MAX_LEVELS : 0) },
  { id: 'timing', label: 'Missing or nonsensical start/end time', check: (w, ctx) => ctx.badTiming ? CHEAT_MAX_LEVELS : 0 },
  { id: 'duration', label: 'Session longer than a real workout', check: (w, ctx) => ctx.badTiming ? 0 : ctx.durationMs / CHEAT_MAX_DURATION_MS },
  { id: 'overlap', label: 'Overlaps another logged session for the same account', check: (w, ctx) => ctx.overlapsAnother ? 3 : 0 },
];
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
  const isImported = id => typeof id === 'string' && id.startsWith('iw');
  const overlapsAnother = !badTiming && !isImported(w?.id) && allWorkouts.some(o => o !== w && o.id !== w.id && !isImported(o.id) && Number(o.start) > 0 && Number(o.end) > 0 && start < Number(o.end) && Number(o.start) < end);
  return { sets, exCount: exSeen.size, maxWeight, maxReps, maxWeightAllowed: CHEAT_MAX_WEIGHT[unit] || CHEAT_MAX_WEIGHT.kg, start, end, durationMs, badTiming, overlapsAnother };
}
function cheatFindingsFor(w, unit, allWorkouts) {
  const ctx = cheatCtxFor(w, unit, allWorkouts);
  return CHEAT_RULES
    .map(rule => ({ id: rule.id, label: rule.label, ratio: rule.check(w, ctx) || 0 }))
    .filter(f => f.ratio > 1)
    .map(f => ({ ...f, levels: severityTier(f.ratio) }))
    .sort((a, b) => b.levels - a.levels);
}
// Scans everything currently stored, but only ever penalizes a given workoutId once. Called from
// forvia-core's PUT /api/data, via this service's own POST /internal/scan-data, BEFORE the write
// it's scoring — a flagged workout is pulled out of `state.workouts` entirely (its only copy
// becomes the one embedded in the penalty row below) rather than left sitting in plain view with
// just a level docked against it: xpFor/feedItemsFor/history/social all read state.workouts, so
// removing it from there is what actually blocks and hides it everywhere at once. Overturning
// (POST /api/admin/anticheat/review) puts it back; upholding leaves it out for good.
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
      if (existing.status === 'overturned') keep.push(w);
      return;
    }
    const findings = cheatFindingsFor(w, unit, workouts);
    if (!findings.length) { keep.push(w); return; }
    const levels = Math.min(CHEAT_MAX_LEVELS, findings[0].levels);
    const before = rankFor(user.id);
    db.cheatPenalties.push({
      id: crypto.randomBytes(8).toString('base64url'), userId: user.id, workoutId: w.id, workout: w, unit,
      findings, levels, date: today, created: new Date().toISOString(),
      status: 'active',
      appeal: null,
      seen: false,
      beforeLevel: before.level, beforeXpInLevel: before.xpInLevel, beforeXpForLevel: before.xpForLevel,
    });
    flaggedMsgs.push(w.id + ':' + findings.map(f => f.id).join(',') + '=' + levels + 'lvl');
  });
  state.workouts = keep;
  if (flaggedMsgs.length) {
    saveDb();
    audit(req, 'anticheat.flag', { user, msg: flaggedMsgs.join(' | ').slice(0, 120) });
    wsSend(user.id, { type: 'anticheat:flagged' });
    notifyCorePush(user.id, {
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
      return true;
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
// db.taskCompletions itself, called from POST /internal/scan-data right after the anti-cheat scan.
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
// (×3), never more, even if an admin adds/removes tiers later. A Free account always gets 1 (no
// bonus, no matter the streak).
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
function rawTrainingXp(uid) {
  const workouts = readState(uid)?.workouts || [];
  return workouts.reduce((n, w) => n + workoutXp(w), 0) + workouts.reduce((n, w) => n + (w.prs?.length || 0), 0) * PR_XP;
}
// Raw, un-docked total — anti-cheat penalties are applied in rankFor below, against the
// level actually on screen, not against a number nobody's account is ever measured by.
function xpFor(uid) {
  const S = readState(uid);
  const user = db.users.find(u => u.id === uid);
  // The streak multiplier only ever applies to training XP earned AFTER it started applying —
  // never live-multiplies the whole historical total (real incident, 2026-09-19). Instead this
  // banks the *delta* since the last time this ran, at whatever multiplier is current right
  // now, into streakXpBankedXp — so only newly-earned XP ever gets bonused. streakXpBaselineRaw
  // is the raw (un-bonused) training XP as of that last bank. patchUser() is used here rather
  // than an await — this runs on nearly every rank/xp read in the file, so it stays the same
  // fire-and-forget shape saveDb() itself already has, not a promise every caller has to thread
  // through (see patchUser's own comment on that tradeoff).
  const raw = rawTrainingXp(uid);
  const baseline = user?.streakXpBaselineRaw ?? 0;
  if (user && raw > baseline) {
    patchUser(uid, {
      streakXpBankedXp: (user.streakXpBankedXp || 0) + (raw - baseline) * streakXpMultiplier(uid),
      streakXpBaselineRaw: raw,
    });
  } else if (user && raw < baseline) {
    patchUser(uid, { streakXpBaselineRaw: raw });   // a workout was edited/deleted — resync down, keep the banked bonus as-is
  }
  let xp = Math.round(user?.streakXpBankedXp ?? raw);
  const bw = S?.bodyweight?.length ? S.bodyweight[S.bodyweight.length - 1] : null;
  if (S?.targetW && bw && Math.abs(S.targetW - bw.w) < 0.05) xp += GOAL_XP;
  xp += db.taskCompletions.filter(c => c.userId === uid).reduce((n, c) => n + c.points, 0);
  xp += user?.adminXpAdjust || 0;
  return Math.max(0, xp);
}
// One full 1→100 climb's worth of XP. Crossing it does NOT roll over on its own — prestige is
// a confirmed action (POST /api/prestige), not automatic math.
const CYCLE_XP = LEVEL_CUM[100];
const MAX_PRESTIGE = 10;
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
  const levelsDocked = levelsDockedFor(uid);
  const level = Math.max(1, rawLevel - levelsDocked);
  const readyToPrestige = level === 100 && prestige < MAX_PRESTIGE;
  const xp = levelsDocked > 0 ? LEVEL_CUM[level - 1] : (readyToPrestige ? LEVEL_CUM[100] : xpInCycle);
  const floor = LEVEL_CUM[level - 1], ceil = LEVEL_CUM[level] ?? floor;
  return { level, prestige, xp, xpInLevel: xp - floor, xpForLevel: ceil - floor, totalXp, readyToPrestige };
}
// Applies the fixed-XP-budget cap (see IMPORT_XP_BUDGET) against the level an import just
// produced. Called from POST /internal/scan-data, after the merged state has already been
// scanned for cheating and its beforeLevel snapshotted — rankFor(uid) here reflects the real,
// anti-cheat-adjusted post-import total. The workouts themselves are never touched, only how
// many of the levels they're worth show up right away (same lever as a cheat penalty, via
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
// One-time migration for penalties created before beforeLevel/beforeXpInLevel/beforeXpForLevel
// existed. Called from main() below, once db is loaded from Postgres.
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
// One-time migration for accounts that predate the streak-XP-bonus feature (xpFor above):
// seeds streakXpBaselineRaw/streakXpBankedXp to the account's current raw (un-bonused)
// training XP, banking zero bonus so far. Same "run once after boot, called from main()" shape
// as backfillCheatPenaltySnapshots above — patches every affected account through patchUser
// rather than a single saveDb(), since `users` isn't this service's table to save directly.
function backfillStreakXpBaselines() {
  const missing = db.users.filter(u => u.streakXpBaselineRaw === undefined);
  if (!missing.length) return;
  for (const u of missing) {
    const raw = rawTrainingXp(u.id);
    patchUser(u.id, { streakXpBaselineRaw: raw, streakXpBankedXp: raw });
  }
  console.log(`[streak-xp] backfilled baseline for ${missing.length} account${missing.length === 1 ? '' : 's'}`);
}
// Perks per rank tier / prestige level — computed fresh from rankFor, same "nothing to
// desync" reasoning as the rest of this section.
function perksFor(uid) {
  const { level, prestige } = rankFor(uid);
  const pro = !!db.users.find(u => u.id === uid)?.pro;
  return {
    pinFavoritePR: level >= 11,   // Bronze
    bio: true,
    maxPhotos: !pro ? 1 : (prestige >= 6 ? 8 : (level >= 51 ? 6 : 4)),   // Diamond / Prestige 6
    pinnedMax: (level >= 61 ? 1 : 0) + (level >= 81 ? 1 : 0) + (prestige >= 3 ? 1 : 0),   // Master + Elite + Prestige 3
    subscriptionDiscount: prestige >= 10 ? 50 : (prestige >= 5 ? 25 : 0),
    streakXpBonusPct: Math.round((streakXpMultiplier(uid) - 1) * 100),
    appTheme: prestige >= 8,   // Prestige 8 — exclusive app-wide color theme
  };
}
// Re-checked on every read, never cached from follow time — a user going private must
// disappear from everyone's feed/leaderboard/discovery on their very next request.
const isPublic = uid => { const u = db.users.find(x => x.id === uid); return !!u && !!u.public && !u.disabled; };
const followingOf = uid => db.follows.filter(f => f.followerId === uid).map(f => f.followeeId).filter(isPublic);
// No badge preference saved yet → default to showing rank (and prestige, once there is
// any) in the first slots.
const defaultBadges = rank => ['rank', ...(rank.prestige > 0 ? ['prestige'] : [])];
const badgesFor = (user, rank) => Array.isArray(user.badges) ? user.badges : defaultBadges(rank);
// Mirrors frontend/src/lib/rank.js TIERS (slug + level floor only) — needed here just to
// validate a showcase badge pick of 'rank:<slug>' against the level actually reached.
const RANK_TIER_MINS = { iron: 1, bronze: 11, silver: 21, gold: 31, platinum: 41, diamond: 51, master: 61, champion: 71, elite: 81, legend: 91 };
// Mirrors frontend/src/lib/streak.js FALLBACK_STREAK_TIERS.
const FALLBACK_STREAK_TIERS = [
  { id: 'fallback-1', days: 1 }, { id: 'fallback-2', days: 3 }, { id: 'fallback-3', days: 7 },
  { id: 'fallback-4', days: 14 }, { id: 'fallback-5', days: 21 }, { id: 'fallback-6', days: 30 },
  { id: 'fallback-7', days: 60 }, { id: 'fallback-8', days: 100 }, { id: 'fallback-9', days: 180 },
  { id: 'fallback-10', days: 365 },
];
// This service's own "who am I" shape — merged client-side with forvia-core's own GET /api/me
// into the one `user` object useStore already expects. Never the auth-only identity fields
// (those are forvia-core's), just the gamification/social ones this service owns.
const nebulaMe = user => {
  const rank = rankFor(user.id);
  return {
    rank, perks: perksFor(user.id), badges: badgesFor(user, rank),
    coach: !!user.coach, coachVisible: !!user.coachVisible, hourlyRate: user.hourlyRate ?? null,
    coachLocation: user.coachLocation || null,
    pro: !!user.pro,
    public: !!user.public, bio: user.bio || '',
    pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
    streakBonus: user.streakBonus || 0,
  };
};
// A user's social presence to OTHER users — never leaks the auth-only fields above. Perks ride
// along here too: they're cosmetic flair, meant to be seen by other people.
const socialUser = user => ({
  id: user.id, name: user.name, username: user.username || null, perks: perksFor(user.id),
  bio: user.bio || '', avatarUrl: avatarUrlOf(user), badges: badgesFor(user, rankFor(user.id)),
  pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
  coach: !!user.coach,
  hourlyRate: user.coach && user.coachVisible ? (user.hourlyRate ?? null) : null,
  coachLocation: user.coach && user.coachVisible ? (user.coachLocation || null) : null,
});
// Shared by GET /api/social/comments and the POST /api/social/comment response.
const publicComment = c => {
  const author = db.users.find(u => u.id === c.userId) || {};
  return { id: c.id, userId: c.userId, name: author.name || '?', username: author.username || null, text: c.text, created: c.created };
};

/* ---------- coach + box ---------- */
// Same discipline as isPublic() above: re-derived fresh on every call, never cached from
// join/box-creation time.
const isCoachOfBox = (coachId, boxId) => {
  const box = db.boxes.find(b => b.id === boxId);
  return !!box && box.coachId === coachId;
};
const isMemberOfBox = (userId, boxId) => db.boxMemberships.some(m => m.userId === userId && m.boxId === boxId);
// "Staff" — a coach's helpers for one specific box, added by @username search rather than the
// manual coach-application review. Never implies coach:true, and never grants the box-admin
// actions that stay owner-only.
const isStaffOfBox = (userId, boxId) => db.boxStaff.some(s => s.boxId === boxId && s.userId === userId);
const canManageBox = (userId, boxId) => isCoachOfBox(userId, boxId) || isStaffOfBox(userId, boxId);
const canViewAthlete = (userId, athleteUid) => {
  const myBoxIds = new Set(db.boxes.filter(b => b.coachId === userId).map(b => b.id)
    .concat(db.boxStaff.filter(s => s.userId === userId).map(s => s.boxId)));
  return db.boxMemberships.some(m => m.userId === athleteUid && myBoxIds.has(m.boxId));
};
// Membership plans: a plan choice is an attribute of the existing membership relationship (the
// boxMemberships row), not a new one — one plan per (boxId, userId) at a time, stored as a
// nullable planId right on that row.
const LIMIT_STATUSES = new Set(['booked', 'no-show']);
function monthlyClassUsage(boxId, userId, monthKey) {
  return db.classBookings.filter(b => {
    if (b.athleteId !== userId || !LIMIT_STATUSES.has(b.status)) return false;
    const session = db.classSessions.find(s => s.id === b.sessionId);
    return !!session && session.boxId === boxId && session.date.slice(0, 7) === monthKey;
  }).length;
}
const PLAN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const PLAN_GRACE_MS = 5 * 24 * 60 * 60 * 1000;
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
// Not real pagination — the frontend fetches this whole list in one call.
const FEED_LIMIT = 500;
const FEED_DAYS = 30;
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
// more per-100g values — only included when actually present.
function extraNutriments(n) {
  const out = {};
  if (n['saturated-fat_100g'] != null) out.satFat100 = Math.round(n['saturated-fat_100g'] * 10) / 10;
  if (n['sugars_100g'] != null) out.sugars100 = Math.round(n['sugars_100g'] * 10) / 10;
  if (n['fiber_100g'] != null) out.fiber100 = Math.round(n['fiber_100g'] * 10) / 10;
  if (n['salt_100g'] != null) out.salt100 = Math.round(n['salt_100g'] * 10) / 10;
  return out;
}

/* ---------- routes ---------- */
// Geocoding proxy helpers — module scope, since `routes` is a plain object literal and can't
// hold statement-level declarations of its own.
const GEO_UA = 'Forvia (self-hosted gym tracker) - github.com/Nebula-Syst/Forvia';
const placeLabelFrom = p => {
  if (!p) return null;
  const street = p.housenumber && p.street ? `${p.street} ${p.housenumber}` : p.street || null;
  const locality = street ? (p.city || p.district) : (p.city || p.name);
  return [street, locality, p.country].filter(Boolean).join(', ') || null;
};
function kmBetween(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const MARKETPLACE_RADIUS_KM = 50;
const LATE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;
// A waitlist offer only holds exclusive priority for this long — checked by a sweep
// (waitlistOfferTick, registered in main()) rather than a per-offer setTimeout: a sweep re-checks
// real elapsed time against `offeredAt` on every tick, so a stale offer self-heals within one
// tick even across a server restart.
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
      notifyCorePush(w.athleteId, { title: 'A spot is open', body: 'First to book gets it — ' + session.name + ' · ' + session.date + ' ' + session.startTime });
      wsSend(w.athleteId, { type: 'class:promoted', sessionId: session.id, name: session.name, date: session.date, startTime: session.startTime });
    }
  }
  if (dirty) saveDb();
}
// Live class clock: elapsed time is a pure function of a single anchor timestamp + the
// accumulated time banked before the current run segment, never a server-side ticking loop.
const liveElapsedMs = row => row.status === 'running'
  ? row.pausedElapsedMs + (Date.now() - Date.parse(row.phaseStartedAt))
  : row.pausedElapsedMs;
const broadcastLive = (session, hostId, payload) => {
  const targets = new Set(db.classBookings.filter(b => b.sessionId === session.id && b.status === 'booked').map(b => b.athleteId));
  if (hostId) targets.add(hostId);
  for (const uid of targets) wsSend(uid, payload);
};
const CLASS_ICONS = new Set([
  'barbell', 'dumbbell', 'figureRun', 'kettlebell', 'stretch', 'boxing', 'bike', 'swim',
  'pullup', 'machine', 'plate', 'figureStrength', 'legs', 'abs', 'arm', 'flame', 'target',
  'trophy', 'medal', 'heart', 'timer', 'sparkles',
]);

const routes = {
  // This service's half of "who am I" — GET /api/me itself is forvia-core's now (identity,
  // auth-only fields; see nginx.conf.template's routing comment), reachable at the exact same
  // path since a browser can only ask one backend per URL. frontend/src/lib/api.js's api()
  // helper is what actually calls both and merges them into the one `user` shape useStore
  // already expects — every OTHER call site in the app still just does api('/api/me') and never
  // has to know two services answer it.
  'GET /api/me/nebula': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: nebulaMe(user) });
  },

  // This service's own Docker healthcheck target — GET /api/health moved to forvia-core along
  // with everything else generic-infra, so this service needs its own (unauthenticated, same as
  // forvia-core's own) rather than reporting unhealthy forever.
  'GET /api/health': async (req, res) => json(res, 200, { ok: true }),

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
    patchUser(coach.id, { coachVisible: !!body.visible, hourlyRate: rate, coachLocation: location });
    audit(req, 'coach.visibility.set', { user: coach, msg: (coach.coachVisible ? 'visible' : 'hidden') + ':' + rate });
    json(res, 200, { user: nebulaMe(coach) });
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

  'POST /api/prestige': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Prestige itself is a Pro perk — a Free account still climbs to level 100 and sits
    // readyToPrestige (nothing about leveling changes), it just can't cash that in without Pro.
    if (!user.pro) return json(res, 403, { error: 'A Pro subscription is required to prestige' });
    const rank = rankFor(user.id);
    if (!rank.readyToPrestige) return json(res, 400, { error: 'not ready to prestige' });
    patchUser(user.id, { prestigeConfirmed: rank.prestige + 1, prestigeBaselineXp: rank.totalXp });   // spends whatever was earned, surplus included
    audit(req, 'prestige.confirm', { user, msg: 'prestige ' + user.prestigeConfirmed });
    json(res, 200, { user: nebulaMe(user) });
  },


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
    patchUser(user.id, { badges: picked });
    audit(req, 'account.badges.set', { user, msg: filled.join(',') || 'none' });
    json(res, 200, { user: nebulaMe(user) });
  },

  // A profile picture — same upload shape as POST /api/social/upload (data: URL, capped at
  // MAX_IMAGE_BYTES, written under this user's own uploads dir). Unlike workout photos, an
  // avatar replaces itself: the previous file is deleted right after the new one is written
  // and the user record is saved, so a crash between those two steps leaves an orphaned file
  // rather than a broken reference — the safer order.


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
    patchUser(u.id, { adminXpAdjust: floor + baseline - xpWithoutAdjust });
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
    const patch = { prestigeConfirmed: target };
    if (delta === 1) patch.prestigeBaselineXp = rankFor(u.id).totalXp;
    patchUser(u.id, patch);
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
    const streakBonus = (u.streakBonus || 0) + delta;
    patchUser(u.id, { streakBonus });
    audit(req, 'admin.user.streak', { user: admin, target: u, msg: `bonus -> ${streakBonus}` });
    wsSend(u.id, { type: 'rank:changed' });
    json(res, 200, { streakBonus });
  },

  // No billing exists yet (SettingsSubscription.jsx is catalog-only) — this is the only way
  // an account becomes Pro for now, same "admin nudge, real mechanism later" posture as
  // adminXpAdjust/streakBonus above.


  'POST /api/admin/user/pro': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const pro = !u.pro;
    patchUser(u.id, { pro });
    audit(req, 'admin.user.pro', { user: admin, target: u, msg: String(pro) });
    json(res, 200, { pro });
  },


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
    saveDb();
    patchUser(applicant.id, { coach: true });
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
    notifyCorePush(c.userId, c.status === 'overturned'
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
    patchUser(user.id, { public: !!body.public });
    audit(req, 'social.public.set', { user, msg: user.public ? 'on' : 'off' });
    json(res, 200, { user: nebulaMe(user) });
  },

  // Rank/prestige perk unlocks below — each is a single field, its own route, gated by
  // perksFor(), same shape as /api/social/public above.


  'POST /api/social/bio': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!perksFor(user.id).bio) return json(res, 403, { error: 'not unlocked yet' });
    const body = await readBody(req);
    patchUser(user.id, { bio: String(body.bio || '').trim().slice(0, 140) });
    audit(req, 'social.bio.set', { user });
    json(res, 200, { user: nebulaMe(user) });
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
    const pinnedWorkoutIds = user.pinnedWorkoutIds || [];
    if (!pinnedWorkoutIds.includes(workoutId)) {
      if (pinnedWorkoutIds.length >= perks.pinnedMax) return json(res, 403, { error: 'pin limit reached' });
      patchUser(user.id, { pinnedWorkoutIds: [...pinnedWorkoutIds, workoutId] });
      audit(req, 'social.pin', { user, msg: workoutId });
    }
    json(res, 200, { user: nebulaMe(user) });
  },


  'POST /api/social/unpin': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const before = (user.pinnedWorkoutIds || []).length;
    const pinnedWorkoutIds = (user.pinnedWorkoutIds || []).filter(id => id !== body.workoutId);
    if (pinnedWorkoutIds.length !== before) {
      patchUser(user.id, { pinnedWorkoutIds });
      audit(req, 'social.unpin', { user, msg: body.workoutId });
    }
    json(res, 200, { user: nebulaMe(user) });
  },

  // One pinned PR, separate from pinned workouts — the earliest perk (Bronze), so it
  // doesn't share the Diamond/Prestige-3 pin budget.


  'POST /api/social/pin-pr': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!perksFor(user.id).pinFavoritePR) return json(res, 403, { error: 'not unlocked yet' });
    const body = await readBody(req);
    const workoutId = String(body.workoutId || ''), exerciseId = String(body.exerciseId || '');
    if (!workoutId || !exerciseId) { patchUser(user.id, { pinnedPR: null }); }
    else {
      const w = (readState(user.id)?.workouts || []).find(x => x.id === workoutId);
      if (!w) return json(res, 404, { error: 'no such workout' });
      patchUser(user.id, { pinnedPR: { workoutId, exerciseId } });
    }
    audit(req, 'social.pinPR.set', { user });
    json(res, 200, { user: nebulaMe(user) });
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
        notifyCorePush(promoted.athleteId, { title: 'A spot opened up', body: 'Open the app to reserve it — ' + session.name + ' · ' + session.date + ' ' + session.startTime });
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

/* ---------- internal API (forvia-core only, never exposed publicly — see nginx config) ---------- */
// The one thing forvia-core calls INTO this service for: scanning a freshly-synced state for
// cheating/task-completion/import-level-gain before it's ever written or shown, since that logic
// (and the data it depends on — rankFor/xpFor) is this service's now. Everything else this
// service is told about forvia-core-side events is fire-and-forget (see POST /internal/event
// below); this one call is synchronous on purpose — see forvia-core's own scanViaNebula comment
// for why that ordering is load-bearing.
const internalRoutes = {
  'POST /internal/scan-data': async (req, res) => {
    if (!requireInternal(req, res)) return;
    const body = await readBody(req);
    const uid = body.uid;
    if (!uid || !body.state || typeof body.state !== 'object') return json(res, 400, { error: 'uid and state required' });
    let user = db.users.find(u => u.id === uid);
    if (!user) user = await fetchAndCacheUser(uid);
    if (!user) return json(res, 404, { error: 'no such user' });
    const state = body.state;
    // beforeLevel has to be read BEFORE this service's own stateCache mirror is updated to the
    // new state below — rankFor(uid) here must reflect where the account stood walking into this
    // sync, exactly like the single-service version did (see capImportLevelGain's own comment).
    const beforeLevel = rankFor(uid).level;
    scanForCheating({ headers: {} }, user, state);   // mutates state.workouts in place
    stateCache.set(uid, state);
    if (body.importedNewWorkouts) capImportLevelGain(uid, beforeLevel);
    scanForTasks({ headers: {} }, user, state);
    json(res, 200, { state });
  },
  // Fire-and-forget notifications FROM forvia-core — right now just account deletion (nothing
  // else on forvia-core's side changes user_state or `users` outside of the synchronous calls
  // above and this service's own patchUser/writeState).
  'POST /internal/event': async (req, res) => {
    if (!requireInternal(req, res)) return;
    const body = await readBody(req);
    if (body.event === 'account-deleted') {
      const uid = body.uid;
      // Same cleanup POST /api/account/delete always did inline, before the split — nothing
      // more, nothing less (this project has never cleaned up a deleted account's box
      // memberships/coach requests/cheat penalties either; not this change's job to start).
      db.follows = db.follows.filter(f => f.followerId !== uid && f.followeeId !== uid);
      db.reactions = db.reactions.filter(r => r.userId !== uid);
      db.comments = db.comments.filter(c => c.userId !== uid);
      db.taskCompletions = db.taskCompletions.filter(c => c.userId !== uid);
      saveDb();
      db.users = db.users.filter(u => u.id !== uid);
      stateCache.delete(uid);
    }
    json(res, 200, { ok: true });
  },
};

/* ---------- boot ---------- */
// Nothing above this point talks to Postgres or forvia-core — db/stateCache/auditCache are just
// declared, and the HTTP server doesn't start listening until they're actually populated, so no
// request can ever observe an empty mirror.
async function main() {
  await ensureSchema();
  db = { ...db, ...(await loadAll()) };   // loadAll() only knows this service's own COLLECTIONS (db.js) — users/subs stay whatever refreshUsersMirror sets below
  await refreshUsersMirror();
  await loadStateMirror();
  if (AUDIT_ON) {
    auditCache = await auditAll();
    auditSeq = auditCache.length ? auditCache[auditCache.length - 1].id : 0;
    auditCount = auditCache.length;
    pruneAudit();
    setInterval(pruneAudit, 3600000).unref();
  }
  backfillCheatPenaltySnapshots();
  backfillStreakXpBaselines();
  setInterval(waitlistOfferTick, 30000).unref();
  // Not a correctness requirement for anything this service writes itself (patchUser already
  // keeps this optimistically fresh) — this is for the fields ONLY forvia-core ever changes
  // (disabling/deleting an account, a forvia-core-side admin action) that would otherwise never
  // reach this service's mirror at all.
  setInterval(refreshUsersMirror, 20000).unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = req.method + ' ' + url.pathname;
    const isInternal = url.pathname.startsWith('/internal/');
    const handler = isInternal ? internalRoutes[key] : routes[key];
    if (!handler) return json(res, 404, { error: 'not found' });
    if (!isInternal) {
      const uid = await resolveSession(req);
      if (uid) {
        let u = db.users.find(x => x.id === uid);
        if (!u) u = await fetchAndCacheUser(uid);
        req.__user = u || null;
      }
    }
    try { await handler(req, res); }
    catch (e) {
      console.error(key, e);
      if (!res.headersSent) json(res, 500, { error: 'server error' });
    }
  });

  // WS auth mirrors every HTTP route: resolve the same session cookie through forvia-core (the
  // brief cache above makes this cheap even though a client may reconnect often), reject the
  // upgrade if it doesn't resolve to a real account.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (req, socket, head) => {
    const uid = await resolveSession(req);
    if (!uid) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      if (!wsByUser.has(uid)) wsByUser.set(uid, new Set());
      wsByUser.get(uid).add(ws);
      ws.on('close', () => {
        const set = wsByUser.get(uid);
        if (set) { set.delete(ws); if (!set.size) wsByUser.delete(uid); }
      });
    });
  });

  server.listen(PORT, () => console.log(`forvia (Nebula) on :${PORT}`));
}

main().catch(e => { console.error('boot failed:', e); process.exit(1); });
