import { createApp } from './app';
import { dataDir, host, port } from './config';
import { initDb, prisma } from './db';
import { copyBackupBeforeMigration, createBackup, listBackups } from './modules/backup/service';
import { purgeOldActivity } from './modules/activity/service';
import { purgeExpired } from './modules/trash/service';
import { seedIfEmpty } from './seed';

async function main() {
  // A second copy would fight the first one over the database file, so say so clearly instead of crashing mid-start.
  try {
    if ((await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(800) })).ok) {
      console.error(`LocalSpace is already running at http://${host}:${port} — open that address, or stop it first:\n  lsof -ti :${port} | xargs kill`);
      process.exit(1);
    }
  } catch { /* nothing answering: the port is free */ }
  await initDb(copyBackupBeforeMigration);
  if (await seedIfEmpty()) console.log('[seed] created sample workspace');
  await purgeExpired();
  await purgeOldActivity();
  // Snapshot at start (at most hourly, so frequent restarts don't push older backups out) and every 6 hours while running.
  const last = listBackups()[0];
  if (!last || Date.now() - new Date(last.createdAt).getTime() > 3_600_000) await createBackup();
  setInterval(() => void createBackup().catch((e) => console.error('[backup] failed', e)), 6 * 3_600_000).unref();

  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`LocalSpace API listening on http://${host}:${port}`);
    console.log(`Data directory: ${dataDir}`);
  });
  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Failed to start LocalSpace:', e);
  process.exit(1);
});
