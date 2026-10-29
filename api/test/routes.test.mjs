// Every route in server.js, called the wrong way: signed out, as a normal user, a coach and an
// admin, with an empty body. None may crash (500) — that is a handler throwing on input it should
// reject, which is exactly what a dependency update tends to surface. The route list is
// read from server.js, so new routes are covered without touching this file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, startServer, client, as, routeKeys, internalHeaders, expectNoCrash } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

const keys = routeKeys();
const publicKeys = keys.filter(k => !k.split(' ')[1].startsWith('/internal/'));
const internalKeys = keys.filter(k => k.split(' ')[1].startsWith('/internal/'));

let db, core, server, admin;
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
  admin = core.addUser({ name: 'Sweep admin', public: true });
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url, env: { ADMIN_UIDS: admin.user.id } });
});
after(async () => { await server?.stop(); await core?.close(); await db?.drop(); });

const call = (c, key, headers) => {
  const [method, p] = key.split(' ');
  return c.request(method, p, method === 'GET' ? undefined : {}, headers);
};
const expectNo5xx = (r, label) => expectNoCrash(assert, r, label);

test('found the routes', () => {
  assert.ok(publicKeys.length > 100, `only ${publicKeys.length} public routes found`);
  assert.equal(internalKeys.length, 3);
});

test('signed out: no route crashes', async () => {
  for (const key of publicKeys) expectNo5xx(await call(client(server.url), key), `${key} (signed out)`);
});

for (const [role, fields] of [['user', {}], ['coach', { coach: true }], ['admin', null]]) {
  test(`${role}: no route crashes`, async () => {
    for (const key of publicKeys) {
      const account = fields ? core.addUser({ public: true, ...fields }) : admin;
      expectNo5xx(await call(as(server.url, account), key), `${key} (${role})`);
    }
  });
}

test('internal routes: no crash with the secret, 403 without', async () => {
  for (const key of internalKeys) {
    expectNo5xx(await call(client(server.url), key, internalHeaders), `${key} (internal)`);
    assert.equal((await call(client(server.url), key)).status, 403, `${key} answered without the secret`);
  }
});

test('the server is still up after the sweep', async () => {
  assert.equal((await client(server.url).get('/api/health')).status, 200);
});
