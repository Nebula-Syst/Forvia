// The internal API forvia-core calls on this service (/internal/*).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, startServer, client, signIn, internalHeaders } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

let db, core, server;
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url });
});
after(async () => { await server?.stop(); await core?.close(); await db?.drop(); });

const post = (p, b, h = internalHeaders) => client(server.url).post(p, b, h);

test('every internal route refuses a missing or wrong secret', async () => {
  for (const p of ['/internal/scan-data', '/internal/event', '/internal/ad-grant']) {
    assert.equal((await client(server.url).post(p, {})).status, 403, p);
    assert.equal((await post(p, {}, { 'X-Internal-Secret': 'wrong' })).status, 403, p);
  }
});

test('scan-data returns the state it was given, after its anti-cheat pass', async () => {
  const acct = core.addUser();
  const state = { workouts: [], routines: [{ id: 'r1', name: 'Legs' }], unit: 'kg' };
  const r = await post('/internal/scan-data', { uid: acct.user.id, state, importedNewWorkouts: 0 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.state.routines, state.routines);
  assert.ok(Array.isArray(r.body.state.workouts));
  assert.equal((await post('/internal/scan-data', { uid: acct.user.id })).status, 400);
  assert.equal((await post('/internal/scan-data', { uid: 'nobody', state })).status, 404);
});

test('ad-grant credits once per reward id', async () => {
  const acct = core.addUser();
  await signIn(server.url, acct);
  const first = await post('/internal/ad-grant', { uid: acct.user.id, sourceRewardId: 'rw-1', rewardAmount: 10 });
  assert.equal(first.status, 200);
  assert.notEqual(first.body.granted, false);
  const again = await post('/internal/ad-grant', { uid: acct.user.id, sourceRewardId: 'rw-1', rewardAmount: 10 });
  assert.deepEqual(again.body, { granted: false, reason: 'duplicate' });
  assert.equal((await post('/internal/ad-grant', { uid: acct.user.id })).status, 400);
});

test('account-deleted removes the account\'s social footprint', async () => {
  const a = core.addUser({ public: true }), b = core.addUser({ public: true });
  await signIn(server.url, a, b);
  await client(server.url).post('/api/social/follow', { userId: b.user.id }, { Cookie: a.cookie });
  assert.equal((await post('/internal/event', { event: 'account-deleted', uid: a.user.id })).status, 200);
  const followers = await client(server.url).get('/api/social/followers', { Cookie: b.cookie });
  assert.ok(!followers.body.followers.some(u => u.id === a.user.id));
});
