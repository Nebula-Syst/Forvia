/* forvia-api — username/password auth + per-user state storage for Forvia
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import webpush from 'web-push';

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

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], subs: [], invites: [], follows: [], reactions: [], comments: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.follows = db.follows || [];       // {followerId, followeeId, created}
db.reactions = db.reactions || [];   // {userId, targetUid, workoutId, created} — one row = one like
db.comments = db.comments || [];     // {id, userId, targetUid, workoutId, text, created}
db.tasks = db.tasks || [];           // {id, name, desc, points, criteria: {type, n?, bp?}, created} — admin-defined catalog
db.taskCompletions = db.taskCompletions || [];  // {id, userId, taskId, points, date, created} — awarded automatically, never self-reported
db.cheatPenalties = db.cheatPenalties || [];    // {id, userId, workoutId, reasons, points, date, created}
// A user can hold several employee types at once (e.g. both founder and admin), not one
// flat role — employeeTypes is an array, filtered to the known set on every read so a
// stale/tampered value in db.json can never grant something that isn't in EMPLOYEE_TYPES.
const EMPLOYEE_TYPES = ['founder', 'admin'];
const employeeTypesOf = user => Array.isArray(user?.employeeTypes) ? user.employeeTypes.filter(t => EMPLOYEE_TYPES.includes(t)) : [];
const isAdmin = user => !!user && (employeeTypesOf(user).length > 0 || ADMIN_UIDS.includes(user.id));
// The shape sent to the client for "who am I" — never the password hash/salt, just enough to
// know what username to prefill when changing it.
// No badge preference saved yet → default to showing rank (and prestige, once there is
// any) in the first slots, matching what used to be shown unconditionally. Once someone
// saves *any* selection (including clearing every slot) that explicit array wins forever.
const defaultBadges = rank => ['rank', ...(rank.prestige > 0 ? ['prestige'] : [])];
const badgesFor = (user, rank) => Array.isArray(user.badges) ? user.badges : defaultBadges(rank);

const publicUser = user => {
  const rank = rankFor(user.id);
  return {
    id: user.id, name: user.name, admin: isAdmin(user), employeeTypes: employeeTypesOf(user), username: user.pwd?.username || null,
    public: !!user.public, rank, perks: perksFor(user.id),
    bio: user.bio || '',
    badges: badgesFor(user, rank),
    pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
    email: user.email || null, emailVerified: !!user.emailVerified, phone: user.phone || null,
  };
};
// A user's social presence to OTHER users — never leaks the auth-only fields above.
// Perks ride along here too: they're cosmetic flair, meant to be seen by other people
// (a legend frame, an animated name) — nothing sensitive about them.
const socialUser = user => ({
  id: user.id, name: user.name, perks: perksFor(user.id),
  bio: user.bio || '', badges: badgesFor(user, rankFor(user.id)),
  pinnedWorkoutIds: user.pinnedWorkoutIds || [], pinnedPR: user.pinnedPR || null,
});
// Shared by GET /api/social/comments and the POST /api/social/comment response, so the
// field list only lives in one place.
const publicComment = c => ({
  id: c.id, userId: c.userId, name: (db.users.find(u => u.id === c.userId) || {}).name || '?',
  text: c.text, created: c.created,
});
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- workout photos ---------- */
// Stored on disk under DATA/uploads/<uid>/, served back through GET /api/uploads?uid&file —
// through the API rather than a static nginx mount, so the one visibility rule (owner or a
// currently-public account) applies without touching the web container at all.
const UPLOAD_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const uploadsDir = uid => path.join(DATA, 'uploads', uid.replace(/[^a-zA-Z0-9_-]/g, ''));
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
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
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

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
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
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
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
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
const findByUsername = name => {
  const norm = String(name || '').trim().toLowerCase();
  return norm ? db.users.find(u => u.pwd?.username?.toLowerCase() === norm) : null;
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
const auditFile = path.join(DATA, 'audit.log');
let auditSeq = 0;      // never reset, not even by a clear — a wiped log leaves a visible id gap
let auditCount = 0;

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

function auditLines() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}
// Retention is a cap, not an archive: age first, then the newest AUDIT_MAX of what's left.
function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}
function compactAudit() {
  const rows = auditLines();
  for (const r of rows) if (+r.id > auditSeq) auditSeq = +r.id;
  const keep = auditKeep(rows);
  auditCount = keep.length;
  if (keep.length === rows.length) return;
  try { atomicWrite(auditFile, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}

// Never throws: a log that can't be written must not break signing in.
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
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { return console.error('audit write failed', e.message); }
  // Amortized: a 5000-event cap rewrites the file once per ~1250 events.
  if (AUDIT_MAX && ++auditCount > AUDIT_MAX * 1.25) compactAudit();
}
if (AUDIT_ON) {
  compactAudit();                                // prune on boot, seed auditSeq/auditCount
  setInterval(compactAudit, 3600000).unref();    // honour AUDIT_DAYS on an idle instance too
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

/* ---------- rank / level ---------- */
// XP needed to go from level n to n+1 grows quadratically — brisk early (a solid first
// week already levels you up a few times) and a genuine grind near the cap: level 98→99
// costs ~2200 XP, roughly 2-3 months for someone training consistently and clearing a
// few tasks a day. 100 levels total, no reset — tune XP_FOR_LEVEL/the per-action XP
// below if that pace ends up feeling off in practice.
const XP_FOR_LEVEL = n => 80 + Math.round(0.22 * n * n);
const LEVEL_CUM = [0];   // LEVEL_CUM[L] = total XP to *reach* level L+1; LEVEL_CUM[0] = level 1's floor
for (let n = 1; n <= 100; n++) LEVEL_CUM.push(LEVEL_CUM[n - 1] + XP_FOR_LEVEL(n));
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
  const overlapsAnother = !badTiming && allWorkouts.some(o => o !== w && o.id !== w.id && Number(o.start) > 0 && Number(o.end) > 0 && start < Number(o.end) && Number(o.start) < end);
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
// given workoutId once. Called from PUT /api/data, after the write it's scoring.
function scanForCheating(req, user, state) {
  const workouts = state.workouts || [];
  if (!workouts.length) return;
  const already = new Set(db.cheatPenalties.filter(c => c.userId === user.id).map(c => c.workoutId));
  const unit = state.unit || 'kg';
  const today = isoOf(new Date());
  let flaggedMsgs = [];
  workouts.forEach(w => {
    if (!w?.id || already.has(w.id)) return;
    const findings = cheatFindingsFor(w, unit, workouts);
    if (!findings.length) return;
    const levels = Math.min(CHEAT_MAX_LEVELS, findings[0].levels);
    // Snapshotted once, right before this penalty lands — not recomputed later — so the
    // reveal's countdown always starts from exactly where the account really stood the moment
    // it got caught, not wherever XP happens to sit whenever the animation finally plays.
    const before = rankFor(user.id);
    db.cheatPenalties.push({
      id: crypto.randomBytes(8).toString('base64url'), userId: user.id, workoutId: w.id,
      findings, levels, date: today, created: new Date().toISOString(),
      status: 'active',   // 'active' | 'appealed' | 'upheld' | 'overturned'
      appeal: null,        // { message, created } once the account holder disputes it
      seen: false,          // flips true once the "caught you" reveal has actually played
      beforeLevel: before.level, beforeXpInLevel: before.xpInLevel, beforeXpForLevel: before.xpForLevel,
    });
    flaggedMsgs.push(w.id + ':' + findings.map(f => f.id).join(',') + '=' + levels + 'lvl');
  });
  if (flaggedMsgs.length) {
    saveDb();
    audit(req, 'anticheat.flag', { user, msg: flaggedMsgs.join(' | ').slice(0, 120) });
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
// Mirrors scanForCheating: scans what's already stored, dedupes on (userId, taskId, date) via
// db.taskCompletions itself, called from PUT /api/data right after the write.
function scanForTasks(req, user, state) {
  if (!db.tasks.length) return;
  const today = isoOf(new Date());
  const dayWorkouts = (state.workouts || []).filter(w => w?.d === today);
  if (!dayWorkouts.length) return;
  const already = new Set(db.taskCompletions.filter(c => c.userId === user.id && c.date === today).map(c => c.taskId));
  const awarded = [];
  db.tasks.forEach(task => {
    if (already.has(task.id) || !taskCriteriaMet(task.criteria, dayWorkouts)) return;
    db.taskCompletions.push({ id: crypto.randomBytes(8).toString('base64url'), userId: user.id, taskId: task.id, points: task.points, date: today, created: new Date().toISOString() });
    awarded.push(task.name);
  });
  if (awarded.length) {
    saveDb();
    audit(req, 'task.auto_complete', { user, msg: awarded.join(', ').slice(0, 120) });
  }
}
// Deliberately computed fresh from what's already stored (workout count, PRs, the
// bodyweight-goal check Home.jsx itself uses) rather than kept as a mutable counter —
// same reasoning as statsFor/feedItemsFor: nothing to desync, nothing to migrate.
// Only task completions and cheat penalties are their own stored fact, since those are real
// one-time server-side actions (a claim; a ruling), not re-derivable from workout history.
// Raw, un-docked total — anti-cheat penalties are applied in rankFor below, against the
// level actually on screen, not against a number nobody's account is ever measured by.
function xpFor(uid) {
  const S = readState(uid);
  const workouts = S?.workouts || [];
  let xp = workouts.reduce((n, w) => n + workoutXp(w), 0);
  xp += workouts.reduce((n, w) => n + (w.prs?.length || 0), 0) * PR_XP;
  const bw = S?.bodyweight?.length ? S.bodyweight[S.bodyweight.length - 1] : null;
  if (S?.targetW && bw && Math.abs(S.targetW - bw.w) < 0.05) xp += GOAL_XP;
  xp += db.taskCompletions.filter(c => c.userId === uid).reduce((n, c) => n + c.points, 0);
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
  const levelsDocked = db.cheatPenalties.filter(c => c.userId === uid && c.status !== 'overturned').reduce((n, c) => n + c.levels, 0);
  const level = Math.max(1, rawLevel - levelsDocked);
  const readyToPrestige = level === 100;
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
(function backfillCheatPenaltySnapshots() {
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
})();
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
  return {
    pinFavoritePR: level >= 11,   // Bronze
    bio: true,
    maxPhotos: prestige >= 6 ? 8 : (level >= 51 ? 6 : 4),   // Diamond / Prestige 6
    pinnedMax: (level >= 61 ? 1 : 0) + (level >= 81 ? 1 : 0) + (prestige >= 3 ? 1 : 0),   // Master + Elite + Prestige 3
    subscriptionDiscount: prestige >= 10 ? 50 : (prestige >= 5 ? 25 : 0),
    appTheme: prestige >= 8,   // Prestige 8 — exclusive app-wide color theme
  };
}
// Re-checked on every read, never cached from follow time — a user going private must
// disappear from everyone's feed/leaderboard/discovery on their very next request.
const isPublic = uid => { const u = db.users.find(x => x.id === uid); return !!u && !!u.public && !u.disabled; };
const followingOf = uid => db.follows.filter(f => f.followerId === uid).map(f => f.followeeId).filter(isPublic);
const FEED_LIMIT = 50;   // feed page size — a self-hosted instance's follow graph is small
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
        uid, name: u.name, level, prestige, perks,
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

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, allow_register: ALLOW_REGISTER }),

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
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (username.length < 3) return json(res, 400, { error: 'username must be at least 3 characters' });
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    if (findByUsername(username)) return json(res, 409, { error: 'that username is taken' });
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
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, created: new Date().toISOString() };
    user.pwd = { username, ...hashPassword(password) };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    saveDb();
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login': async (req, res) => {
    const body = await readBody(req);
    const user = findByUsername(body.username);
    // Same generic error either way — a username is guessable, so "no such user" vs "wrong
    // password" would let an attacker enumerate accounts.
    const fail = msg => { audit(req, 'auth.login.fail', { ok: false, uid: user?.id, msg }); return json(res, 401, { error: 'incorrect username or password' }) }
    if (!user || !verifyPassword(String(body.password || ''), user.pwd.salt, user.pwd.hash)) return fail(user ? 'bad-password' : 'unknown-username');
    if (user.disabled) { audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' }); return json(res, 403, { error: 'this account has been disabled' }) }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  // Account info — one route per field (same convention as the /api/social/* setters):
  // each call touches exactly one thing on the signed-in account and returns the fresh
  // publicUser() so the frontend never has to guess what changed.
  'POST /api/account/name': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'name required' });
    user.name = name;
    saveDb();
    audit(req, 'account.name.set', { user });
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
    const allowed = new Set(['rank', ...(rank.prestige > 0 ? ['prestige'] : [])]);
    const filled = picked.filter(Boolean);
    if (filled.some(id => !allowed.has(id)) || new Set(filled).size !== filled.length) {
      return json(res, 400, { error: 'invalid badge selection' });
    }
    while (picked.length < 3) picked.push(null);
    user.badges = picked;
    saveDb();
    audit(req, 'account.badges.set', { user, msg: filled.join(',') || 'none' });
    json(res, 200, { user: publicUser(user) });
  },

  // Username only — no password required alongside it (that used to be one combined route;
  // splitting means changing your handle doesn't force picking a new password too).
  'POST /api/account/username': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    if (username.length < 3) return json(res, 400, { error: 'username must be at least 3 characters' });
    const other = findByUsername(username);
    if (other && other.id !== user.id) return json(res, 409, { error: 'that username is taken' });
    user.pwd.username = username;
    saveDb();
    audit(req, 'account.username.set', { user });
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

  // Sets a pending email and fires off a verification link — best-effort: if this instance
  // has no SMTP_HOST configured, the address is still saved (unverified) so it's there once
  // an admin sets one up, and `mailConfigured:false` tells the frontend not to promise a mail
  // that can't be sent.
  'POST /api/account/email': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'enter a valid email address' });
    user.email = email || null;
    user.emailVerified = false;
    delete user.emailVerifyToken;
    if (!email) { saveDb(); audit(req, 'account.email.cleared', { user }); return json(res, 200, { user: publicUser(user), mailSent: false, mailConfigured: SMTP_CONFIGURED }); }
    user.emailVerifyToken = { token: crypto.randomBytes(24).toString('base64url'), expires: Date.now() + 86400000 };
    saveDb();
    audit(req, 'account.email.set', { user });
    const mailSent = SMTP_CONFIGURED && await sendMail({
      to: email, subject: 'Verify your email — Forvia',
      text: `Confirm this is your email address for your Forvia account (${user.pwd?.username || user.name}):\n\n${ORIGIN}/api/account/verify-email?token=${user.emailVerifyToken.token}\n\nIf you didn't request this, you can ignore this message — nothing changes until the link above is opened.`,
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
      text: `Confirm this is your email address for your Forvia account (${user.pwd?.username || user.name}):\n\n${ORIGIN}/api/account/verify-email?token=${user.emailVerifyToken.token}\n\nIf you didn't request this, you can ignore this message — nothing changes until the link above is opened.`,
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
    try { fs.unlinkSync(stateFile(id)); } catch {}
    try { fs.rmSync(uploadsDir(id), { recursive: true, force: true }); } catch {}
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // Reads the session purely so the sign-out can be recorded; the cookie is cleared either way.
  // A logout with no valid cookie is a no-op and isn't worth an entry.
  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) audit(req, 'auth.logout', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    scanForCheating(req, user, body.state);
    scanForTasks(req, user, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
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
        id: u.id, name: u.name, username: u.pwd?.username || null, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), employeeTypes: employeeTypesOf(u), invitedBy: u.invitedBy || null,
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
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), employeeTypes: employeeTypesOf(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
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
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (username.length < 3) return json(res, 400, { error: 'username must be at least 3 characters' });
    if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    if (findByUsername(username)) return json(res, 409, { error: 'that username is taken' });
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, created: new Date().toISOString() };
    user.pwd = { username, ...hashPassword(password) };
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
    let rows = auditKeep(auditLines()).reverse();
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
    try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
    auditCount = 0;
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
  // The actual ruling on a review request. Overturning drops it from xpFor() on the very next
  // read (nothing else to recompute); upholding just records that a human looked and agreed —
  // either way the account holder's appeal message stays on the record.
  'POST /api/admin/anticheat/review': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const c = db.cheatPenalties.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'no such penalty' });
    if (!['uphold', 'overturn'].includes(body.decision)) return json(res, 400, { error: 'invalid decision' });
    c.status = body.decision === 'overturn' ? 'overturned' : 'upheld';
    c.reviewedBy = admin.id;
    c.reviewedAt = new Date().toISOString();
    saveDb();
    audit(req, 'admin.anticheat.review', { user: admin, msg: c.workoutId + ':' + c.status });
    json(res, 200, { ok: true, status: c.status });
  },

  /* ---------- daily tasks (XP) ---------- */
  // The catalog's copy (name/description/points) is admin-authored, but whether a task is
  // DONE is graded server-side by scanForTasks against real workout data — there's no
  // "mark complete" route any more, on purpose (see taskCriteriaMet above).
  'GET /api/admin/tasks': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    json(res, 200, { tasks: db.tasks, bodyParts: TASK_BODY_PARTS });
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

  // Today's catalog for the signed-in user, with per-task completion state. Completions
  // are per calendar day (server-local date), so the checklist clears itself overnight
  // with no cron job — "today" is just a different string tomorrow. done is only ever
  // set by scanForTasks (called from PUT /api/data) — this route is read-only.
  'GET /api/tasks/today': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const today = isoOf(new Date());
    const done = new Set(db.taskCompletions.filter(c => c.userId === me.id && c.date === today).map(c => c.taskId));
    json(res, 200, { tasks: db.tasks.map(t => ({ ...t, done: done.has(t.id) })) });
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
  'GET /api/social/feed': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { items: feedItemsFor(followingOf(me.id), me) });
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
  // the account isn't public any more, same rule as everywhere else in Social.
  'GET /api/social/user': async (req, res) => {
    const me = readSession(req);
    if (!me) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const uid = q.get('uid') || '';
    const u = db.users.find(x => x.id === uid);
    if (!u || u.disabled || !u.public) return json(res, 404, { error: 'not found' });
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
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (origin=${ORIGIN})`));
