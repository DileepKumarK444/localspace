import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { attachmentsDir, backupsDir, dataDir, dbPath } from './config';

/**
 * SQLite has a single writer. With Prisma's default connection pool, parallel requests open several connections that fight
 * over the write lock and fail with "socket timeout". One connection makes Prisma queue queries instead (WAL mode still
 * lets that connection be fast), and the generous timeouts let a burst of requests drain rather than error.
 */
export const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}?connection_limit=1&socket_timeout=30&pool_timeout=60` } } });

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '../prisma/schema.prisma');

/** Applies pending Prisma migrations (additive only). If the DB already exists and a migration is pending, a backup is taken first. */
function migrate(backupFirst: () => void) {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const run = (args: string[]) =>
    execFileSync(process.execPath, [prismaCli, ...args, '--schema', schemaPath], { env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: 'pipe' });
  if (fs.existsSync(dbPath)) {
    // `migrate status` exits non-zero when migrations are pending; no DB connection is opened in this process.
    try {
      run(['migrate', 'status']);
      return; // up to date: nothing to apply, so no write lock is needed (and a running instance is not disturbed)
    } catch (e) {
      const out = String((e as { stderr?: Buffer }).stderr ?? e);
      if (/locked/i.test(out)) throw new Error('The LocalSpace database is in use by another LocalSpace process. Stop the other copy first (lsof -ti :4000 | xargs kill).');
      backupFirst(); // pending migration: take a backup before touching the data
    }
  }
  run(['migrate', 'deploy']);
}

/**
 * Full-text search index. Prisma cannot model FTS5 virtual tables, so it is created with raw SQL.
 * It is an external-content index over "Page", kept in sync by triggers.
 */
async function ensureSearchIndex() {
  const exists = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='page_fts'`,
  );
  const stmts = [
    `CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(title, contentText, content='Page', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
    `CREATE TRIGGER IF NOT EXISTS page_fts_ai AFTER INSERT ON "Page" BEGIN
       INSERT INTO page_fts(rowid, title, contentText) VALUES (new.rowid, new.title, new.contentText);
     END`,
    `CREATE TRIGGER IF NOT EXISTS page_fts_ad AFTER DELETE ON "Page" BEGIN
       INSERT INTO page_fts(page_fts, rowid, title, contentText) VALUES ('delete', old.rowid, old.title, old.contentText);
     END`,
    `CREATE TRIGGER IF NOT EXISTS page_fts_au AFTER UPDATE OF title, contentText ON "Page" BEGIN
       INSERT INTO page_fts(page_fts, rowid, title, contentText) VALUES ('delete', old.rowid, old.title, old.contentText);
       INSERT INTO page_fts(rowid, title, contentText) VALUES (new.rowid, new.title, new.contentText);
     END`,
  ];
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  if (exists.length === 0) await prisma.$executeRawUnsafe(`INSERT INTO page_fts(page_fts) VALUES('rebuild')`);
}

async function afterOpen() {
  await prisma.$queryRawUnsafe(`PRAGMA journal_mode=WAL`);
  await prisma.$queryRawUnsafe(`PRAGMA foreign_keys=ON`);
  await ensureSearchIndex();
  const ws = await prisma.workspace.findFirst();
  if (!ws) await prisma.workspace.create({ data: { name: 'My Workspace', icon: 'L' } });
}

export async function initDb(backupFirst: () => void = () => {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });
  migrate(backupFirst);
  await afterOpen();
}

/** Called after the database file has been swapped by a restore: migrate if the backup is older, reconnect, rebuild search. */
export async function reopenAfterRestore() {
  migrate(() => {});
  await prisma.$connect();
  await afterOpen();
  await prisma.$executeRawUnsafe(`INSERT INTO page_fts(page_fts) VALUES('rebuild')`);
}

export async function getWorkspaceId(): Promise<string> {
  const ws = await prisma.workspace.findFirstOrThrow();
  return ws.id;
}
