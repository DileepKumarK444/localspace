import { getWorkspaceId, prisma } from '../../db';
import { badRequest, notFound } from '../../errors';
import { logActivity } from '../activity/service';
import { folderSubtree, loadMeta, pageSubtree } from './hierarchy';

export interface MoveInput {
  kind: 'folder' | 'page';
  id: string;
  parent: { kind: 'folder' | 'page'; id: string } | null;
  beforeId?: string | null;
}

/** Renumbers `ids` (already in final order) as 0..n-1. */
const renumber = (ids: string[], model: 'folder' | 'page') =>
  ids.map((id, position) => (model === 'folder' ? prisma.folder.update({ where: { id }, data: { position } }) : prisma.page.update({ where: { id }, data: { position } })));

/** Moves/reorders a folder or page: re-parent and place before a sibling, all in one transaction. */
export async function move(input: MoveInput): Promise<void> {
  const workspaceId = await getWorkspaceId();
  const { folders, pages } = await loadMeta(workspaceId);
  const before = input.beforeId ?? null;

  if (input.kind === 'folder') {
    if (!folders.some((f) => f.id === input.id)) throw notFound('Folder');
    if (input.parent && input.parent.kind !== 'folder') throw badRequest('A folder can only be moved into another folder or the root');
    const parentId = input.parent?.id ?? null;
    if (parentId) {
      if (!folders.some((f) => f.id === parentId)) throw notFound('Target folder');
      if (folderSubtree(input.id, folders).has(parentId)) throw badRequest('Cannot move a folder into itself or its own subfolder');
    }
    const siblings = folders.filter((f) => f.parentId === parentId && f.id !== input.id).map((f) => f.id);
    const at = before ? siblings.indexOf(before) : -1;
    siblings.splice(at === -1 ? siblings.length : at, 0, input.id);
    await prisma.$transaction([prisma.folder.update({ where: { id: input.id }, data: { parentId } }), ...renumber(siblings, 'folder')]);
    await logActivity('moved', 'folder', input.id, folders.find((f) => f.id === input.id)!.name);
    return;
  }

  if (!pages.some((p) => p.id === input.id)) throw notFound('Page');
  let folderId: string | null = null;
  let parentPageId: string | null = null;
  if (input.parent?.kind === 'folder') {
    folderId = input.parent.id;
    if (!folders.some((f) => f.id === folderId)) throw notFound('Target folder');
  } else if (input.parent?.kind === 'page') {
    parentPageId = input.parent.id;
    if (!pages.some((p) => p.id === parentPageId)) throw notFound('Target page');
    if (pageSubtree([input.id], new Set(), pages).has(parentPageId)) throw badRequest('Cannot move a page under itself or its own child');
  }
  const siblings = pages
    .filter((p) => p.id !== input.id && p.folderId === folderId && p.parentPageId === parentPageId)
    .map((p) => p.id);
  const at = before ? siblings.indexOf(before) : -1;
  siblings.splice(at === -1 ? siblings.length : at, 0, input.id);
  await prisma.$transaction([prisma.page.update({ where: { id: input.id }, data: { folderId, parentPageId } }), ...renumber(siblings, 'page')]);
  await logActivity('moved', 'page', input.id, pages.find((p) => p.id === input.id)!.title);
}
