// Boot, schema and persistence through pg, and the session lookup against forvia-core.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, startServer, client, as, signIn, waitFor } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

let db, core, server;
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url });
});
after(async () => { await server?.stop(); await core?.close(); await db?.drop(); });

test('creates its own tables and never touches forvia-core\'s', async () => {
  const { rows } = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const tables = rows.map(r => r.table_name);
  for (const t of ['kv_follows', 'kv_reactions', 'kv_comments', 'kv_tasks', 'kv_boxes', 'kv_class_sessions',
    'kv_ai_scans', 'kv_ai_credit_purchases', 'kv_ad_rewards', 'nebula_audit_log']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  for (const t of ['kv_users', 'kv_subs', 'user_state', 'audit_log']) assert.ok(!tables.includes(t), `created core's table ${t}`);
});

test('health answers without a session', async () => {
  assert.equal((await client(server.url).get('/api/health')).status, 200);
});

test('a session is whatever forvia-core says the cookie is', async () => {
  const ana = core.addUser({ name: 'Ana', bio: 'bio of ana' });
  const me = await as(server.url, ana).get('/api/me/nebula');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.bio, 'bio of ana');
  assert.ok(core.callsTo('POST', '/internal/session').some(c => c.body.cookie === ana.cookie));

  assert.equal((await client(server.url).get('/api/me/nebula')).status, 401);
  const forged = client(server.url); forged.cookie = 'gymsid=forged';
  assert.equal((await forged.get('/api/me/nebula')).status, 401);
});

test('a brand-new account works on its first request (fetched from core, not waiting for the mirror)', async () => {
  const fresh = core.addUser({ name: 'Fresh' });
  assert.equal((await as(server.url, fresh).get('/api/me/nebula')).status, 200);
  assert.ok(core.callsTo('GET', '/internal/user').some(c => c.query.uid === fresh.user.id));
});

test('its own data survives a restart', async () => {
  const a = core.addUser({ public: true }), b = core.addUser({ public: true });
  await signIn(server.url, a, b);
  assert.equal((await as(server.url, a).post('/api/social/follow', { userId: b.user.id })).status, 200);
  await waitFor(async () => (await db.query(`SELECT 1 FROM kv_follows WHERE data->>'followerId' = $1`, [a.user.id])).rowCount, { what: 'follow persisted' });
  await server.stop();
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url, dataDir: server.dataDir });
  const following = await as(server.url, a).get('/api/social/following');
  assert.ok(following.body.following.some(u => u.id === b.user.id));
});
