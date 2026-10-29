// AI credit purchases: Stripe's webhook signature check (the stripe library, offline), crediting the
// account through core, the purchase row in Postgres and the live refresh over WebSocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { WebSocket } from 'ws';
import { createDatabase, startServer, client, waitFor } from './helpers.mjs';
import { startFakeCore } from './fake-core.mjs';

const WEBHOOK_SECRET = 'whsec_test_' + 'x'.repeat(24);
const stripe = new Stripe('sk_test_unused');
let db, core, server;
before(async () => {
  db = await createDatabase();
  core = await startFakeCore();
  server = await startServer({ databaseUrl: db.url, coreUrl: core.url, env: { STRIPE_SECRET_KEY: 'sk_test_unused', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } });
});
after(async () => { await server?.stop(); await core?.close(); await db?.drop(); });

function checkoutCompleted(uid, { sessionId = 'cs_test_' + Math.random().toString(36).slice(2), credits = 50 } = {}) {
  return JSON.stringify({
    id: 'evt_' + sessionId, object: 'event', type: 'checkout.session.completed',
    data: { object: { id: sessionId, object: 'checkout.session', amount_total: 499, currency: 'eur', metadata: { uid, credits: String(credits), packId: 'pack-50' } } },
  });
}
const deliver = (payload, signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })) =>
  client(server.url).request('POST', '/api/ai-credits/webhook', payload, { 'Stripe-Signature': signature });

test('a forged or missing signature is rejected', async () => {
  const acct = core.addUser();
  const payload = checkoutCompleted(acct.user.id);
  assert.equal((await deliver(payload, 't=1,v1=deadbeef')).status, 400);
  assert.equal((await client(server.url).request('POST', '/api/ai-credits/webhook', payload)).status, 400);
  const wrongSecret = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
  assert.equal((await deliver(payload, wrongSecret)).status, 400);
  assert.equal(core.users.get(acct.user.id).aiScanCredits, undefined);
});

test('a completed checkout credits the account once, records it and tells the app live', async () => {
  const acct = core.addUser({ aiScanCredits: 5 });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws', { headers: { Cookie: acct.cookie } });
  const messages = [];
  ws.on('message', d => messages.push(JSON.parse(d.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  // The api only knows accounts it has seen; this one signs in first, as the buyer would have.
  assert.equal((await client(server.url).request('GET', '/api/me/nebula', undefined, { Cookie: acct.cookie })).status, 200);

  const payload = checkoutCompleted(acct.user.id, { sessionId: 'cs_test_once', credits: 50 });
  const r = await deliver(payload);
  assert.equal(r.status, 200);
  assert.equal(core.users.get(acct.user.id).aiScanCredits, 55);
  await waitFor(() => messages.some(m => m.type === 'rank:changed'), { what: 'ws rank:changed' });
  await waitFor(async () => (await db.query(`SELECT data FROM kv_ai_credit_purchases WHERE data->>'stripeSessionId' = 'cs_test_once'`)).rowCount === 1, { what: 'purchase row' });

  // Stripe retries deliveries; a replay must not credit twice.
  assert.equal((await deliver(payload)).status, 200);
  assert.equal(core.users.get(acct.user.id).aiScanCredits, 55);
  assert.equal((await db.query(`SELECT 1 FROM kv_ai_credit_purchases WHERE data->>'stripeSessionId' = 'cs_test_once'`)).rowCount, 1);
  ws.close();
});

test('other event types are acknowledged and ignored', async () => {
  const payload = JSON.stringify({ id: 'evt_other', object: 'event', type: 'customer.created', data: { object: {} } });
  assert.equal((await deliver(payload)).status, 200);
});
