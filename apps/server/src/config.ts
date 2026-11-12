import os from 'node:os';
import path from 'node:path';

/**
 * All user data lives outside the repository. The POC uses its own directory so that
 * sample data never mixes with a future "real" LocalSpace data directory.
 */
export const dataDir =
  process.env.LOCALSPACE_DATA_DIR ?? path.join(os.homedir(), 'Library', 'Application Support', 'LocalSpace-POC');
export const dbPath = path.join(dataDir, 'localspace.db');
export const backupsDir = path.join(dataDir, 'backups');
export const attachmentsDir = path.join(dataDir, 'attachments');
export const port = Number(process.env.PORT ?? 4000);
export const host = '127.0.0.1';
export const BACKUPS_TO_KEEP = 10;
/** Minimum time between automatic version snapshots of a page. */
export const VERSION_INTERVAL_MS = Number(process.env.LOCALSPACE_VERSION_INTERVAL_MS ?? 10 * 60 * 1000);
export const MAX_AUTO_VERSIONS = 100;
