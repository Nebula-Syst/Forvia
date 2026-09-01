/* One-off migration: reads the old JSON-file storage (db.json, state-<uid>.json, audit.log)
   from a data directory and imports it into Postgres via db.js — run once per instance, by
   hand, when moving that instance from the file-based storage to the bundled Postgres
   container. Safe to run again: it's a full replace (saveAll/saveState overwrite whatever's
   already there for that collection/user), not an additive import.

   Usage: DATA_DIR=/path/to/data DATABASE_URL=postgres://... node scripts/migrate-json-to-pg.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema, saveAll, saveState, appendAudit, pool } from '../db.js';

const DATA = process.env.DATA_DIR;
if (!DATA) { console.error('Set DATA_DIR to the folder holding db.json / state-*.json / audit.log'); process.exit(1); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

async function main() {
  await ensureSchema();

  const dbFile = path.join(DATA, 'db.json');
  const db = readJson(dbFile, null);
  if (!db) { console.error(`No db.json found at ${dbFile} — nothing to migrate.`); process.exit(1); }
  const collections = ['users', 'subs', 'invites', 'follows', 'reactions', 'comments', 'tasks', 'taskCompletions', 'cheatPenalties'];
  for (const name of collections) db[name] = db[name] || [];
  await saveAll(db);
  console.log(`✓ ${db.users.length} users, ${db.tasks.length} tasks, ${db.taskCompletions.length} task completions, ${db.invites.length} invites, ${db.cheatPenalties.length} cheat penalties, ${db.follows.length} follows, ${db.reactions.length} reactions, ${db.comments.length} comments, ${db.subs.length} push subs`);

  let stateCount = 0;
  for (const file of fs.readdirSync(DATA)) {
    const m = /^state-(.+)\.json$/.exec(file);
    if (!m) continue;
    const state = readJson(path.join(DATA, file), null);
    if (!state) { console.warn(`  ! skipped unreadable ${file}`); continue; }
    await saveState(m[1], state);
    stateCount++;
  }
  console.log(`✓ ${stateCount} per-user state files`);

  const auditFile = path.join(DATA, 'audit.log');
  let auditCount = 0;
  try {
    const text = fs.readFileSync(auditFile, 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.id && rec.ev) { await appendAudit(rec); auditCount++; }
      } catch { /* torn line — same as the old auditLines() behaviour, dropped */ }
    }
  } catch { /* no audit.log — fine, nothing recorded yet */ }
  console.log(`✓ ${auditCount} audit log events`);

  await pool.end();
  console.log('Migration complete.');
}
main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
