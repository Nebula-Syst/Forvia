// Boot while forvia-core is still starting: the users/state mirrors must still end up loaded.
// In production this is a deploy (compose only waits for core-api's container to exist) or a host
// reboot (every container starts at once) — core-api answering a few seconds after this service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, startServer, as, sleep, waitFor } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

let db, core;
const servers = [];
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
});
after(async () => {
  for (const s of servers) await s.stop();
  await core?.close();
  await db?.drop();
});

// An account with two synced workouts in core — GET /api/social/me reads them from the state
// mirror only (nothing else fills it for an account that hasn't synced since boot).
function accountWithWorkouts() {
  const acc = core.addUser({ name: 'Ana' });
  core.states.set(acc.user.id, { workouts: [{ id: 'w1' }, { id: 'w2' }] });
  return acc;
}

test('core answering a moment after boot: both mirrors load before serving', async () => {
  const ana = accountWithWorkouts();
  core.down = true;
  const upLater = sleep(1500).then(() => { core.down = false; });
  const server = await startServer({ databaseUrl: db.url, coreUrl: core.url, env: { BOOT_MIRROR_RETRY_MS: '200' } });
  servers.push(server);
  await upLater;
  const me = await as(server.url, ana).get('/api/social/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.workouts, 2, 'state mirror was not loaded');
  assert.match(server.output(), /mirrors loaded after/);
  await server.stop();
});

test('core still down past the boot wait: serves anyway, state mirror loads late', async () => {
  const ana = accountWithWorkouts();
  core.down = true;
  const server = await startServer({
    databaseUrl: db.url, coreUrl: core.url,
    env: { BOOT_MIRROR_WAIT_MS: '600', BOOT_MIRROR_RETRY_MS: '200', LATE_STATE_RETRY_MS: '300' },
  });
  servers.push(server);
  assert.match(server.output(), /state mirror still empty/);
  core.down = false;
  await waitFor(() => /state mirror loaded \(late\)/.test(server.output()), { what: 'late state mirror load' });
  const me = await as(server.url, ana).get('/api/social/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.workouts, 2, 'late state mirror load did not fill the account');
  await server.stop();
});
