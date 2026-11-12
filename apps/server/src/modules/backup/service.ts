import fs from 'node:fs';
import path from 'node:path';
import type { BackupInfo } from '@localspace/shared';
import { BACKUPS_TO_KEEP, attachmentsDir, backupsDir, dbPath } from '../../config';
import { prisma, reopenAfterRestore } from '../../db';
import { HttpError, badRequest, notFound } from '../../errors';

/**
 * A backup is a directory `backup-<timestamp>/` holding `localspace.db` (a consistent SQLite snapshot)
 * and `attachments/` (hard links to the files, so it costs no extra disk and survives later deletions).
 * Older single-file `localspace-*.db` backups are still listed and restorable (database only).
 */
const NAME_RE = /^(backup-[\w-]+|localspace-[\w-]+\.db)$/;
let restoring = false;
export const isRestoring = () => restoring;

const dirSize = (dir: string): number =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

function toInfo(name: string): BackupInfo {
  const p = path.join(backupsDir, name);
  const st = fs.statSync(p);
  const size = st.isDirectory() ? fs.statSync(path.join(p, 'localspace.db')).size : st.size;
  return { name, size, createdAt: st.mtime.toISOString() };
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((n) => NAME_RE.test(n))
    .filter((n) => { const p = path.join(backupsDir, n); return fs.statSync(p).isDirectory() ? fs.existsSync(path.join(p, 'localspace.db')) : true; })
    .map(toInfo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function prune() {
  for (const b of listBackups().slice(BACKUPS_TO_KEEP)) fs.rmSync(path.join(backupsDir, b.name), { recursive: true, force: true });
}

/** Mirrors a directory tree, hard-linking files (falls back to copying across volumes). */
function linkTree(src: string, dst: string, overwrite = true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) linkTree(s, d, overwrite);
    else if (!fs.existsSync(d) || overwrite) {
      fs.rmSync(d, { force: true });
      try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); }
    }
  }
}

/** Consistent online snapshot using SQLite's VACUUM INTO (safe while the server is running). */
export async function createBackup(): Promise<BackupInfo> {
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const dir = path.join(backupsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'localspace.db');
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  linkTree(attachmentsDir, path.join(dir, 'attachments'));
  prune();
  return toInfo(name);
}

/** Pre-migration backup: a plain file copy (the DB is not open yet at that point). */
export function copyBackupBeforeMigration() {
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.copyFileSync(dbPath, path.join(backupsDir, `localspace-premigrate-${Date.now()}.db`));
}

export function lastBackupAt(): string | null {
  return listBackups()[0]?.createdAt ?? null;
}

/**
 * Replaces the live database with a backup. A safety backup of the current state is taken first,
 * so a restore can itself be undone by restoring that safety backup.
 */
export async function restoreBackup(name: string): Promise<{ safetyBackup: string }> {
  if (!NAME_RE.test(name)) throw badRequest('Invalid backup name');
  const src = path.join(backupsDir, name);
  if (!fs.existsSync(src)) throw notFound('Backup');
  const srcDb = fs.statSync(src).isDirectory() ? path.join(src, 'localspace.db') : src;
  if (!fs.existsSync(srcDb)) throw notFound('Backup database');
  const head = Buffer.alloc(16);
  const fd = fs.openSync(srcDb, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('utf8', 0, 15) !== 'SQLite format 3') throw badRequest('This backup is not a valid SQLite database');
  if (restoring) throw new HttpError(409, 'BUSY', 'A restore is already running');

  const safety = await createBackup();
  restoring = true;
  try {
    await prisma.$disconnect();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
    fs.copyFileSync(srcDb, dbPath);
    if (fs.statSync(src).isDirectory()) linkTree(path.join(src, 'attachments'), attachmentsDir, false); // additive: never removes files
    await reopenAfterRestore();
  } catch (e) {
    // Put the pre-restore state back so a failed restore never leaves the app without data.
    try {
      await prisma.$disconnect();
      for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
      fs.copyFileSync(path.join(backupsDir, safety.name, 'localspace.db'), dbPath);
      await reopenAfterRestore();
    } catch { /* surfaced below */ }
    throw new HttpError(500, 'RESTORE_FAILED', `Restore failed and the previous data was put back: ${(e as Error).message}`);
  } finally {
    restoring = false;
  }
  return { safetyBackup: safety.name };
}
