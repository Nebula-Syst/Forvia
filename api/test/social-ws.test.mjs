// Social graph + live updates over the ws WebSocket server (and the ws client, both directions).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createDatabase, startServer, as, signIn, waitFor } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

let db, core, server;
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url });
});
after(async () => { await server?.stop(); await core?.close(); await db?.drop(); });

function connect(account) {
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws', { headers: account ? { Cookie: account.cookie } : {} });
  const messages = [];
  ws.on('message', d => messages.push(JSON.parse(d.toString())));
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', () => reject(new Error('rejected'))); });
  return { ws, messages, ready };
}

test('a WebSocket without a valid session is refused', async () => {
  await assert.rejects(connect(null).ready);
  await assert.rejects(connect({ cookie: 'gymsid=forged' }).ready);
});

test('only /ws accepts an upgrade', async () => {
  const acct = core.addUser();
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/elsewhere', { headers: { Cookie: acct.cookie } });
  await assert.rejects(new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }));
});

test('following someone notifies them live, and over push via core', async () => {
  const ana = core.addUser({ name: 'Ana', public: true });
  const ben = core.addUser({ name: 'Ben', public: true });
  await signIn(server.url, ana, ben);
  const live = connect(ben);
  await live.ready;

  assert.equal((await as(server.url, ana).post('/api/social/follow', { userId: ben.user.id })).status, 200);
  const msg = await waitFor(() => live.messages.find(m => m.type === 'social:follow'), { what: 'ws follow event' });
  assert.equal(msg.uid, ana.user.id);
  assert.equal(msg.name, 'Ana');
  await waitFor(() => core.callsTo('POST', '/internal/push').some(c => c.body.uid === ben.user.id), { what: 'push via core' });

  const followers = await as(server.url, ben).get('/api/social/followers');
  assert.ok(followers.body.followers.some(u => u.id === ana.user.id));
  live.ws.close();
});

test('following is idempotent, and unfollow undoes it', async () => {
  const a = core.addUser({ public: true }), b = core.addUser({ public: true });
  await signIn(server.url, a, b);
  const ac = as(server.url, a);
  await ac.post('/api/social/follow', { userId: b.user.id });
  await ac.post('/api/social/follow', { userId: b.user.id });
  assert.equal((await ac.get('/api/social/following')).body.following.filter(u => u.id === b.user.id).length, 1);
  assert.equal((await ac.post('/api/social/unfollow', { userId: b.user.id })).status, 200);
  assert.equal((await ac.get('/api/social/following')).body.following.length, 0);
});

test('private profiles, yourself and unknown ids cannot be followed', async () => {
  const a = core.addUser({ public: true }), hidden = core.addUser({ public: false });
  await signIn(server.url, a, hidden);
  const ac = as(server.url, a);
  assert.equal((await ac.post('/api/social/follow', { userId: hidden.user.id })).status, 404);
  assert.equal((await ac.post('/api/social/follow', { userId: a.user.id })).status, 400);
  assert.equal((await ac.post('/api/social/follow', { userId: 'nobody' })).status, 404);
});

test('making a profile public is written back to core', async () => {
  const a = core.addUser({ public: false });
  assert.equal((await as(server.url, a).post('/api/social/public', { public: true })).status, 200);
  await waitFor(() => core.callsTo('POST', '/internal/user').some(c => c.body.uid === a.user.id && c.body.patch.public === true), { what: 'patch to core' });
  assert.equal(core.users.get(a.user.id).public, true);
});
