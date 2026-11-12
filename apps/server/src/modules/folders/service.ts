import type { FolderNode } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { badRequest, notFound } from '../../errors';
import { logActivity } from '../activity/service';
import { folderSubtree, loadMeta, pageSubtree } from '../tree/hierarchy';

const toNode = (f: { id: string; name: string; parentId: string | null; position: number; color: string | null }): FolderNode => ({
  id: f.id, name: f.name, parentId: f.parentId, position: f.position, color: f.color,
});

async function nextPosition(workspaceId: string, parentId: string | null) {
  const agg = await prisma.folder.aggregate({ where: { workspaceId, parentId, deletedAt: null }, _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}

export async function createFolder(input: { name: string; parentId?: string | null }): Promise<FolderNode> {
  const workspaceId = await getWorkspaceId();
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: parentId, deletedAt: null } });
    if (!parent) throw notFound('Parent folder');
  }
  const position = await nextPosition(workspaceId, parentId);
  const f = await prisma.folder.create({ data: { workspaceId, parentId, name: input.name, position } });
  await logActivity('created', 'folder', f.id, f.name);
  return toNode(f);
}

export async function updateFolder(id: string, input: { name?: string; parentId?: string | null; color?: string | null }): Promise<FolderNode> {
  const workspaceId = await getWorkspaceId();
  const existing = await prisma.folder.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound('Folder');
  const data: { name?: string; parentId?: string | null; position?: number; color?: string | null } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.color !== undefined) data.color = input.color ? input.color.toLowerCase() : null;
  if (input.parentId !== undefined && input.parentId !== existing.parentId) {
    if (input.parentId) {
      const { folders } = await loadMeta(workspaceId);
      if (!folders.some((f) => f.id === input.parentId)) throw notFound('Target folder');
      if (folderSubtree(id, folders).has(input.parentId)) throw badRequest('Cannot move a folder into itself or its own subfolder');
    }
    data.parentId = input.parentId;
    data.position = await nextPosition(workspaceId, input.parentId);
  }
  const updated = await prisma.folder.update({ where: { id }, data });
  if (input.name !== undefined && input.name !== existing.name) await logActivity('renamed', 'folder', id, updated.name);
  if (data.position !== undefined) await logActivity('moved', 'folder', id, updated.name);
  return toNode(updated);
}

/** Soft-deletes a folder and everything inside it in a single transaction. Returns number of items affected. */
export async function deleteFolder(id: string): Promise<{ folders: number; pages: number }> {
  const workspaceId = await getWorkspaceId();
  const { folders, pages } = await loadMeta(workspaceId);
  if (!folders.some((f) => f.id === id)) throw notFound('Folder');
  const folderIds = folderSubtree(id, folders);
  const pageIds = pageSubtree([], folderIds, pages);
  const now = new Date();
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: [...folderIds] } }, data: { deletedAt: now } }),
    prisma.page.updateMany({ where: { id: { in: [...pageIds] } }, data: { deletedAt: now } }),
  ]);
  await logActivity('deleted', 'folder', id, folders.find((f) => f.id === id)!.name);
  return { folders: folderIds.size, pages: pageIds.size };
}
