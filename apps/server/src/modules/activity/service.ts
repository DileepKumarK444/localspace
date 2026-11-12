import type { ActivityItem, ActivityType } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';

const COALESCE_EDITS_MS = 30 * 60 * 1000;
export const ACTIVITY_RETENTION_DAYS = 90;

/**
 * Records something that happened. Logging must never break the action it describes, so failures are swallowed.
 * Consecutive edits of the same page within 30 minutes collapse into one entry (autosave fires constantly).
 */
export async function logActivity(type: ActivityType, kind: 'folder' | 'page', entityId: string, title: string): Promise<void> {
  try {
    const workspaceId = await getWorkspaceId();
    if (type === 'edited') {
      const last = await prisma.activity.findFirst({ where: { entityId }, orderBy: { createdAt: 'desc' } });
      if (last && last.type === 'edited' && Date.now() - last.createdAt.getTime() < COALESCE_EDITS_MS) {
        await prisma.activity.update({ where: { id: last.id }, data: { createdAt: new Date(), title } });
        return;
      }
    }
    await prisma.activity.create({ data: { workspaceId, type, kind, entityId, title } });
  } catch (e) {
    console.error('[activity] could not record', type, e);
  }
}

export async function listActivity(opts: { limit?: number; before?: string; type?: string }): Promise<ActivityItem[]> {
  const take = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = await prisma.activity.findMany({
    where: { ...(opts.type ? { type: opts.type } : {}), ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  });
  const [pages, folders] = await Promise.all([
    prisma.page.findMany({ where: { id: { in: rows.filter((r) => r.kind === 'page').map((r) => r.entityId) }, deletedAt: null }, select: { id: true, title: true } }),
    prisma.folder.findMany({ where: { id: { in: rows.filter((r) => r.kind === 'folder').map((r) => r.entityId) }, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const live = new Map<string, string>([...pages.map((p) => [p.id, p.title] as const), ...folders.map((f) => [f.id, f.name] as const)]);
  return rows.map((r) => ({
    id: r.id, type: r.type as ActivityType, kind: r.kind as 'folder' | 'page', entityId: r.entityId,
    title: live.get(r.entityId) ?? r.title, createdAt: r.createdAt.toISOString(), exists: live.has(r.entityId),
  }));
}

export async function purgeOldActivity() {
  await prisma.activity.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000) } } });
}
