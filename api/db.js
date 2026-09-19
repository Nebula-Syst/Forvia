/* Forvia (Nebula service) — PostgreSQL persistence.
   Same shape/reasoning as forvia-core's own db.js (this is the other half of that same split):
   one JSONB row per item, everything mirrored into memory at request time. This service owns a
   strict SUBSET of the original collections — everything gamification/social/coach-box. `users`
   and `subs`, and the user_state table, live in the SAME Postgres instance but are owned and
   migrated by forvia-core, not this service — this file never touches either.

   The one thing this service's audit log has to get right that forvia-core's doesn't: both
   services log to the SAME Postgres instance, so this can't reuse the table name `audit_log` —
   two independent auditSeq counters both starting from their own in-memory count would collide
   on the same `id BIGINT PRIMARY KEY` (and, worse, silently merge each service's events into the
   other's admin audit view). `nebula_audit_log` keeps the two logs as separate as the services
   that write them. */
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://forvia:forvia@db:5432/forvia';
export const pool = new pg.Pool({ connectionString: DATABASE_URL });

const COLLECTIONS = [
  'follows', 'reactions', 'comments', 'tasks', 'taskCompletions', 'cheatPenalties',
  'importLevelCaps', 'streakTiers', 'coachRequests', 'boxes', 'boxMemberships', 'boxInvites',
  'routineAssignments', 'wods', 'wodResults', 'boxRequests', 'boxStaff', 'classTypes',
  'dayTemplates', 'weekTemplates', 'wodTemplates', 'classSessions', 'classBookings',
  'classPenalties', 'liveClasses', 'publicFoods', 'boxPlans',
];
const tableFor = name => 'kv_' + name.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

export async function ensureSchema() {
  const client = await pool.connect();
  try {
    for (const name of COLLECTIONS) {
      await client.query(`CREATE TABLE IF NOT EXISTS ${tableFor(name)} (row_id SERIAL PRIMARY KEY, data JSONB NOT NULL)`);
    }
    await client.query('CREATE TABLE IF NOT EXISTS nebula_audit_log (id BIGINT PRIMARY KEY, data JSONB NOT NULL)');
  } finally { client.release(); }
}

export async function loadAll() {
  const out = {};
  for (const name of COLLECTIONS) {
    const { rows } = await pool.query(`SELECT data FROM ${tableFor(name)} ORDER BY row_id`);
    out[name] = rows.map(r => r.data);
  }
  return out;
}

export async function saveAll(db) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const name of COLLECTIONS) {
      const table = tableFor(name);
      await client.query(`DELETE FROM ${table}`);
      const items = db[name] || [];
      if (items.length) {
        const values = [], params = [];
        items.forEach((item, i) => { values.push(`($${i + 1})`); params.push(JSON.stringify(item)); });
        await client.query(`INSERT INTO ${table} (data) VALUES ${values.join(',')}`, params);
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function appendAudit(rec) {
  await pool.query('INSERT INTO nebula_audit_log (id, data) VALUES ($1, $2)', [rec.id, JSON.stringify(rec)]);
}
export async function auditAll() {
  const { rows } = await pool.query('SELECT data FROM nebula_audit_log ORDER BY id');
  return rows.map(r => r.data);
}
export async function auditDeleteIds(ids) {
  if (!ids.length) return;
  await pool.query('DELETE FROM nebula_audit_log WHERE id = ANY($1::bigint[])', [ids]);
}
export async function auditClearAll() {
  await pool.query('DELETE FROM nebula_audit_log');
}
