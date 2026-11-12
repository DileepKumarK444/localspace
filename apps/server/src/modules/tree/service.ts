import type { TreeResponse } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { loadMeta } from './hierarchy';

export async function getTree(): Promise<TreeResponse> {
  const workspaceId = await getWorkspaceId();
  const { folders, pages } = await loadMeta(workspaceId);
  const [favs, recents] = await Promise.all([
    prisma.favorite.findMany({ where: { workspaceId, page: { deletedAt: null } }, orderBy: { createdAt: 'asc' } }),
    prisma.recentView.findMany({ where: { page: { deletedAt: null } }, orderBy: { viewedAt: 'desc' }, take: 6 }),
  ]);
  return {
    folders,
    pages: pages.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
    favorites: favs.map((f) => f.pageId),
    recents: recents.map((r) => r.pageId),
  };
}
