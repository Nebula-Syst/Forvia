// Test harness: every test file boots the real api/server.js as a child process, against its own
// throwaway Postgres database and its own DATA_DIR, and talks to it over HTTP and WebSocket —
// nothing is imported from server.js or mocked inside it. That is the point: these tests exist so
// a dependency update (pg, ws, stripe, Node itself) can be merged on a green run, and only the real
// process exercises the real dependency. forvia-core is the one thing faked (fake-core.mjs): it is
// another repo, and its side of the internal API is tested there.
//
// Needs a Postgres the tests may create databases in: TEST_DATABASE_URL, defaulting to the dev
// stack's (docker/dev, published on 127.0.0.1:5432). CI provides one as a service container.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://forvia:forvia@127.0.0.1:5432/forvia';
export const INTERNAL_SECRET = 'test-internal-secret';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitFor(check, { timeout = 10000, interval = 50, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${what}` + (last instanceof Error ? `: ${last.message}` : ''));
}

// A fresh database per test file, dropped afterwards — tests never see each other's rows.
export async function createDatabase() {
  const name = 'forvia_test_' + crypto.randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: ADMIN_DB_URL });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(ADMIN_DB_URL);
  url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  return {
    url: url.toString(),
    query: (text, params) => pool.query(text, params),
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_DB_URL });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } finally { await c.end(); }
    },
  };
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

// Boots server.js against a fake forvia-core (coreUrl, see fake-core.mjs).
export async function startServer({ databaseUrl, coreUrl, dataDir, env = {} } = {}) {
  const port = await freePort();
  dataDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'forvia-api-test-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_URL: databaseUrl,
      ORIGIN: 'http://localhost',
      INTERNAL_SECRET,
      CORE_URL: coreUrl,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  let exited = null;
  const exitPromise = new Promise(resolve => child.on('exit', code => { exited = code ?? 'signal'; resolve(); }));

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => {
      if (exited !== null) throw new Error(`server exited (${exited})`);
      const r = await fetch(url + '/api/health');
      return r.ok;
    }, { timeout: 20000, what: 'server health' });
  } catch (e) {
    child.kill('SIGKILL');
    throw new Error(`${e.message}\n--- server output ---\n${output}`);
  }
  return {
    url, port, dataDir,
    output: () => output,
    async stop() {
      if (exited === null) { child.kill('SIGTERM'); await exitPromise; }
    },
  };
}

// fetch with a one-cookie jar (the session cookie), JSON in and out.
export function client(baseUrl) {
  let cookie = '';
  async function request(method, urlPath, body, headers = {}) {
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      if (/Max-Age=0/i.test(sc)) cookie = '';
      else if (pair.startsWith('gymsid=')) cookie = pair;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    request,
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b = {}, h) => request('POST', p, b, h),
    put: (p, b = {}, h) => request('PUT', p, b, h),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

export const internalHeaders = { 'X-Internal-Secret': INTERNAL_SECRET };

// Every route key in server.js, read straight from its route tables — a route added later is
// swept automatically.
export function routeKeys(file = path.join(ROOT, 'server.js')) {
  const src = fs.readFileSync(file, 'utf8');
  return [...new Set([...src.matchAll(/^\s*'(GET|POST|PUT|PATCH|DELETE) (\/[^']*)':/gm)].map(m => `${m[1]} ${m[2]}`))];
}

// A client already signed in as `account` (an account from fakeCore.addUser).
export function as(baseUrl, account) {
  const c = client(baseUrl);
  c.cookie = account.cookie;
  return c;
}

// The api only knows an account once it has made a request (or after its periodic mirror refresh
// from core, every 20 s) — the same as in production, where the other person has used the app.
export async function signIn(baseUrl, ...accounts) {
  for (const account of accounts) {
    const r = await as(baseUrl, account).get('/api/me/nebula');
    if (r.status !== 200) throw new Error(`sign-in failed: ${r.status} ${r.text}`);
  }
}

// A 500 is the catch-all a handler that threw ends up in. Other 5xx are deliberate (503: a
// feature like Stripe or OpenAI that this instance has no key for).
export const expectNoCrash = (assert, r, label) => assert.notEqual(r.status, 500, `${label} crashed: ${r.text}`);
