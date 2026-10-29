// A stand-in for forvia-core's internal API (/internal/*), just enough of its contract for the
// api to run against: sessions, the users mirror, synced state and push. The real side of this
// contract is tested in the forvia-core repo (test/internal.test.mjs) — keep the two in step.
//
// Every call is recorded in `calls`, so a test can assert what the api asked core to do (a user
// patch after a Stripe purchase, a push after a follow).
import crypto from 'node:crypto';
import http from 'node:http';
import { INTERNAL_SECRET } from './helpers.mjs';

export async function startFakeCore() {
  const users = new Map();
  const sessions = new Map();     // Cookie header -> uid
  const states = new Map();
  const calls = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch {}
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) return send(403, { error: 'forbidden' });
      const uid = url.searchParams.get('uid');
      switch (req.method + ' ' + url.pathname) {
        case 'POST /internal/session': {
          const id = sessions.get(String(body.cookie || ''));
          return send(200, { user: id && users.has(id) ? users.get(id) : null });
        }
        case 'GET /internal/user':
          return users.has(uid) ? send(200, { user: users.get(uid) }) : send(404, { error: 'not found' });
        case 'GET /internal/users':
          return send(200, { users: [...users.values()] });
        case 'GET /internal/users/search': {
          const q = (url.searchParams.get('q') || '').replace(/^@/, '').toLowerCase();
          return send(200, { users: q.length < 2 ? [] : [...users.values()].filter(u => (u.username || '').toLowerCase().includes(q)) });
        }
        case 'POST /internal/user':
          if (!users.has(body.uid)) return send(404, { error: 'not found' });
          Object.assign(users.get(body.uid), body.patch || {});
          return send(200, { ok: true });
        case 'GET /internal/state':
          return send(200, { state: states.get(uid) || null });
        case 'PUT /internal/state':
          states.set(body.uid, body.state);
          return send(200, { ok: true });
        case 'GET /internal/states':
          return send(200, { states: Object.fromEntries(states) });
        case 'POST /internal/push':
          return send(200, { ok: true });
        default:
          return send(404, { error: 'not found' });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    users, states, calls,
    // An account as forvia-core would hold it (no credentials — those never leave core), plus a
    // session cookie that resolves to it.
    addUser(fields = {}) {
      const id = crypto.randomBytes(12).toString('base64url');
      const user = { id, name: 'User ' + id.slice(0, 4), created: new Date().toISOString(), ...fields };
      users.set(id, user);
      const cookie = 'gymsid=' + crypto.randomBytes(24).toString('base64url');
      sessions.set(cookie, id);
      return { user, cookie };
    },
    callsTo: (method, path) => calls.filter(c => c.method === method && c.path === path),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
