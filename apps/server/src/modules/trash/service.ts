import type { TrashItem } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { notFound } from '../../errors';
import { logActivity } from '../activity/service';
import { removeOrphanFiles } from '../attachments/service';

export const TRASH_RETENTION_DAYS = 30;

/** Everything deleted in one operation shares the same `deletedAt`, which is how a "group" is identified. */
export async function listTrash(): Promise<TrashItem[]> {
  const workspaceId = await getWorkspaceId();
  const [folders, pages] = await Promise.all([
    prisma.folder.findMany({ where: { workspaceId, deletedAt: { not: null } } }),
    prisma.page.findMany({ where: { workspaceId, deletedAt: { not: null } }, select: { id: true, title: true, folderId: true, parentPageId: true, deletedAt: true } }),
  ]);
  const fMap = new Map(folders.map((f) => [f.id, f]));
  const pMap = new Map(pages.map((p) => [p.id, p]));
  const groupSize = new Map<number, number>();
  [...folders, ...pages].forEach((x) => groupSize.set(x.deletedAt!.getTime(), (groupSize.get(x.deletedAt!.getTime()) ?? 0) + 1));
  const sameGroup = (a: Date | null | undefined, b: Date) => !!a && a.getTime() === b.getTime();
  const out: TrashItem[] = [];
  for (const f of folders) {
    const parent = f.parentId ? fMap.get(f.parentId) : undefined;
    if (!sameGroup(parent?.deletedAt, f.deletedAt!)) out.push({ kind: 'folder', id: f.id, title: f.name, deletedAt: f.deletedAt!.toISOString(), childCount: (groupSize.get(f.deletedAt!.getTime()) ?? 1) - 1 });
  }
  for (const p of pages) {
    const container = p.parentPageId ? pMap.get(p.parentPageId) : p.folderId ? fMap.get(p.folderId) : undefined;
    if (!sameGroup(container?.deletedAt, p.deletedAt!)) out.push({ kind: 'page', id: p.id, title: p.title, deletedAt: p.deletedAt!.toISOString(), childCount: (groupSize.get(p.deletedAt!.getTime()) ?? 1) - 1 });
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

async function loadDeleted(kind: 'folder' | 'page', id: string) {
  const item = kind === 'folder' ? await prisma.folder.findFirst({ where: { id, deletedAt: { not: null } } }) : await prisma.page.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!item) throw notFound('Trashed item');
  return item;
}

/** Restores an item plus everything deleted with it. If its old container is gone, it returns to the workspace root. */
export async function restore(kind: 'folder' | 'page', id: string): Promise<void> {
  const item = await loadDeleted(kind, id);
  const at = item.deletedAt!;
  const alive = async (k: 'folder' | 'page', cid: string | null) =>
    !cid ? true : !!(k === 'folder' ? await prisma.folder.findFirst({ where: { id: cid, deletedAt: null } }) : await prisma.page.findFirst({ where: { id: cid, deletedAt: null } }));
  const detach: Promise<unknown>[] = [];
  if (kind === 'folder') {
    const f = item as { parentId: string | null };
    if (!(await alive('folder', f.parentId))) detach.push(prisma.folder.update({ where: { id }, data: { parentId: null } }));
  } else {
    const pg = item as { folderId: string | null; parentPageId: string | null };
    if (!(await alive('folder', pg.folderId)) || !(await alive('page', pg.parentPageId))) {
      detach.push(prisma.page.update({ where: { id }, data: { folderId: null, parentPageId: null } }));
    }
  }
  await Promise.all(detach);
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { deletedAt: at }, data: { deletedAt: null } }),
    prisma.page.updateMany({ where: { deletedAt: at }, data: { deletedAt: null } }),
  ]);
  await logActivity('restored', kind, id, kind === 'folder' ? (item as { name: string }).name : (item as { title: string }).title);
}

async function purgeWhere(where: { deletedAt: Date | { not: null } | { lt: Date } }) {
  const attachments = await prisma.attachment.findMany({ where: { page: { deletedAt: where.deletedAt } }, select: { storagePath: true } });
  await prisma.$transaction([prisma.page.deleteMany({ where: { deletedAt: where.deletedAt } }), prisma.folder.deleteMany({ where: { deletedAt: where.deletedAt } })]);
  await removeOrphanFiles(attachments.map((a) => a.storagePath));
}

/** Permanently deletes an item and everything deleted with it. Cannot be undone. */
export async function purge(kind: 'folder' | 'page', id: string): Promise<void> {
  const item = await loadDeleted(kind, id);
  await purgeWhere({ deletedAt: item.deletedAt! });
}
export const emptyTrash = () => purgeWhere({ deletedAt: { not: null } });
export const purgeExpired = () => purgeWhere({ deletedAt: { lt: new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000) } });
